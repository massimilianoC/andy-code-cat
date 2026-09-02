import { z } from "zod";

/**
 * Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis) — Feature A.
 *
 * Zero Effort has no chat and no model picker, so when its one generation breaks the user's
 * only option today is to start over from nothing, having paid for whatever the model already
 * produced. This contract carries the offer: how much work is recoverable, and what a
 * discard actually removes.
 *
 * Deliberately thin — the recovery route itself decides IF a project has something to recover
 * (docs/specs/INTERRUPTED_RUN_RECOVERY.md §4: "not every failure is resumable"); the client
 * never re-derives that judgement from raw journal fields.
 */

export const zeroEffortRecoveryStatusSchema = z.object({
    recoverable: z.boolean(),
    /** The failed `PromptExecutionLog` row this offer is about — echoed back on retry as `resumedFromPromptExecutionId`. */
    promptExecutionId: z.string().optional(),
    pipelineRunId: z.string().optional(),
    conversationId: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    /** `usage.totalTokens` on the failed row — the number the modal states ("N tokens of work already done"). */
    tokensUsed: z.number().nonnegative().optional(),
    hasRawResponse: z.boolean().optional(),
    hasReasoningTrace: z.boolean().optional(),
    /**
     * The original brief plus the partial answer and the reasoning, already assembled into one
     * message — ready to send verbatim as the `message` of a normal `/llm/chat-preview` turn
     * (with `resumedFromPromptExecutionId` set to `promptExecutionId`). Present only when
     * `recoverable` is true.
     */
    resumePrompt: z.string().optional(),
    failedAt: z.string().optional(),
});
export type ZeroEffortRecoveryStatus = z.infer<typeof zeroEffortRecoveryStatusSchema>;

export const discardPendingProjectResultSchema = z.object({
    deleted: z.boolean(),
    removed: z.object({
        journalRows: z.number().nonnegative(),
        costTransactions: z.number().nonnegative(),
        conversations: z.number().nonnegative(),
        workSessions: z.number().nonnegative(),
        pipelineRuns: z.number().nonnegative(),
    }),
});
export type DiscardPendingProjectResult = z.infer<typeof discardPendingProjectResultSchema>;
