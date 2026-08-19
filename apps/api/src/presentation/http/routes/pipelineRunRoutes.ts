import { Router } from "express";
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
 * I7 of the SSOT program — see docs/SSOT_REFACTOR_PROGRESS.md.
 *
 * Gated behind `PIPELINE_RUN_ENABLED` (default false): the master rollback lever. When
 * disabled, every route below responds 404 as if it did not exist, and no existing route or
 * frontend code calls any of these — creating/listing/reading a PipelineRun here has zero
 * effect on the legacy Vibe/GodMode dispatch paths still in production use. This is additive
 * infrastructure for later increments (I9+), not a live cutover.
 */
export function createPipelineRunRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const pipelineRunRepository = new MongoPipelineRunRepository();
    const llmCatalogRepository = new MongoLlmCatalogRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

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

    router.use(authMiddleware);

    // Scoped to this router's own paths only — NOT a blanket router.use(), which would
    // intercept every "/v1/*" request mounted after this router in app.ts and 404 them
    // whenever the flag is off. Each handler checks the flag itself instead.
    router.use("/projects/:projectId/pipeline-runs", (_req, res, next) => {
        if (!env.pipelineRunEnabled) {
            res.status(404).json({ error: "Not found" });
            return;
        }
        next();
    });

    router.post(
        "/projects/:projectId/pipeline-runs",
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
