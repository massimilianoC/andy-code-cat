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
import { buildDatasetAppendixPrompt, buildDocumentBriefPrompt, extractDatasetAppendix, extractDocumentBrief } from "./DocumentBriefExtractor";
import { analyzeImage } from "../image/ImageAnalyzer";
import { prepareImageBuffer } from "../image/ImageResizeGuard";
import type { DocumentTextLayer } from "../../../domain/entities/AssetEnrichmentTrace";
import { CostTransactionService } from "../../cost/CostTransactionService";
import { ResourceType } from "../../../domain/entities/CostTransaction";
import { estimateCost } from "../../llm/costPolicy";
import { getSiliconFlowPrice } from "../../llm/siliconflowPricing";
import { buildDatasetStructuredData, normalizeDatasetBuffer } from "../../datasets/DatasetRuntime";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { DatasetCacheStore } from "../../datasets/DatasetCacheStore";
import type { PromptExecutionLogRepository } from "../../../domain/repositories/PromptExecutionLogRepository";
import { ExecutionLogger } from "../../services/ExecutionLogger";

export interface EnrichmentInput {
    asset: ProjectAsset;
    fileBuffer: Buffer;
    getLlmCatalog: GetLlmCatalog;
    assetRepository: ProjectAssetRepository;
    promptExecutionLogRepository?: PromptExecutionLogRepository;
    sourceContext?: {
        conversationId?: string;
        messageId?: string;
        backgroundTaskId?: string;
    };
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

/**
 * Record an enrichment LLM call in the cost ledger.
 *
 * Every asset always carries (userId, projectId) so the double-sandbox
 * is enforced upstream — we just attribute the spend here. Fire-and-forget;
 * never blocks the enrichment pipeline.
 */
function recordEnrichmentCost(params: {
    asset: ProjectAsset;
    providerKey: string;
    modelId: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    taskKey: "enrich_document" | "enrich_image" | "enrich_dataset_appendix";
    sourceContext?: EnrichmentInput["sourceContext"];
}): number | null {
    if (!params.usage.totalTokens) return null;

    let providerCostUsd: number | undefined;
    if (params.providerKey === "siliconflow") {
        const sfPrice = getSiliconFlowPrice(params.modelId);
        if (sfPrice && sfPrice.priceUnit === "per_m_tokens") {
            providerCostUsd =
                (params.usage.promptTokens / 1_000_000) * sfPrice.input +
                (params.usage.completionTokens / 1_000_000) * sfPrice.output;
        }
    }

    const costEstimate = estimateCost(
        {
            capability: "chat",
            tokenUsage: params.usage,
            providerCostUsd,
        },
        {
            textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
            imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
            videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
            usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
            providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
        },
    );

    CostTransactionService.instance.record({
        userId: params.asset.userId,
        projectId: params.asset.projectId,
        resourceType: ResourceType.LLM_BACKGROUND,
        resourceSubtype: params.modelId,
        providerCostUsd,
        precomputedTotalEur: costEstimate.amount,
        units: params.usage,
        sourceRef: {
            assetId: params.asset.id,
            conversationId: params.sourceContext?.conversationId,
            messageId: params.sourceContext?.messageId,
            backgroundTaskId: params.sourceContext?.backgroundTaskId,
        },
        meta: {
            taskKey: params.taskKey,
            provider: params.providerKey,
            assetId: params.asset.id,
        },
    });

    return costEstimate.amount;
}

export class AssetEnrichmentPipeline {
    private readonly datasetCache = new DatasetCacheStore(getFileStorage());

    private async persistPromptExecutionLog(params: {
        input: EnrichmentInput;
        taskKey: "enrich_document" | "enrich_dataset_appendix";
        provider: string;
        model: string;
        inputPrompt: string;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
        costEur?: number | null;
        status: "succeeded" | "failed";
        durationMs: number;
        errorMessage?: string;
    }): Promise<void> {
        const repo = params.input.promptExecutionLogRepository;
        if (!repo) return;

        await repo.create({
            taskKey: params.taskKey,
            projectId: params.input.asset.projectId,
            userId: params.input.asset.userId,
            conversationId: params.input.sourceContext?.conversationId,
            provider: params.provider,
            model: params.model,
            inputPrompt: params.inputPrompt,
            contextMeta: {
                assetIds: [params.input.asset.id],
                usedMoodboard: false,
                usedUserProfile: false,
            },
            usage: params.usage,
            costEstimate: params.costEur != null ? {
                currency: "EUR",
                amount: params.costEur,
                breakdown: {
                    tokenCost: params.costEur,
                    imageCost: 0,
                    videoCost: 0,
                },
                unitRates: {
                    textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                    imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                    videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                },
            } : undefined,
            status: params.status,
            errorMessage: params.errorMessage,
            durationMs: params.durationMs,
        });
    }

    private emitLlmExecutionLog(params: {
        input: EnrichmentInput;
        eventType: "asset_enrichment_llm_complete" | "asset_enrichment_llm_failed";
        status: "success" | "failure" | "partial";
        provider: string;
        model: string;
        durationMs: number;
        taskKey: "enrich_document" | "enrich_dataset_appendix";
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
        costEur?: number | null;
        errorMessage?: string;
    }): void {
        ExecutionLogger.instance.emit({
            projectId: params.input.asset.projectId,
            conversationId: params.input.sourceContext?.conversationId,
            messageId: params.input.sourceContext?.messageId,
            domain: "llm",
            eventType: params.eventType,
            level: params.status === "failure" ? "error" : params.status === "partial" ? "warn" : "info",
            status: params.status,
            durationMs: params.durationMs,
            metadata: {
                provider: params.provider,
                model: params.model,
                taskKey: params.taskKey,
                assetId: params.input.asset.id,
                promptTokens: params.usage?.promptTokens,
                completionTokens: params.usage?.completionTokens,
                totalTokens: params.usage?.totalTokens,
                costEur: params.costEur ?? null,
                backgroundTaskId: params.input.sourceContext?.backgroundTaskId ?? null,
                errorMessage: params.errorMessage ?? null,
            },
        });
    }

    async enrich(input: EnrichmentInput): Promise<AssetEnrichmentTrace> {
        if (!env.enrichmentEnabled) {
            return this.skippedTrace(input.asset, "enrichment disabled via ENRICHMENT_ENABLED=false");
        }

        // ── Idempotency guard ─────────────────────────────────────────────────
        // If the asset already has a complete enrichment trace (status=ready AND
        // renderedFragment present) we skip the expensive LLM pass entirely and
        // return the cached result.  The caller can force a re-run by passing
        // forceRe-enrich=true (not wired yet — reserved for future admin endpoint).
        // This prevents double-billing and double-processing when the same physical
        // file is attached to multiple conversations in the same project.
        const existingTrace = input.asset.enrichmentTrace;
        if (
            existingTrace &&
            existingTrace.provenance.enrichmentStatus === "ready" &&
            existingTrace.renderedFragment
        ) {
            ExecutionLogger.instance.emit({
                projectId: input.asset.projectId,
                conversationId: input.sourceContext?.conversationId,
                messageId: input.sourceContext?.messageId,
                domain: "system",
                eventType: "asset_enrichment_started",
                level: "info",
                status: "success",
                metadata: {
                    assetId: input.asset.id,
                    assetKind: existingTrace.assetKind,
                    mimeType: input.asset.mimeType,
                    skipped: true,
                    reason: "trace_already_ready",
                    backgroundTaskId: input.sourceContext?.backgroundTaskId ?? null,
                },
            });
            return existingTrace;
        }

        const assetKind = detectEnrichmentKind(input.asset.mimeType);
        const startMs = Date.now();
        ExecutionLogger.instance.emit({
            projectId: input.asset.projectId,
            conversationId: input.sourceContext?.conversationId,
            messageId: input.sourceContext?.messageId,
            domain: "system",
            eventType: "asset_enrichment_started",
            level: "info",
            status: "success",
            metadata: {
                assetId: input.asset.id,
                assetKind,
                mimeType: input.asset.mimeType,
                backgroundTaskId: input.sourceContext?.backgroundTaskId ?? null,
            },
        });

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
                const trace = await this.enrichDocument(input, assetKind, startMs);
                ExecutionLogger.instance.emit({
                    projectId: input.asset.projectId,
                    conversationId: input.sourceContext?.conversationId,
                    messageId: input.sourceContext?.messageId,
                    domain: "system",
                    eventType: "asset_enrichment_completed",
                    level: "info",
                    status: "success",
                    durationMs: Date.now() - startMs,
                    metadata: {
                        assetId: input.asset.id,
                        assetKind,
                        enrichmentStatus: trace.provenance.enrichmentStatus,
                    },
                });
                return trace;
            }

            if (isImageKind(assetKind) && env.enrichmentImageAnalysis) {
                const trace = await this.enrichImage(input, assetKind, startMs);
                ExecutionLogger.instance.emit({
                    projectId: input.asset.projectId,
                    conversationId: input.sourceContext?.conversationId,
                    messageId: input.sourceContext?.messageId,
                    domain: "system",
                    eventType: "asset_enrichment_completed",
                    level: "info",
                    status: "success",
                    durationMs: Date.now() - startMs,
                    metadata: {
                        assetId: input.asset.id,
                        assetKind,
                        enrichmentStatus: trace.provenance.enrichmentStatus,
                    },
                });
                return trace;
            }

            const trace = await this.saveTrace(input, buildEnrichmentTrace({
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
            ExecutionLogger.instance.emit({
                projectId: input.asset.projectId,
                conversationId: input.sourceContext?.conversationId,
                messageId: input.sourceContext?.messageId,
                domain: "system",
                eventType: "asset_enrichment_skipped",
                level: "info",
                status: "partial",
                durationMs: Date.now() - startMs,
                metadata: {
                    assetId: input.asset.id,
                    assetKind,
                },
            });
            return trace;
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
            ExecutionLogger.instance.emit({
                projectId: input.asset.projectId,
                conversationId: input.sourceContext?.conversationId,
                messageId: input.sourceContext?.messageId,
                domain: "system",
                eventType: "asset_enrichment_failed",
                level: "error",
                status: "failure",
                durationMs: Date.now() - startMs,
                metadata: {
                    assetId: input.asset.id,
                    assetKind,
                    errorMessage,
                },
            });
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

        const [parsed, dataset] = await Promise.all([
            parser.parse(input.fileBuffer, input.asset.mimeType),
            normalizeDatasetBuffer(input.fileBuffer, input.asset.mimeType).catch(() => null),
        ]);

        const datasetStructuredData = dataset ? buildDatasetStructuredData(dataset) : null;

        if (dataset) {
            await this.datasetCache.write(input.asset, dataset);
        }

        const textLayer: DocumentTextLayer = {
            wordCount: parsed.wordCount,
            charCount: parsed.charCount,
            languageHint: "unknown",
            pageCount: parsed.pageCount,
            sectionCount: parsed.sectionCount,
            extractedTextSnippet: parsed.rawText.slice(0, 8000),
            fullTextStored: false,
        };

        // Build the structuredData payload from parser output (available before LLM call)
        const earlyStructuredData = datasetStructuredData
            ? ({ kind: "dataset" as const, dataset: datasetStructuredData, sheets: parsed.sheets })
            : parsed.sheets && parsed.sheets.length > 0
                ? ({ kind: "spreadsheet" as const, sheets: parsed.sheets })
                : parsed.slides && parsed.slides.length > 0
                    ? ({ kind: "presentation" as const, slides: parsed.slides })
                    : null;

        // Save textLayer + structuredData immediately so Layer D can inject them
        // even while the LLM brief is still in flight (timing gap fix).
        await input.assetRepository.saveEnrichmentTrace(
            input.asset.id,
            input.asset.projectId,
            buildEnrichmentTrace({
                asset: input.asset,
                assetKind,
                provenance: {
                    ...pendingProvenance(parsed.parserName),
                    parserVersion: parsed.parserVersion,
                },
                textLayer,
                documentBrief: null,
                structuredData: earlyStructuredData,
                colorPalette: null,
                visualAnalysis: null,
                designSignals: null,
            }),
        );

        let documentBrief = null;
        let structuredData: import("../../../domain/entities/AssetEnrichmentTrace").StructuredDataPayload | null = earlyStructuredData;
        let llmProvider: string | null = null;
        let llmModel: string | null = null;
        let llmTokensUsed: number | null = null;
        let llmCostEur: number | null = null;
        // When the brief LLM fails the parsed data (textLayer + structuredData) is
        // already valuable enough for Layer D — record the failure on the trace but
        // keep the asset marked "ready" so it is still injected downstream.
        let briefErrorMessage: string | null = null;

        if (env.enrichmentDocumentLlmPass) {
            const taskSetting = resolvePromptTaskSettingFromConfig(input.platformConfig, "default", "enrich_document");
            const textProviderKey = taskSetting?.provider ?? env.ENRICHMENT_TEXT_PROVIDER;
            const textModel = taskSetting?.model ?? env.ENRICHMENT_TEXT_MODEL;
            const catalog = await input.getLlmCatalog.execute();
            const provider = resolveProvider(catalog, textProviderKey);
            if (provider) {
                const authHeader = resolveAuthHeader(provider.provider, provider.authType);
                llmProvider = provider.provider;
                llmModel = textModel;

                if (parsed.rawText.length >= 50) {
                    const briefPrompt = buildDocumentBriefPrompt({
                        textSnippet: parsed.rawText,
                        assetKind,
                        sheets: parsed.sheets,
                        slides: parsed.slides,
                    });
                    const briefStartMs = Date.now();
                    try {
                        const result = await extractDocumentBrief({
                            textSnippet: parsed.rawText,
                            assetKind,
                            sheets: parsed.sheets,
                            slides: parsed.slides,
                            baseUrl: provider.baseUrl,
                            model: textModel,
                            authHeader,
                        });
                        documentBrief = result.brief;
                        structuredData = result.structuredData ?? earlyStructuredData;
                        llmTokensUsed = (llmTokensUsed ?? 0) + (result.tokensUsed ?? 0);

                        let briefCost: number | null = null;
                        if (result.usage) {
                            briefCost = recordEnrichmentCost({
                                asset: input.asset,
                                providerKey: provider.provider,
                                modelId: textModel,
                                usage: result.usage,
                                taskKey: "enrich_document",
                                sourceContext: input.sourceContext,
                            });
                            llmCostEur = (llmCostEur ?? 0) + (briefCost ?? 0);
                        }
                        await this.persistPromptExecutionLog({
                            input,
                            taskKey: "enrich_document",
                            provider: provider.provider,
                            model: textModel,
                            inputPrompt: briefPrompt.prompt,
                            usage: result.usage,
                            costEur: briefCost,
                            status: "succeeded",
                            durationMs: Date.now() - briefStartMs,
                        });
                        this.emitLlmExecutionLog({
                            input,
                            eventType: "asset_enrichment_llm_complete",
                            status: "success",
                            provider: provider.provider,
                            model: textModel,
                            durationMs: Date.now() - briefStartMs,
                            taskKey: "enrich_document",
                            usage: result.usage,
                            costEur: briefCost,
                        });
                    } catch (briefErr) {
                        briefErrorMessage = briefErr instanceof Error ? briefErr.message : String(briefErr);
                        await this.persistPromptExecutionLog({
                            input,
                            taskKey: "enrich_document",
                            provider: provider.provider,
                            model: textModel,
                            inputPrompt: briefPrompt.prompt,
                            status: "failed",
                            durationMs: Date.now() - briefStartMs,
                            errorMessage: briefErrorMessage,
                        });
                        this.emitLlmExecutionLog({
                            input,
                            eventType: "asset_enrichment_llm_failed",
                            status: "failure",
                            provider: provider.provider,
                            model: textModel,
                            durationMs: Date.now() - briefStartMs,
                            taskKey: "enrich_document",
                            errorMessage: briefErrorMessage,
                        });
                        console.warn(
                            `[AssetEnrichmentPipeline] brief extraction failed for asset ${input.asset.id} — keeping parsed textLayer/structuredData. Reason:`,
                            briefErrorMessage,
                        );
                    }
                }

                if (datasetStructuredData) {
                    const datasetAppendixPrompt = buildDatasetAppendixPrompt(datasetStructuredData);
                    const datasetAppendixStartMs = Date.now();
                    try {
                        const appendixResult = await extractDatasetAppendix({
                            datasetStructuredData,
                            baseUrl: provider.baseUrl,
                            model: textModel,
                            authHeader,
                        });
                        if (structuredData?.dataset) {
                            structuredData.dataset.llmAppendix = appendixResult.appendix;
                        } else if (earlyStructuredData?.dataset) {
                            earlyStructuredData.dataset.llmAppendix = appendixResult.appendix;
                            structuredData = earlyStructuredData;
                        }
                        llmTokensUsed = (llmTokensUsed ?? 0) + (appendixResult.tokensUsed ?? 0);

                        let appendixCost: number | null = null;
                        if (appendixResult.usage) {
                            appendixCost = recordEnrichmentCost({
                                asset: input.asset,
                                providerKey: provider.provider,
                                modelId: textModel,
                                usage: appendixResult.usage,
                                taskKey: "enrich_dataset_appendix",
                                sourceContext: input.sourceContext,
                            });
                            llmCostEur = (llmCostEur ?? 0) + (appendixCost ?? 0);
                        }
                        await this.persistPromptExecutionLog({
                            input,
                            taskKey: "enrich_dataset_appendix",
                            provider: provider.provider,
                            model: textModel,
                            inputPrompt: datasetAppendixPrompt,
                            usage: appendixResult.usage,
                            costEur: appendixCost,
                            status: "succeeded",
                            durationMs: Date.now() - datasetAppendixStartMs,
                        });
                        this.emitLlmExecutionLog({
                            input,
                            eventType: "asset_enrichment_llm_complete",
                            status: "success",
                            provider: provider.provider,
                            model: textModel,
                            durationMs: Date.now() - datasetAppendixStartMs,
                            taskKey: "enrich_dataset_appendix",
                            usage: appendixResult.usage,
                            costEur: appendixCost,
                        });
                    } catch (appendixErr) {
                        const appendixErrorMessage = appendixErr instanceof Error ? appendixErr.message : String(appendixErr);
                        await this.persistPromptExecutionLog({
                            input,
                            taskKey: "enrich_dataset_appendix",
                            provider: provider.provider,
                            model: textModel,
                            inputPrompt: datasetAppendixPrompt,
                            status: "failed",
                            durationMs: Date.now() - datasetAppendixStartMs,
                            errorMessage: appendixErrorMessage,
                        });
                        this.emitLlmExecutionLog({
                            input,
                            eventType: "asset_enrichment_llm_failed",
                            status: "failure",
                            provider: provider.provider,
                            model: textModel,
                            durationMs: Date.now() - datasetAppendixStartMs,
                            taskKey: "enrich_dataset_appendix",
                            errorMessage: appendixErrorMessage,
                        });
                        console.warn(
                            `[AssetEnrichmentPipeline] dataset appendix extraction failed for asset ${input.asset.id} — keeping deterministic dataset envelope only. Reason:`,
                            appendixErrorMessage,
                        );
                        if (!briefErrorMessage) {
                            briefErrorMessage = appendixErrorMessage;
                        }
                    }
                }
            }
        }

        const trace = buildEnrichmentTrace({
            asset: input.asset,
            assetKind,
            provenance: {
                traceVersion: CURRENT_TRACE_VERSION,
                // Parsing succeeded; brief is optional. Layer D can render the asset
                // from textLayer + structuredData alone — see renderAssetLayerDFragment.
                enrichmentStatus: "ready",
                enrichedAt: new Date(),
                processingMs: Date.now() - startMs,
                parserName: parsed.parserName,
                parserVersion: parsed.parserVersion,
                llmProvider,
                llmModel,
                llmTokensUsed,
                llmCostEur,
                errorMessage: briefErrorMessage,
            },
            textLayer,
            documentBrief,
            structuredData,
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

        // prepareImageBuffer transcodes HEIC/HEIF/AVIF/TIFF/BMP → JPEG so the vision
        // provider receives a format it accepts, and resizes oversized images.
        const { buffer: safeBuffer, mimeType: safeMime } = await prepareImageBuffer(
            input.fileBuffer,
            input.asset.mimeType,
        );
        const authHeader = resolveAuthHeader(provider.provider, provider.authType);

        const { colorPalette, visualAnalysis, designSignals, tokensUsed, usage } = await analyzeImage({
            buffer: safeBuffer,
            mimeType: safeMime,
            baseUrl: provider.baseUrl,
            model: visionModel,
            authHeader,
        });

        // ── Cost ledger: attribute vision call to (user, project) ──
        const llmCostEur = usage
            ? recordEnrichmentCost({
                asset: input.asset,
                providerKey: provider.provider,
                modelId: visionModel,
                usage,
                taskKey: "enrich_image",
            })
            : null;

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
                llmCostEur,
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
        if (kind === "pdf" || kind === "docx" || kind === "txt" || kind === "md"
            || kind === "html" || kind === "xlsx" || kind === "csv") return "document";
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
