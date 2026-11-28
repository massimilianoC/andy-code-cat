import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import { listLeaderboardQuerySchema, submitLeaderboardScoreSchema, leaderboardBoardIdSchema, LEADERBOARD_DEFAULT_BOARD_ID } from "@andy-code-cat/contracts";
import { ManageLeaderboard } from "../../../application/leaderboard/ManageLeaderboard";
import type { LeaderboardScope } from "../../../domain/entities/LeaderboardEntry";
import { MongoLeaderboardRepository } from "../../../infra/repositories/MongoLeaderboardRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";

/**
 * Leaderboards of a project, for its owner (the Arcade shell). Every route runs behind the double
 * sandbox: the JWT subject must own the project named by x-project-id, and the path must name the
 * same project. Scores are never written by an anonymous visitor in this version — a public
 * submit path is a separate, reviewed capability (docs/specs/ARCADE_MODE_MVP.md §6).
 */
export function createLeaderboardRoutes(): Router {
    const router = Router();
    const manageLeaderboard = new ManageLeaderboard(new MongoLeaderboardRepository());
    const sandboxMiddleware = createSandboxMiddleware(new MongoProjectRepository());
    const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
    const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

    function samePathProject(req: RequestWithContext, res: Response, next: NextFunction) {
        if (req.params.projectId !== req.sandbox?.projectId) {
            res.status(403).json({ error: "Project not accessible for current user" });
            return;
        }
        next();
    }

    function scopeOf(req: RequestWithContext, boardId: string): LeaderboardScope {
        return { ownerUserId: req.auth!.userId, projectId: req.sandbox!.projectId, boardId };
    }

    // The owner's own games only: the scope is the JWT subject, so no project header is involved.
    router.get("/leaderboards/summary", readLimiter, authMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const boardId = leaderboardBoardIdSchema.parse(String(req.query.boardId ?? LEADERBOARD_DEFAULT_BOARD_ID));
                res.json({ boardId, games: await manageLeaderboard.summary(req.auth!.userId, boardId) });
            } catch (error) {
                next(error);
            }
        });

    router.get("/projects/:projectId/leaderboard", readLimiter, authMiddleware, sandboxMiddleware, samePathProject,
        async (req: RequestWithContext, res, next) => {
            try {
                const query = listLeaderboardQuerySchema.parse(req.query);
                res.json({ boardId: query.boardId, entries: await manageLeaderboard.top(scopeOf(req, query.boardId), query.limit) });
            } catch (error) {
                next(error);
            }
        });

    router.post("/projects/:projectId/leaderboard", writeLimiter, authMiddleware, sandboxMiddleware, samePathProject,
        async (req: RequestWithContext, res, next) => {
            try {
                const input = submitLeaderboardScoreSchema.parse(req.body);
                const result = await manageLeaderboard.submit(scopeOf(req, input.boardId), input, 10);
                res.status(201).json(result);
            } catch (error) {
                next(error);
            }
        });

    router.delete("/projects/:projectId/leaderboard/:entryId", writeLimiter, authMiddleware, sandboxMiddleware, samePathProject,
        async (req: RequestWithContext, res, next) => {
            try {
                const boardId = leaderboardBoardIdSchema.parse(String(req.query.boardId ?? LEADERBOARD_DEFAULT_BOARD_ID));
                const removed = await manageLeaderboard.remove(scopeOf(req, boardId), String(req.params.entryId));
                if (!removed) {
                    res.status(404).json({ error: "Score not found" });
                    return;
                }
                res.status(204).end();
            } catch (error) {
                next(error);
            }
        });

    return router;
}
