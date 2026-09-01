import { describe, it, expect } from "vitest";
import { runBoundedPool } from "../boundedPool";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runBoundedPool", () => {
    it("never exceeds the configured concurrency", async () => {
        let inFlight = 0;
        let peak = 0;
        const tasks = Array.from({ length: 12 }, () => async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await sleep(10);
            inFlight--;
            return "ok";
        });

        await runBoundedPool(tasks, { concurrency: 3 });

        expect(peak).toBe(3);
    });

    it("returns outcomes in task order regardless of completion order", async () => {
        const tasks = [
            async () => { await sleep(30); return "slow"; },
            async () => { await sleep(1); return "fast"; },
        ];

        const { outcomes } = await runBoundedPool(tasks, { concurrency: 2 });

        expect(outcomes[0]).toMatchObject({ status: "fulfilled", value: "slow" });
        expect(outcomes[1]).toMatchObject({ status: "fulfilled", value: "fast" });
    });

    it("collects a failure without abandoning its siblings", async () => {
        // The reason this is not Promise.all: nine sections and one labelled gap is a result.
        const tasks = [
            async () => "a",
            async () => { throw new Error("boom"); },
            async () => "c",
        ];

        const { outcomes } = await runBoundedPool(tasks, { concurrency: 3 });

        expect(outcomes[0]).toMatchObject({ status: "fulfilled", value: "a" });
        expect(outcomes[1]).toMatchObject({ status: "rejected" });
        expect(outcomes[2]).toMatchObject({ status: "fulfilled", value: "c" });
    });

    it("abandons a task that outlives its own ceiling", async () => {
        const tasks = [async () => { await sleep(500); return "never"; }];

        const { outcomes } = await runBoundedPool(tasks, { concurrency: 1, taskTimeoutMs: 40 });

        expect(outcomes[0]!.status).toBe("timeout");
    });

    it("skips tasks not yet started once the run ceiling passes, and says so", async () => {
        const tasks = Array.from({ length: 6 }, () => async () => { await sleep(40); return "ok"; });

        const result = await runBoundedPool(tasks, { concurrency: 1, totalTimeoutMs: 60 });

        expect(result.hitTotalTimeout).toBe(true);
        expect(result.outcomes.some((o) => o.status === "skipped")).toBe(true);
        // Whatever ran before the ceiling still counts — the point is a defined outcome for each.
        expect(result.outcomes).toHaveLength(6);
        expect(result.outcomes.filter(Boolean)).toHaveLength(6);
    });

    it("reports each outcome as it lands, so a section can reach the user before its siblings", async () => {
        const seen: number[] = [];
        const tasks = [
            async () => { await sleep(40); return 0; },
            async () => { await sleep(5); return 1; },
        ];

        await runBoundedPool(tasks, { concurrency: 2 }, (outcome) => seen.push(outcome.index));

        expect(seen).toEqual([1, 0]);
    });
});
