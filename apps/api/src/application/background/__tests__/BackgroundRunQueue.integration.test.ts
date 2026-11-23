/**
 * The background-run queue, engine and worker against a real MongoDB (MongoMemoryServer), with
 * fake steps: claim exclusivity, every transition persisted, resume after a lost worker from the
 * stored outputs, lease ownership, cancel (queued and in flight), cost ceiling, guard refusal,
 * deferral, graceful shutdown and the attempts ceiling. BACKGROUND_RUNS.md §3.2–§3.3.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { BackgroundRun, BackgroundRunStep } from "../../../domain/entities/BackgroundRun";
import type { MongoBackgroundRunRepository as RepoType } from "../../../infra/repositories/MongoBackgroundRunRepository";
import {
    BackgroundRunDeferred,
    BackgroundRunEngine,
    BackgroundRunStepError,
    type BackgroundRunStepContext,
    type BackgroundRunSteps,
} from "../BackgroundRunEngine";
import { BackgroundRunWorker } from "../BackgroundRunWorker";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let repo: RepoType;

interface FakeOptions {
    /** step → behaviour */
    onStep?: Partial<Record<BackgroundRunStep, (ctx: BackgroundRunStepContext) => Promise<void>>>;
    cost?: () => number;
    guard?: (ctx: BackgroundRunStepContext, step: BackgroundRunStep) => Promise<void>;
}

function fakeSteps(options: FakeOptions = {}) {
    const calls: string[] = [];
    const finished: BackgroundRun[] = [];
    const steps: BackgroundRunSteps = {
        guard: options.guard ?? (async () => undefined),
        async execute(step, ctx) {
            calls.push(step);
            await options.onStep?.[step]?.(ctx);
            switch (step) {
                case "classifying": return { classification: { templateId: "landing", formatHint: null, confidence: 0.9, skipped: false } };
                case "launching": return { launch: { pipelineRunId: "pr-1", conversationId: "c-1" } };
                case "publishing": return { publish: { deploymentId: "d-1", publishId: "abcdef12", publicUrl: "/p/abcdef12/" } };
                default: return {};
            }
        },
        async measureCostEur() { return options.cost?.() ?? 0.01; },
        async onFinished(run) { finished.push(run); },
    };
    return { steps, calls, finished };
}

function engineFor(steps: BackgroundRunSteps, maxCostEur = 0.5, maxAttempts = 5) {
    return new BackgroundRunEngine(repo, steps, { maxCostEur, maxAttempts });
}

async function newRun(userId = "user-a"): Promise<BackgroundRun> {
    return repo.create({ userId, projectId: `project-${Math.random().toString(16).slice(2, 8)}`, input: { prompt: "Una landing per un forno" } });
}

async function collection() {
    const { getDb } = await import("../../../infra/db/mongo");
    return (await getDb()).collection("background_runs");
}

describe("background-run queue, engine and worker", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { MongoBackgroundRunRepository } = await import("../../../infra/repositories/MongoBackgroundRunRepository");
        repo = new MongoBackgroundRunRepository();
        await repo.ensureIndexes();
    }, 60_000);

    beforeEach(async () => {
        await (await collection()).deleteMany({});
    });

    afterAll(async () => {
        const { getDb } = await import("../../../infra/db/mongo");
        await (await getDb()).client.close(true);
        await mongod.stop();
    });

    it("a run is claimed by exactly one of two concurrent workers", async () => {
        await newRun();
        const now = new Date();
        const [a, b] = await Promise.all([
            repo.claimNext({ workerId: "w-a", leaseMs: 60_000, now }),
            repo.claimNext({ workerId: "w-b", leaseMs: 60_000, now }),
        ]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it("carries a run to done, persisting a started and a completed transition per step", async () => {
        const run = await newRun();
        const fake = fakeSteps();
        const claimed = await repo.claimNext({ workerId: "w-1", leaseMs: 60_000, now: new Date() });
        const ended = await engineFor(fake.steps).process(claimed!, "w-1", new AbortController().signal);

        expect(ended?.status).toBe("done");
        expect(fake.calls).toEqual(["classifying", "briefing", "launching", "generating", "snapshotting", "publishing"]);
        const stored = await repo.findByIdForUser(run.id, "user-a");
        const log = stored!.transitions.map((t) => `${t.status}:${t.phase}`);
        expect(log).toEqual([
            "queued:completed",
            "classifying:started", "classifying:completed",
            "briefing:started", "briefing:completed",
            "launching:started", "launching:completed",
            "generating:started", "generating:completed",
            "snapshotting:started", "snapshotting:completed",
            "publishing:started", "publishing:completed",
        ]);
        expect(stored!.outputs.launch?.pipelineRunId).toBe("pr-1");
        expect(stored!.outputs.publish?.publicUrl).toBe("/p/abcdef12/");
        expect(stored!.lease).toBeNull();
        expect(stored!.finishedAt).toBeInstanceOf(Date);
        expect(stored!.costEur).toBeCloseTo(0.01);
        expect(fake.finished.map((r) => r.status)).toEqual(["done"]);
    });

    it("a run whose worker died resumes at the step it was in, with the earlier outputs kept", async () => {
        const run = await newRun();
        // Worker A dies inside "launching": the step never returns and its lease is never released.
        const crashed = fakeSteps({
            onStep: { launching: () => new Promise<void>(() => undefined) },
        });
        const claimedByA = await repo.claimNext({ workerId: "w-a", leaseMs: 60_000, now: new Date() });
        void engineFor(crashed.steps).process(claimedByA!, "w-a", new AbortController().signal);
        await expect.poll(async () => (await repo.findByIdForUser(run.id, "user-a"))?.status).toBe("launching");
        expect(crashed.calls).toEqual(["classifying", "briefing", "launching"]);

        // Not claimable while A's lease is live…
        expect(await repo.claimNext({ workerId: "w-b", leaseMs: 60_000, now: new Date() })).toBeNull();
        // …claimable once it expired.
        const later = new Date(Date.now() + 61_000);
        const claimedByB = await repo.claimNext({ workerId: "w-b", leaseMs: 60_000, now: later });
        expect(claimedByB?.status).toBe("launching");
        expect(claimedByB?.attempts).toBe(2);
        expect(claimedByB?.outputs.classification?.templateId).toBe("landing");

        const resumed = fakeSteps();
        const ended = await engineFor(resumed.steps).process(claimedByB!, "w-b", new AbortController().signal);
        expect(ended?.status).toBe("done");
        // B did not redo the steps A had completed.
        expect(resumed.calls).toEqual(["launching", "generating", "snapshotting", "publishing"]);
        const stored = await repo.findByIdForUser(run.id, "user-a");
        expect(stored!.transitions.some((t) => t.status === "launching" && t.detail?.startsWith("resumed"))).toBe(true);
    });

    it("a worker that lost its lease can no longer move the run", async () => {
        const run = await newRun();
        await repo.claimNext({ workerId: "w-a", leaseMs: 60_000, now: new Date() });
        const claimedByB = await repo.claimNext({ workerId: "w-b", leaseMs: 60_000, now: new Date(Date.now() + 61_000) });
        expect(claimedByB).not.toBeNull();
        const stale = await repo.recordTransition(run.id, "w-a", { status: "classifying", phase: "started", expectedStatus: "queued" });
        expect(stale).toBeNull();
        expect(await repo.renewLease(run.id, "w-a", 60_000, new Date())).toBeNull();
    });

    it("refuses an illegal transition", async () => {
        const run = await newRun();
        await repo.claimNext({ workerId: "w-1", leaseMs: 60_000, now: new Date() });
        await expect(repo.recordTransition(run.id, "w-1", { status: "publishing", phase: "started", expectedStatus: "queued" }))
            .rejects.toThrow(/Illegal/);
    });

    it("cancelling a queued run ends it at once and it is never claimed", async () => {
        const run = await newRun();
        const cancelled = await repo.requestCancel(run.id, "user-a", new Date());
        expect(cancelled?.status).toBe("cancelled");
        expect(await repo.claimNext({ workerId: "w-1", leaseMs: 60_000, now: new Date() })).toBeNull();
    });

    it("cancelling is owner-scoped: another user's id finds nothing", async () => {
        const run = await newRun("user-a");
        expect(await repo.requestCancel(run.id, "user-b", new Date())).toBeNull();
        expect(await repo.findByIdForUser(run.id, "user-b")).toBeNull();
        expect((await repo.findByIdForUser(run.id, "user-a"))?.cancelRequested).toBe(false);
    });

    it("cancelling a run in flight aborts the step through the heartbeat and ends it cancelled", async () => {
        const run = await newRun();
        let sawAbort = false;
        const fake = fakeSteps({
            onStep: {
                generating: (ctx) => new Promise<void>((_, reject) => {
                    ctx.signal.addEventListener("abort", () => { sawAbort = true; reject(new Error("aborted")); });
                }),
            },
        });
        const worker = new BackgroundRunWorker(repo, engineFor(fake.steps), { workerId: "w-1", poolSize: 2, leaseMs: 3_000, pollMs: 50 });
        await worker.tick();
        await expect.poll(async () => (await repo.findByIdForUser(run.id, "user-a"))?.status).toBe("generating");
        const flagged = await repo.requestCancel(run.id, "user-a", new Date());
        expect(flagged?.cancelRequested).toBe(true);
        await worker.drain();
        const stored = await repo.findByIdForUser(run.id, "user-a");
        expect(sawAbort).toBe(true);
        expect(stored?.status).toBe("cancelled");
        expect(stored?.error?.code).toBe("BACKGROUND_RUN_CANCELLED");
        expect(fake.calls).not.toContain("snapshotting");
        expect(fake.finished).toHaveLength(0);
    }, 20_000);

    it("stops at the cost ceiling after the step that crossed it", async () => {
        const run = await newRun();
        let cost = 0;
        const fake = fakeSteps({ cost: () => { cost += 0.3; return cost; } });
        const claimed = await repo.claimNext({ workerId: "w-1", leaseMs: 60_000, now: new Date() });
        const ended = await engineFor(fake.steps, 0.5).process(claimed!, "w-1", new AbortController().signal);
        expect(ended?.status).toBe("failed");
        expect(ended?.error?.code).toBe("BACKGROUND_RUN_COST_CEILING");
        expect(fake.calls).toEqual(["classifying", "briefing"]);
        expect((await repo.findByIdForUser(run.id, "user-a"))?.costEur).toBeGreaterThan(0.5);
        expect(fake.finished.map((r) => r.status)).toEqual(["failed"]);
    });

    it("a guard refusal fails the run before the step runs", async () => {
        await newRun();
        const fake = fakeSteps({
            guard: async (_ctx, step) => {
                if (step === "generating") throw new BackgroundRunStepError("BACKGROUND_RUN_OWNER_BLOCKED", "blocked");
            },
        });
        const claimed = await repo.claimNext({ workerId: "w-1", leaseMs: 60_000, now: new Date() });
        const ended = await engineFor(fake.steps).process(claimed!, "w-1", new AbortController().signal);
        expect(ended?.status).toBe("failed");
        expect(ended?.error).toMatchObject({ code: "BACKGROUND_RUN_OWNER_BLOCKED", step: "generating" });
        expect(fake.calls).not.toContain("generating");
    });

    it("a deferred step gives the run back until notBefore, then resumes it", async () => {
        const run = await newRun();
        let deferOnce = true;
        const fake = fakeSteps({
            onStep: {
                generating: async () => {
                    if (deferOnce) { deferOnce = false; throw new BackgroundRunDeferred("previous call still in flight", 30_000); }
                },
            },
        });
        const claimed = await repo.claimNext({ workerId: "w-1", leaseMs: 60_000, now: new Date() });
        await engineFor(fake.steps).process(claimed!, "w-1", new AbortController().signal);
        const parked = await repo.findByIdForUser(run.id, "user-a");
        expect(parked?.status).toBe("generating");
        expect(parked?.lease).toBeNull();
        expect(await repo.claimNext({ workerId: "w-2", leaseMs: 60_000, now: new Date() })).toBeNull();
        const again = await repo.claimNext({ workerId: "w-2", leaseMs: 60_000, now: new Date(Date.now() + 31_000) });
        const ended = await engineFor(fake.steps).process(again!, "w-2", new AbortController().signal);
        expect(ended?.status).toBe("done");
    });

    it("a graceful shutdown gives the run back at its step; the next worker resumes it", async () => {
        const run = await newRun();
        const blocking = fakeSteps({
            onStep: {
                briefing: (ctx) => new Promise<void>((_, reject) => {
                    ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
                }),
            },
        });
        const first = new BackgroundRunWorker(repo, engineFor(blocking.steps), { workerId: "w-1", poolSize: 2, leaseMs: 60_000, pollMs: 50 });
        first.start();
        await expect.poll(async () => (await repo.findByIdForUser(run.id, "user-a"))?.status).toBe("briefing");
        await first.stop(5_000);
        const released = await repo.findByIdForUser(run.id, "user-a");
        expect(released?.status).toBe("briefing");
        expect(released?.lease).toBeNull();

        const resumed = fakeSteps();
        const second = new BackgroundRunWorker(repo, engineFor(resumed.steps), { workerId: "w-2", poolSize: 2, leaseMs: 60_000, pollMs: 50 });
        await second.tick();
        await second.drain();
        expect((await repo.findByIdForUser(run.id, "user-a"))?.status).toBe("done");
        expect(resumed.calls[0]).toBe("briefing");
    }, 20_000);

    it("the pool size bounds how many runs are held at once", async () => {
        await newRun();
        await newRun();
        await newRun();
        const fake = fakeSteps({ onStep: { classifying: () => new Promise<void>(() => undefined) } });
        const worker = new BackgroundRunWorker(repo, engineFor(fake.steps), { workerId: "w-1", poolSize: 2, leaseMs: 60_000, pollMs: 50 });
        expect(await worker.tick()).toBe(2);
        expect(await worker.tick()).toBe(0);
        expect(await repo.countLeased(new Date())).toBe(2);
    });

    it("a run that keeps dying is failed after the attempts ceiling instead of looping forever", async () => {
        const run = await newRun();
        for (let i = 0; i < 3; i++) {
            await repo.claimNext({ workerId: `w-${i}`, leaseMs: 1, now: new Date(Date.now() + i * 10_000) });
        }
        const claimed = await repo.claimNext({ workerId: "w-last", leaseMs: 60_000, now: new Date(Date.now() + 60_000) });
        expect(claimed?.attempts).toBe(4);
        const fake = fakeSteps();
        const ended = await engineFor(fake.steps, 0.5, 3).process(claimed!, "w-last", new AbortController().signal);
        expect(ended?.status).toBe("failed");
        expect(ended?.error?.code).toBe("BACKGROUND_RUN_TOO_MANY_ATTEMPTS");
        expect(fake.calls).toHaveLength(0);
        expect((await repo.findByIdForUser(run.id, "user-a"))?.status).toBe("failed");
    });
});
