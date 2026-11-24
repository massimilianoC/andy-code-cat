/**
 * Background runs — HTTP surface (docs/specs/BACKGROUND_RUNS.md §3.5, §4).
 *
 *   POST /v1/background-runs             start: creates the run's project and queues the run
 *   GET  /v1/background-runs             the caller's recent runs, newest first
 *   GET  /v1/background-runs/:id         one run of the caller
 *   POST /v1/background-runs/:id/cancel  the caller stops one of their runs
 *
 * An id is not a credential: every read and write is scoped by the user of the token, so a run
 * of someone else answers 404 exactly like a run that does not exist. The worker, not this
 * process, executes the run.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createBackgroundRunSchema, type BackgroundRunDto, type BackgroundRunEstimateDto } from "@andy-code-cat/contracts";
import { env } from "../../../config";
import { EstimateBackgroundRunDuration } from "../../../application/background/EstimateBackgroundRunDuration";
import { ManageProject } from "../../../application/use-cases/ManageProject";
import type { BackgroundRun } from "../../../domain/entities/BackgroundRun";
import { MongoBackgroundRunDurationStats } from "../../../infra/repositories/MongoBackgroundRunDurationStats";
import { MongoBackgroundRunRepository } from "../../../infra/repositories/MongoBackgroundRunRepository";
import { MongoProjectMoodboardRepository } from "../../../infra/repositories/MongoProjectMoodboardRepository";
import { MongoProjectPresetRepository } from "../../../infra/repositories/MongoProjectPresetRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { authMiddleware } from "../middlewares/authMiddleware";
import type { RequestWithContext } from "../types";

/** Same rule as the home: the project is named after the start of the prompt until the brief renames it. */
const PROJECT_NAME_FROM_PROMPT_CHARS = 64;

const listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export function toBackgroundRunDto(run: BackgroundRun, estimate: BackgroundRunEstimateDto, projectName?: string): BackgroundRunDto {
    const publish = run.outputs.publish;
    return {
        id: run.id,
        projectId: run.projectId,
        projectName,
        status: run.status,
        prompt: run.input.prompt,
        conversationId: run.outputs.launch?.conversationId,
        estimate,
        progress: run.progress
            ? { generatedChars: run.progress.generatedChars, updatedAt: run.progress.updatedAt.toISOString() }
            : undefined,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        startedAt: run.startedAt?.toISOString(),
        finishedAt: run.finishedAt?.toISOString(),
        costEur: run.costEur,
        cancelRequested: run.cancelRequested,
        transitions: run.transitions.map((transition) => ({
            status: transition.status,
            phase: transition.phase,
            at: transition.at.toISOString(),
            ...(transition.detail ? { detail: transition.detail } : {}),
        })),
        site: publish
            ? { publishId: publish.publishId, publicUrl: publish.publicUrl, proposedSlug: publish.proposedSlug }
            : undefined,
        error: run.error,
    };
}

export function createBackgroundRunRoutes(): Router {
    const router = Router();
    const runs = new MongoBackgroundRunRepository();
    const projects = new MongoProjectRepository();
    const manageProject = new ManageProject(projects, new MongoProjectPresetRepository(), new MongoProjectMoodboardRepository());
    const estimate = new EstimateBackgroundRunDuration(new MongoBackgroundRunDurationStats());

    const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
    const writeLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

    async function present(run: BackgroundRun): Promise<BackgroundRunDto> {
        const project = await projects.findByIdForUser(run.projectId, run.userId).catch(() => null);
        return toBackgroundRunDto(run, await estimate.execute(), project?.name);
    }

    router.post("/background-runs", writeLimiter, authMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const input = createBackgroundRunSchema.parse(req.body);
            const userId = req.auth!.userId;

            const active = await runs.countActiveForUser(userId);
            if (active >= env.BACKGROUND_RUN_MAX_PER_USER) {
                res.status(429).json({
                    error: `At most ${env.BACKGROUND_RUN_MAX_PER_USER} background runs at once`,
                    code: "BACKGROUND_RUN_LIMIT_REACHED",
                    userMessage: `Hai già ${active} generazioni in background in corso: attendi che una finisca.`,
                    details: { active, max: env.BACKGROUND_RUN_MAX_PER_USER },
                });
                return;
            }

            // The run's own project, created here by the authenticated owner: authority is
            // established once, now, and the worker acts only inside it (§4).
            const project = await manageProject.create({
                userId,
                name: input.prompt.slice(0, PROJECT_NAME_FROM_PROMPT_CHARS).trim(),
            });
            const run = await runs.create({
                userId,
                projectId: project.id,
                // Absent fields stay absent (the driver would store an undefined as null).
                input: Object.fromEntries(Object.entries({
                    prompt: input.prompt,
                    uiLanguage: input.uiLanguage,
                    provider: input.provider,
                    model: input.model,
                    generationMode: input.generationMode,
                }).filter(([, value]) => value !== undefined)) as typeof input,
            });
            res.status(201).json({ run: await present(run) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/background-runs", readLimiter, authMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const { limit } = listQuerySchema.parse(req.query);
            const list = await runs.listForUser(req.auth!.userId, limit ?? 20);
            res.json({ runs: await Promise.all(list.map(present)) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/background-runs/:id", readLimiter, authMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const run = await runs.findByIdForUser(String(req.params.id), req.auth!.userId);
            if (!run) {
                res.status(404).json({ error: "Background run not found", code: "BACKGROUND_RUN_NOT_FOUND" });
                return;
            }
            res.json({ run: await present(run) });
        } catch (error) {
            next(error);
        }
    });

    router.post("/background-runs/:id/cancel", writeLimiter, authMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const run = await runs.requestCancel(String(req.params.id), req.auth!.userId, new Date());
            if (!run) {
                res.status(404).json({ error: "Background run not found", code: "BACKGROUND_RUN_NOT_FOUND" });
                return;
            }
            res.json({ run: await present(run) });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
