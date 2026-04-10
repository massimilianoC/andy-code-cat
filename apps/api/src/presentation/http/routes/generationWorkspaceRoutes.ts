import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { localFileStorage } from "../../../infra/storage/LocalFileStorage";
import { PrepareGenerationWorkspace } from "../../../application/use-cases/PrepareGenerationWorkspace";
import { prepareWorkspaceSchema } from "@andy-code-cat/contracts";
import type { RequestWithContext } from "../types";
import type { GenerationWorkspace } from "../../../domain/entities/GenerationWorkspace";
import type { GenerationWorkspaceDto } from "@andy-code-cat/contracts";

function toDto(ws: GenerationWorkspace): GenerationWorkspaceDto {
    return {
        jobId: ws.jobId,
        projectId: ws.projectId,
        rootPath: ws.rootPath,
        outputPath: ws.outputPath,
        files: ws.files,
        layer1Included: ws.layer1Included,
        snapshotId: ws.snapshotId,
        createdAt: ws.createdAt.toISOString(),
    };
}

/**
 * Routes for generation workspace preparation.
 *
 * These are primarily called by the M3 GenerationWorker before spawning OpenCode,
 * but can also be triggered from the frontend (e.g. "Start Pipeline" button).
 *
 * POST /v1/projects/:projectId/workspace/prepare
 *   → prepares input dir, copies assets, writes Layer 1 artifacts and brief
 *   → returns GenerationWorkspaceDto with rootPath / outputPath for the worker
 */
export function createGenerationWorkspaceRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();
    const convRepository = new MongoConversationRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const prepareWorkspace = new PrepareGenerationWorkspace(
        assetRepository,
        snapshotRepository,
        convRepository,
        localFileStorage
    );

    router.use(authMiddleware);

    // ------------------------------------------------------------------
    // POST /v1/projects/:projectId/workspace/prepare
    //
    // Body: { jobId: uuid, conversationId?: string, snapshotId?: uuid }
    //
    // Called by GenerationWorker (M3) or directly from the client before
    // queuing an OpenCode job.
    // ------------------------------------------------------------------
    router.post(
        "/projects/:projectId/workspace/prepare",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = prepareWorkspaceSchema.parse(req.body);

                const workspace = await prepareWorkspace.execute({
                    userId: req.auth!.userId,
                    projectId: req.sandbox!.projectId,
                    jobId: body.jobId,
                    conversationId: body.conversationId,
                    snapshotId: body.snapshotId,
                });

                res.status(201).json(toDto(workspace));
            } catch (error) {
                next(error);
            }
        }
    );

    return router;
}
