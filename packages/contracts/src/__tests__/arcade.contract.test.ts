import { describe, expect, it } from "vitest";
import {
    ARCADE_RUNTIME_SOURCE, arcadeStickDirections, classifyArcadeGesture, injectArcadeRuntime, parseArcadeGameMessage, usesArcadeSdk,
} from "../arcade";

/** A minimal browser for running the runtime in Node: enough DOM for the SDK's own code paths. */
function fakeBrowser(options: { touch?: boolean; framed?: boolean } = {}) {
    type Listener = (event: Record<string, unknown>) => void;
    const listeners: Record<string, Listener[]> = {};
    const posted: Array<Record<string, unknown>> = [];
    const keys: Array<{ type: string; code: string; key: string; keyCode: number }> = [];
    const appended: Array<Record<string, unknown>> = [];

    function element(tag: string): Record<string, unknown> {
        const node: Record<string, unknown> = {
            tag, style: {}, children: [] as unknown[], attributes: {} as Record<string, string>,
            setAttribute(name: string, value: string) { (node.attributes as Record<string, string>)[name] = value; },
            appendChild(child: Record<string, unknown>) { (node.children as unknown[]).push(child); child.parentNode = node; appended.push(child); return child; },
            removeChild() { /* splash removal */ },
            addEventListener() { /* controls are exercised in the browser, not here */ },
        };
        return node;
    }
    const body = element("body");
    (body as { dispatchEvent: unknown }).dispatchEvent = (event: { type: string; code: string; key: string; keyCode: number }) => {
        keys.push({ type: event.type, code: event.code, key: event.key, keyCode: event.keyCode });
        return true;
    };
    const head = element("head");
    const document = {
        body, head, documentElement: element("html"), activeElement: null,
        createElement: element,
        getElementById: (id: string) => appended.find((node) => node.id === id) ?? null,
        addEventListener() { /* DOMContentLoaded not needed: body exists */ },
    };
    const parent = { postMessage: (message: Record<string, unknown>) => posted.push(message) };
    const window: Record<string, unknown> = {
        addEventListener: (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn); },
        matchMedia: () => ({ matches: Boolean(options.touch) }),
        innerWidth: 400,
        innerHeight: 800,
    };
    window.parent = options.framed === false ? window : parent;
    class KeyboardEvent {
        type: string; key: string; code: string;
        constructor(type: string, init: { key: string; code: string }) { this.type = type; this.key = init.key; this.code = init.code; }
    }
    const navigator = { maxTouchPoints: options.touch ? 5 : 0 };
    new Function("window", "document", "navigator", "KeyboardEvent", ARCADE_RUNTIME_SOURCE)(window, document, navigator, KeyboardEvent);
    const fire = (type: string, event: Record<string, unknown>) => (listeners[type] ?? []).forEach((fn) => fn(event));
    return { window, posted, keys, appended, fire, parent };
}

describe("arcade SDK runtime", () => {
    it("announces itself and posts scores within bounds", () => {
        const { window, posted } = fakeBrowser();
        expect(posted[0]).toMatchObject({ source: "andy-arcade", type: "ready", version: 2 });
        const sdk = window.AndyArcade as { submitScore(n: unknown): void; version: number };
        sdk.submitScore(1234.9);
        sdk.submitScore(-5);
        sdk.submitScore("nope");
        sdk.submitScore(5e12);
        expect(posted.filter((m) => m.type === "score").map((m) => m.score)).toEqual([1234, 1_000_000_000]);
    });

    it("turns shell key messages into keyboard events, only from the parent frame", () => {
        const { posted, keys, fire, parent } = fakeBrowser();
        fire("message", { source: parent, data: { source: "andy-arcade-shell", type: "key", code: "Space", down: true } });
        fire("message", { source: parent, data: { source: "andy-arcade-shell", type: "key", code: "Space", down: true } });
        fire("message", { source: {}, data: { source: "andy-arcade-shell", type: "key", code: "Enter", down: true } });
        fire("message", { source: parent, data: { source: "andy-arcade-shell", type: "key", code: "KeyQ", down: true } });
        fire("message", { source: parent, data: { source: "andy-arcade-shell", type: "key", code: "Space", down: false } });
        expect(keys).toEqual([
            { type: "keydown", code: "Space", key: " ", keyCode: 32 },
            { type: "keyup", code: "Space", key: " ", keyCode: 32 },
        ]);
        expect(posted.length).toBe(1);
    });

    it("pauses through the game's listener, or by pressing P when the game has none", async () => {
        const legacy = fakeBrowser();
        legacy.fire("message", { source: legacy.parent, data: { source: "andy-arcade-shell", type: "pause" } });
        expect(legacy.keys.map((k) => `${k.type}:${k.code}`)).toEqual(["keydown:KeyP"]);
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(legacy.keys.map((k) => `${k.type}:${k.code}`)).toEqual(["keydown:KeyP", "keyup:KeyP"]);

        const modern = fakeBrowser();
        const calls: string[] = [];
        const sdk = modern.window.AndyArcade as { on(name: string, fn: () => void): void };
        sdk.on("pause", () => calls.push("pause"));
        sdk.on("resume", () => calls.push("resume"));
        modern.fire("message", { source: modern.parent, data: { source: "andy-arcade-shell", type: "pause" } });
        modern.fire("message", { source: modern.parent, data: { source: "andy-arcade-shell", type: "resume" } });
        expect(calls).toEqual(["pause", "resume"]);
        expect(modern.keys).toEqual([]);
    });

    it("configures touch controls on touch devices only, locks the page and reports the config", () => {
        const phone = fakeBrowser({ touch: true });
        (phone.window.AndyArcade as { configure(o: unknown): void }).configure({ touch: "joystick", buttons: ["a", "b", "z"], orientation: "landscape" });
        expect(phone.posted.find((m) => m.type === "config")?.config).toEqual({ touch: "joystick", buttons: ["a", "b"], orientation: "landscape" });
        const marks = phone.appended.map((node) => (node.attributes as Record<string, string>)["data-andy-arcade"]).filter(Boolean);
        expect(marks).toEqual(expect.arrayContaining(["controls", "joystick", "button-a", "button-b"]));
        expect(phone.appended.some((node) => node.id === "andy-arcade-lock")).toBe(true);

        const desktop = fakeBrowser({ touch: false });
        (desktop.window.AndyArcade as { configure(o: unknown): void }).configure({ touch: "dpad" });
        expect(desktop.appended.some((node) => (node.attributes as Record<string, string>)["data-andy-arcade"] === "controls")).toBe(false);
        expect(desktop.appended.some((node) => node.id === "andy-arcade-lock")).toBe(true);
    });

    it("stays silent towards a parent on a published page", () => {
        const page = fakeBrowser({ framed: false });
        (page.window.AndyArcade as { submitScore(n: number): void }).submitScore(10);
        expect(page.posted).toEqual([]);
    });

    it("keeps its stick and gesture logic identical to the exported functions", () => {
        const runtimeFn = (name: string) => {
            const match = ARCADE_RUNTIME_SOURCE.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
            expect(match, name).not.toBeNull();
            return new Function(`${match![0]}; return ${name};`)() as (...args: number[]) => unknown;
        };
        const dirOf = runtimeFn("dirOf");
        const gestureOf = runtimeFn("gestureOf");
        for (let dx = -60; dx <= 60; dx += 7) {
            for (let dy = -60; dy <= 60; dy += 7) {
                expect(dirOf(dx, dy, 18)).toEqual(arcadeStickDirections(dx, dy, 18));
                for (const ms of [100, 400, 700]) expect(gestureOf(dx, dy, ms)).toEqual(classifyArcadeGesture(dx, dy, ms));
            }
        }
    });
});

describe("arcade SDK helpers", () => {
    it("reads stick directions with a dead zone and stable diagonals", () => {
        expect(arcadeStickDirections(5, 5, 18)).toEqual({ up: false, down: false, left: false, right: false });
        expect(arcadeStickDirections(40, 2, 18)).toEqual({ up: false, down: false, left: false, right: true });
        expect(arcadeStickDirections(30, -30, 18)).toEqual({ up: true, down: false, left: false, right: true });
        expect(arcadeStickDirections(-5, 50, 18)).toEqual({ up: false, down: true, left: false, right: false });
    });

    it("tells taps, swipes and slow drags apart", () => {
        expect(classifyArcadeGesture(3, 2, 120)).toEqual({ type: "tap" });
        expect(classifyArcadeGesture(-80, 10, 200)).toEqual({ type: "swipe", dir: "left" });
        expect(classifyArcadeGesture(5, -60, 200)).toEqual({ type: "swipe", dir: "up" });
        expect(classifyArcadeGesture(80, 0, 1500)).toBeNull();
    });

    it("injects once, in <head> and never in <header>, and only where the SDK is used", () => {
        const doc = injectArcadeRuntime("<!doctype html><html><head><title>x</title><script>game()</script></head><body></body></html>");
        expect(doc.indexOf("data-andy-arcade-runtime")).toBeLessThan(doc.indexOf("game()"));
        expect(injectArcadeRuntime(doc)).toBe(doc);
        expect(injectArcadeRuntime("<header>Hi</header><canvas></canvas>").startsWith("<script data-andy-arcade-runtime")).toBe(true);
        expect(usesArcadeSdk("<html></html>", "if (window.AndyArcade) AndyArcade.configure({})")).toBe(true);
        expect(usesArcadeSdk("<html></html>", "", null)).toBe(false);
    });

    it("validates every message a game may post", () => {
        expect(parseArcadeGameMessage({ source: "andy-arcade", type: "config", config: { touch: "swipe", buttons: ["a", "a", "q"], orientation: "sideways" } }))
            .toEqual({ source: "andy-arcade", type: "config", config: { touch: "swipe", buttons: ["a"], orientation: "any" } });
        expect(parseArcadeGameMessage({ source: "andy-arcade", type: "haptic", ms: 5000 })).toEqual({ source: "andy-arcade", type: "haptic", ms: 200 });
        expect(parseArcadeGameMessage({ source: "andy-arcade", type: "ready" })).toEqual({ source: "andy-arcade", type: "ready", version: 1 });
        expect(parseArcadeGameMessage({ source: "andy-arcade", type: "menu" })?.type).toBe("menu");
        for (const bad of [null, "x", { source: "other", type: "score", score: 1 }, { source: "andy-arcade", type: "score", score: -1 },
            { source: "andy-arcade", type: "score", score: 1.5 }, { source: "andy-arcade", type: "config", config: { touch: "mouse" } },
            { source: "andy-arcade", type: "haptic", ms: -3 }, { source: "andy-arcade", type: "eval" }]) {
            expect(parseArcadeGameMessage(bad)).toBeNull();
        }
    });
});
