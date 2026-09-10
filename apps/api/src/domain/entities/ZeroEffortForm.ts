import type { GuidedLaunchInput } from "@andy-code-cat/contracts";

/**
 * What the prefill proposed, and what the user changed about it
 * (docs/specs/WORK_SESSION_TRACING_SPEC.md §3.1).
 *
 * **This entity is deliberately smaller than it first looks like it should be.** The obvious design
 * — store the whole Zero Effort form — is already implemented elsewhere and was nearly duplicated
 * here: `buildCanonicalGenerationBrief` writes `sourceFields: { ...input }` into the envelope
 * (`buildCanonicalGenerationBrief.ts:39` and `:152`), so the full nineteen-field confirmed intake is
 * already persisted on `PipelineRun.canonicalBrief`, hashed and timestamped, for both the derived
 * and the hand-edited case.
 *
 * So `confirmed` does not live here. What genuinely has no owner is the *other* side of the
 * comparison: what `VibePrefill` suggested before the user touched it. Without it, one question
 * stays unanswerable — **did the user accept the model's proposal or overrule it** — and that is the
 * difference between what the machine thought and what the human decided.
 *
 * One fact, one owner: this object holds the proposal and the diff, and points at the envelope that
 * already holds the result.
 */
export interface ZeroEffortFormProposal {
    id: string;
    workSessionId: string;
    userId: string;
    projectId?: string;

    /** What `VibePrefill` proposed, before the user saw it. */
    prefilled: GuidedLaunchInput;
    /**
     * Field names the user changed between the proposal and what they submitted. Stored rather than
     * recomputed: re-deriving it later means diffing two payloads against a schema that may have
     * moved in between.
     */
    editedFields: string[];

    /** The prefill call itself, so its prompt and raw reply stay reachable. */
    prefillPromptExecutionLogId?: string;
    /**
     * The `contentHash` of the envelope the submitted form produced — the same hash carried by
     * `PipelineRun.canonicalBrief`, whose `sourceFields` is the confirmed intake. A pointer, so the
     * result keeps exactly one owner.
     */
    briefContentHash?: string;

    createdAt: Date;
}

export type NewZeroEffortFormProposal = Omit<ZeroEffortFormProposal, "id" | "createdAt">;

/**
 * Names the fields that differ between what the model proposed and what the user submitted.
 *
 * Compares on JSON value rather than reference so that arrays and nested objects — `contactInfo`,
 * `styleAttributes`, `attachmentNames` — are judged by content. A field the user retyped identically
 * is not an edit.
 */
export function diffFormFields(
    prefilled: GuidedLaunchInput | undefined,
    confirmed: GuidedLaunchInput,
): string[] {
    if (!prefilled) return [];
    const keys = new Set([...Object.keys(prefilled), ...Object.keys(confirmed)]);
    const changed: string[] = [];
    for (const key of keys) {
        const before = (prefilled as Record<string, unknown>)[key];
        const after = (confirmed as Record<string, unknown>)[key];
        if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) changed.push(key);
    }
    return changed.sort();
}
