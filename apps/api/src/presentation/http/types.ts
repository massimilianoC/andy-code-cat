import type { Request } from "express";

export interface AuthContext {
    userId: string;
    roles: string[];
}

export interface SandboxContext {
    projectId: string;
}

/**
 * The WorkSession this request belongs to, resolved from the `x-work-session-id` header.
 *
 * Rides here rather than through use-case constructors on purpose: every tool invoked inside a
 * session has to record its membership, and threading the id through thirteen constructors is the
 * refactor docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP4 explicitly forbids. A tool receives it
 * the way it already receives `projectId` — inside the call it is already being given.
 *
 * Always optional. Tracing must never fail a generation, so a missing or unresolvable session leaves
 * this undefined and the request proceeds untraced rather than rejected.
 */
export interface WorkSessionContext {
    id: string;
}

export type RequestWithContext = Request & {
    auth?: AuthContext;
    sandbox?: SandboxContext;
    workSession?: WorkSessionContext;
};
