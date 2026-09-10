import type { ZeroEffortRecoveryStatus } from "@andy-code-cat/contracts";
import type { PromptExecutionLog } from "../../domain/entities/PromptExecutionLog";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

/**
 * Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis) — Feature A.
 *
 * Zero Effort has no chat and no model picker: the artifact-producing "generate" call is the
 * whole interaction. When it breaks, this is the one place that decides whether there is
 * anything worth offering to resume — the client never re-derives that judgement itself.
 *
 * Two independent reasons a project has nothing to recover, both checked here so the caller
 * (the recovery route) makes zero judgement calls of its own:
 *
 *  1. an artifact already exists — a later attempt (manual or a previous "retry") succeeded, so
 *     the offer would resurrect a stale failure the user has already moved past;
 *  2. the row carries no material — a 402 or an invalid key produces no partial work at all
 *     (docs/specs/INTERRUPTED_RUN_RECOVERY.md §4: the five most recent failed rows measured had
 *     tok=0, raw=0, think=0). Offering to "resume" from nothing wastes the user's time and pays
 *     for a second call that starts from scratch anyway.
 */
export function isRecoverableFailure(
    row: Pick<PromptExecutionLog, "usage" | "rawResponse" | "reasoningTrace">,
): boolean {
    return (
        (row.usage?.totalTokens ?? 0) > 0 ||
        (row.rawResponse?.length ?? 0) > 0 ||
        (row.reasoningTrace?.length ?? 0) > 0
    );
}

/**
 * Builds the message a retry sends — the original brief plus the partial answer and the
 * reasoning, so the model continues a train of thought instead of boarding it again
 * (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis). This is the only new text a recovery
 * introduces; everything downstream of it is an ordinary `/llm/chat-preview` turn.
 */
export function buildResumePrompt(row: PromptExecutionLog): string {
    const original = (row.renderedUserPrompt ?? row.inputPrompt ?? "").trim();
    const parts = [
        original,
        "---",
        "A previous attempt at this same request was interrupted before it finished. " +
            "Resume and complete the work below instead of starting over — continue the same " +
            "train of thought rather than beginning again.",
    ];
    if (row.rawResponse?.trim()) {
        parts.push("[Partial output already produced — continue from here]", row.rawResponse.trim());
    }
    if (row.reasoningTrace?.trim()) {
        parts.push("[Reasoning already worked out]", row.reasoningTrace.trim());
    }
    parts.push("Continue from this point and produce the complete, final result.");
    return parts.join("\n\n");
}

export class GetZeroEffortRecoveryStatus {
    constructor(
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly snapshotRepository: PreviewSnapshotRepository,
    ) { }

    async execute(input: { projectId: string; userId: string }): Promise<ZeroEffortRecoveryStatus> {
        // An artifact already exists — nothing left to recover, regardless of what the journal
        // says. This also covers the case where a previous "retry" already succeeded.
        const activeSnapshot = await this.snapshotRepository.getActiveForProject(input.projectId).catch(() => null);
        if (activeSnapshot) {
            return { recoverable: false };
        }

        const recent = await this.promptExecutionLogRepository.listRecentByProject(input.projectId, input.userId, 10);
        const latestGeneration = recent.find((row) => row.taskKey === "chat" && row.pipelineStage === "generate");

        if (!latestGeneration || latestGeneration.status !== "failed") {
            return { recoverable: false };
        }

        if (!isRecoverableFailure(latestGeneration)) {
            return { recoverable: false };
        }

        return {
            recoverable: true,
            promptExecutionId: latestGeneration.id,
            pipelineRunId: latestGeneration.pipelineRunId,
            conversationId: latestGeneration.conversationId,
            provider: latestGeneration.provider,
            model: latestGeneration.model,
            tokensUsed: latestGeneration.usage?.totalTokens ?? 0,
            hasRawResponse: Boolean(latestGeneration.rawResponse?.trim()),
            hasReasoningTrace: Boolean(latestGeneration.reasoningTrace?.trim()),
            resumePrompt: buildResumePrompt(latestGeneration),
            failedAt: latestGeneration.createdAt.toISOString(),
        };
    }
}
