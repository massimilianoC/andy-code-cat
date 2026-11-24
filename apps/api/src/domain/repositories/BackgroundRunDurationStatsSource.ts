import type { BackgroundRunStep } from "../entities/BackgroundRun";

export interface DurationSample {
    medianMs: number;
    samples: number;
}

/**
 * Measured durations the background-run estimate is built from (BACKGROUND_RUNS.md §3.5).
 * Read-only aggregates over the whole installation: durations and token counts only, never
 * prompts, outputs or who ran them.
 */
export interface BackgroundRunDurationStatsSource {
    /** Median started→completed time of each step, over the most recent completed runs. */
    stepDurationsFromRuns(limit: number): Promise<Partial<Record<BackgroundRunStep, DurationSample>>>;
    /** Median duration of the succeeded journal rows of one task (e.g. "vibe_intent_classify"). */
    journalDuration(input: { taskKey: string; pipelineStage?: string; limit: number }): Promise<DurationSample | null>;
    /** Median completion tokens of the succeeded first generations of launched projects. */
    generationCompletionTokens(limit: number): Promise<DurationSample | null>;
}
