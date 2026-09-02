import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// WP1 step 3 regression test (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md).
//
// handleSend used to write `generatedArtifacts: llm.structured?.artifacts` into the assistant
// message's metadata on every turn - a second, independently-updated copy of the artifact,
// alongside the PreviewSnapshot committed a few lines later in the same function. Steps 1-2
// already removed every read of that copy (the live fallback at the two decision points, and
// the dead assistantSnapshots list); this step stops producing it. `metadata.rawResponse` is a
// deliberately separate field - a history record, not a second authority - and must stay.
//
// Same import constraint as the other WP1 tests in this directory: page.tsx can't be imported
// into this vitest workspace (node environment, no React/JSX vite plugin), so this asserts on
// the page.tsx source text directly.

const fullSource = readFileSync(
    path.join(__dirname, "..", "page.tsx"),
    "utf8"
);

describe("WP1 step 3 — handleSend no longer writes metadata.generatedArtifacts", () => {
    it("never writes the generatedArtifacts key into a message's metadata", () => {
        expect(fullSource).not.toContain("generatedArtifacts: llm.structured?.artifacts");
        expect(fullSource).not.toMatch(/generatedArtifacts:\s*llm\.structured/);
    });

    it("keeps writing rawResponse — a history record, not a second authority", () => {
        // Guards against a future cleanup pass conflating the two: rawResponse is explicitly
        // out of scope for WP1 (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP1 closing note).
        expect(fullSource).toContain("rawResponse: llm.rawResponse,");
    });
});
