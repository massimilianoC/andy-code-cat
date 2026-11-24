/**
 * How long a background run is expected to take, step by step (BACKGROUND_RUNS.md §3.5).
 *
 * Each step's expectation comes from the best measurement available, in this order:
 *   1. completed background runs (the step exactly as the worker runs it), when ≥ MIN_SAMPLES;
 *   2. the prompt-execution journal of every Andy project, for the steps that are one LLM call
 *      (classify, prefill, the first generation of a launched project);
 *   3. a fixed default, named as such in the result.
 * The basis is returned with every figure, so the UI can say "stima" and mean it.
 */
import { BACKGROUND_RUN_STEPS, type BackgroundRunEstimateDto } from "@andy-code-cat/contracts";
import type { BackgroundRunStep } from "../../domain/entities/BackgroundRun";
import type { BackgroundRunDurationStatsSource, DurationSample } from "../../domain/repositories/BackgroundRunDurationStatsSource";

const MIN_SAMPLES = 3;
const RUN_SAMPLE_LIMIT = 50;
const JOURNAL_SAMPLE_LIMIT = 200;
const CACHE_TTL_MS = 10 * 60_000;

/** Used only when nothing was measured yet. */
const DEFAULT_STEP_MS: Record<BackgroundRunStep, number> = {
    classifying: 6_000,
    briefing: 30_000,
    launching: 3_000,
    generating: 240_000,
    snapshotting: 1_000,
    publishing: 4_000,
};
const DEFAULT_GENERATION_TOKENS = 24_000;

/** The steps that are one journalled LLM call, and the journal rows that measure them. */
const JOURNAL_TASK: Partial<Record<BackgroundRunStep, { taskKey: string; pipelineStage?: string }>> = {
    classifying: { taskKey: "vibe_intent_classify" },
    briefing: { taskKey: "vibe_intent_prefill" },
    generating: { taskKey: "chat", pipelineStage: "generate" },
};

function usable(sample: DurationSample | null | undefined): sample is DurationSample {
    return Boolean(sample && sample.samples >= MIN_SAMPLES && sample.medianMs > 0);
}

export class EstimateBackgroundRunDuration {
    private cached: { value: BackgroundRunEstimateDto; at: number } | null = null;

    constructor(
        private readonly stats: BackgroundRunDurationStatsSource,
        private readonly now: () => number = Date.now,
    ) { }

    async execute(): Promise<BackgroundRunEstimateDto> {
        if (this.cached && this.now() - this.cached.at < CACHE_TTL_MS) return this.cached.value;
        const value = await this.compute().catch((error: unknown) => {
            console.warn("[background-run] duration statistics unavailable, using defaults", error);
            return this.defaults();
        });
        this.cached = { value, at: this.now() };
        return value;
    }

    private async compute(): Promise<BackgroundRunEstimateDto> {
        const fromRuns = await this.stats.stepDurationsFromRuns(RUN_SAMPLE_LIMIT);
        const steps = {} as BackgroundRunEstimateDto["steps"];
        for (const step of BACKGROUND_RUN_STEPS) {
            const measuredByRuns = fromRuns[step];
            if (usable(measuredByRuns)) {
                steps[step] = { expectedMs: measuredByRuns.medianMs, basis: "runs", samples: measuredByRuns.samples };
                continue;
            }
            const task = JOURNAL_TASK[step];
            const measuredByJournal = task
                ? await this.stats.journalDuration({ ...task, limit: JOURNAL_SAMPLE_LIMIT })
                : null;
            steps[step] = usable(measuredByJournal)
                ? { expectedMs: measuredByJournal.medianMs, basis: "journal", samples: measuredByJournal.samples }
                : { expectedMs: DEFAULT_STEP_MS[step], basis: "default", samples: 0 };
        }
        const tokens = await this.stats.generationCompletionTokens(JOURNAL_SAMPLE_LIMIT);
        return {
            steps,
            totalMs: BACKGROUND_RUN_STEPS.reduce((sum, step) => sum + steps[step].expectedMs, 0),
            generationExpectedTokens: usable(tokens) ? tokens.medianMs : DEFAULT_GENERATION_TOKENS,
        };
    }

    private defaults(): BackgroundRunEstimateDto {
        const steps = {} as BackgroundRunEstimateDto["steps"];
        for (const step of BACKGROUND_RUN_STEPS) {
            steps[step] = { expectedMs: DEFAULT_STEP_MS[step], basis: "default", samples: 0 };
        }
        return {
            steps,
            totalMs: BACKGROUND_RUN_STEPS.reduce((sum, step) => sum + steps[step].expectedMs, 0),
            generationExpectedTokens: DEFAULT_GENERATION_TOKENS,
        };
    }
}
