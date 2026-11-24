/**
 * The pure parts of a background run's progress (BACKGROUND_RUNS.md §3.5): the percentage and the
 * time still to go from transitions and the per-step estimate, the estimate's sources, the brief
 * a draft launches and the slug a site is offered.
 */
import { describe, it, expect } from "vitest";

// VibeBackgroundRunSteps imports the generation engine, which validates the environment on load.
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

import {
    BACKGROUND_RUN_STEPS,
    computeBackgroundRunProgress,
    guidedIntakeFromDraft,
    launchWorkspacePipelineSchema,
    type BackgroundRunDto,
    type BackgroundRunEstimateDto,
} from "@andy-code-cat/contracts";
import { EstimateBackgroundRunDuration } from "../EstimateBackgroundRunDuration";
import type { BackgroundRunDurationStatsSource } from "../../../domain/repositories/BackgroundRunDurationStatsSource";

const estimate: BackgroundRunEstimateDto = {
    steps: {
        classifying: { expectedMs: 10_000, basis: "journal", samples: 10 },
        briefing: { expectedMs: 30_000, basis: "journal", samples: 10 },
        launching: { expectedMs: 0, basis: "default", samples: 0 },
        generating: { expectedMs: 60_000, basis: "runs", samples: 5 },
        snapshotting: { expectedMs: 0, basis: "default", samples: 0 },
        publishing: { expectedMs: 0, basis: "default", samples: 0 },
    },
    totalMs: 100_000,
    generationExpectedTokens: 1000,
};
const T0 = Date.parse("2026-11-24T10:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function run(partial: Partial<Pick<BackgroundRunDto, "status" | "transitions" | "progress">>) {
    return { status: "queued" as const, transitions: [], estimate, ...partial } as Pick<BackgroundRunDto, "status" | "transitions" | "estimate" | "progress">;
}

describe("computeBackgroundRunProgress", () => {
    it("a queued run is at 0% of step 1 with the whole estimate to go", () => {
        expect(computeBackgroundRunProgress(run({}), T0)).toEqual({ percent: 0, step: "classifying", stepNumber: 1, remainingMs: 100_000 });
    });

    it("counts completed steps in full and the step in flight by elapsed time", () => {
        const progress = computeBackgroundRunProgress(run({
            status: "briefing",
            transitions: [
                { status: "classifying", phase: "started", at: at(0) },
                { status: "classifying", phase: "completed", at: at(10_000) },
                { status: "briefing", phase: "started", at: at(10_000) },
            ],
        }), T0 + 25_000);
        // 10s done + half of the 30s brief
        expect(progress).toMatchObject({ percent: 25, step: "briefing", stepNumber: 2, remainingMs: 75_000 });
    });

    it("while generating, the streamed output moves the bar ahead of the clock", () => {
        const progress = computeBackgroundRunProgress(run({
            status: "generating",
            transitions: [{ status: "generating", phase: "started", at: at(0) }],
            progress: { generatedChars: 1750, updatedAt: at(1000) }, // half of 1000 tokens × 3.5
        }), T0 + 1_000);
        expect(progress.percent).toBe(70); // 40s before + 30s of 60s
    });

    it("never shows a step in flight as complete, and only done reaches 100%", () => {
        const late = computeBackgroundRunProgress(run({
            status: "generating",
            transitions: [{ status: "generating", phase: "started", at: at(0) }],
        }), T0 + 10 * 60_000);
        expect(late.percent).toBeLessThan(100);
        expect(late.remainingMs).toBeGreaterThan(0);
        expect(computeBackgroundRunProgress(run({ status: "done" }), T0).percent).toBe(100);
    });

    it("a failed run keeps the step it failed at and no time to go", () => {
        const failed = computeBackgroundRunProgress(run({
            status: "failed",
            transitions: [
                { status: "classifying", phase: "completed", at: at(1) },
                { status: "briefing", phase: "started", at: at(2) },
                { status: "failed", phase: "failed", at: at(3) },
            ],
        }), T0);
        expect(failed).toEqual({ percent: 10, step: "briefing", stepNumber: 2, remainingMs: null });
    });
});

describe("EstimateBackgroundRunDuration", () => {
    function stats(overrides: Partial<BackgroundRunDurationStatsSource> = {}): BackgroundRunDurationStatsSource {
        return {
            stepDurationsFromRuns: async () => ({}),
            journalDuration: async () => null,
            generationCompletionTokens: async () => null,
            ...overrides,
        };
    }

    it("prefers completed runs, then the journal, then a named default", async () => {
        const result = await new EstimateBackgroundRunDuration(stats({
            stepDurationsFromRuns: async () => ({ generating: { medianMs: 120_000, samples: 4 }, briefing: { medianMs: 1, samples: 1 } }),
            journalDuration: async ({ taskKey }) => taskKey === "vibe_intent_prefill" ? { medianMs: 33_000, samples: 40 } : null,
            generationCompletionTokens: async () => ({ medianMs: 18_000, samples: 30 }),
        })).execute();
        expect(result.steps.generating).toEqual({ expectedMs: 120_000, basis: "runs", samples: 4 });
        // one run is not enough: the journal wins
        expect(result.steps.briefing).toEqual({ expectedMs: 33_000, basis: "journal", samples: 40 });
        expect(result.steps.publishing.basis).toBe("default");
        expect(result.generationExpectedTokens).toBe(18_000);
        expect(result.totalMs).toBe(BACKGROUND_RUN_STEPS.reduce((sum, step) => sum + result.steps[step].expectedMs, 0));
    });

    it("falls back to defaults when the statistics cannot be read, and caches the answer", async () => {
        let reads = 0;
        const estimator = new EstimateBackgroundRunDuration(stats({
            stepDurationsFromRuns: async () => { reads += 1; throw new Error("db down"); },
        }));
        const first = await estimator.execute();
        await estimator.execute();
        expect(first.steps.generating.basis).toBe("default");
        expect(reads).toBe(1);
    });
});

describe("guidedIntakeFromDraft", () => {
    it("maps a prefill draft to a launchable intake", () => {
        const intake = launchWorkspacePipelineSchema.parse(guidedIntakeFromDraft({
            businessName: "Forno Rossi",
            presetId: "landing",
            primaryGoal: "Portare clienti nel forno",
            audience: "Famiglie",
            contactInfo: [{ key: "Telefono", value: "051 123" }, { key: "", value: "x" }],
        }, { defaultOutputLanguage: "it" }));
        expect(intake).toMatchObject({
            businessName: "Forno Rossi",
            presetId: "landing",
            sourceRequest: "Portare clienti nel forno",
            outputLanguage: "it",
            contactInfo: [{ key: "Telefono", value: "051 123" }],
            optimizationPolicy: "skip",
        });
    });

    it("uses the project name and the legacy site type only as fallbacks", () => {
        const intake = guidedIntakeFromDraft({ siteType: "business_site", primaryGoal: "x" }, { projectName: "Progetto", defaultOutputLanguage: "en" });
        expect(intake.businessName).toBe("Progetto");
        expect(intake.presetId).toBe("website");
    });

    it("does not invent a goal or an audience the draft lacks: the launch schema refuses it", () => {
        const parsed = launchWorkspacePipelineSchema.safeParse(guidedIntakeFromDraft({ businessName: "Forno" }, { defaultOutputLanguage: "it" }));
        expect(parsed.success).toBe(false);
    });
});

describe("slugCandidateFrom", () => {
    it("derives a valid slug from a business name", async () => {
        const { slugCandidateFrom } = await import("../VibeBackgroundRunSteps");
        expect(slugCandidateFrom("Forno Rossi & Figli — Bologna")).toBe("forno-rossi-figli-bologna");
        expect(slugCandidateFrom("Caffè Città")).toBe("caffe-citta");
        expect(slugCandidateFrom("Una pasticceria artigianale nel centro storico")?.length).toBeLessThanOrEqual(30);
        expect(slugCandidateFrom("!")).toBeNull();
    });
});
