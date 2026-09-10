import type { NextFunction, Response } from "express";
import type { WorkSessionRepository } from "../../../domain/repositories/WorkSessionRepository";
import type { RequestWithContext } from "../types";

export const WORK_SESSION_HEADER = "x-work-session-id";

/**
 * Resolves `x-work-session-id` into `req.workSession`, so every downstream tool can record which
 * session it belongs to without being handed a new constructor dependency
 * (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP4).
 *
 * **Deliberately non-blocking, unlike `sandboxMiddleware`.** That one rejects a request without a
 * valid project because the request is meaningless without one. This one never rejects: a missing,
 * malformed or foreign session id leaves `req.workSession` undefined and the request proceeds
 * untraced. Tracing must never fail a generation — a user losing their work because a logging header
 * was wrong would be a worse defect than the blindness this exists to cure.
 *
 * Ownership is still enforced: the lookup is scoped to the caller, so a session id belonging to
 * someone else resolves to nothing rather than letting one user's calls be journalled into another
 * user's history.
 */
export function createWorkSessionMiddleware(workSessionRepository: WorkSessionRepository) {
    return async function workSessionMiddleware(
        req: RequestWithContext,
        _res: Response,
        next: NextFunction,
    ): Promise<void> {
        const headerValue = req.headers[WORK_SESSION_HEADER];
        const sessionId = String(Array.isArray(headerValue) ? headerValue[0] : headerValue ?? "").trim();
        // Read directly from the header rather than req.sandbox: this middleware is mounted at
        // router level, and sandboxMiddleware runs per route, so req.sandbox is frequently not
        // populated yet when we get here.
        const projectHeader = req.headers["x-project-id"];
        const projectId = String(Array.isArray(projectHeader) ? projectHeader[0] : projectHeader ?? "").trim();

        if (!req.auth || (!sessionId && !projectId)) {
            next();
            return;
        }

        try {
            const session = sessionId
                ? await workSessionRepository.findByIdForUser(sessionId, req.auth.userId)
                : null;
            // A closed session must not accept new work journalled against it: its history is
            // finished, and appending to it would make "what happened in this session" a moving
            // target. The request still proceeds — it is simply not attributed.
            if (session && session.status === "open") {
                req.workSession = { id: session.id };
            } else if (projectId) {
                // Fallback for a client that does not echo the session id back. Found by exporting a
                // real UI-driven run: classify and prefill carried the session because the routes
                // resolve it themselves, while `generate` — the call that produces the artifact —
                // carried none, so the session could not reach the very thing it exists to explain.
                // An OPEN session on this project is the intent in progress there.
                const openOnProject = await workSessionRepository.findOpenByProject(projectId, req.auth.userId);
                if (openOnProject) req.workSession = { id: openOnProject.id };
            }
        } catch {
            // Same reasoning as above: a database hiccup while resolving a tracing header is not a
            // reason to refuse the user's generation.
        }

        next();
    };
}
