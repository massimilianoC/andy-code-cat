import { z } from "zod";

/**
 * Background runs — the Vibe flow carried by the server, detached from the browser
 * (docs/specs/BACKGROUND_RUNS.md). One run = one project, worked through these steps in order.
 */
export const BACKGROUND_RUN_STEPS = [
    "classifying",
    "briefing",
    "launching",
    "generating",
    "snapshotting",
    "publishing",
] as const;

export const BACKGROUND_RUN_TERMINAL_STATUSES = ["done", "failed", "cancelled"] as const;

export const backgroundRunStatusSchema = z.enum([
    "queued",
    ...BACKGROUND_RUN_STEPS,
    ...BACKGROUND_RUN_TERMINAL_STATUSES,
]);

export type BackgroundRunStep = (typeof BACKGROUND_RUN_STEPS)[number];
export type BackgroundRunStatus = z.infer<typeof backgroundRunStatusSchema>;

/** Same ceiling as the Vibe prompt (vibecoreRoutes VIBE_PROMPT_MAX_CHARS). */
export const BACKGROUND_RUN_PROMPT_MAX_CHARS = 12000;

export const createBackgroundRunSchema = z.object({
    prompt: z.string().trim().min(10).max(BACKGROUND_RUN_PROMPT_MAX_CHARS),
    /** BCP-47 UI language, as Vibe sends it. */
    uiLanguage: z.string().min(2).max(10).optional(),
    /** Pipeline model override, as Vibe sends it; resolved against the catalog like any other request. */
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(200).optional(),
    /** The Vibe generation mode selector, as Vibe sends it to classify and prefill. */
    generationMode: z.enum(["auto", "website", "data_dashboard"]).optional(),
}).strict();

export type CreateBackgroundRunInput = z.infer<typeof createBackgroundRunSchema>;

export interface BackgroundRunTransitionDto {
    status: BackgroundRunStatus;
    phase: "started" | "completed" | "failed" | "cancelled" | "deferred";
    at: string;
    detail?: string;
}

/** Where a step's expected duration comes from (BACKGROUND_RUNS.md §3.5). */
export type BackgroundRunEstimateBasis = "runs" | "journal" | "default";

/**
 * Expected duration of each step, from what the platform measured: completed background runs
 * first, the prompt-execution journal of every Andy project next, a fixed default when neither
 * has enough samples. Medians, not means — one stuck call must not move every estimate.
 */
export interface BackgroundRunEstimateDto {
    steps: Record<BackgroundRunStep, { expectedMs: number; basis: BackgroundRunEstimateBasis; samples: number }>;
    totalMs: number;
    /** Median completion tokens of a first generation — the scale of the live generation bar. */
    generationExpectedTokens: number;
}

export interface BackgroundRunDto {
    id: string;
    projectId: string;
    /** The project's name as it is now (it is renamed from the brief during the run). */
    projectName?: string;
    status: BackgroundRunStatus;
    prompt: string;
    /** The conversation the run generated into — the workspace deep link opens it. */
    conversationId?: string;
    estimate: BackgroundRunEstimateDto;
    /** Live output of the step in flight (today: the generation's streamed size). */
    progress?: { generatedChars: number; updatedAt: string };
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    costEur: number;
    cancelRequested: boolean;
    transitions: BackgroundRunTransitionDto[];
    /** Present once the site is live. */
    site?: {
        publishId: string;
        publicUrl: string;
        /** A free, valid slug the user may adopt with one click (nothing is reserved). */
        proposedSlug?: string;
    };
    error?: { code: string; message: string; step?: BackgroundRunStatus };
}

export const BACKGROUND_RUN_STEP_COUNT = BACKGROUND_RUN_STEPS.length;

export interface BackgroundRunProgress {
    /** 0–100. Reaches 100 only when the run is done. */
    percent: number;
    /** The step in flight (or the last one reached, once terminal). */
    step: BackgroundRunStep | null;
    /** 1-based position of `step`. */
    stepNumber: number;
    /** Expected time still to go, ms; null once terminal. */
    remainingMs: number | null;
}

/** Characters of streamed answer per completion token, for the live generation bar. */
const CHARS_PER_TOKEN = 3.5;
/** A step in flight never shows as complete before it actually completes. */
const IN_STEP_CAP = 0.95;

/**
 * How far a run is, from its transitions and the per-step estimate. Each completed step counts
 * its expected duration in full; the step in flight counts the time spent in it (or, while
 * generating, the share of the expected output already streamed), capped below completion.
 * Pure — the web computes it on every tick, the API never stores it.
 */
export function computeBackgroundRunProgress(
    run: Pick<BackgroundRunDto, "status" | "transitions" | "estimate" | "progress">,
    now: number,
): BackgroundRunProgress {
    const steps = BACKGROUND_RUN_STEPS;
    const total = Math.max(1, steps.reduce((sum, step) => sum + run.estimate.steps[step].expectedMs, 0));
    const lastReached = [...run.transitions].reverse()
        .find((transition) => (steps as readonly string[]).includes(transition.status))?.status as BackgroundRunStep | undefined;

    if (run.status === "done") {
        return { percent: 100, step: steps[steps.length - 1]!, stepNumber: steps.length, remainingMs: null };
    }
    if (run.status === "failed" || run.status === "cancelled") {
        const step = lastReached ?? null;
        const index = step ? steps.indexOf(step) : 0;
        const done = steps.slice(0, index).reduce((sum, s) => sum + run.estimate.steps[s].expectedMs, 0);
        return { percent: Math.round((done / total) * 100), step, stepNumber: index + 1, remainingMs: null };
    }

    const step: BackgroundRunStep = run.status === "queued" ? steps[0] : run.status as BackgroundRunStep;
    const index = steps.indexOf(step);
    const completedMs = steps.slice(0, index).reduce((sum, s) => sum + run.estimate.steps[s].expectedMs, 0);
    const expected = run.estimate.steps[step].expectedMs;

    let fraction = 0;
    const started = [...run.transitions].reverse()
        .find((transition) => transition.status === step && transition.phase === "started");
    if (run.status !== "queued" && started) {
        fraction = (now - new Date(started.at).getTime()) / Math.max(1, expected);
        if (step === "generating" && run.progress && run.estimate.generationExpectedTokens > 0) {
            const byOutput = run.progress.generatedChars / (run.estimate.generationExpectedTokens * CHARS_PER_TOKEN);
            fraction = Math.max(fraction * 0.5, byOutput);
        }
    }
    fraction = Math.min(IN_STEP_CAP, Math.max(0, fraction));
    const doneMs = completedMs + expected * fraction;
    return {
        percent: Math.min(99, Math.round((doneMs / total) * 100)),
        step,
        stepNumber: index + 1,
        remainingMs: Math.max(0, Math.round(total - doneMs)),
    };
}
