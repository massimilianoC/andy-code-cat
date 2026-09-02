/**
 * Pure derivations over a WorkSessionDetailDto — kept out of the .tsx so the "which row belongs to
 * which block" logic is testable without a JSX transform (mirrors promptTranscriptSegments.ts).
 *
 * Block ownership (SESSION_INSPECTOR_SPEC.md §2):
 *   Vibe        -> the vibe_classify journal row
 *   Zero Effort -> the vibe_prefill journal row + canonicalBrief
 *   Generation  -> the generate journal row
 */

import type {
    WorkSessionSummaryDto,
    WorkSessionDetailDto,
    PromptExecutionLogDetailDto,
    CostTransactionDetailDto,
    CanonicalBriefEnvelope,
} from "@andy-code-cat/contracts";

/** Sessions arrive newest-first from the list endpoint (see ListWorkSessionSummaries) — the one
 * this page renders is simply the first. */
export function pickLatestSession(sessions: WorkSessionSummaryDto[]): WorkSessionSummaryDto | undefined {
    return sessions[0];
}

/** The most recent journal row for a given pipeline stage, or undefined when the session never
 * reached it. More than one row for a stage is possible (e.g. a re-generate); the latest one is
 * "how the artifact came to exist" right now. */
export function latestLogForStage(
    logs: PromptExecutionLogDetailDto[],
    stage: string,
): PromptExecutionLogDetailDto | undefined {
    const matches = logs.filter((log) => log.pipelineStage === stage);
    if (matches.length === 0) return undefined;
    return matches.reduce((latest, log) => (log.createdAt > latest.createdAt ? log : latest));
}

/**
 * Sum of every cost row attributable to one journal row. Deliberately unfiltered by status —
 * ListWorkSessionSummaries sums totalCostEur the same way (see apps/api's
 * ListWorkSessionSummaries.ts), and spec §6.7 wants each block's cost to sum to that same session
 * total, so this has to use the identical rule rather than a stricter one of its own.
 */
export function costForLog(costTransactions: CostTransactionDetailDto[], logId: string | undefined): number {
    if (!logId) return 0;
    return costTransactions
        .filter((tx) => tx.sourceRef.promptExecutionLogId === logId)
        .reduce((sum, tx) => sum + tx.totalEur, 0);
}

/** The pipeline run that carries a canonicalBrief, if any — the sole owner of the brief text
 * (spec §5.2: "the brief comes from canonicalBrief, not from the generate prompt that contains a
 * copy of it"). */
export function canonicalBriefOf(detail: WorkSessionDetailDto): CanonicalBriefEnvelope | undefined {
    return detail.pipelineRuns.find((run) => run.canonicalBrief)?.canonicalBrief;
}

export interface InspectorBlocksPresence {
    vibe: boolean;
    zeroEffort: boolean;
    generation: boolean;
}

/** Which blocks this session actually produced (spec §5.1: never render an empty one). */
export function blocksPresent(detail: WorkSessionDetailDto): InspectorBlocksPresence {
    const canonicalBrief = canonicalBriefOf(detail);
    return {
        vibe: detail.vibeIntakes.length > 0,
        zeroEffort: detail.zeroEffortFormProposals.length > 0 || canonicalBrief !== undefined,
        generation: latestLogForStage(detail.promptExecutionLogs, "generate") !== undefined,
    };
}
