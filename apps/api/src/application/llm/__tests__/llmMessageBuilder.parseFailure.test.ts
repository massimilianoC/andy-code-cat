import { describe, expect, it } from "vitest";

process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

async function loadModule() {
    return import("../llmMessageBuilder");
}

describe("buildParseFailureStructured", () => {
    it("returns empty artifacts — never echoes the raw brief as HTML", async () => {
        const { buildParseFailureStructured } = await loadModule();
        const structured = buildParseFailureStructured();

        expect(structured.artifacts).toEqual({ html: "", css: "", js: "" });
    });

    it("takes no message argument — cannot structurally echo the user's brief", async () => {
        const { buildParseFailureStructured } = await loadModule();

        expect(buildParseFailureStructured.length).toBe(0);
    });

    it("does not contain the removed raw-brief-dump markup", async () => {
        const { buildParseFailureStructured } = await loadModule();
        const serialized = JSON.stringify(buildParseFailureStructured());

        expect(serialized).not.toContain("<h1>");
        expect(serialized).not.toContain("Preview progetto");
    });

    it("carries a non-empty chat summary explaining the failure", async () => {
        const { buildParseFailureStructured } = await loadModule();
        const structured = buildParseFailureStructured();

        expect(structured.chat.summary.length).toBeGreaterThan(0);
    });
});

describe("isGenerationParseFailure", () => {
    it("is false when the parse succeeded", async () => {
        const { isGenerationParseFailure } = await loadModule();
        expect(isGenerationParseFailure({ parseValid: true, isFocusedMode: false, hasCurrentArtifacts: false })).toBe(false);
    });

    it("is true for a failed initial/full generation (the production bug)", async () => {
        const { isGenerationParseFailure } = await loadModule();
        expect(isGenerationParseFailure({ parseValid: false, isFocusedMode: false, hasCurrentArtifacts: false })).toBe(true);
    });

    it("is false for a failed focused edit that has current artifacts to preserve", async () => {
        const { isGenerationParseFailure } = await loadModule();
        expect(isGenerationParseFailure({ parseValid: false, isFocusedMode: true, hasCurrentArtifacts: true })).toBe(false);
    });

    it("is true for a failed focused edit with nothing to preserve", async () => {
        const { isGenerationParseFailure } = await loadModule();
        expect(isGenerationParseFailure({ parseValid: false, isFocusedMode: true, hasCurrentArtifacts: false })).toBe(true);
    });

    it("is false when parse succeeded even in focused mode with artifacts", async () => {
        const { isGenerationParseFailure } = await loadModule();
        expect(isGenerationParseFailure({ parseValid: true, isFocusedMode: true, hasCurrentArtifacts: true })).toBe(false);
    });
});
