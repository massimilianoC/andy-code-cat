import { Router, type Response, type NextFunction } from "express";
import {
    executeProjectPipelineSchema,
    type ZeroEffortLaunchResultDto,
    zeroEffortLaunchSchema,
    type GenerationWorkspaceDto,
    launchWorkspacePipelineSchema,
    type LaunchWorkspacePipelineResultDto,
} from "@andy-code-cat/contracts";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";
import { env } from "../../../config";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectMoodboardRepository } from "../../../infra/repositories/MongoProjectMoodboardRepository";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoPipelineRunRepository } from "../../../infra/repositories/MongoPipelineRunRepository";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { localFileStorage } from "../../../infra/storage/LocalFileStorage";
import { PrepareGenerationWorkspace } from "../../../application/use-cases/PrepareGenerationWorkspace";
import { LaunchZeroEffortProject } from "../../../application/use-cases/LaunchZeroEffortProject";
import { LaunchWorkspacePipeline } from "../../../application/use-cases/LaunchWorkspacePipeline";
import { ResolvePipelineModelLock } from "../../../application/use-cases/ResolvePipelineModelLock";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import type { GenerationWorkspace } from "../../../domain/entities/GenerationWorkspace";
import { ExecutionLogger } from "../../../application/services/ExecutionLogger";
import {
    resolveAttachmentPolicyFromConfig,
    resolveDocumentContextPolicyFromConfig,
    resolvePromptTaskSettingFromConfig,
} from "../../../domain/entities/PlatformConfig";

function toWorkspaceDto(workspace: GenerationWorkspace): GenerationWorkspaceDto {
    return {
        jobId: workspace.jobId,
        projectId: workspace.projectId,
        rootPath: workspace.rootPath,
        outputPath: workspace.outputPath,
        files: workspace.files,
        layer1Included: workspace.layer1Included,
        snapshotId: workspace.snapshotId,
        createdAt: workspace.createdAt.toISOString(),
    };
}

export function createPipelineRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const moodboardRepository = new MongoProjectMoodboardRepository();
    const conversationRepository = new MongoConversationRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();
    const platformConfigRepository = new MongoPlatformConfigRepository();
    const pipelineRunRepository = new MongoPipelineRunRepository();
    const llmCatalogRepository = new MongoLlmCatalogRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const prepareGenerationWorkspace = new PrepareGenerationWorkspace(
        assetRepository,
        snapshotRepository,
        conversationRepository,
        localFileStorage,
    );

    const launchZeroEffortProject = new LaunchZeroEffortProject(
        moodboardRepository,
        conversationRepository,
        prepareGenerationWorkspace,
    );

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
    const resolvePipelineModelLock = new ResolvePipelineModelLock(pipelineRunRepository, getLlmCatalog);
    const launchWorkspacePipeline = new LaunchWorkspacePipeline(
        launchZeroEffortProject,
        resolvePipelineModelLock,
        pipelineRunRepository,
    );

    router.use(authMiddleware);

    const runZeroEffort = async (req: RequestWithContext, res: Response, next: NextFunction) => {
        try {
            const intake = zeroEffortLaunchSchema.parse(req.body);

            // Propagate inferred presetId to the project so Layer T picks the right template,
            // and persist the resolved output language so Layer L (OUTPUT LANGUAGE) is injected
            // into every subsequent generation for this project (not just the intake brief text).
            if (intake.presetId || intake.outputLanguage) {
                await projectRepository.update(req.sandbox!.projectId, req.auth!.userId, {
                    ...(intake.presetId ? { presetId: intake.presetId } : {}),
                    ...(intake.outputLanguage ? { outputLanguage: intake.outputLanguage } : {}),
                }).catch(() => {});
            }

            const result = await launchZeroEffortProject.execute({
                userId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                intake,
            });

            ExecutionLogger.instance.emit({
                projectId: req.sandbox!.projectId,
                conversationId: result.conversationId,
                domain: "system",
                eventType: "zero_effort_pipeline_prepared",
                level: "info",
                status: "success",
                metadata: {
                    mode: "zero-effort",
                    jobId: result.jobId,
                    workspaceRootPath: result.workspace.rootPath,
                },
            });

            const response: ZeroEffortLaunchResultDto = {
                mode: "zero-effort",
                status: "prepared",
                projectId: req.sandbox!.projectId,
                conversationId: result.conversationId,
                jobId: result.jobId,
                normalizedBrief: result.normalizedBrief,
                suggestedNextActions: result.suggestedNextActions,
                workspace: toWorkspaceDto(result.workspace),
            };

            res.status(201).json(response);
        } catch (error) {
            next(error);
        }
    };

    router.post(
        "/projects/:projectId/pipelines/zero-effort",
        sandboxMiddleware,
        runZeroEffort,
    );

    router.post(
        "/projects/:projectId/pipelines/execute",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = executeProjectPipelineSchema.parse(req.body);
                req.body = body.input;
                await runZeroEffort(req, res, next);
            } catch (error) {
                next(error);
            }
        },
    );

    /**
     * I12 of the SSOT program — server-owned Workspace launch that freezes a `PipelineModelLock`
     * and attaches the canonical brief to a real `PipelineRun` up front (see
     * `LaunchWorkspacePipeline`). Gated behind the same `PIPELINE_RUN_ENABLED` master rollback
     * lever as `pipelineRunRoutes.ts` since it persists a `PipelineRun`; the pre-existing
     * `/pipelines/zero-effort` route above is completely untouched by this addition.
     *
     * Named "Workspace" (not "GodMode") since 2026-08-19, matching the product-owner-approved
     * rename in PR #58; see `pipelineEntryModeSchema`'s doc comment in
     * `packages/contracts/src/pipelineRun.ts` for the full rationale.
     */
    router.post(
        "/projects/:projectId/pipeline/launch-workspace",
        sandboxMiddleware,
        async (req: RequestWithContext, res: Response, next: NextFunction) => {
            try {
                if (!env.pipelineRunEnabled) {
                    res.status(404).json({ error: "Not found" });
                    return;
                }

                const intake = launchWorkspacePipelineSchema.parse(req.body);

                if (intake.presetId || intake.outputLanguage) {
                    await projectRepository.update(req.sandbox!.projectId, req.auth!.userId, {
                        ...(intake.presetId ? { presetId: intake.presetId } : {}),
                        ...(intake.outputLanguage ? { outputLanguage: intake.outputLanguage } : {}),
                    }).catch(() => {});
                }

                const result = await launchWorkspacePipeline.execute({
                    userId: req.auth!.userId,
                    projectId: req.sandbox!.projectId,
                    intake,
                });

                ExecutionLogger.instance.emit({
                    projectId: req.sandbox!.projectId,
                    conversationId: result.conversationId,
                    domain: "system",
                    eventType: "workspace_pipeline_prepared",
                    level: "info",
                    status: "success",
                    metadata: {
                        mode: "workspace",
                        jobId: result.jobId,
                        pipelineRunId: result.pipelineRunId,
                        workspaceRootPath: result.workspace.rootPath,
                    },
                });

                const response: LaunchWorkspacePipelineResultDto = {
                    mode: "workspace",
                    status: "prepared",
                    projectId: req.sandbox!.projectId,
                    pipelineRunId: result.pipelineRunId,
                    conversationId: result.conversationId,
                    jobId: result.jobId,
                    normalizedBrief: result.normalizedBrief,
                    modelLock: result.modelLock,
                    suggestedNextActions: result.suggestedNextActions,
                    workspace: toWorkspaceDto(result.workspace),
                };

                res.status(201).json(response);
            } catch (error) {
                next(error);
            }
        },
    );

    router.get(
        "/projects/:projectId/pipelines/zero-effort/config",
        sandboxMiddleware,
        async (req: RequestWithContext, res: Response, next: NextFunction) => {
            try {
                const platformConfig = await platformConfigRepository.get();
                const project = await projectRepository
                    .findByIdForUser(req.sandbox!.projectId, req.auth!.userId)
                    .catch(() => null);
                const productKey = project?.presetId ?? "default";
                const optimize = resolvePromptTaskSettingFromConfig(platformConfig, productKey, "zero_effort_optimize");
                const generate = resolvePromptTaskSettingFromConfig(platformConfig, productKey, "zero_effort_generate");
                const vibeGenerate = resolvePromptTaskSettingFromConfig(platformConfig, productKey, "vibe_mode_generate");
                const godModeGenerate = resolvePromptTaskSettingFromConfig(platformConfig, productKey, "god_mode_generate");
                const attachmentPolicy = resolveAttachmentPolicyFromConfig(platformConfig, productKey);
                const documentContextPolicy = resolveDocumentContextPolicyFromConfig(platformConfig, productKey);
                res.json({ optimize, generate, vibeGenerate, godModeGenerate, attachmentPolicy, documentContextPolicy });
            } catch (error) {
                next(error);
            }
        },
    );

    return router;
}
