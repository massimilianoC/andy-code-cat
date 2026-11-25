import { describe, expect, it } from "vitest";
import { ACTION_KEY, DEFAULT_BINDINGS, detectBinding, diffActions, readActions, type PadState } from "../gamepad";
import { injectArcadeRuntime, parseArcadeGameMessage } from "../arcadeRuntime";
import { ARCADE_GENRES, buildArcadeGamePrompt, randomArcadeRecipe } from "../arcadeRecipe";

function pad(pressed: number[] = [], axes: number[] = [0, 0]): PadState {
    return { buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })), axes };
}

describe("gamepad mapping", () => {
    it("reads d-pad, stick and face buttons through the standard mapping", () => {
        expect([...readActions(pad([12, 0]))].sort()).toEqual(["a", "up"]);
        expect([...readActions(pad([], [-0.9, 0.8]))].sort()).toEqual(["down", "left"]);
        expect(readActions(pad([], [0.3, -0.3])).size).toBe(0);
    });

    it("maps actions onto the keys of the playability contract; select stays with the shell", () => {
        expect(ACTION_KEY.a).toBe("Space");
        expect(ACTION_KEY.start).toBe("Enter");
        expect(ACTION_KEY.left).toBe("ArrowLeft");
        expect(ACTION_KEY.select).toBeNull();
    });

    it("reports press and release edges only", () => {
        const { pressed, released } = diffActions(new Set(["a", "up"]), new Set(["up", "start"]));
        expect(pressed).toEqual(["start"]);
        expect(released).toEqual(["a"]);
    });

    it("detects the input a player presses when remapping, and uses custom bindings", () => {
        expect(detectBinding(pad([5]), pad())).toEqual({ kind: "button", index: 5 });
        expect(detectBinding(pad([], [0, 0, 0.95]), pad([], [0, 0, 0]))).toEqual({ kind: "axis", index: 2, sign: 1 });
        expect(detectBinding(pad(), pad())).toBeNull();
        const custom = { ...DEFAULT_BINDINGS, a: [{ kind: "button" as const, index: 5 }] };
        expect(readActions(pad([5]), custom).has("a")).toBe(true);
        expect(readActions(pad([0]), custom).has("a")).toBe(false);
    });
});

describe("arcade runtime bridge", () => {
    it("injects once, before any game script", () => {
        const doc = injectArcadeRuntime("<!doctype html><html><head><title>x</title><script>game()</script></head><body></body></html>");
        expect(doc.indexOf("data-andy-arcade-runtime")).toBeLessThan(doc.indexOf("game()"));
        expect(injectArcadeRuntime(doc)).toBe(doc);
        expect(injectArcadeRuntime("<canvas></canvas>").startsWith("<script data-andy-arcade-runtime")).toBe(true);
    });

    it("accepts only well-formed game messages", () => {
        expect(parseArcadeGameMessage({ source: "andy-arcade", type: "score", score: 1200 })).toEqual({ source: "andy-arcade", type: "score", score: 1200 });
        expect(parseArcadeGameMessage({ source: "andy-arcade", type: "exit" })?.type).toBe("exit");
        for (const bad of [null, "x", { source: "other", type: "score", score: 1 }, { source: "andy-arcade", type: "score", score: -1 },
            { source: "andy-arcade", type: "score", score: 1.5 }, { source: "andy-arcade", type: "score", score: "9" }, { source: "andy-arcade", type: "eval" }]) {
            expect(parseArcadeGameMessage(bad)).toBeNull();
        }
    });
});

describe("arcade recipe", () => {
    it("builds a prompt that names a game, its mechanics and the controls", () => {
        const prompt = buildArcadeGamePrompt({ genre: "platformer", style: "pixel-8bit", setting: "neon-city", hero: "cat-astronaut", twist: "gravity-flip", extra: "" });
        for (const word of ["videogame", "platformer", "WASD", "levels", "score", "original"]) expect(prompt).toContain(word);
        expect(prompt.length).toBeGreaterThan(10);
    });

    it("draws a complete random recipe", () => {
        const recipe = randomArcadeRecipe(() => 0.99);
        expect(ARCADE_GENRES.map((g) => g.id)).toContain(recipe.genre);
        expect(buildArcadeGamePrompt(recipe)).toContain("videogame");
    });
});
