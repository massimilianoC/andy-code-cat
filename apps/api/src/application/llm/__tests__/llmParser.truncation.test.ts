import { describe, expect, it } from "vitest";

import { tryParseStructuredJson } from "../llmParser";

/**
 * Regression for a real production incident: a genuine, valid, complete LLM completion
 * (no markdown fence) truncated by exactly one missing closing brace at the very end
 * (classic max_tokens cutoff) used to be silently discarded. repairTruncatedJson() exists
 * specifically for this case, but tryParseStructuredJson()'s candidate list only ever
 * offered it extractFirstJsonObject() results — which require balanced braces and
 * therefore return null for a truncated document — so the repair never ran.
 */
describe("tryParseStructuredJson truncated-completion recovery", () => {
    it("recovers a completion truncated by one missing closing brace, no markdown fence", () => {
        const full = JSON.stringify({
            chat: {
                summary: "A complete, valid generation.",
                bullets: ["one", "two"],
                nextActions: ["ship it"],
            },
            artifacts: {
                html: "<main class=\"page\"><h1>Real site</h1><p>Genuinely generated content.</p></main>",
                css: "body{margin:0}",
                js: "console.log('ok')",
            },
        });
        // Simulate a max_tokens cutoff: drop the final closing brace of the root object.
        const truncated = full.slice(0, -1);

        const result = tryParseStructuredJson(truncated);

        expect(result.parseValid).toBe(true);
        expect(result.structured?.artifacts.html).toBe(
            "<main class=\"page\"><h1>Real site</h1><p>Genuinely generated content.</p></main>",
        );
        expect(result.structured?.chat.summary).toBe("A complete, valid generation.");
    });

    it("recovers a completion truncated mid-way through the css field", () => {
        const full = JSON.stringify({
            chat: { summary: "ok", bullets: [], nextActions: [] },
            artifacts: {
                html: "<main>content</main>",
                css: ".a{color:red}.b{color:blue}.c{color:green}",
                js: "",
            },
        });
        // Cut off partway through the css string value, before it or the object closes.
        const cutIndex = full.indexOf(".b{color:blue}");
        const truncated = full.slice(0, cutIndex);

        const result = tryParseStructuredJson(truncated);

        expect(result.parseValid).toBe(true);
        expect(result.structured?.artifacts.html).toBe("<main>content</main>");
    });

    it("still rejects genuinely non-JSON prose with no recoverable structure", () => {
        const result = tryParseStructuredJson(
            "Sure! Here's a description of what I would build for your unicycle website, but I won't provide JSON.",
        );

        expect(result.parseValid).toBe(false);
        expect(result.structured).toBeNull();
    });

    it("prefers a complete, well-formed candidate over the truncated raw fallback when both exist", () => {
        // A fenced, complete JSON block followed by trailing truncated prose-JSON noise.
        const complete = JSON.stringify({
            chat: { summary: "complete", bullets: [], nextActions: [] },
            artifacts: { html: "<main>complete</main>", css: "", js: "" },
        });
        const raw = "```json\n" + complete + "\n```\n\nAdditional trailing note: {\"chat\":{\"summary\":\"partial";

        const result = tryParseStructuredJson(raw);

        expect(result.parseValid).toBe(true);
        expect(result.structured?.artifacts.html).toBe("<main>complete</main>");
    });
});
