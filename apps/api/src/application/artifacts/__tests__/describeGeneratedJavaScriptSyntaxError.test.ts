import { describe, expect, it } from "vitest";
import { describeGeneratedJavaScriptSyntaxError } from "../generatedJavaScriptSyntax";

/**
 * Pinned against a real failure, not a synthetic one.
 *
 * Run 94ca3440 (minimax/minimax-m3) returned a complete, cleanly-parsing JSON reply whose
 * `artifacts.js` did not compile: the model truncated a nested `.map(...)` chain mid-expression, so
 * the next statement closed brackets that were never opened. The reply looked fine, the client
 * showed the assistant message, and the preview silently never changed — because the snapshot write
 * was the only thing that ever ran the check, and its 422 was swallowed.
 *
 * These tests exist to keep two properties true: the check is deterministic (same source, same
 * answer, every time — `new Script` parses, it does not execute or sample), and when it says no it
 * says WHERE. A verdict without a location is not actionable on thirty thousand characters of
 * generated code.
 */

/** The shape that actually broke, with the truncation on a line we can assert by number. */
const TRUNCATED_MAP_CHAIN = [
    "const MODULI = ['a','b'];",                                                    // 1
    "function avg(xs) { return xs.length ? xs[0] : 0; }",                           // 2
    "const data = [];",                                                             // 3
    "const ruoli = ['Ufficio','Produzione'];",                                      // 4
    "const datasets = ruoli.map((r,i) => ({ label: r, data: MODULI.map(k => avg(",  // 5 — truncated
    "makeChart('chart-moduli-ruolo', { type:'bar' });",                             // 6
].join("\n");

describe("describeGeneratedJavaScriptSyntaxError", () => {
    it("says nothing about JavaScript that parses", () => {
        expect(describeGeneratedJavaScriptSyntaxError("const x = 1;")).toBeUndefined();
        expect(describeGeneratedJavaScriptSyntaxError("")).toBeUndefined();
    });

    it("never executes the source it is judging", () => {
        // A generated artifact is untrusted input. Parsing is the whole check; running it to find
        // out whether it runs would be the vulnerability, not the test.
        expect(() => describeGeneratedJavaScriptSyntaxError("throw new Error('must not execute')")).not.toThrow();
        expect(describeGeneratedJavaScriptSyntaxError("throw new Error('must not execute')")).toBeUndefined();
    });

    it("reports instead of throwing, so the generation boundary can keep the artifact", () => {
        // The storage boundary refuses; this one describes. Throwing here would discard a complete
        // artifact — and ten minutes of paid work — over a missing bracket the model can fix.
        expect(() => describeGeneratedJavaScriptSyntaxError(TRUNCATED_MAP_CHAIN)).not.toThrow();
        expect(describeGeneratedJavaScriptSyntaxError(TRUNCATED_MAP_CHAIN)).toBeDefined();
    });

    it("carries the evidence: message, line, and the offending line itself", () => {
        const diagnosis = describeGeneratedJavaScriptSyntaxError(TRUNCATED_MAP_CHAIN);

        expect(diagnosis?.message).toContain("Generated artifacts.js is not valid JavaScript");
        // V8 reports the failure where the unbalanced construct is detected, which is at or after
        // the truncation — never before it. Asserting the exact token would pin the test to a V8
        // version; asserting that we point into the broken region is the property that matters.
        expect(diagnosis?.line).toBeGreaterThanOrEqual(5);
        expect(diagnosis?.sourceLine).toBeTruthy();
    });

    it("is deterministic — the same source gives byte-identical answers", () => {
        // This is what makes it usable as a gate at all. If the check could disagree with itself,
        // an artifact would be accepted on one call and rejected on the next, and the user would
        // see the preview update sometimes.
        const runs = Array.from({ length: 5 }, () => describeGeneratedJavaScriptSyntaxError(TRUNCATED_MAP_CHAIN));
        for (const run of runs) expect(run).toEqual(runs[0]);
    });

    it("bounds the excerpt, because a generated line can be a whole minified function", () => {
        const long = `const x = (${"y".repeat(2000)}`;
        const diagnosis = describeGeneratedJavaScriptSyntaxError(long);
        expect(diagnosis).toBeDefined();
        expect((diagnosis?.sourceLine ?? "").length).toBeLessThanOrEqual(240);
    });

    it("survives CRLF, which is how a generated artifact can arrive", () => {
        // Splitting on "\n" alone would leave a stray carriage return on every excerpt.
        const crlf = "const a = 1;\r\nconst b = (;\r\n";
        const diagnosis = describeGeneratedJavaScriptSyntaxError(crlf);
        expect(diagnosis).toBeDefined();
        expect(diagnosis?.sourceLine ?? "").not.toContain("\r");
    });
});
