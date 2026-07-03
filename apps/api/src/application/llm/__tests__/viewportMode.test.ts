import { describe, it, expect, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: true,
        ENRICHMENT_LAYER_D_MAX_CHARS: 50_000,
        ENRICHMENT_LAYER_D_MAX_ASSETS: 10,
    },
}));

import { buildViewportModeBlock, buildPresetLayerFromPreset } from "../systemPromptLayers";
import type { PresetOutputSpec } from "../../../domain/entities/ProjectPreset";

function spec(partial: Partial<PresetOutputSpec>): { outputSpec: PresetOutputSpec } {
    return {
        outputSpec: {
            pageModel: "single_page",
            sectionModel: "scroll",
            printReady: false,
            systemPromptModule: "MODULE BODY",
            ...partial,
        },
    };
}

describe("VIEWPORT MODE block (Layer B, single source for layout framing)", () => {
    it("fullscreen_app asserts full-viewport with no page scroll and no document chrome", () => {
        const block = buildViewportModeBlock("fullscreen_app");
        expect(block).toContain("VIEWPORT MODE — FULLSCREEN APP");
        expect(block).toContain("100dvw × 100dvh");
        expect(block).toContain("overflow:hidden");
        expect(block).toContain("No document chrome");
        // Must NOT reintroduce landing/document responsive framing.
        expect(block).not.toContain("Mobile-first");
        expect(block).not.toContain("below-the-fold");
    });

    it("slide_deck asserts one full-viewport slide per screen", () => {
        const block = buildViewportModeBlock("slide_deck");
        expect(block).toContain("VIEWPORT MODE — SLIDE DECK");
        expect(block).toContain("one slide visible per screen");
    });

    it("print asserts a fixed print canvas", () => {
        expect(buildViewportModeBlock("print")).toContain("VIEWPORT MODE — PRINT CANVAS");
    });

    it("document_scroll (and absent) carries the responsive-document directives moved out of Layer A", () => {
        const explicit = buildViewportModeBlock("document_scroll");
        const fallback = buildViewportModeBlock(undefined);
        expect(explicit).toBe(fallback); // absent defaults to document_scroll
        expect(explicit).toContain("VIEWPORT MODE — RESPONSIVE DOCUMENT");
        expect(explicit).toContain("Mobile-first responsive");
        expect(explicit).toContain("semantic landmarks");
        expect(explicit).toContain('loading="lazy"');
    });

    it("buildPresetLayerFromPreset prepends the viewport block before the preset module", () => {
        const layer = buildPresetLayerFromPreset(spec({ viewportModel: "fullscreen_app" }));
        expect(layer.indexOf("VIEWPORT MODE — FULLSCREEN APP")).toBeGreaterThanOrEqual(0);
        expect(layer.indexOf("VIEWPORT MODE — FULLSCREEN APP")).toBeLessThan(layer.indexOf("MODULE BODY"));
    });

    it("preset-less projects still receive the default document framing (PP-018 gap guard)", () => {
        expect(buildPresetLayerFromPreset(null)).toContain("VIEWPORT MODE — RESPONSIVE DOCUMENT");
        expect(buildPresetLayerFromPreset(undefined)).toContain("VIEWPORT MODE — RESPONSIVE DOCUMENT");
    });
});

describe("Layer A completeness & ship-readiness contract", () => {
    it("mandates a complete, publish-ready result and forbids deferring work to next steps", async () => {
        const { buildBaseConstraintsLayer } = await import("../systemPromptLayers");
        const layer = buildBaseConstraintsLayer();
        expect(layer).toContain("COMPLETENESS & SHIP-READINESS CONTRACT");
        expect(layer).toContain("publish-ready");
        expect(layer).toContain("never a skeleton");
        // Token efficiency must not be an excuse to shrink scope.
        expect(layer).toContain("Token efficiency serves completeness");
    });
});
