import type { NextFunction, Response } from "express";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { RequestWithContext } from "../types";

/** Project ids are MongoDB ObjectIds: 24 hex characters. Anything else names no project. */
const PROJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * Resolves `x-project-id` to a project the caller owns, or refuses the request. When the route has
 * a `:projectId` path parameter it must name the same project as the header.
 *
 * Express 4 does not catch a rejected promise from an async middleware: an error thrown here would
 * be an unhandled rejection, which ends the Node process. A malformed id is therefore refused before
 * it reaches the database driver (which throws on it), and any other failure goes to `next(error)`.
 */
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

        if (!PROJECT_ID_PATTERN.test(projectId)) {
            res.status(403).json({ error: "Project not accessible for current user" });
            return;
        }

        // A route that names its project in the path acts on that project only when it is the one
        // the header resolved. Refused, never substituted: otherwise a handler reading the path
        // would act on a project the ownership check never looked at.
        const pathProjectId = req.params?.projectId;
        if (typeof pathProjectId === "string" && pathProjectId.toLowerCase() !== projectId.toLowerCase()) {
            res.status(403).json({ error: "Project not accessible for current user", code: "PROJECT_SCOPE_MISMATCH" });
            return;
        }

        let project;
        try {
            project = await projectRepository.findByIdForUser(projectId, req.auth.userId);
        } catch (error) {
            next(error);
            return;
        }
        if (!project) {
            res.status(403).json({ error: "Project not accessible for current user" });
            return;
        }

        req.sandbox = { projectId: project.id };
        next();
    };
}
