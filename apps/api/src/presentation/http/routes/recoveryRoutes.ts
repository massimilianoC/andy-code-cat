import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { RequestWithContext } from "../types";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectMoodboardRepository } from "../../../infra/repositories/MongoProjectMoodboardRepository";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { MongoWorkSessionRepository } from "../../../infra/repositories/MongoWorkSessionRepository";
import { MongoPipelineRunRepository } from "../../../infra/repositories/MongoPipelineRunRepository";
import { MongoCostTransactionRepository } from "../../../infra/repositories/MongoCostTransactionRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoMediaResolutionTraceRepository } from "../../../infra/repositories/MongoMediaResolutionTraceRepository";
import { MongoVibeIntakeRepository } from "../../../infra/repositories/MongoVibeIntakeRepository";
import { MongoPublishHistoryRepository } from "../../../infra/repositories/MongoPublishHistoryRepository";
import { MongoWysiwygEditSessionRepository } from "../../../infra/repositories/MongoWysiwygEditSessionRepository";
import { MongoZeroEffortFormProposalRepository } from "../../../infra/repositories/MongoZeroEffortFormProposalRepository";
import { MongoDidacticArtifactKnowledgeRepository } from "../../../infra/repositories/MongoDidacticArtifactKnowledgeRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { MongoSiteDeploymentRepository } from "../../../infra/repositories/MongoSiteDeploymentRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { GetZeroEffortRecoveryStatus } from "../../../application/use-cases/GetZeroEffortRecoveryStatus";
import { DiscardPendingProject } from "../../../application/use-cases/DiscardPendingProject";
import { DeleteProject } from "../../../application/use-cases/DeleteProject";

/**
 * Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis) — Feature A.
 *
 * A NEW file on purpose: llmRoutes.ts and projectRoutes.ts are both being edited concurrently by
 * other agents on this branch, so nothing here touches either. These two endpoints are additive
 * — they read the journal and, on discard, delete a project the SAME way an owner already could
 * via DeleteProject, just more thoroughly (journal rows, costs, sessions and runs included, not
 * only the project row and its moodboard).
 *
 * Both routes are read/delete only. Neither dispatches to an LLM provider, journals a call, or
 * creates anything — the actual "retry" generation is an ordinary `/llm/chat-preview` turn the
 * client sends itself, carrying `resumedFromPromptExecutionId` and the `resumePrompt` this
 * status endpoint hands back. That is the whole of what makes this additive rather than a new
 * execution path (AGENTS.md Rule Zero): recovery re-enters the one generation path that already
 * exists instead of building a second one.
 */
export function createRecoveryRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const moodboardRepository = new MongoProjectMoodboardRepository();
    const promptExecutionLogRepository = new MongoPromptExecutionLogRepository();
    const conversationRepository = new MongoConversationRepository();
    const workSessionRepository = new MongoWorkSessionRepository();
    const pipelineRunRepository = new MongoPipelineRunRepository();
    const costTransactionRepository = new MongoCostTransactionRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();

    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const readLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
    const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

    const getRecoveryStatus = new GetZeroEffortRecoveryStatus(promptExecutionLogRepository, snapshotRepository);
    // One deletion, fully wired. Discard adds the guard and the counts; the removal itself is
    // DeleteProject, the same one the dashboard uses.
    const discardPendingProject = new DiscardPendingProject(
        projectRepository,
        snapshotRepository,
        new DeleteProject(
            projectRepository,
            moodboardRepository,
            promptExecutionLogRepository,
            conversationRepository,
            workSessionRepository,
            pipelineRunRepository,
            costTransactionRepository,
            snapshotRepository,
            new MongoMediaResolutionTraceRepository(),
            new MongoVibeIntakeRepository(),
            new MongoPublishHistoryRepository(),
            new MongoWysiwygEditSessionRepository(),
            new MongoZeroEffortFormProposalRepository(),
            new MongoDidacticArtifactKnowledgeRepository(),
            new MongoProjectAssetRepository(),
            new MongoSiteDeploymentRepository(),
            getFileStorage(),
        ),
    );

    router.get(
        "/projects/:projectId/recovery/status",
        readLimiter,
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const status = await getRecoveryStatus.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                });
                res.json(status);
            } catch (error) {
                next(error);
            }
        },
    );

    router.post(
        "/projects/:projectId/recovery/discard",
        writeLimiter,
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const result = await discardPendingProject.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                });
                res.json(result);
            } catch (error) {
                next(error);
            }
        },
    );

    return router;
}
