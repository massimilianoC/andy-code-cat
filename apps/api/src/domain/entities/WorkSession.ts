import type { PipelineEntryMode, WorkSessionConfig, WorkSessionStatus } from "@andy-code-cat/contracts";

// Re-exported so existing importers keep working. The declarations themselves moved to
// packages/contracts: the web client needs the same shapes, and a type declared in two places is a
// type that will eventually disagree with itself.
export type { WorkSessionStatus, WorkSessionConfig };

/**
 * A working session — one user intent, from the first interaction with a tool to the last edit it
 * produces (docs/specs/WORK_SESSION_TRACING_SPEC.md §3).
 *
 * This is a **certificate, not a container**. It asserts that a session began: by this user, in this
 * organisation, through this tool, at this moment, under this session-scoped configuration. It holds
 * no mode payload — the Vibe prompt and its attachments belong to `VibeIntake`, which is one tool's
 * input/output cycle, and what each generation actually did belongs to its `PipelineRun`.
 */
export interface WorkSession {
    id: string;
    userId: string;
    /** The tenant this session belongs to, where the deployment is multi-tenant. */
    organizationId?: string;
    /**
     * Absent until a project exists. A Vibe session begins before there is anything to attach it
     * to, which is precisely why a conversation could not serve as this root: conversations are
     * project-scoped, and the session starts earlier.
     */
    projectId?: string;
    /** Which of the three tools opened it: `vibe`, `zero-effort` or `workspace`. */
    entryMode: PipelineEntryMode;
    config: WorkSessionConfig;
    status: WorkSessionStatus;
    /** Set when the session ends unhappily — the human-readable reason, not a stack trace. */
    failureReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

export type NewWorkSession = Omit<WorkSession, "id" | "status" | "createdAt" | "updatedAt" | "failureReason">;

const ALLOWED_TRANSITIONS: Record<WorkSessionStatus, WorkSessionStatus[]> = {
    open: ["completed", "failed", "abandoned"],
    // Terminal. A session that produced an artifact and is then edited further does not reopen:
    // the edit belongs to the session that is still open, or starts its own.
    completed: [],
    failed: [],
    abandoned: [],
};

export function assertWorkSessionTransition(from: WorkSessionStatus, to: WorkSessionStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        throw new Error(`WorkSession: illegal status transition ${from} -> ${to}`);
    }
}
