import type { GuidedLaunchInput } from "@andy-code-cat/contracts";

/**
 * The Zero Effort form as the user confirmed it
 * (docs/specs/WORK_SESSION_TRACING_SPEC.md §3.1).
 *
 * `GuidedLaunchInput` (`packages/contracts/src/pipeline.ts:30-61`) is nineteen fields wide and today
 * is a **DTO that is never stored**: it flows through `LaunchGuidedProject`, produces a brief, and
 * disappears. Only the derived brief survives, on `PipelineRun.canonicalBrief`.
 *
 * That leaves two questions permanently unanswerable, and they are the two worth asking:
 *
 *   1. what did the form actually contain, as opposed to what the brief says it contained;
 *   2. **did the user change what the prefill proposed** — the difference between the model's
 *      suggestion and the human's decision, which is currently invisible.
 *
 * Question 2 is why `prefilled` and `edited` are separate snapshots rather than one payload with a
 * dirty flag: a diff needs both sides.
 */
export interface ZeroEffortForm {
    id: string;
    workSessionId: string;
    userId: string;
    projectId?: string;

    /** What `VibePrefill` proposed. Absent when the user filled the form unaided. */
    prefilled?: GuidedLaunchInput;
    /** What was actually submitted. Always present — this is the form that ran. */
    confirmed: GuidedLaunchInput;
    /**
     * Field names the user changed between the two. Derived, but stored: recomputing it later means
     * re-deriving intent from two payloads whose schema may since have moved.
     */
    editedFields: string[];

    /** The prefill call that produced `prefilled`, so its prompt and raw reply stay reachable. */
    prefillPromptExecutionLogId?: string;
    /**
     * The content hash of the brief this form produced — the same hash `PipelineRun.canonicalBrief`
     * carries. A reference, so the brief text keeps exactly one owner.
     */
    briefContentHash?: string;

    createdAt: Date;
}

export type NewZeroEffortForm = Omit<ZeroEffortForm, "id" | "createdAt">;

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
