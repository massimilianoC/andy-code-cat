import { describe, expect, it } from "vitest";
import { zeroEffortCompletionBudget } from "../zeroEffortBudget";

describe("zeroEffortCompletionBudget", () => {
    it.each([
        [256, 24_000],      // classify setting persisted by older releases
        [6_000, 24_000],    // prefill setting persisted by older releases
        [24_000, 24_000],
        [28_000, 28_000],   // operator headroom between floor and ceiling is honoured
        [32_000, 32_000],
        [167_000, 32_000],  // never above what a model can be assumed to accept
        [undefined, 24_000],
        [Number.NaN, 24_000],
    ])("configured %s -> %s", (configured, expected) => {
        expect(zeroEffortCompletionBudget(configured)).toBe(expected);
    });
});
