import { describe, expect, it } from "vitest";

import { PRESET_MAP } from "../../../domain/entities/ProjectPreset";
import { buildTemplateListBlock } from "../formatHintRules";

describe("buildTemplateListBlock", () => {
    it("includes rich preset context for classifier decisions", () => {
        const preset = PRESET_MAP.get("videogame");
        expect(preset).toBeDefined();

        const block = buildTemplateListBlock([{
            id: preset!.id,
            label: preset!.label,
            hint: preset!.hint,
            category: preset!.category,
            tags: preset!.tags,
            pageModel: preset!.outputSpec.pageModel,
            sectionModel: preset!.outputSpec.sectionModel,
            printReady: preset!.outputSpec.printReady,
            briefTemplate: preset!.briefTemplate,
            styleTemplate: preset!.styleTemplate,
        }]);

        expect(block).toContain('id: "videogame"');
        expect(block).toContain("game-xr");
        expect(block).toContain("game, interactive, arcade");
        expect(block).toContain("Qualsiasi gioco interattivo browser");
        expect(block).toContain("Core loop");
        expect(block).toContain("Gameplay leggibile");
    });
});
