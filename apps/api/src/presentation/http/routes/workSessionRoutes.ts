import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoWorkSessionRepository } from "../../../infra/repositories/MongoWorkSessionRepository";
import { MongoVibeIntakeRepository } from "../../../infra/repositories/MongoVibeIntakeRepository";
import { MongoZeroEffortFormProposalRepository } from "../../../infra/repositories/MongoZeroEffortFormProposalRepository";
import { MongoPipelineRunRepository } from "../../../infra/repositories/MongoPipelineRunRepository";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoCostTransactionRepository } from "../../../infra/repositories/MongoCostTransactionRepository";
import { ListWorkSessionSummaries } from "../../../application/use-cases/ListWorkSessionSummaries";
import { GetWorkSessionDetail } from "../../../application/use-cases/GetWorkSessionDetail";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";

/**
 * Session Inspector — the two read endpoints (docs/specs/SESSION_INSPECTOR_SPEC.md §2).
 *
 * Read-only (spec §5.1): neither route writes anything. Put in its own file, not merged into
 * pipelineRunRoutes.ts or executionLogRoutes.ts, because another agent may be editing existing
 * route files concurrently with this work.
 *
 * `GET /projects/:projectId/work-sessions` returns collapsed-row summaries with NO prompt bodies
 * (spec §5.5) — see ListWorkSessionSummaries for what is deliberately left out.
 * `GET /projects/:projectId/work-sessions/:workSessionId` returns everything, including prompt
 * bodies — the client only calls this once a block is expanded.
 */
export function createWorkSessionRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const workSessionRepository = new MongoWorkSessionRepository();
    const vibeIntakeRepository = new MongoVibeIntakeRepository();
    const zeroEffortFormProposalRepository = new MongoZeroEffortFormProposalRepository();
    const pipelineRunRepository = new MongoPipelineRunRepository();
    const promptExecutionLogRepository = new MongoPromptExecutionLogRepository();
    const costTransactionRepository = new MongoCostTransactionRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const workSessionLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
    });

    const listWorkSessionSummaries = new ListWorkSessionSummaries(
        workSessionRepository,
        pipelineRunRepository,
        promptExecutionLogRepository,
        costTransactionRepository,
    );
    const getWorkSessionDetail = new GetWorkSessionDetail(
        workSessionRepository,
        vibeIntakeRepository,
        zeroEffortFormProposalRepository,
        pipelineRunRepository,
        promptExecutionLogRepository,
        costTransactionRepository,
        new MongoPreviewSnapshotRepository(),
    );

    router.get(
        "/projects/:projectId/work-sessions",
        workSessionLimiter,
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const sessions = await listWorkSessionSummaries.execute(req.sandbox!.projectId, req.auth!.userId);
                res.json({ sessions });
            } catch (error) {
                next(error);
            }
        },
    );

    router.get(
        "/projects/:projectId/work-sessions/:workSessionId",
        workSessionLimiter,
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const detail = await getWorkSessionDetail.execute(
                    req.sandbox!.projectId,
                    req.params.workSessionId!,
                    req.auth!.userId,
                );
                if (!detail) {
                    // Same 404 whether the session doesn't exist, belongs to another user, or
                    // belongs to a different project — never a 403 that would confirm existence
                    // (spec §5: ownership-scoped everywhere / double sandbox).
                    res.status(404).json({ error: "Work session not found" });
                    return;
                }
                res.json({ session: detail });
            } catch (error) {
                next(error);
            }
        },
    );

    return router;
}
