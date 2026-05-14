import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { AssetEnrichmentTrace, EnrichmentProvenance } from "../../../domain/entities/AssetEnrichmentTrace";
import { CURRENT_TRACE_VERSION } from "../../../domain/entities/AssetEnrichmentTrace";
import type { ProjectAssetRepository } from "../../../domain/repositories/ProjectAssetRepository";
import type { GetLlmCatalog } from "../../use-cases/GetLlmCatalog";
import type { PlatformConfig } from "../../../domain/entities/PlatformConfig";
import { resolvePromptTaskSettingFromConfig } from "../../../domain/entities/PlatformConfig";
import { env } from "../../../config";
import { detectEnrichmentKind, isDocumentKind, isImageKind } from "./EnrichmentKindDetector";
import { buildEnrichmentTrace } from "./EnrichmentTraceBuilder";
import { getParser } from "../parsers/DocumentParserFactory";
import { extractDocumentBrief } from "./DocumentBriefExtractor";
import { analyzeImage } from "../image/ImageAnalyzer";
import { prepareImageBuffer } from "../image/ImageResizeGuard";
import type { DocumentTextLayer } from "../../../domain/entities/AssetEnrichmentTrace";

export interface EnrichmentInput {
    asset: ProjectAsset;
    fileBuffer: Buffer;
    getLlmCatalog: GetLlmCatalog;
    assetRepository: ProjectAssetRepository;
    /** Optional — when provided, admin-configured task settings override env var defaults. */
    platformConfig?: Pick<PlatformConfig, "governanceByProduct"> | null;
}

function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none"): string | undefined {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return (authType ?? "bearer") === "api-key" ? key : `Bearer ${key}`;
}

function pendingProvenance(parserName: string): EnrichmentProvenance {
    return {
        traceVersion: CURRENT_TRACE_VERSION,
        enrichmentStatus: "pending",
        enrichedAt: null,
        processingMs: null,
        parserName,
        parserVersion: "unknown",
        llmProvider: null,
        llmModel: null,
        llmTokensUsed: null,
        llmCostEur: null,
        errorMessage: null,
    };
}

function resolveProvider(catalog: Awaited<ReturnType<GetLlmCatalog["execute"]>>, providerKey: string) {
    return catalog.providers.find(p => p.provider === providerKey && p.isActive)
        ?? catalog.providers.find(p => p.provider === providerKey)
        ?? catalog.providers.find(p => p.isActive);
}

export class AssetEnrichmentPipeline {
    async enrich(input: EnrichmentInput): Promise<AssetEnrichmentTrace> {
        if (!env.enrichmentEnabled) {
            return this.skippedTrace(input.asset, "enrichment disabled via ENRICHMENT_ENABLED=false");
        }

        const assetKind = detectEnrichmentKind(input.asset.mimeType);
        const startMs = Date.now();

        // Save pending trace immediately so UI can show "analyzing…"
        const pendingTrace = buildEnrichmentTrace({
            asset: input.asset,
            assetKind,
            provenance: pendingProvenance("pending"),
            textLayer: null,
            documentBrief: null,
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
        });
        pendingTrace.provenance.enrichmentStatus = "pending";
        await input.assetRepository.saveEnrichmentTrace(
            input.asset.id,
            input.asset.projectId,
            pendingTrace,
        );

        try {
            if (isDocumentKind(assetKind) && env.enrichmentDocumentParsing) {
                return await this.enrichDocument(input, assetKind, startMs);
            }

            if (isImageKind(assetKind) && env.enrichmentImageAnalysis) {
                return await this.enrichImage(input, assetKind, startMs);
            }

            return await this.saveTrace(input, buildEnrichmentTrace({
                asset: input.asset,
                assetKind,
                provenance: {
                    ...pendingProvenance("none"),
                    enrichmentStatus: "skipped",
                    processingMs: Date.now() - startMs,
                },
                textLayer: null,
                documentBrief: null,
                colorPalette: null,
                visualAnalysis: null,
                designSignals: null,
            }));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[AssetEnrichmentPipeline] enrichment failed for asset ${input.asset.id}:`, err);
            const failedTrace = buildEnrichmentTrace({
                asset: input.asset,
                assetKind,
                provenance: {
                    ...pendingProvenance("error"),
                    enrichmentStatus: "failed",
                    processingMs: Date.now() - startMs,
                    errorMessage,
                },
                textLayer: null,
                documentBrief: null,
                colorPalette: null,
                visualAnalysis: null,
                designSignals: null,
            });
            await input.assetRepository.saveEnrichmentTrace(
                input.asset.id,
                input.asset.projectId,
                failedTrace,
            );
            return failedTrace;
        }
    }

    private async enrichDocument(
        input: EnrichmentInput,
        assetKind: AssetEnrichmentTrace["assetKind"],
        startMs: number,
    ): Promise<AssetEnrichmentTrace> {
        const parser = getParser(input.asset.mimeType);
        if (!parser) {
            return this.saveTrace(input, buildEnrichmentTrace({
                asset: input.asset,
                assetKind,
                provenance: { ...pendingProvenance("none"), enrichmentStatus: "skipped", processingMs: Date.now() - startMs },
                textLayer: null, documentBrief: null, colorPalette: null, visualAnalysis: null, designSignals: null,
            }));
        }

        const parsed = await parser.parse(input.fileBuffer, input.asset.mimeType);

        const textLayer: DocumentTextLayer = {
            wordCount: parsed.wordCount,
            charCount: parsed.charCount,
            languageHint: "unknown",
            pageCount: parsed.pageCount,
            sectionCount: parsed.sectionCount,
            extractedTextSnippet: parsed.rawText.slice(0, 8000),
            fullTextStored: false,
        };

        let documentBrief = null;
        let llmProvider: string | null = null;
        let llmModel: string | null = null;
        let llmTokensUsed: number | null = null;

        if (env.enrichmentDocumentLlmPass && parsed.rawText.length >= 50) {
            const taskSetting = resolvePromptTaskSettingFromConfig(input.platformConfig, "default", "enrich_document");
            const textProviderKey = taskSetting?.provider ?? env.ENRICHMENT_TEXT_PROVIDER;
            const textModel = taskSetting?.model ?? env.ENRICHMENT_TEXT_MODEL;
            const catalog = await input.getLlmCatalog.execute();
            const provider = resolveProvider(catalog, textProviderKey);
            if (provider) {
                const authHeader = resolveAuthHeader(provider.provider, provider.authType);
                const result = await extractDocumentBrief({
                    textSnippet: parsed.rawText,
                    baseUrl: provider.baseUrl,
                    model: textModel,
                    authHeader,
                });
                documentBrief = result.brief;
                llmProvider = provider.provider;
                llmModel = textModel;
                llmTokensUsed = result.tokensUsed;
            }
        }

        const trace = buildEnrichmentTrace({
            asset: input.asset,
            assetKind,
            provenance: {
                traceVersion: CURRENT_TRACE_VERSION,
                enrichmentStatus: "ready",
                enrichedAt: new Date(),
                processingMs: Date.now() - startMs,
                parserName: parsed.parserName,
                parserVersion: parsed.parserVersion,
                llmProvider,
                llmModel,
                llmTokensUsed,
                llmCostEur: null,
                errorMessage: null,
            },
            textLayer,
            documentBrief,
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
        });

        return this.saveTrace(input, trace);
    }

    private async enrichImage(
        input: EnrichmentInput,
        assetKind: AssetEnrichmentTrace["assetKind"],
        startMs: number,
    ): Promise<AssetEnrichmentTrace> {
        const taskSetting = resolvePromptTaskSettingFromConfig(input.platformConfig, "default", "enrich_image");
        const visionProviderKey = taskSetting?.provider ?? env.ENRICHMENT_VISION_PROVIDER;
        const visionModel = taskSetting?.model ?? env.ENRICHMENT_VISION_MODEL;
        const catalog = await input.getLlmCatalog.execute();
        const provider = resolveProvider(catalog, visionProviderKey);

        if (!provider) {
            return this.saveTrace(input, buildEnrichmentTrace({
                asset: input.asset,
                assetKind,
                provenance: { ...pendingProvenance("none"), enrichmentStatus: "skipped", processingMs: Date.now() - startMs, errorMessage: "No vision provider available" },
                textLayer: null, documentBrief: null, colorPalette: null, visualAnalysis: null, designSignals: null,
            }));
        }

        const { buffer: safeBuffer } = await prepareImageBuffer(input.fileBuffer);
        const authHeader = resolveAuthHeader(provider.provider, provider.authType);

        const { colorPalette, visualAnalysis, designSignals, tokensUsed } = await analyzeImage({
            buffer: safeBuffer,
            mimeType: input.asset.mimeType,
            baseUrl: provider.baseUrl,
            model: visionModel,
            authHeader,
        });

        const trace = buildEnrichmentTrace({
            asset: input.asset,
            assetKind,
            provenance: {
                traceVersion: CURRENT_TRACE_VERSION,
                enrichmentStatus: "ready",
                enrichedAt: new Date(),
                processingMs: Date.now() - startMs,
                parserName: "vision-model",
                parserVersion: visionModel,
                llmProvider: provider.provider,
                llmModel: visionModel,
                llmTokensUsed: tokensUsed,
                llmCostEur: null,
                errorMessage: null,
            },
            textLayer: null,
            documentBrief: null,
            colorPalette,
            visualAnalysis,
            designSignals,
        });

        return this.saveTrace(input, trace);
    }

    private async saveTrace(input: EnrichmentInput, trace: AssetEnrichmentTrace): Promise<AssetEnrichmentTrace> {
        const updated = await input.assetRepository.saveEnrichmentTrace(
            input.asset.id,
            input.asset.projectId,
            trace,
        );
        // Mirror distilled fields back to semanticMetadata for backward compat (spec section 10)
        if (updated) {
            await input.assetRepository.update(
                input.asset.id,
                input.asset.projectId,
                input.asset.userId,
                {
                    semanticMetadata: {
                        title: trace.distilledTitle,
                        summary: trace.distilledSummary,
                        description: trace.documentBrief?.purposeSentence
                            ?? trace.visualAnalysis?.sceneDescription
                            ?? "",
                        tags: trace.distilledTags,
                        colors: trace.distilledColors,
                        mediaKind: this.toMediaKind(trace.assetKind),
                        classifierProvider: trace.provenance.llmProvider ?? "system",
                        classifierModel: trace.provenance.llmModel ?? "heuristic-media-classifier-v1",
                        classifiedAt: trace.provenance.enrichedAt ?? new Date(),
                    },
                },
            );
        }
        return trace;
    }

    private toMediaKind(kind: AssetEnrichmentTrace["assetKind"]): "image" | "background" | "logo" | "icon" | "document" | "reference" {
        if (kind === "image_raster" || kind === "image_svg") return "image";
        if (kind === "pdf" || kind === "docx" || kind === "txt" || kind === "md") return "document";
        return "reference";
    }

    private skippedTrace(asset: ProjectAsset, reason: string): AssetEnrichmentTrace {
        return buildEnrichmentTrace({
            asset,
            assetKind: detectEnrichmentKind(asset.mimeType),
            provenance: {
                traceVersion: CURRENT_TRACE_VERSION,
                enrichmentStatus: "skipped",
                enrichedAt: null,
                processingMs: 0,
                parserName: "none",
                parserVersion: "none",
                llmProvider: null,
                llmModel: null,
                llmTokensUsed: null,
                llmCostEur: null,
                errorMessage: reason,
            },
            textLayer: null,
            documentBrief: null,
            colorPalette: null,
            visualAnalysis: null,
            designSignals: null,
        });
    }
}
