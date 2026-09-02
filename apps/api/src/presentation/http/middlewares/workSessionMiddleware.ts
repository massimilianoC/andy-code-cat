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

        if (!sessionId || !req.auth) {
            next();
            return;
        }

        try {
            const session = await workSessionRepository.findByIdForUser(sessionId, req.auth.userId);
            // A closed session must not accept new work journalled against it: its history is
            // finished, and appending to it would make "what happened in this session" a moving
            // target. The request still proceeds — it is simply not attributed.
            if (session && session.status === "open") {
                req.workSession = { id: session.id };
            }
        } catch {
            // Same reasoning as above: a database hiccup while resolving a tracing header is not a
            // reason to refuse the user's generation.
        }

        next();
    };
}
