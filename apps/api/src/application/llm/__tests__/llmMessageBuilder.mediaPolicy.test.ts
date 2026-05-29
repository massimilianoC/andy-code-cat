import { describe, expect, it } from "vitest";

process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

async function loadPromptModules() {
    const [{ buildOutputBudgetPolicy }, { composeSystemPromptWithLayers }] = await Promise.all([
        import("../llmMessageBuilder"),
        import("../systemPromptComposer"),
    ]);
    return { buildOutputBudgetPolicy, composeSystemPromptWithLayers };
}

describe("LLM media placeholder prompt policy", () => {
    it("keeps media placeholder rules in the non-editable budget policy layer", async () => {
        const { buildOutputBudgetPolicy } = await loadPromptModules();
        const policy = buildOutputBudgetPolicy();

        expect(policy).toContain("asset://media/<lowercase-kebab-key>");
        expect(policy).toContain("data-media-key=\"<same-key>\"");
        expect(policy).toContain("mediaManifest.version must be media-manifest-v1");
        expect(policy).toContain("non-editable platform rules");
        expect(policy).toContain("override any earlier editable project template");
    });

    it("instructs the canonical asset filenames (script.js/style.css), never app.js/app.css", async () => {
        const { buildBaseConstraintsLayer } = await import("../systemPromptLayers");
        const layer = buildBaseConstraintsLayer();

        expect(layer).toContain('<script src="script.js"></script>');
        expect(layer).toContain('href="style.css"');
        // The publish/export pipeline writes style.css + script.js — an app.js/app.css
        // REFERENCE would 404. (The text may mention them as forbidden examples, so we
        // assert on the actual src/href reference form, not raw substring presence.)
        expect(layer).not.toContain('src="app.js"');
        expect(layer).not.toContain('href="app.css"');
    });

    it("keeps the non-editable visibility-without-JS rule", async () => {
        const { buildBaseConstraintsLayer } = await import("../systemPromptLayers");
        const { buildOutputBudgetPolicy } = await loadPromptModules();
        const layer = buildBaseConstraintsLayer();

        expect(layer).toContain("Visibility-without-JS rules (NON-EDITABLE");
        expect(buildOutputBudgetPolicy()).toContain("VISIBILITY (non-editable)");
    });

    it("composes hardcoded media rules after editable project templates", async () => {
        const { buildOutputBudgetPolicy, composeSystemPromptWithLayers } = await loadPromptModules();
        const layers = composeSystemPromptWithLayers({
            prePromptTemplate: "Legacy project template says use https://loremflickr.com/1200/600/cat directly.",
            outputBudgetPolicy: buildOutputBudgetPolicy(),
        });

        expect(layers.layerE).toContain("loremflickr.com");
        expect(layers.budgetPolicy).toContain("Never emit random/provider image URLs");
        expect(layers.composed.indexOf(layers.layerE)).toBeLessThan(layers.composed.indexOf(layers.budgetPolicy));
    });
});