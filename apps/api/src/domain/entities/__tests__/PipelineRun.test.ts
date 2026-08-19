import { describe, expect, it } from "vitest";
import type { PipelineModelLock, PipelineRunStatus } from "@andy-code-cat/contracts";
import { appendStage, assertLockImmutable, assertStatusTransition, type PipelineRun } from "../PipelineRun";

function baseLock(overrides?: Partial<PipelineModelLock>): PipelineModelLock {
    return {
        policy: "legacy",
        requested: { providerId: "siliconflow", modelId: "MiniMaxAI/MiniMax-M3", catalogRevision: "rev-1" },
        effective: { providerId: "siliconflow", modelId: "MiniMaxAI/MiniMax-M3" },
        selectedAt: "2026-08-18T00:00:00.000Z",
        selectedBy: "user",
        ...overrides,
    };
}

function baseRun(overrides?: Partial<PipelineRun>): PipelineRun {
    return {
        id: "run-1",
        projectId: "project-1",
        ownerUserId: "user-1",
        entryMode: "vibe",
        modelLock: baseLock(),
        optimizationPolicy: "skip",
        status: "draft",
        stages: [],
        createdAt: new Date("2026-08-18T00:00:00.000Z"),
        updatedAt: new Date("2026-08-18T00:00:00.000Z"),
        ...overrides,
    };
}

describe("PipelineRun — assertLockImmutable", () => {
    it("does not throw when next is identical to previous", () => {
        const lock = baseLock();
        expect(() => assertLockImmutable(lock, { ...lock })).not.toThrow();
    });

    it.each<[string, Partial<PipelineModelLock>]>([
        ["policy", { policy: "strict" }],
        ["selectedAt", { selectedAt: "2026-08-19T00:00:00.000Z" }],
        ["selectedBy", { selectedBy: "admin-default" }],
    ])("throws when top-level field %s differs", (_label, overrides) => {
        const previous = baseLock();
        const next = baseLock(overrides);
        expect(() => assertLockImmutable(previous, next)).toThrow(/immutable/i);
    });

    it("throws when requested.providerId differs", () => {
        const previous = baseLock();
        const next = baseLock({ requested: { ...previous.requested, providerId: "openrouter" } });
        expect(() => assertLockImmutable(previous, next)).toThrow(/immutable/i);
    });

    it("throws when requested.modelId differs", () => {
        const previous = baseLock();
        const next = baseLock({ requested: { ...previous.requested, modelId: "other-model" } });
        expect(() => assertLockImmutable(previous, next)).toThrow(/immutable/i);
    });

    it("throws when requested.catalogRevision differs", () => {
        const previous = baseLock();
        const next = baseLock({ requested: { ...previous.requested, catalogRevision: "rev-2" } });
        expect(() => assertLockImmutable(previous, next)).toThrow(/immutable/i);
    });

    it("throws when effective.providerId differs", () => {
        const previous = baseLock();
        const next = baseLock({ effective: { ...previous.effective, providerId: "openrouter" } });
        expect(() => assertLockImmutable(previous, next)).toThrow(/immutable/i);
    });

    it("throws when effective.modelId differs", () => {
        const previous = baseLock();
        const next = baseLock({ effective: { ...previous.effective, modelId: "other-model" } });
        expect(() => assertLockImmutable(previous, next)).toThrow(/immutable/i);
    });
});

describe("PipelineRun — assertStatusTransition", () => {
    const blockedDetail = { code: "MODEL_LOCK_UNAVAILABLE" as const, stage: "vibe_classify" as const };

    const legalTransitions: Array<[PipelineRunStatus, PipelineRunStatus, typeof blockedDetail | undefined]> = [
        ["draft", "ready_for_generation", undefined],
        ["ready_for_generation", "running", undefined],
        ["running", "completed", undefined],
        ["running", "failed", undefined],
        ["running", "blocked", blockedDetail],
        ["draft", "blocked", blockedDetail],
        ["ready_for_generation", "blocked", blockedDetail],
        ["blocked", "ready_for_generation", undefined],
        ["draft", "cancelled", undefined],
        ["ready_for_generation", "cancelled", undefined],
        ["running", "cancelled", undefined],
        ["blocked", "cancelled", undefined],
    ];

    it.each(legalTransitions)("allows %s -> %s", (from, to, detail) => {
        expect(() => assertStatusTransition(from, to, detail)).not.toThrow();
    });

    const illegalTransitions: Array<[PipelineRunStatus, PipelineRunStatus]> = [
        ["draft", "running"],
        ["draft", "completed"],
        ["draft", "failed"],
        ["ready_for_generation", "completed"],
        ["ready_for_generation", "failed"],
        ["ready_for_generation", "draft"],
        ["running", "draft"],
        ["running", "ready_for_generation"],
        ["blocked", "running"],
        ["blocked", "completed"],
        ["blocked", "failed"],
        ["completed", "running"],
        ["completed", "cancelled"],
        ["completed", "draft"],
        ["failed", "running"],
        ["failed", "cancelled"],
        ["failed", "ready_for_generation"],
        ["cancelled", "draft"],
        ["cancelled", "running"],
        ["cancelled", "cancelled"],
    ];

    it.each(illegalTransitions)("rejects %s -> %s", (from, to) => {
        expect(() => assertStatusTransition(from, to, blockedDetail)).toThrow(/illegal status transition/i);
    });

    it("rejects a transition to blocked without a blocked detail", () => {
        expect(() => assertStatusTransition("draft", "blocked")).toThrow(/requires a blocked detail/i);
        expect(() => assertStatusTransition("running", "blocked", undefined)).toThrow(/requires a blocked detail/i);
    });

    it("allows a transition to blocked when a detail is provided", () => {
        expect(() => assertStatusTransition("running", "blocked", blockedDetail)).not.toThrow();
    });
});

describe("PipelineRun — appendStage", () => {
    it("returns a new object with the stage appended, without mutating the original", () => {
        const run = baseRun();
        const stageRef = {
            stage: "vibe_classify" as const,
            taskKey: "vibe_intent_classify",
            decision: {
                version: "model-selection-v1" as const,
                policy: "legacy" as const,
                requested: { source: "task-setting" as const, catalogRevision: "rev-1" },
                outcome: "exact" as const,
                trail: [],
                decidedAt: "2026-08-18T00:00:00.000Z",
            },
            status: "resolved" as const,
            startedAt: "2026-08-18T00:00:00.000Z",
        };

        const updated = appendStage(run, stageRef);

        expect(run.stages).toHaveLength(0);
        expect(updated.stages).toHaveLength(1);
        expect(updated.stages[0]).toEqual(stageRef);
        expect(updated).not.toBe(run);
        expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(run.updatedAt.getTime());
    });

    it("appending twice preserves insertion order and does not affect the first snapshot", () => {
        const run = baseRun();
        const stageA = {
            stage: "vibe_classify" as const,
            taskKey: "vibe_intent_classify",
            decision: {
                version: "model-selection-v1" as const,
                policy: "legacy" as const,
                requested: { source: "task-setting" as const, catalogRevision: "rev-1" },
                outcome: "exact" as const,
                trail: [],
                decidedAt: "2026-08-18T00:00:00.000Z",
            },
            status: "resolved" as const,
            startedAt: "2026-08-18T00:00:00.000Z",
        };
        const stageB = { ...stageA, stage: "vibe_prefill" as const, taskKey: "vibe_intent_prefill" };

        const afterA = appendStage(run, stageA);
        const afterB = appendStage(afterA, stageB);

        expect(afterA.stages).toHaveLength(1);
        expect(afterB.stages).toHaveLength(2);
        expect(afterB.stages.map((s) => s.stage)).toEqual(["vibe_classify", "vibe_prefill"]);
    });
});
