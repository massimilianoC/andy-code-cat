import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: false,
        ENRICHMENT_LAYER_D_MAX_CHARS: 50_000,
        ENRICHMENT_LAYER_D_MAX_ASSETS: 10,
    },
}));

import { buildLanguageLayer } from "../systemPromptLayers";

describe("buildLanguageLayer", () => {
    it("contains LAYER L header", () => {
        const layer = buildLanguageLayer("en");
        expect(layer).toContain("LAYER L");
    });

    it("includes the language name for German", () => {
        const layer = buildLanguageLayer("de");
        expect(layer).toContain("German");
        expect(layer).toContain("de");
    });

    it("includes the language name for Italian", () => {
        const layer = buildLanguageLayer("it");
        expect(layer).toContain("Italian");
    });

    it("includes the language name for French", () => {
        const layer = buildLanguageLayer("fr");
        expect(layer).toContain("French");
    });

    it("uses raw code for unknown languages", () => {
        const layer = buildLanguageLayer("xx");
        expect(layer).toContain("xx");
    });

    it("normalizes uppercase input", () => {
        const layer = buildLanguageLayer("DE");
        expect(layer).toContain("German");
    });

    it("strips subtag from BCP-47 with subtag", () => {
        const layer = buildLanguageLayer("pt-BR");
        expect(layer).toContain("pt");
        // Should still resolve to Portuguese name or raw code
        expect(layer.toLowerCase()).toMatch(/portuguese|pt/);
    });

    it("directive applies to all user-visible copy", () => {
        const layer = buildLanguageLayer("es");
        expect(layer).toMatch(/user-visible|heading|label/i);
    });
});
