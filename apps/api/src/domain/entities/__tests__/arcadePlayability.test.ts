import { describe, expect, it } from "vitest";
import { ARCADE_PLAYABILITY_MODULE, PRESET_MAP } from "../ProjectPreset";

const ARCADE_PRESETS = ["videogame", "freerunner", "seriousgame", "game3d"];

describe("arcade playability contract", () => {
    it("is appended once to every arcade game preset", () => {
        for (const id of ARCADE_PRESETS) {
            const module = PRESET_MAP.get(id)?.outputSpec.systemPromptModule ?? "";
            expect(module.split(ARCADE_PLAYABILITY_MODULE).length - 1, id).toBe(1);
            expect(module.endsWith(ARCADE_PLAYABILITY_MODULE), id).toBe(true);
        }
    });

    it("is not added to non-game presets", () => {
        for (const [id, preset] of PRESET_MAP) {
            if (ARCADE_PRESETS.includes(id)) continue;
            expect(preset.outputSpec.systemPromptModule ?? "", id).not.toContain("ARCADE PLAYABILITY");
        }
    });

    it("names the keys the Arcade shell maps gamepads onto, and the score hook", () => {
        for (const fragment of ["WASD", "arrow keys", "Space", "Shift", "Enter", "window.AndyArcade.submitScore", "Never reproduce names",
            "escalating named tiers", "fixed 1/60 s steps", "reduced-motion", "never use the Gamepad API", "zzfx@1.4.0", "three.js 0.160.0"]) {
            expect(ARCADE_PLAYABILITY_MODULE).toContain(fragment);
        }
    });
});
