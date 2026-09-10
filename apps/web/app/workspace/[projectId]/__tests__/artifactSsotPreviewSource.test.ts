import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// WP1 step 2 regression test (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md).
//
// The two live decision points named in the plan:
//   - what the preview panel displays (`artifacts`, formerly
//     `selectedBackendSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts`)
//   - what is sent to the server as the base artifact for the next generation
//     (`currentArtifactsSource`, formerly
//     `activeBaselineSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts`)
// must both read from the PreviewSnapshot alone. Step 1 made that safe (a snapshot always
// exists, or genuinely none does, before a message can enter activeConv state); this step
// removes the fallback that used to paper over the case where it didn't.
//
// Same import constraint as the step 1 test (artifactSsotOrdering.test.ts): page.tsx can't be
// imported into this vitest workspace (node environment, no React/JSX vite plugin — importing
// it throws a JSX parse error), so this test asserts directly on the page.tsx source text.

const fullSource = readFileSync(
    path.join(__dirname, "..", "page.tsx"),
    "utf8"
);

describe("WP1 step 2 — preview and next-turn base artifact read from the snapshot alone", () => {
    it("never falls back to metadata.generatedArtifacts anywhere in the file", () => {
        // The live fallback is gone outright — not narrowed, not moved, removed. Comments that
        // merely name the retired field (explaining the historical defect) are fine; what must
        // not exist is the actual expression `latestAssistant?.metadata?.generatedArtifacts`.
        expect(fullSource).not.toContain("latestAssistant?.metadata?.generatedArtifacts");
    });

    it("derives the preview panel's `artifacts` from selectedBackendSnapshot alone", () => {
        expect(fullSource).toContain("const artifacts = selectedBackendSnapshot?.artifacts;");
    });

    it("derives the next-turn base artifact from activeBaselineSnapshot alone", () => {
        expect(fullSource).toContain(
            "                    : activeBaselineSnapshot?.artifacts;"
        );
    });

    it("no longer computes the dead assistantSnapshots fallback list", () => {
        // It filtered on metadata?.generatedArtifacts and was never read anywhere — confirmed
        // dead before step 1 touched this file. Once the fallback field it filtered on stops
        // being written (step 3) and is removed (step 4), a variable still filtering on it would
        // be worse than dead: a landmine for the next reader who assumes it means something.
        expect(fullSource).not.toContain("const assistantSnapshots =");
    });
});
