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
import { generateProjectImageSchema, suggestProjectImageIdeaSchema, type ProjectAssetDto } from "@andy-code-cat/contracts";
import { GenerateProjectImage } from "../../../application/use-cases/GenerateProjectImage";
import { GetProjectAiAnalytics } from "../../../application/use-cases/GetProjectAiAnalytics";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoLlmPromptConfigRepository } from "../../../infra/repositories/MongoLlmPromptConfigRepository";
import { GetLlmPromptConfig } from "../../../application/use-cases/GetLlmPromptConfig";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { OptimizeImagePrompt } from "../../../application/prompting/OptimizeImagePrompt";
import { SuggestProjectImageIdea } from "../../../application/prompting/SuggestProjectImageIdea";
import { buildImagePromptContextPacket } from "../../../application/prompting/buildImagePromptContext";
import { env } from "../../../config";

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
                });

                res.status(201).json({ asset: toDto(asset) });
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

    return router;
}
