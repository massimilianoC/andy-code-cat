import { describe, expect, it } from "vitest";

process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

async function loadComposer() {
    return import("../systemPromptComposer");
}

describe("composeSystemPromptWithLayers — SSOT contract", () => {
    it("returns one entry per descriptor, in registry order, including empty layers", async () => {
        const { composeSystemPromptWithLayers, PROMPT_LAYER_DESCRIPTORS } = await loadComposer();
        const result = composeSystemPromptWithLayers({});
        expect(result.layers.map((l) => l.id)).toEqual(PROMPT_LAYER_DESCRIPTORS.map((d) => d.id));
        const emptyEntries = result.layers.filter((l) => l.chars === 0);
        for (const entry of emptyEntries) {
            expect(entry.source).toBe("empty");
            expect(entry.span[0]).toBe(entry.span[1]);
        }
    });

    it("spans are byte-exact slices of composed, wrapped in PF_LAYER markers", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({
            prePromptTemplate: "PROJECT TEMPLATE CONTENT",
            governanceSystemPrompt: "GOVERNANCE CONTENT",
            outputBudgetPolicy: "BUDGET CONTENT",
            outputLanguage: "it",
        });
        for (const layer of result.layers.filter((l) => l.chars > 0)) {
            const slice = result.composed.slice(layer.span[0], layer.span[1]);
            expect(slice.startsWith(`<!-- PF_LAYER id=${layer.id} `)).toBe(true);
            expect(slice.endsWith(`<!-- /PF_LAYER id=${layer.id} -->`)).toBe(true);
        }
    });

    it("keeps Layer S reserved and empty (TEMPLATE_SKILLS_INJECTION_PLAN not implemented)", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({ prePromptTemplate: "x" });
        const layerS = result.layers.find((l) => l.id === "S")!;
        expect(layerS.chars).toBe(0);
        expect(result.composed).not.toContain("PF_LAYER id=S");
    });

    it("honours caller-provided sources and defaults the rest", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({
            governanceSystemPrompt: "GOV",
            sources: { F: "product-override" },
        });
        expect(result.layers.find((l) => l.id === "F")!.source).toBe("product-override");
        expect(result.layers.find((l) => l.id === "A")!.source).toBe("code-default");
    });

    it("emits the request override (Layer R) last", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({ requestSystemPrompt: "REQ OVERRIDE" });
        const nonEmpty = result.layers.filter((l) => l.chars > 0);
        expect(nonEmpty[nonEmpty.length - 1]!.id).toBe("R");
        expect(result.composed.trimEnd().endsWith("<!-- /PF_LAYER id=R -->")).toBe(true);
    });

    // Regression guard: Layer L (OUTPUT LANGUAGE) must be injected when a language is
    // resolved, and omitted otherwise. See OUTPUT_LANGUAGE_CONTROL_SPEC.md — the previous
    // regression was Layer L never reaching generation, so this locks the composer half.
    it("injects Layer L with a byte-exact marker when outputLanguage is resolved", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({ outputLanguage: "it", sources: { L: "project-config" } });
        expect(result.composed).toContain("PF_LAYER id=L");
        expect(result.composed).toContain("OUTPUT LANGUAGE");
        expect(result.composed).toContain("Italian");
        const layerL = result.layers.find((l) => l.id === "L")!;
        expect(layerL.chars).toBeGreaterThan(0);
        expect(layerL.source).toBe("project-config");
        expect(result.composed.slice(layerL.span[0], layerL.span[1])).toContain("Italian");
    });

    it("omits Layer L when no output language is resolved (model default English)", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({ outputLanguage: null });
        expect(result.composed).not.toContain("PF_LAYER id=L");
        expect(result.layers.find((l) => l.id === "L")!.chars).toBe(0);
    });
});
