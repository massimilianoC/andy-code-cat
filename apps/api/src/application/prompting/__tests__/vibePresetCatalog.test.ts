import { describe, expect, it } from "vitest";

import { PRESET_CATALOG } from "../../../domain/entities/ProjectPreset";
import {
    buildAnnotatedPresetCatalog,
    buildAttachmentSignalRules,
    buildCanonicalPresetSelectionRules,
    buildTemplateSelectionProcedure,
} from "../vibePresetCatalog";

describe("buildAnnotatedPresetCatalog", () => {
    it("includes every catalog preset id exactly once", () => {
        const catalog = buildAnnotatedPresetCatalog();
        for (const preset of PRESET_CATALOG) {
            const marker = `[${preset.id}]`;
            const occurrences = catalog.split(marker).length - 1;
            expect(occurrences, `${marker} should appear exactly once`).toBe(1);
        }
    });

    it("gives every game-xr preset a DO NOT SELECT WHEN clause", () => {
        const catalog = buildAnnotatedPresetCatalog();
        const gameXrPresets = PRESET_CATALOG.filter((p) => p.category === "game-xr");
        expect(gameXrPresets.length).toBeGreaterThan(0);
        for (const preset of gameXrPresets) {
            const start = catalog.indexOf(`[${preset.id}]`);
            const nextBlock = catalog.indexOf("\n\n", start);
            const block = catalog.slice(start, nextBlock === -1 ? undefined : nextBlock);
            expect(block, `${preset.id} block should list a DO NOT SELECT WHEN clause`).toContain("DO NOT SELECT WHEN:");
        }
    });

    it("marks website as commonly confused with videogame", () => {
        const catalog = buildAnnotatedPresetCatalog();
        const start = catalog.indexOf("[website]");
        const nextBlock = catalog.indexOf("\n\n", start);
        const block = catalog.slice(start, nextBlock === -1 ? undefined : nextBlock);
        expect(block).toContain("NOT TO BE CONFUSED WITH videogame");
    });
});

describe("buildTemplateSelectionProcedure", () => {
    it("carries all five steps and the forbidden atmosphere-word list", () => {
        const procedure = buildTemplateSelectionProcedure();
        for (const step of ["STEP 1", "STEP 2", "STEP 3", "STEP 4", "STEP 5"]) {
            expect(procedure).toContain(step);
        }
        for (const forbidden of ["micro-interactions", "Awwwards-level", "immersive", "kinetic"]) {
            expect(procedure).toContain(forbidden);
        }
    });
});

describe("buildAttachmentSignalRules", () => {
    it("mentions dataset and presentation file types", () => {
        const rules = buildAttachmentSignalRules();
        expect(rules).toContain(".csv");
        expect(rules).toContain(".pptx");
    });
});

describe("buildCanonicalPresetSelectionRules", () => {
    it("stays well under the size of the old duplicated catalog rendering", () => {
        expect(buildCanonicalPresetSelectionRules().length).toBeLessThan(40000);
    });

    it("keeps hidden specialist presets matchable (freerunner)", () => {
        expect(buildCanonicalPresetSelectionRules()).toContain("freerunner");
    });
});
