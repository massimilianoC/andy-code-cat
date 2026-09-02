/**
 * What the user handed the Vibe tool, at the moment they handed it over
 * (docs/specs/WORK_SESSION_TRACING_SPEC.md §3.1).
 *
 * This owns a fact nothing else owns. Today the prompt, the attachments and the model override exist
 * only as an HTTP request body: a Vibe request that fails before producing anything leaves no record
 * that it was ever made, and one that succeeds leaves only its consequences.
 *
 * It is an **intake**, not a run log. It records what was submitted and points at the journal rows
 * the submission produced; it does not restate their contents. The rendered prompts, the raw
 * replies, the tokens, the cost and the endpoint all belong to `PromptExecutionLog`, and copying
 * them here would give those facts a second owner.
 */

export interface VibeAttachmentRef {
    /**
     * Pointer, not copy — the asset keeps living in its own collection and its own storage.
     *
     * Optional because at Vibe intake time it frequently does not exist yet: the classifier receives
     * `AttachmentMeta` (filename, mime type, size) describing files the user selected, and those
     * become `ProjectAsset` rows only later in the flow. Recording the metadata without an id still
     * answers what the user attached, which is the question; demanding an id here would mean either
     * inventing one or dropping the attachment from the record entirely.
     */
    assetId?: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
}

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
