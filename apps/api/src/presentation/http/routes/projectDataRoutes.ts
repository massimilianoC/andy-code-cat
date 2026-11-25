import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
    clearProjectDataSchema,
    exportProjectDataQuerySchema,
    listProjectDataRecordsQuerySchema,
} from "@andy-code-cat/contracts";
import { ManageProjectData } from "../../../application/projectData/ManageProjectData";
import type { ProjectDataRegistry } from "../../../application/projectData/ProjectDataRegistry";
import { composeProjectDataRegistry } from "../../../composition/composeProjectData";
import type { ProjectDataScope } from "../../../domain/projectData/ProjectDataCapability";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";

const recordIdSchema = z.string().min(1).max(128);

/**
 * The owner's data panel (docs/specs/PROJECT_DATA_PANEL.md): every record a platform capability
 * stored for the project — list, delete one, clear, export. Every route runs behind the double
 * sandbox: the JWT subject must own the project named by x-project-id, and the path must name the
 * same project. The scope is built from those two only; the request never supplies an owner.
 */
export function createProjectDataRoutes(registry: ProjectDataRegistry = composeProjectDataRegistry()): Router {
    const router = Router();
    const manageProjectData = new ManageProjectData(registry);
    const sandboxMiddleware = createSandboxMiddleware(new MongoProjectRepository());
    const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
    const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
    const exportLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

    function samePathProject(req: RequestWithContext, res: Response, next: NextFunction) {
        if (req.params.projectId !== req.sandbox?.projectId) {
            res.status(403).json({ error: "Project not accessible for current user" });
            return;
        }
        next();
    }

    function scopeOf(req: RequestWithContext): ProjectDataScope {
        return { ownerUserId: req.auth!.userId, projectId: req.sandbox!.projectId };
    }

    const guarded = [authMiddleware, sandboxMiddleware, samePathProject] as const;

    router.get("/projects/:projectId/data", readLimiter, ...guarded,
        async (req: RequestWithContext, res, next) => {
            try {
                res.json(await manageProjectData.summary(scopeOf(req)));
            } catch (error) {
                next(error);
            }
        });

    router.get("/projects/:projectId/data/:capabilityId/records", readLimiter, ...guarded,
        async (req: RequestWithContext, res, next) => {
            try {
                const query = listProjectDataRecordsQuerySchema.parse(req.query);
                res.json(await manageProjectData.list(scopeOf(req), String(req.params.capabilityId), query));
            } catch (error) {
                next(error);
            }
        });

    router.delete("/projects/:projectId/data/:capabilityId/records/:recordId", writeLimiter, ...guarded,
        async (req: RequestWithContext, res, next) => {
            try {
                const recordId = recordIdSchema.parse(String(req.params.recordId));
                const removed = await manageProjectData.deleteRecord(scopeOf(req), String(req.params.capabilityId), recordId);
                if (!removed) {
                    res.status(404).json({ error: "Record not found", code: "PROJECT_DATA_RECORD_NOT_FOUND" });
                    return;
                }
                res.status(204).end();
            } catch (error) {
                next(error);
            }
        });

    router.post("/projects/:projectId/data/:capabilityId/clear", writeLimiter, ...guarded,
        async (req: RequestWithContext, res, next) => {
            try {
                const input = clearProjectDataSchema.parse(req.body ?? {});
                res.json(await manageProjectData.clear(scopeOf(req), String(req.params.capabilityId), input));
            } catch (error) {
                next(error);
            }
        });

    router.get("/projects/:projectId/data/:capabilityId/export", exportLimiter, ...guarded,
        async (req: RequestWithContext, res, next) => {
            try {
                const query = exportProjectDataQuerySchema.parse(req.query);
                const file = await manageProjectData.exportFile(scopeOf(req), String(req.params.capabilityId), query);
                res.setHeader("Content-Type", file.contentType);
                // The filename is built server-side from [A-Za-z0-9._-] only, so it needs no escaping.
                res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
                res.setHeader("Cache-Control", "no-store");
                res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("X-Export-Records", String(file.exported));
                res.setHeader("X-Export-Total", String(file.total));
                res.status(200).send(file.body);
            } catch (error) {
                next(error);
            }
        });

    return router;
}
