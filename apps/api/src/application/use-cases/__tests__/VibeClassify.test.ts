import { describe, expect, it } from "vitest";

import { inferDeterministicVibeTemplate } from "../../prompting/vibeTemplateIntent";

describe("inferDeterministicVibeTemplate", () => {
    it("routes spatial playable space prompts to the 3D game template", () => {
        const result = inferDeterministicVibeTemplate(
            "build a copy of Spore space-age part, where you can fly your spaceship between stars, zoom into planets and upgrade your ship etc.",
        );

        expect(result?.templateId).toBe("game3d");
    });

    it("routes generic playable browser prompts to the videogame template", () => {
        const result = inferDeterministicVibeTemplate(
            "Create a playable arcade game with score, levels, controls, win and game over states.",
        );

        expect(result?.templateId).toBe("videogame");
    });

    it("does not force a template for ordinary landing page prompts", () => {
        const result = inferDeterministicVibeTemplate(
            "Create a landing page for a consulting studio with a hero, services and contact form.",
        );

        expect(result).toBeNull();
    });
});
