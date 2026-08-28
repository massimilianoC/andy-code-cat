import { Router } from "express";
import rateLimit from "express-rate-limit";
import { updateProjectFormSettingsSchema } from "@andy-code-cat/contracts";
import { GetProjectFormSettings, SetProjectFormSettings, toProjectFormSettingsDto } from "../../../application/forms/ProjectFormSettings";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";

/** Owner API for the initial mailto form adapter. Public BaaS routes are intentionally absent. */
export function createFormServiceRoutes(): Router {
    const router = Router();
    const projectRepository = new MongoProjectRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);
    const getSettings = new GetProjectFormSettings(projectRepository);
    const setSettings = new SetProjectFormSettings(projectRepository);
    const formServiceLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
    });

    router.get("/projects/:projectId/services/forms", formServiceLimiter, authMiddleware, sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const settings = await getSettings.execute(req.sandbox!.projectId, req.auth!.userId);
            res.json({ settings: toProjectFormSettingsDto(settings) ?? null });
        } catch (error) {
            next(error);
        }
    });

    router.put("/projects/:projectId/services/forms", formServiceLimiter, authMiddleware, sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const settings = updateProjectFormSettingsSchema.parse(req.body);
            const project = await setSettings.execute(req.sandbox!.projectId, req.auth!.userId, settings);
            res.json({ settings: toProjectFormSettingsDto(project.serviceConfig?.forms) });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
