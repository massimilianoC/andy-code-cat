import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { MongoProjectMoodboardRepository } from "../../../infra/repositories/MongoProjectMoodboardRepository";
import { MongoUserStyleProfileRepository } from "../../../infra/repositories/MongoUserStyleProfileRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { UploadProjectAsset } from "../../../application/use-cases/UploadProjectAsset";
import { UpdateProjectAsset } from "../../../application/use-cases/UpdateProjectAsset";
import { AddUrlReference } from "../../../application/use-cases/AddUrlReference";
import { ListProjectAssets } from "../../../application/use-cases/ListProjectAssets";
import { DeleteProjectAsset } from "../../../application/use-cases/DeleteProjectAsset";
import type { RequestWithContext } from "../types";
import { generateProjectImageSchema, regenerateMediaByKeySchema, regenerateStockProjectImageSchema, suggestProjectImageIdeaSchema, type AssetEnrichmentTraceDto, type DatasetFactsEnvelopeDto, type DatasetTableProfileDto, type ProjectAssetDto } from "@andy-code-cat/contracts";
import { GenerateProjectImage } from "../../../application/use-cases/GenerateProjectImage";
import { GetProjectAiAnalytics } from "../../../application/use-cases/GetProjectAiAnalytics";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoLlmPromptConfigRepository } from "../../../infra/repositories/MongoLlmPromptConfigRepository";
import { GetLlmPromptConfig } from "../../../application/use-cases/GetLlmPromptConfig";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { OptimizeImagePrompt } from "../../../application/prompting/OptimizeImagePrompt";
import { SuggestProjectImageIdea } from "../../../application/prompting/SuggestProjectImageIdea";
import { buildImagePromptContextPacket } from "../../../application/prompting/buildImagePromptContext";
import { AssetEnrichmentPipeline } from "../../../application/documents/enrichment/AssetEnrichmentPipeline";
import { env } from "../../../config";
import { MongoServiceApiKeyRepository } from "../../../infra/repositories/MongoServiceApiKeyRepository";
import { RegenerateStockProjectImage } from "../../../application/use-cases/RegenerateStockProjectImage";
import { buildStockProviderOrder, resolveMediaProviderPolicy } from "../../../application/media/mediaProviderPolicy";
import { MongoMediaResolutionTraceRepository } from "../../../infra/repositories/MongoMediaResolutionTraceRepository";
import { RegenerateMediaByKey } from "../../../application/use-cases/RegenerateMediaByKey";
import { resolveAttachmentPolicyFromConfig } from "../../../domain/entities/PlatformConfig";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { LogBackgroundTask } from "../../../application/use-cases/LogBackgroundTask";
import { MongoBrandAssetRepository } from "../../../infra/repositories/MongoBrandAssetRepository";
import { SetBrandAsset } from "../../../application/use-cases/SetBrandAsset";
import { ListBrandAssets } from "../../../application/use-cases/ListBrandAssets";
import { DeleteBrandAsset } from "../../../application/use-cases/DeleteBrandAsset";
import { createBrandAssetTextSchema, promoteBrandAssetSchema, updateBrandAssetSchema } from "@andy-code-cat/contracts";
import type { BrandAsset } from "../../../domain/entities/BrandAsset";
import type { BrandAssetDto } from "@andy-code-cat/contracts";

function toBrandAssetDto(asset: BrandAsset): BrandAssetDto {
    const downloadUrl = asset.valueType === "asset_ref"
        ? (asset.scope === "platform"
            ? `/v1/admin/brand-assets/${asset.id}/download`
            : asset.scope === "user"
            ? `/v1/users/me/brand-assets/${asset.id}/download`
            : `/v1/projects/${asset.projectId}/brand-assets/${asset.id}/download`)
        : undefined;
    return {
        id: asset.id, scope: asset.scope, ownerUserId: asset.ownerUserId, projectId: asset.projectId,
        role: asset.role, customRoleLabel: asset.customRoleLabel, policy: asset.policy,
        valueType: asset.valueType, originalName: asset.originalName, mimeType: asset.mimeType,
        fileSize: asset.fileSize, textValue: asset.textValue, description: asset.description,
        isActive: asset.isActive, priority: asset.priority, downloadUrl,
        createdAt: asset.createdAt.toISOString(), updatedAt: asset.updatedAt.toISOString(),
    };
}

// In-memory storage: the use case writes to disk itself after validation.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // hard upper bound; per-type limits in use case
});

function toDto(asset: {
    id: string;
    projectId: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    source: string;
    scope?: string;
    label?: string;
    useInProject?: boolean;
    styleRole?: string;
    descriptionText?: string;
    externalUrl?: string;
    generationStatus?: ProjectAssetDto["generationStatus"];
    generationPrompt?: string;
    generationMetadata?: {
        provider: string;
        model?: string;
        imageSize?: string;
        numInferenceSteps?: number;
        requestedAt: Date;
        completedAt?: Date;
        latencyMs?: number;
        revisedPrompt?: string;
        finishReason?: string;
        providerRequestId?: string;
        sourceUrl?: string;
        outputMimeType?: string;
        width?: number;
        height?: number;
        tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
        cost?: { currency: "EUR"; amount: number; source: "provider" | "flat-rate"; providerCostUsd?: number };
        errorMessage?: string;
        providerResponse?: Record<string, unknown>;
    };
    semanticMetadata?: { title: string; summary: string; description: string; tags: string[]; colors: string[]; mediaKind: string; classifierProvider: string; classifierModel: string; classifiedAt: Date };
    enrichmentTrace?: {
        provenance: { enrichmentStatus: string; enrichedAt: Date | null; errorMessage: string | null };
        distilledTitle: string;
        distilledSummary: string;
        distilledTags: string[];
        distilledColors: string[];
        documentBrief?: {
            documentType: string; detectedTitle: string | null; detectedBrandName: string | null;
            purposeSentence: string; contentSummary: string; mainArgumentOrValue: string | null;
            structureSummary: string | null; keyMessages: string[]; toneLabel: string;
            targetAudience: string | null; ctaText: string | null; primaryTopics: string[];
            contentLanguage: string; suggestedStyleRole: string;
        } | null;
        designSignals?: {
            imageCategory: string; hasText: boolean; detectedTextSnippet: string | null;
            hasLogo: boolean; hasPeople: boolean; hasProduct: boolean;
            layoutStyle: string | null; aspectRatioLabel: string | null;
            suggestedWebUse: string[]; suggestedStyleRole: string;
        } | null;
        structuredData?: {
            dataset?: {
                sourceFormat: "csv" | "xlsx" | "json" | "xml" | "sql";
                tables: import("../../../domain/entities/AssetEnrichmentTrace").DatasetTableProfile[];
                facts: import("../../../domain/entities/AssetEnrichmentTrace").DatasetFactsEnvelope;
                limitations?: string[];
                llmAppendix?: import("../../../domain/entities/AssetEnrichmentTrace").DatasetLlmAppendix;
            };
        } | null;
    } | null;
    createdAt: Date;
}): ProjectAssetDto {
    return {
        id: asset.id,
        projectId: asset.projectId,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        source: asset.source as ProjectAssetDto["source"],
        scope: (asset.scope as ProjectAssetDto["scope"]) ?? "project",
        label: asset.label,
        useInProject: asset.useInProject,
        styleRole: asset.styleRole as ProjectAssetDto["styleRole"],
        descriptionText: asset.descriptionText,
        externalUrl: asset.externalUrl,
        generationStatus: asset.generationStatus,
        generationPrompt: asset.generationPrompt,
        generationMetadata: asset.generationMetadata ? {
            ...asset.generationMetadata,
            requestedAt: asset.generationMetadata.requestedAt.toISOString(),
            completedAt: asset.generationMetadata.completedAt?.toISOString(),
        } : undefined,
        semanticMetadata: asset.semanticMetadata ? {
            ...asset.semanticMetadata,
            mediaKind: asset.semanticMetadata.mediaKind as NonNullable<ProjectAssetDto["semanticMetadata"]>["mediaKind"],
            classifiedAt: asset.semanticMetadata.classifiedAt.toISOString(),
        } : undefined,
        enrichmentTrace: asset.enrichmentTrace ? {
            provenance: {
                enrichmentStatus: asset.enrichmentTrace.provenance.enrichmentStatus as NonNullable<ProjectAssetDto["enrichmentTrace"]>["provenance"]["enrichmentStatus"],
                enrichedAt: asset.enrichmentTrace.provenance.enrichedAt?.toISOString() ?? null,
                errorMessage: asset.enrichmentTrace.provenance.errorMessage,
            },
            distilledTitle: asset.enrichmentTrace.distilledTitle,
            distilledSummary: asset.enrichmentTrace.distilledSummary,
            distilledTags: asset.enrichmentTrace.distilledTags,
            distilledColors: asset.enrichmentTrace.distilledColors,
            documentBrief: asset.enrichmentTrace.documentBrief ?? null,
            designSignals: asset.enrichmentTrace.designSignals ?? null,
            dataset: asset.enrichmentTrace.structuredData?.dataset
                ? {
                    sourceFormat: asset.enrichmentTrace.structuredData.dataset.sourceFormat,
                    tables: asset.enrichmentTrace.structuredData.dataset.tables as DatasetTableProfileDto[],
                    facts: asset.enrichmentTrace.structuredData.dataset.facts as DatasetFactsEnvelopeDto,
                    limitations: asset.enrichmentTrace.structuredData.dataset.limitations,
                    llmAppendix: asset.enrichmentTrace.structuredData.dataset.llmAppendix,
                }
                : null,
        } as AssetEnrichmentTraceDto : undefined,
        createdAt: asset.createdAt.toISOString(),
    };
}

export function createProjectAssetRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const moodboardRepository = new MongoProjectMoodboardRepository();
    const userStyleProfileRepository = new MongoUserStyleProfileRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);
    const storage = getFileStorage();

    const uploadAsset = new UploadProjectAsset(assetRepository, storage);
    const updateAsset = new UpdateProjectAsset(assetRepository);
    const addUrlRef = new AddUrlReference(assetRepository);
    const listAssets = new ListProjectAssets(assetRepository);
    const deleteAsset = new DeleteProjectAsset(assetRepository, storage);
    const promptExecutionLogRepository = new MongoPromptExecutionLogRepository();
    const conversationRepository = new MongoConversationRepository();
    const logBackgroundTask = new LogBackgroundTask(conversationRepository);
    const serviceKeyRepository = new MongoServiceApiKeyRepository();
    const promptConfigRepository = new MongoLlmPromptConfigRepository();
    const platformConfigRepository = new MongoPlatformConfigRepository();
    const llmCatalogRepository = new MongoLlmCatalogRepository();
    const getLlmCatalog = new GetLlmCatalog(
        env.LLM_CATALOG_SOURCE,
        env.SILICONFLOW_BASE_URL,
        env.LMSTUDIO_BASE_URL,
        env.OPENROUTER_BASE_URL,
        llmCatalogRepository,
        env.hasOpenRouterApiKey,
        env.providerApiKeys,
        env.LLM_DEFAULT_PROVIDER,
    );
    const optimizeImagePrompt = new OptimizeImagePrompt(
        platformConfigRepository,
        promptExecutionLogRepository,
        getLlmCatalog,
    );
    const suggestProjectImageIdea = new SuggestProjectImageIdea(
        platformConfigRepository,
        promptExecutionLogRepository,
        getLlmCatalog,
    );
    const generateProjectImage = new GenerateProjectImage(
        assetRepository,
        storage,
        projectRepository,
        moodboardRepository,
        userStyleProfileRepository,
        optimizeImagePrompt,
    );
    const getLlmPromptConfig = new GetLlmPromptConfig(promptConfigRepository);
    const getProjectAiAnalytics = new GetProjectAiAnalytics(promptExecutionLogRepository, assetRepository);
    const regenerateStockProjectImage = new RegenerateStockProjectImage(
        assetRepository,
        storage,
        serviceKeyRepository,
        undefined,
        undefined,
        platformConfigRepository,
    );
    const mediaResolutionTraceRepository = new MongoMediaResolutionTraceRepository();
    const regenerateMediaByKey = new RegenerateMediaByKey(mediaResolutionTraceRepository, regenerateStockProjectImage);
    const brandAssetRepo = new MongoBrandAssetRepository();
    const setBrandAsset = new SetBrandAsset(brandAssetRepo, assetRepository);
    const listBrandAssets = new ListBrandAssets(brandAssetRepo);
    const deleteBrandAsset = new DeleteBrandAsset(brandAssetRepo, storage);

    router.use(authMiddleware);

    // POST /v1/projects/:projectId/assets — upload a reference file
    router.post(
        "/projects/:projectId/assets",
        sandboxMiddleware,
        upload.single("file"),
        async (req: RequestWithContext, res, next) => {
            try {
                if (!req.file) {
                    res.status(400).json({ error: "No file uploaded. Use multipart/form-data with field name 'file'." });
                    return;
                }

                const [platformConfig, project] = await Promise.all([
                    platformConfigRepository.get().catch(() => null),
                    projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId).catch(() => null),
                ]);
                const attachmentPolicy = resolveAttachmentPolicyFromConfig(platformConfig, project?.presetId ?? "default");

                if (req.file.size > attachmentPolicy.maxFileSizeBytes) {
                    res.status(413).json({
                        error: `File size exceeds limit (${attachmentPolicy.maxFileSizeBytes} bytes max).`,
                        code: "ATTACHMENT_FILE_TOO_LARGE",
                        attachmentPolicy,
                    });
                    return;
                }

                const asset = await uploadAsset.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    fileSize: req.file.size,
                    buffer: req.file.buffer,
                    label: typeof req.body["label"] === "string" ? req.body["label"] : undefined,
                    scope: req.body["scope"] === "user" ? "user" : "project",
                    useInProject: req.body["useInProject"] === "true" || req.body["useInProject"] === true,
                    styleRole: (["inspiration", "material", "logo", "background", "icon", "watermark", "reference"] as const).includes(req.body["styleRole"])
                        ? req.body["styleRole"] as "inspiration" | "material" | "logo" | "background" | "icon" | "watermark" | "reference"
                        : undefined,
                    descriptionText: typeof req.body["descriptionText"] === "string" ? req.body["descriptionText"] : undefined,
                    maxTotalBytes: attachmentPolicy.maxTotalBytes,
                });

                const totalProjectBytes = await assetRepository
                    .totalProjectSize(req.sandbox!.projectId, req.auth!.userId)
                    .catch(() => asset.fileSize);
                const warnings: string[] = [];
                if (totalProjectBytes >= attachmentPolicy.warningThresholdBytes) {
                    const usedMb = Math.round((totalProjectBytes / (1024 * 1024)) * 10) / 10;
                    const capMb = Math.round((attachmentPolicy.maxTotalBytes / (1024 * 1024)) * 10) / 10;
                    warnings.push(`Project attachments are near the storage cap: ${usedMb} MB / ${capMb} MB.`);
                }

                res.status(201).json({
                    asset: toDto(asset),
                    warnings,
                    attachmentPolicy,
                    usage: {
                        totalBytes: totalProjectBytes,
                        maxTotalBytes: attachmentPolicy.maxTotalBytes,
                        warningThresholdBytes: attachmentPolicy.warningThresholdBytes,
                    },
                });

                // Fire-and-forget enrichment — never blocks the HTTP response
                if (env.enrichmentEnabled) {
                    const fileBuffer = req.file.buffer;
                    const conversationId = typeof req.body["conversationId"] === "string" ? req.body["conversationId"].trim() : "";
                    const messageId = typeof req.body["messageId"] === "string" ? req.body["messageId"].trim() : "";
                    setImmediate(async () => {
                        let backgroundTaskId: string | undefined;
                        try {
                            const platformConfig = await platformConfigRepository.get().catch(() => null);
                            if (conversationId && messageId) {
                                const task = await logBackgroundTask.execute({
                                    conversationId,
                                    projectId: req.sandbox!.projectId,
                                    messageId,
                                    type: "asset_enrichment",
                                    pipelineProfile: "attachment_enrichment",
                                    input: {
                                        assetId: asset.id,
                                        originalName: asset.originalName,
                                        mimeType: asset.mimeType,
                                    },
                                    status: "running",
                                }).catch(() => null);
                                backgroundTaskId = task?.id;
                            }
                            const pipeline = new AssetEnrichmentPipeline();
                            const trace = await pipeline.enrich({
                                asset,
                                fileBuffer,
                                getLlmCatalog,
                                assetRepository,
                                promptExecutionLogRepository,
                                sourceContext: {
                                    conversationId: conversationId || undefined,
                                    messageId: messageId || undefined,
                                    backgroundTaskId,
                                },
                                platformConfig,
                            });
                            if (conversationId && messageId && backgroundTaskId) {
                                await conversationRepository.updateBackgroundTask(
                                    conversationId,
                                    messageId,
                                    backgroundTaskId,
                                    {
                                        status: "completed",
                                        completedAt: new Date(),
                                        output: {
                                            assetId: asset.id,
                                            enrichmentStatus: trace.provenance.enrichmentStatus,
                                            parserName: trace.provenance.parserName,
                                            llmProvider: trace.provenance.llmProvider,
                                            llmModel: trace.provenance.llmModel,
                                        },
                                        tokenUsage: trace.provenance.llmTokensUsed != null ? {
                                            promptTokens: 0,
                                            completionTokens: 0,
                                            totalTokens: trace.provenance.llmTokensUsed,
                                        } : undefined,
                                        costEstimate: trace.provenance.llmCostEur != null ? {
                                            currency: "EUR",
                                            amount: trace.provenance.llmCostEur,
                                            breakdown: {
                                                tokenCost: trace.provenance.llmCostEur,
                                                imageCost: 0,
                                                videoCost: 0,
                                            },
                                            unitRates: {
                                                textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                                                imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                                                videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                                            },
                                        } : undefined,
                                    },
                                ).catch(() => {});
                            }
                        } catch (err) {
                            if (conversationId && messageId && backgroundTaskId) {
                                await conversationRepository.updateBackgroundTask(
                                    conversationId,
                                    messageId,
                                    backgroundTaskId,
                                    {
                                        status: "failed",
                                        completedAt: new Date(),
                                        error: err instanceof Error ? err.message : String(err),
                                    },
                                ).catch(() => {});
                            }
                            console.error(`[upload] enrichment pipeline failed for asset ${asset.id}:`, err);
                        }
                    });
                }
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/assets/url — add a URL reference (no file upload)
    router.post(
        "/projects/:projectId/assets/url",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const asset = await addUrlRef.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    rawData: req.body,
                });
                res.status(201).json({ asset: toDto(asset) });
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/assets/suggest-image — suggest a visual direction for the selected element
    router.post(
        "/projects/:projectId/assets/suggest-image",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const input = suggestProjectImageIdeaSchema.parse(req.body);
                const promptConfig = await getLlmPromptConfig.execute(req.sandbox!.projectId).catch(() => null);
                const project = await projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId);
                if (!project) {
                    res.status(404).json({ error: "Project not found" });
                    return;
                }

                const [moodboard, userProfile, allAssets] = await Promise.all([
                    moodboardRepository.findByProjectId(req.sandbox!.projectId).catch(() => null),
                    userStyleProfileRepository.findByUserId(req.auth!.userId).catch(() => null),
                    assetRepository.listByProject(req.sandbox!.projectId, req.auth!.userId).catch(() => []),
                ]);

                const packet = buildImagePromptContextPacket({
                    project,
                    moodboard,
                    userProfile,
                    assets: allAssets,
                    targetMode: input.targetMode,
                    selectedElement: input.selectedElement ? {
                        ...input.selectedElement,
                        classes: [],
                        textSnippet: input.selectedElement.textSnippet,
                    } : undefined,
                    prePromptTemplate: promptConfig?.enabled ? promptConfig.prePromptTemplate : undefined,
                });

                const result = await suggestProjectImageIdea.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    productKey: project.presetId ?? "default",
                    rawPrompt: input.prompt,
                    packet,
                    projectPresetId: project.presetId,
                    usedMoodboard: Boolean(moodboard),
                    usedUserProfile: Boolean(userProfile),
                });

                res.json(result);
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/assets/generate-image — create a sandboxed deferred image asset
    router.post(
        "/projects/:projectId/assets/generate-image",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const input = generateProjectImageSchema.parse(req.body);
                const promptConfig = await getLlmPromptConfig.execute(req.sandbox!.projectId).catch(() => null);
                const result = await generateProjectImage.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    prompt: input.prompt,
                    fileNameHint: input.fileNameHint,
                    scope: input.scope,
                    provider: input.provider,
                    model: input.model,
                    imageSize: input.imageSize,
                    numInferenceSteps: input.numInferenceSteps,
                    targetMode: input.targetMode,
                    selectedElement: input.selectedElement ? {
                        ...input.selectedElement,
                        classes: [],
                    } : undefined,
                    mediaConfig: input.mediaConfig,
                    prePromptTemplate: promptConfig?.enabled ? promptConfig.prePromptTemplate : undefined,
                });

                res.status(202).json({
                    taskId: result.taskId,
                    status: result.status,
                    mode: result.mode,
                    asset: toDto(result.asset),
                    storagePath: result.storagePath,
                    downloadUrl: `/v1/projects/${req.sandbox!.projectId}/assets/${result.asset.id}/download`,
                    cssDefaults: result.cssDefaults,
                });
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/images/provider-status — current stock-image provider policy summary
    router.get(
        "/projects/:projectId/images/provider-status",
        sandboxMiddleware,
        async (_req: RequestWithContext, res, next) => {
            try {
                const [pexelsDb, pixabayDb, unsplashDb, platformConfig] = await Promise.all([
                    serviceKeyRepository.findActiveByService("pexels").catch(() => null),
                    serviceKeyRepository.findActiveByService("pixabay").catch(() => null),
                    serviceKeyRepository.findActiveByService("unsplash").catch(() => null),
                    platformConfigRepository.get().catch(() => null),
                ]);
                const policy = resolveMediaProviderPolicy(platformConfig);
                const providerOrder = buildStockProviderOrder(policy);

                const configuredProviders = {
                    pexels: Boolean(pexelsDb || env.hasPexelsApiKey),
                    pixabay: Boolean(pixabayDb || env.hasPixabayApiKey),
                    unsplash: Boolean(unsplashDb || env.hasUnsplashApiKey),
                    loremflickr: true,
                    picsum: true,
                };

                res.json({
                    activeProvider: policy.stockImage.primaryProvider,
                    fallbackMode: policy.stockImage.fallbackEnabled ? "notify" : "disabled",
                    fallbackProviders: providerOrder.filter((provider) => provider !== policy.stockImage.primaryProvider),
                    providerOrder,
                    mediaProviderPolicy: policy,
                    persistenceEnabled: true,
                    configuredProviders,
                });
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/images/regenerate-stock — fetch a new stock image and persist it as a project asset
    router.post(
        "/projects/:projectId/images/regenerate-stock",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const input = regenerateStockProjectImageSchema.parse(req.body);
                const result = await regenerateStockProjectImage.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    query: input.query,
                    width: input.width,
                    height: input.height,
                    offset: input.offset,
                    targetSelector: input.targetSelector,
                    targetMode: input.targetMode,
                    scope: input.scope,
                    allowFallback: true,
                });

                res.status(201).json({
                    asset: toDto(result.asset),
                    assetUrl: result.assetUrl,
                    provider: result.provider,
                    fallbackUsed: result.fallbackUsed,
                    attribution: result.attribution,
                    attemptedProviders: result.attemptedProviders,
                });
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/media/:mediaKey/regenerate — regenerate from the latest persisted media trace
    router.post(
        "/projects/:projectId/media/:mediaKey/regenerate",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const input = regenerateMediaByKeySchema.parse(req.body);
                const result = await regenerateMediaByKey.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    mediaKey: req.params.mediaKey!,
                    snapshotId: input.snapshotId,
                    width: input.width,
                    height: input.height,
                    offset: input.offset,
                    targetSelector: input.targetSelector,
                    targetMode: input.targetMode,
                    scope: input.scope,
                });

                res.status(201).json({
                    mediaKey: result.mediaKey,
                    traceId: result.traceId,
                    asset: toDto(result.asset),
                    assetUrl: result.assetUrl,
                    provider: result.provider,
                    fallbackUsed: result.fallbackUsed,
                    attribution: result.attribution,
                    attemptedProviders: result.attemptedProviders,
                });
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/assets — list current project assets + user shared library
    // Optional query: ?source=user_upload | platform_generated | url_reference
    router.get(
        "/projects/:projectId/assets",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const sourceParam = req.query["source"] as string | undefined;
                const source =
                    sourceParam === "user_upload" || sourceParam === "platform_generated" || sourceParam === "url_reference"
                        ? sourceParam
                        : undefined;
                const assets = await listAssets.execute(req.sandbox!.projectId, req.auth!.userId, source);
                res.json({ assets: assets.map(toDto) });
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/assets/analytics — combined LLM + image usage summary
    router.get(
        "/projects/:projectId/assets/analytics",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const analytics = await getProjectAiAnalytics.execute(req.sandbox!.projectId, req.auth!.userId);
                res.json(analytics);
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/assets/:assetId — single asset (for enrichment polling)
    router.get(
        "/projects/:projectId/assets/:assetId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const asset = await assetRepository.findById(
                    req.params.assetId!,
                    req.sandbox!.projectId,
                    req.auth!.userId
                );
                if (!asset) {
                    res.status(404).json({ error: "Asset not found" });
                    return;
                }
                res.json({ asset: toDto(asset) });
            } catch (error) {
                next(error);
            }
        }
    );

    // PATCH /v1/projects/:projectId/assets/:assetId — update asset metadata
    router.patch(
        "/projects/:projectId/assets/:assetId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const asset = await updateAsset.execute({
                    assetId: req.params.assetId!,
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    rawData: req.body,
                });
                res.json({ asset: toDto(asset) });
            } catch (error) {
                next(error);
            }
        }
    );

    // DELETE /v1/projects/:projectId/assets/:assetId
    router.delete(
        "/projects/:projectId/assets/:assetId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                await deleteAsset.execute({
                    assetId: req.params.assetId!,
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                });
                res.status(204).send();
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/assets/:assetId/download — stream file
    router.get(
        "/projects/:projectId/assets/:assetId/download",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const asset = await assetRepository.findById(
                    req.params.assetId!,
                    req.sandbox!.projectId,
                    req.auth!.userId
                );
                if (!asset) {
                    res.status(404).json({ error: "Asset not found" });
                    return;
                }

                // URL references have no file — redirect to external URL
                if (asset.externalUrl) {
                    res.redirect(302, asset.externalUrl);
                    return;
                }

                const filePath = storage.uploadFilePath(
                    req.auth!.userId,
                    asset.projectId,
                    asset.storedFilename
                );

                const exists = await storage.fileExists(filePath);
                if (!exists) {
                    res.status(410).json({ error: "File no longer available" });
                    return;
                }

                const actualSize = await storage.fileSize(filePath).catch(() => asset.fileSize);

                res.setHeader("Content-Type", asset.mimeType);
                res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(asset.originalName)}"`);
                if (actualSize > 0) {
                    res.setHeader("Content-Length", actualSize);
                }
                const stream = await storage.createReadStream(filePath);
                stream.pipe(res);
            } catch (error) {
                next(error);
            }
        }
    );

    // ── Project Brand Assets ────────────────────────────────────────────────────

    /** GET /projects/:projectId/brand-assets */
    router.get("/projects/:projectId/brand-assets", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const assets = await listBrandAssets.execute({
                scope: "project",
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
            });
            res.json({ assets: assets.map(toBrandAssetDto) });
        } catch (err) {
            next(err);
        }
    });

    /** POST /projects/:projectId/brand-assets — text / color / url value */
    router.post("/projects/:projectId/brand-assets", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const body = createBrandAssetTextSchema.parse(req.body);
            const asset = await setBrandAsset.createText({
                scope: "project",
                ownerUserId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                ...body,
            });
            res.status(201).json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** POST /projects/:projectId/brand-assets/upload — multipart file */
    router.post(
        "/projects/:projectId/brand-assets/upload",
        sandboxMiddleware,
        upload.single("file"),
        async (req: RequestWithContext, res, next) => {
            try {
                if (!req.file) {
                    res.status(400).json({ error: "No file uploaded" });
                    return;
                }
                const role = createBrandAssetTextSchema.shape.role.parse(req.body["role"]);
                const policy = createBrandAssetTextSchema.shape.policy.parse(req.body["policy"] ?? "prefer");
                const { randomUUID } = await import("crypto");
                const pathMod = await import("path");
                const safeExt = pathMod.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
                const safeName = pathMod.basename(req.file.originalname, pathMod.extname(req.file.originalname))
                    .toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60);
                const storedFilename = `${randomUUID()}-${safeName}${safeExt}`;
                await storage.saveUpload(req.auth!.userId, req.sandbox!.projectId, storedFilename, req.file.buffer, req.file.mimetype);
                const asset = await setBrandAsset.createFile({
                    scope: "project",
                    ownerUserId: req.auth!.userId,
                    projectId: req.sandbox!.projectId,
                    role,
                    policy,
                    customRoleLabel: typeof req.body["customRoleLabel"] === "string" ? req.body["customRoleLabel"] : undefined,
                    description: typeof req.body["description"] === "string" ? req.body["description"] : undefined,
                    isActive: req.body["isActive"] !== "false",
                    priority: req.body["priority"] ? Number(req.body["priority"]) : 0,
                    storedFilename,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    fileSize: req.file.size,
                });
                res.status(201).json({ asset: toBrandAssetDto(asset) });
            } catch (err) {
                next(err);
            }
        }
    );

    /** POST /projects/:projectId/brand-assets/promote — promote project asset to project brand */
    router.post("/projects/:projectId/brand-assets/promote", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const body = promoteBrandAssetSchema.parse(req.body);
            const asset = await setBrandAsset.promote({
                scope: "project",
                ownerUserId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                role: body.role,
                customRoleLabel: body.customRoleLabel,
                policy: body.policy,
                description: body.description,
                isActive: body.isActive,
                priority: body.priority,
                sourceAssetId: body.sourceAssetId,
                sourceProjectId: req.sandbox!.projectId,
                sourceUserId: req.auth!.userId,
            });
            res.status(201).json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** PATCH /projects/:projectId/brand-assets/:id */
    router.patch("/projects/:projectId/brand-assets/:id", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const id = req.params.id;
            if (!id) { res.status(400).json({ error: "Missing id" }); return; }
            const existing = await brandAssetRepo.findById(id);
            if (!existing || existing.scope !== "project"
                || existing.projectId !== req.sandbox!.projectId
                || existing.ownerUserId !== req.auth!.userId) {
                res.status(404).json({ error: "Brand asset not found" });
                return;
            }
            const patch = updateBrandAssetSchema.parse(req.body);
            const asset = await brandAssetRepo.update(id, patch);
            res.json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** DELETE /projects/:projectId/brand-assets/:id */
    router.delete("/projects/:projectId/brand-assets/:id", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const id = req.params.id;
            if (!id) { res.status(400).json({ error: "Missing id" }); return; }
            const existing = await brandAssetRepo.findById(id);
            if (!existing || existing.scope !== "project"
                || existing.projectId !== req.sandbox!.projectId
                || existing.ownerUserId !== req.auth!.userId) {
                res.status(404).json({ error: "Brand asset not found" });
                return;
            }
            const deleted = await deleteBrandAsset.execute(id, { scopeFolder: req.sandbox!.projectId });
            res.json({ ok: deleted });
        } catch (err) {
            next(err);
        }
    });

    /** GET /projects/:projectId/brand-assets/:id/download */
    router.get(
        "/projects/:projectId/brand-assets/:id/download",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const id = req.params.id;
                if (!id) { res.status(400).json({ error: "Missing id" }); return; }
                const asset = await brandAssetRepo.findById(id);
                if (!asset || asset.scope !== "project"
                    || asset.projectId !== req.sandbox!.projectId
                    || asset.valueType !== "asset_ref" || !asset.storedFilename) {
                    res.status(404).json({ error: "Asset not found or not downloadable" });
                    return;
                }
                const filePath = storage.uploadFilePath(req.auth!.userId, req.sandbox!.projectId, asset.storedFilename);
                const exists = await storage.fileExists(filePath);
                if (!exists) { res.status(410).json({ error: "File no longer available" }); return; }
                const actualSize = await storage.fileSize(filePath).catch(() => asset.fileSize ?? 0);
                res.setHeader("Content-Type", asset.mimeType ?? "application/octet-stream");
                res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(asset.originalName ?? asset.storedFilename)}"`);
                if (actualSize > 0) res.setHeader("Content-Length", actualSize);
                const stream = await storage.createReadStream(filePath);
                stream.pipe(res);
            } catch (err) {
                next(err);
            }
        }
    );

    return router;
}
