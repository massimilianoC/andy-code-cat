import type { VibeAttachmentRef } from "@andy-code-cat/contracts";

// Declaration moved to packages/contracts — the inspector renders it, so both sides need the shape.
export type { VibeAttachmentRef };

/**
 * What the user handed the Vibe tool, at the moment they handed it over
 * (docs/specs/WORK_SESSION_TRACING_SPEC.md §3.1).
 *
 * This owns a fact nothing else owns. Before it, the prompt, the attachments and the model override
 * existed only as an HTTP request body: a Vibe request that failed early left no record that it was
 * ever made, and one that succeeded left only its consequences.
 *
 * It is an **intake**, not a run log. It records what was submitted and points at the journal rows
 * the submission produced; it does not restate their contents.
 */
export interface VibeIntake {
    id: string;
    workSessionId: string;
    userId: string;
    /** Absent when the intake precedes the project it will create. */
    projectId?: string;

    /** The user's own words, verbatim. Not a rendered prompt — that belongs to the journal row. */
    prompt: string;
    attachments: VibeAttachmentRef[];

    /**
     * The model the user explicitly asked for, if they asked for one.
     *
     * A record of intent, never an authority. What a generation actually dispatched lives in that
     * run's `PipelineRun.modelLock`, because the model can legitimately change later in the session
     * — over-freezing it is what broke on 2026-08-26.
     */
    requestedProvider?: string;
    requestedModel?: string;

    /** The mode asked for where the entry point offers a choice, e.g. "website". */
    generationMode?: string;
    /** Forward slot for per-intake options that do not exist yet. */
    options?: Record<string, unknown>;

    /**
     * The journal rows this intake produced — classify, prefill, and anything else dispatched on its
     * behalf. Ids only: the rows hold the content.
     */
    promptExecutionLogIds: string[];

    createdAt: Date;
}

export type NewVibeIntake = Omit<VibeIntake, "id" | "createdAt" | "promptExecutionLogIds">;
