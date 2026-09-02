import type { PipelineEntryMode } from "@andy-code-cat/contracts";

/**
 * A working session — one user intent, from the first interaction with a tool to the last edit it
 * produces (docs/specs/WORK_SESSION_TRACING_SPEC.md §3).
 *
 * This is a **certificate, not a container**. It asserts that a session began: by this user, in this
 * organisation, through this tool, at this moment, under this session-scoped configuration. It holds
 * no mode payload.
 *
 * The first cut of this entity carried the Vibe prompt, its attachments and the model override as an
 * `openingInput`, and that was wrong in three ways that only appear in use: a session entered
 * through `workspace` has neither prompt nor attachments, so the field was dead on a third of all
 * sessions; a user who goes back and re-prompts produces two intakes and the shape held one; and it
 * conflated *"a session began"* with *"this is what the Vibe tool was handed"*. Those belong to
 * `VibeIntake`, which is one tool's input/output cycle.
 *
 * What each generation actually did belongs to its `PipelineRun`; what each individual call sent and
 * received belongs to its `PromptExecutionLog` row. One fact, one owner — the session restates none
 * of them, and everything downstream carries its id.
 */

export type WorkSessionStatus = "open" | "completed" | "failed" | "abandoned";

/**
 * Configuration true of the session as a whole, as opposed to one tool invocation.
 *
 * Deliberately near-empty today. Anything that varies per call — the model, the prompt, the
 * attachments — is not session-scoped and does not belong here, however tempting the convenience.
 */
export interface WorkSessionConfig {
    /** BCP-47, as the client reported it when the session opened. */
    uiLanguage?: string;
    /**
     * Settings that do not exist yet: reasoning-report toggles, default budgets, whatever a later
     * feature adds. A new session-scoped option should be a value here, not a migration of every
     * historical session. Anything that graduates into a first-class concern is promoted out.
     */
    options?: Record<string, unknown>;
}

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
