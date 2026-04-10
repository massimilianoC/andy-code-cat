import type { NextFunction, Response } from "express";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { RequestWithContext } from "../types";

export function createSandboxMiddleware(projectRepository: ProjectRepository) {
    return async function sandboxMiddleware(
        req: RequestWithContext,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        if (!req.auth) {
            res.status(401).json({ error: "Missing auth context" });
            return;
        }

        const projectId = String(req.headers["x-project-id"] || "").trim();
        if (!projectId) {
            res.status(400).json({ error: "Missing x-project-id header" });
            return;
        }

        const project = await projectRepository.findByIdForUser(projectId, req.auth.userId);
        if (!project) {
            res.status(403).json({ error: "Project not accessible for current user" });
            return;
        }

        req.sandbox = { projectId: project.id };
        next();
    };
}
