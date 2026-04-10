import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoExecutionLogRepository } from "../../../infra/repositories/MongoExecutionLogRepository";
import type { RequestWithContext } from "../types";
import type { LogDomain, LogLevel } from "../../../domain/entities/ExecutionLog";

const querySchema = z.object({
    domain: z.enum(["llm", "focus_patch", "snapshot", "wysiwyg", "export", "system"]).optional(),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    conversationId: z.string().uuid().optional(),
    snapshotId: z.string().uuid().optional(),
    before: z
        .string()
        .datetime({ offset: true })
        .optional()
        .transform((v) => (v ? new Date(v) : undefined)),
    limit: z
        .string()
        .optional()
        .transform((v) => {
            const n = v ? parseInt(v, 10) : 50;
            return isNaN(n) ? 50 : Math.min(n, 200);
        }),
});

export function createExecutionLogRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const executionLogRepository = new MongoExecutionLogRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    router.use(authMiddleware);

    /**
     * GET /projects/:projectId/execution-logs
     *
     * Query execution logs for a project.
     * Query params (all optional):
     *   domain        — "llm" | "focus_patch" | "snapshot" | "wysiwyg" | "export" | "system"
     *   level         — "debug" | "info" | "warn" | "error"
     *   conversationId — UUID
     *   snapshotId    — UUID
     *   before        — ISO-8601 datetime cursor for pagination
     *   limit         — 1-200, default 50
     */
    router.get(
        "/projects/:projectId/execution-logs",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const parsed = querySchema.safeParse(req.query);
                if (!parsed.success) {
                    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
                    return;
                }

                const { domain, level, conversationId, snapshotId, before, limit } = parsed.data;

                const logs = await executionLogRepository.findByProject(req.sandbox!.projectId, {
                    domain: domain as LogDomain | undefined,
                    level: level as LogLevel | undefined,
                    conversationId,
                    snapshotId,
                    before,
                    limit,
                });

                res.json({ logs });
            } catch (error) {
                next(error);
            }
        }
    );

    return router;
}
