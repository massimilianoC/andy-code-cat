import { describe, it, expect } from "vitest";
import { canTransition, isTerminalStatus, statusAfter, stepToRun } from "../BackgroundRun";

describe("BackgroundRun state machine", () => {
    it("walks the steps in order and ends in done", () => {
        const walked: string[] = [];
        let status: Parameters<typeof stepToRun>[0] = "queued";
        for (let step = stepToRun(status); step; step = stepToRun(status)) {
            walked.push(step);
            status = statusAfter(step);
        }
        expect(walked).toEqual(["classifying", "briefing", "launching", "generating", "snapshotting", "publishing"]);
        expect(status).toBe("done");
    });

    it("knows the terminal statuses", () => {
        expect(isTerminalStatus("done")).toBe(true);
        expect(isTerminalStatus("failed")).toBe(true);
        expect(isTerminalStatus("cancelled")).toBe(true);
        expect(isTerminalStatus("queued")).toBe(false);
        expect(stepToRun("done")).toBeNull();
    });

    it("allows only entering the current step, completing it, failing or cancelling", () => {
        expect(canTransition("queued", "classifying")).toBe(true);
        expect(canTransition("classifying", "briefing")).toBe(true);
        expect(canTransition("publishing", "done")).toBe(true);
        expect(canTransition("generating", "failed")).toBe(true);
        expect(canTransition("queued", "cancelled")).toBe(true);

        expect(canTransition("queued", "generating")).toBe(false);
        expect(canTransition("classifying", "publishing")).toBe(false);
        expect(canTransition("briefing", "classifying")).toBe(false);
        expect(canTransition("done", "failed")).toBe(false);
        expect(canTransition("cancelled", "queued")).toBe(false);
    });
});
