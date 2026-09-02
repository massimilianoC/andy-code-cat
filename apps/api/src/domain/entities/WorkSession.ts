import type { PipelineEntryMode } from "@andy-code-cat/contracts";

/**
 * A working session — one user intent, from the first interaction with a tool to the last edit it
 * produces (docs/specs/WORK_SESSION_TRACING_SPEC.md §3).
 *
 * This is the root that was missing. `PipelineRun` is deliberately ONE generation — its model lock
 * is consumed by the first dispatch, and `ResolvePipelineModelLock.dispatch():181-193` treats a
 * second stage as proof the run has said everything it can truthfully say. That semantic is
 * incident-hardened (2026-08-26) and must not be widened to mean "a session". A session is the level
 * above: it opens when the user engages one of the three modes, and it holds however many
 * generations, edits and regenerations follow.
 *
 * What the session owns is the *starting conditions*. What each generation actually did belongs to
 * its own `PipelineRun`, and what each individual call sent and received belongs to its own
 * `PromptExecutionLog` row. One fact, one owner — the session does not restate them.
 */

/**
 * The user's opening move, photographed.
 *
 * "Photographed" is the whole point of this shape: these are the conditions at the moment the
 * session opened, not the conditions in force now. The model in particular can change mid-session —
 * a project conversation lets the user switch models between turns, and over-freezing it is exactly
 * what broke on 2026-08-26. So this records what was chosen *at the start*, and the authority for
 * what any given generation actually dispatched stays where it already lives, in that run's
 * `PipelineRun.modelLock`.
 */
export interface WorkSessionOpeningInput {
    /** The user's own words. Not a rendered prompt — that belongs to the journal row that sent it. */
    prompt: string;
    attachments: WorkSessionAttachmentRef[];
    /** An explicit model override, if the user made one. A record of intent, never an authority. */
    requestedProvider?: string;
    requestedModel?: string;
    /** BCP-47, as the client reported it. */
    uiLanguage?: string;
    /** The mode the user asked for, where the entry point offers a choice (e.g. "website"). */
    generationMode?: string;
    /**
     * Options that do not exist yet.
     *
     * Reasoning-report toggles, per-section budgets, whatever a later feature adds: this exists so
     * adding one is a value in an existing field rather than a migration of every historical
     * session. Anything that graduates into a first-class concern gets promoted out of here.
     */
    options?: Record<string, unknown>;
}

/** A pointer, not a copy — the asset itself stays in its own collection and storage. */
export interface WorkSessionAttachmentRef {
    assetId: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
}

export type WorkSessionStatus = "open" | "completed" | "failed" | "abandoned";

export interface WorkSession {
    id: string;
    userId: string;
    /**
     * Absent until a project exists. A Vibe session begins before there is anything to attach it
     * to, which is precisely why a conversation could not serve as this root: conversations are
     * project-scoped, and the session starts earlier.
     */
    projectId?: string;
    /** Which of the three tools opened it: `vibe`, `zero-effort` or `workspace`. */
    entryMode: PipelineEntryMode;
    openingInput: WorkSessionOpeningInput;
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
