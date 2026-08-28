import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createPipelineRunSchema, type PipelineRunDto } from "@andy-code-cat/contracts";
import { env } from "../../../config";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoPipelineRunRepository } from "../../../infra/repositories/MongoPipelineRunRepository";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { ResolvePipelineModelLock } from "../../../application/use-cases/ResolvePipelineModelLock";
import type { PipelineRun } from "../../../domain/entities/PipelineRun";

function toDto(run: PipelineRun): PipelineRunDto {
    return {
        ...run,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        blocked: run.blocked ? { ...run.blocked, at: run.blocked.at.toISOString() } : undefined,
    };
}

/**
 * I7 of the SSOT program — see docs/SSOT_REFACTOR_PROGRESS.md. These routes are the only
 * persisted PipelineRun surface; rollback is a code revert and redeploy, not a runtime branch.
 */
export function createPipelineRunRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const pipelineRunRepository = new MongoPipelineRunRepository();
    const llmCatalogRepository = new MongoLlmCatalogRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);
    const pipelineRunLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
    });

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

    router.post(
        "/projects/:projectId/pipeline-runs",
        pipelineRunLimiter,
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = createPipelineRunSchema.parse({ ...req.body, projectId: req.sandbox!.projectId });

                const run = await resolvePipelineModelLock.createRun({
                    projectId: req.sandbox!.projectId,
                    ownerUserId: req.auth!.userId,
                    conversationId: body.conversationId,
                    entryMode: body.entryMode,
                    requestedProviderId: body.requestedProviderId,
                    requestedModelId: body.requestedModelId,
                    optimizationPolicy: "skip",
                });

                res.status(201).json({ run: toDto(run) });
            } catch (error) {
                next(error);
            }
        },
    );

    router.get(
        "/projects/:projectId/pipeline-runs",
        pipelineRunLimiter,
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const runs = await pipelineRunRepository.listByProject(req.sandbox!.projectId, req.auth!.userId);
                res.json({ runs: runs.map(toDto) });
            } catch (error) {
                next(error);
            }
        },
    );

    router.get(
        "/projects/:projectId/pipeline-runs/:runId",
        pipelineRunLimiter,
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const run = await pipelineRunRepository.findByIdForUser(req.params.runId!, req.auth!.userId);
                if (!run || run.projectId !== req.sandbox!.projectId) {
                    res.status(404).json({ error: "Pipeline run not found" });
                    return;
                }
                res.json({ run: toDto(run) });
            } catch (error) {
                next(error);
            }
        },
    );

    return router;
}
