import type { ZeroEffortRecoveryStatus } from "@andy-code-cat/contracts";

/**
 * The two decisions the recovery flow makes, pulled out of the component so they can be tested
 * without rendering it (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3).
 *
 * Both are small, and both are the kind of small that goes wrong quietly: offering to resume from
 * nothing costs the user a second paid call, and dropping a parameter from the handoff means the
 * workspace restarts the model's thinking instead of continuing it — which looks like it worked.
 */

/**
 * Whether to interrupt the Vibe flow with the offer instead of continuing to the launch form.
 *
 * The server owns `recoverable`; this never re-derives it from raw fields. A prefill that SUCCEEDED
 * is never offered a recovery, however much material its row happens to carry — there is nothing to
 * recover from a call that did what it was asked.
 */
export function shouldOfferRecovery(
    prefillSucceeded: boolean,
    status: ZeroEffortRecoveryStatus | null | undefined,
): boolean {
    if (prefillSucceeded) return false;
    return status?.recoverable === true;
}

export interface ResumeHandoff {
    /** Query string for `/workspace/:projectId`. */
    query: string;
    /** Stored under `recovery_resume_<projectId>`; absent when the server sent no assembled prompt. */
    resumePrompt?: string;
}

/**
 * Builds the handoff that carries a broken generation into project mode.
 *
 * `resumePrompt` is the part that matters: the server has already assembled the original brief, the
 * attachments and the interrupted reasoning into one message, and the workspace sends it as an
 * ordinary turn. Losing it degrades the recovery into a plain retry — the model starts thinking
 * again rather than continuing — which is exactly the failure this feature exists to remove, and it
 * would look like success.
 *
 * `resumeFrom` carries the failed row's id so the resumed generation can be journalled as a
 * resumption (`resumedFromPromptExecutionId`) rather than appearing as an unexplained second attempt.
 */
export function buildResumeHandoff(
    status: ZeroEffortRecoveryStatus,
    choice: { provider?: string; model?: string } = {},
): ResumeHandoff {
    const query = new URLSearchParams();
    if (status.conversationId) query.set("conv", status.conversationId);
    if (status.pipelineRunId) query.set("pipelineRunId", status.pipelineRunId);
    if (status.promptExecutionId) query.set("resumeFrom", status.promptExecutionId);

    // Only when the user actually changed it. Echoing the model that just failed as an explicit
    // override would pin the resumed run to it, which is the opposite of what picking a different
    // one is for — and would silently override a platform default that may since have moved.
    if (choice.provider && choice.provider !== status.provider) query.set("provider", choice.provider);
    if (choice.model && choice.model !== status.model) query.set("model", choice.model);

    return { query: query.toString(), resumePrompt: status.resumePrompt };
}

export const RESUME_STORAGE_KEY = (projectId: string) => `recovery_resume_${projectId}`;
