"use client";

import { useEffect, useRef } from "react";
import type { ArcadeKeyCode } from "./arcadeRuntime";

/**
 * Gamepad → arcade actions → keyboard keys (docs/specs/ARCADE_MODE_MVP.md §3).
 *
 * The shell, not the game, reads controllers: the Gamepad API is polled in the top-level page and
 * every action becomes the key the ARCADE PLAYABILITY contract promises (arrows, Space, Shift…).
 * Defaults follow the W3C "standard" mapping (XInput-style pads); cheap USB encoders and DIY
 * boards often report their own layout, so a controller can be remapped and the mapping is kept
 * per `Gamepad.id`.
 */

export const ARCADE_ACTIONS = ["up", "down", "left", "right", "a", "b", "x", "y", "start", "select"] as const;
export type ArcadeAction = (typeof ARCADE_ACTIONS)[number];

/** `select` is the shell's own button (back to the library), never forwarded to a game. */
export const ACTION_KEY: Record<ArcadeAction, ArcadeKeyCode | null> = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    a: "Space",
    b: "ShiftLeft",
    x: "KeyK",
    y: "KeyP",
    start: "Enter",
    select: null,
};

export type GamepadBinding = { kind: "button"; index: number } | { kind: "axis"; index: number; sign: 1 | -1 };
export type GamepadBindings = Record<ArcadeAction, GamepadBinding[]>;

export const DEFAULT_BINDINGS: GamepadBindings = {
    up: [{ kind: "button", index: 12 }, { kind: "axis", index: 1, sign: -1 }],
    down: [{ kind: "button", index: 13 }, { kind: "axis", index: 1, sign: 1 }],
    left: [{ kind: "button", index: 14 }, { kind: "axis", index: 0, sign: -1 }],
    right: [{ kind: "button", index: 15 }, { kind: "axis", index: 0, sign: 1 }],
    a: [{ kind: "button", index: 0 }],
    b: [{ kind: "button", index: 1 }],
    x: [{ kind: "button", index: 2 }],
    y: [{ kind: "button", index: 3 }],
    start: [{ kind: "button", index: 9 }],
    select: [{ kind: "button", index: 8 }, { kind: "button", index: 16 }],
};

const AXIS_THRESHOLD = 0.5;
const DETECT_AXIS_THRESHOLD = 0.7;

export interface PadState {
    buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
    axes: ReadonlyArray<number>;
}

function bindingActive(pad: PadState, binding: GamepadBinding): boolean {
    if (binding.kind === "button") {
        const button = pad.buttons[binding.index];
        return Boolean(button && (button.pressed || button.value > AXIS_THRESHOLD));
    }
    const value = pad.axes[binding.index] ?? 0;
    return binding.sign > 0 ? value > AXIS_THRESHOLD : value < -AXIS_THRESHOLD;
}

export function readActions(pad: PadState, bindings: GamepadBindings = DEFAULT_BINDINGS): Set<ArcadeAction> {
    const active = new Set<ArcadeAction>();
    for (const action of ARCADE_ACTIONS) {
        if (bindings[action]?.some((binding) => bindingActive(pad, binding))) active.add(action);
    }
    return active;
}

export function diffActions(previous: ReadonlySet<ArcadeAction>, next: ReadonlySet<ArcadeAction>) {
    return {
        pressed: ARCADE_ACTIONS.filter((action) => next.has(action) && !previous.has(action)),
        released: ARCADE_ACTIONS.filter((action) => previous.has(action) && !next.has(action)),
    };
}

/** The first input that differs from a resting baseline: what the player just pressed. */
export function detectBinding(pad: PadState, baseline: PadState): GamepadBinding | null {
    for (let index = 0; index < pad.buttons.length; index++) {
        if (pad.buttons[index]?.pressed && !baseline.buttons[index]?.pressed) return { kind: "button", index };
    }
    for (let index = 0; index < pad.axes.length; index++) {
        const value = pad.axes[index] ?? 0;
        const rest = baseline.axes[index] ?? 0;
        if (Math.abs(value - rest) > DETECT_AXIS_THRESHOLD) return { kind: "axis", index, sign: value > rest ? 1 : -1 };
    }
    return null;
}

export function describeBinding(binding: GamepadBinding): string {
    return binding.kind === "button" ? `B${binding.index}` : `A${binding.index}${binding.sign > 0 ? "+" : "−"}`;
}

const STORAGE_KEY = "andy-arcade:bindings:v1";

function readStore(): Record<string, GamepadBindings> {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) as Record<string, GamepadBindings> : {};
    } catch {
        return {};
    }
}

export function loadBindings(gamepadId: string): GamepadBindings {
    const stored = readStore()[gamepadId];
    if (!stored) return DEFAULT_BINDINGS;
    return Object.fromEntries(ARCADE_ACTIONS.map((action) => [action, stored[action]?.length ? stored[action] : DEFAULT_BINDINGS[action]])) as GamepadBindings;
}

export function saveBindings(gamepadId: string, bindings: GamepadBindings | null) {
    try {
        const store = readStore();
        if (bindings) store[gamepadId] = bindings; else delete store[gamepadId];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        // Private mode or blocked storage: the mapping lasts for this session only.
    }
}

export function connectedPads(): Gamepad[] {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => Boolean(pad));
}

/**
 * Polls every connected controller once per animation frame and reports action edges. Repeated
 * presses of a held direction are the caller's business (menus repeat, games hold).
 */
export function useArcadeGamepad(handlers: { onPress?: (action: ArcadeAction) => void; onRelease?: (action: ArcadeAction) => void; enabled?: boolean }) {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (handlers.enabled === false) return;
        let frame = 0;
        let previous = new Set<ArcadeAction>();
        const bindingsCache = new Map<string, GamepadBindings>();

        const tick = () => {
            const next = new Set<ArcadeAction>();
            for (const pad of connectedPads()) {
                if (!bindingsCache.has(pad.id)) bindingsCache.set(pad.id, loadBindings(pad.id));
                readActions(pad, bindingsCache.get(pad.id)).forEach((action) => next.add(action));
            }
            const { pressed, released } = diffActions(previous, next);
            pressed.forEach((action) => handlersRef.current.onPress?.(action));
            released.forEach((action) => handlersRef.current.onRelease?.(action));
            previous = next;
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        const reload = () => bindingsCache.clear();
        window.addEventListener("gamepadconnected", reload);
        window.addEventListener("andy-arcade-bindings-changed", reload);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("gamepadconnected", reload);
            window.removeEventListener("andy-arcade-bindings-changed", reload);
            // Release whatever was held, so a game never keeps a key stuck down.
            previous.forEach((action) => handlersRef.current.onRelease?.(action));
        };
    }, [handlers.enabled]);
}
