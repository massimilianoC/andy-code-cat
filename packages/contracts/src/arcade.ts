/**
 * Andy Arcade SDK — the platform-owned script injected into every game document that uses it
 * (docs/specs/ARCADE_MODE_MVP.md §3, docs/specs/ARCADE_SDK.md).
 *
 * The model never writes touch controls, gesture recognisers, audio unlocking or viewport
 * fitting: it calls `window.AndyArcade.configure({...})` and the SDK does the rest, the same way in
 * the Arcade shell, in the workspace preview and on a published site. Every call must be safe when
 * the SDK is absent (a ZIP export), so the model guards it with `if (window.AndyArcade)`.
 *
 * What it provides:
 * - `submitScore(n)` posts the score to the Arcade shell, which stores it on the leaderboard;
 * - `configure({ touch, buttons, orientation })` draws on-screen controls on touch devices (a
 *   d-pad, a joystick, swipe or tap gestures) that press the same keys the keyboard does, and locks
 *   the page against scrolling, rubber-banding, text selection and long-press menus;
 * - `fit(canvas, width, height)` letterboxes a fixed-resolution canvas to any screen;
 * - `on("pause" | "resume" | "gesture", fn)` lets a game react to the shell's pause menu and to
 *   gestures; without a pause listener the shell's pause presses P, as the playability contract
 *   requires every game to pause on P;
 * - `vibrate(ms)` asks for a short haptic pulse (through the shell inside a frame);
 * - every AudioContext created by the game is resumed on the first real tap or key press, and a
 *   "tap to start" splash appears when audio is still locked.
 *
 * Messages are matched on `source`, never on origin: the Arcade frame has an opaque origin.
 */

export const ARCADE_SDK_VERSION = 2;

/** Presets whose projects appear on the Arcade shelf. */
export const ARCADE_GAME_PRESET_IDS = ["videogame", "freerunner", "seriousgame", "game3d"] as const;

/** Keys the shell may press inside the game: exactly the ARCADE PLAYABILITY contract. */
export const ARCADE_KEY_CODES = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter", "ShiftLeft", "KeyK", "KeyP", "Escape"] as const;
export type ArcadeKeyCode = (typeof ARCADE_KEY_CODES)[number];

export const ARCADE_SHELL_SOURCE = "andy-arcade-shell";
export const ARCADE_GAME_SOURCE = "andy-arcade";

export const ARCADE_TOUCH_LAYOUTS = ["dpad", "joystick", "swipe", "tap", "pointer", "none"] as const;
export type ArcadeTouchLayout = (typeof ARCADE_TOUCH_LAYOUTS)[number];
export const ARCADE_TOUCH_BUTTONS = ["a", "b", "x", "y"] as const;
export type ArcadeTouchButton = (typeof ARCADE_TOUCH_BUTTONS)[number];
export const ARCADE_ORIENTATIONS = ["landscape", "portrait", "any"] as const;
export type ArcadeOrientation = (typeof ARCADE_ORIENTATIONS)[number];

export interface ArcadeGameConfig {
    touch: ArcadeTouchLayout;
    buttons: ArcadeTouchButton[];
    orientation: ArcadeOrientation;
}

export type ArcadeGameMessage =
    | { source: typeof ARCADE_GAME_SOURCE; type: "ready"; version: number }
    | { source: typeof ARCADE_GAME_SOURCE; type: "score"; score: number }
    | { source: typeof ARCADE_GAME_SOURCE; type: "exit" }
    | { source: typeof ARCADE_GAME_SOURCE; type: "menu" }
    | { source: typeof ARCADE_GAME_SOURCE; type: "config"; config: ArcadeGameConfig }
    | { source: typeof ARCADE_GAME_SOURCE; type: "haptic"; ms: number };

export type ArcadeShellMessage =
    | { source: typeof ARCADE_SHELL_SOURCE; type: "key"; code: ArcadeKeyCode; down: boolean }
    | { source: typeof ARCADE_SHELL_SOURCE; type: "pause" | "resume" };

const MAX_SCORE = 1_000_000_000;
const MAX_HAPTIC_MS = 200;

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
    return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Validates what a game frame posts to the shell. Anything unexpected is dropped. */
export function parseArcadeGameMessage(data: unknown): ArcadeGameMessage | null {
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message.source !== ARCADE_GAME_SOURCE) return null;
    const source = ARCADE_GAME_SOURCE;
    switch (message.type) {
        case "ready":
            return { source, type: "ready", version: typeof message.version === "number" && Number.isInteger(message.version) ? message.version : 1 };
        case "exit":
        case "menu":
            return { source, type: message.type };
        case "score":
            return typeof message.score === "number" && Number.isInteger(message.score) && message.score >= 0 && message.score <= MAX_SCORE
                ? { source, type: "score", score: message.score }
                : null;
        case "haptic":
            return typeof message.ms === "number" && Number.isFinite(message.ms) && message.ms > 0
                ? { source, type: "haptic", ms: Math.min(Math.round(message.ms), MAX_HAPTIC_MS) }
                : null;
        case "config": {
            const raw = message.config as Record<string, unknown> | null | undefined;
            if (!raw || typeof raw !== "object" || !oneOf(ARCADE_TOUCH_LAYOUTS, raw.touch)) return null;
            const buttons = Array.isArray(raw.buttons) ? raw.buttons.filter((b): b is ArcadeTouchButton => oneOf(ARCADE_TOUCH_BUTTONS, b)) : [];
            return {
                source,
                type: "config",
                config: {
                    touch: raw.touch,
                    buttons: Array.from(new Set(buttons)),
                    orientation: oneOf(ARCADE_ORIENTATIONS, raw.orientation) ? raw.orientation : "any",
                },
            };
        }
        default:
            return null;
    }
}

/**
 * Direction of a joystick or d-pad from the thumb's offset, with a dead zone. Diagonals are kept
 * when the minor axis is at least ~40% of the major one (a 22.5° sector each side), so a thumb
 * resting a little off-axis does not jitter between two keys. Mirrors `dirOf` in the runtime.
 */
export function arcadeStickDirections(dx: number, dy: number, deadZone: number): { up: boolean; down: boolean; left: boolean; right: boolean } {
    const none = { up: false, down: false, left: false, right: false };
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < deadZone) return none;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const diagonal = 0.414;
    const horizontal = ax >= ay || ax / ay > diagonal;
    const vertical = ay > ax || ay / ax > diagonal;
    return {
        up: vertical && dy < 0,
        down: vertical && dy > 0,
        left: horizontal && dx < 0,
        right: horizontal && dx > 0,
    };
}

/**
 * What a finished touch was: a swipe in a direction, a tap, or nothing (a slow drag). Distances
 * are in CSS pixels, time in milliseconds. Mirrors `gestureOf` in the runtime.
 */
export function classifyArcadeGesture(dx: number, dy: number, ms: number): { type: "swipe"; dir: "up" | "down" | "left" | "right" } | { type: "tap" } | null {
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 12 && ms < 350) return { type: "tap" };
    if (distance >= 30 && ms < 600) {
        if (Math.abs(dx) > Math.abs(dy)) return { type: "swipe", dir: dx > 0 ? "right" : "left" };
        return { type: "swipe", dir: dy > 0 ? "down" : "up" };
    }
    return null;
}

/*
 * The runtime itself, as ES5 so it runs before any game code in any browser. `dirOf` and
 * `gestureOf` are the two functions above, kept in step by the contract tests.
 */
const RUNTIME_SOURCE = `(function () {
  if (window.AndyArcade) return;
  var GAME = "${ARCADE_GAME_SOURCE}", SHELL = "${ARCADE_SHELL_SOURCE}";
  var KEY = { ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Space: " ", Enter: "Enter", ShiftLeft: "Shift", KeyK: "k", KeyP: "p", Escape: "Escape" };
  var CODE = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, Enter: 13, ShiftLeft: 16, KeyK: 75, KeyP: 80, Escape: 27 };
  var BUTTON_KEY = { a: "Space", b: "ShiftLeft", x: "KeyK", y: "KeyP" };
  var DIR_KEY = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
  var framed = window.parent !== window;
  var touchDevice = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0;
  var listeners = { pause: [], resume: [], gesture: [] };
  var held = {};
  var config = null;
  var lastEscape = 0;

  function post(message) {
    if (!framed) return;
    message.source = GAME;
    try { window.parent.postMessage(message, "*"); } catch (e) {}
  }
  function emit(name, payload) {
    var list = listeners[name] || [];
    for (var i = 0; i < list.length; i++) { try { list[i](payload); } catch (e) { setTimeout(function (err) { return function () { throw err; }; }(e)); } }
    return list.length;
  }
  function press(type, code) {
    if (!CODE[code]) return;
    if (type === "keydown") { if (held[code]) return; held[code] = true; } else { if (!held[code]) return; delete held[code]; }
    var event = new KeyboardEvent(type, { key: KEY[code], code: code, bubbles: true, cancelable: true });
    try {
      Object.defineProperty(event, "keyCode", { get: function () { return CODE[code]; } });
      Object.defineProperty(event, "which", { get: function () { return CODE[code]; } });
    } catch (e) {}
    (document.activeElement || document.body || document).dispatchEvent(event);
  }
  function tapKey(code) { press("keydown", code); setTimeout(function () { press("keyup", code); }, 80); }
  function releaseAll() { for (var code in held) press("keyup", code); }
  function vibrate(ms) {
    ms = Math.min(Math.max(Math.round(Number(ms) || 0), 0), ${MAX_HAPTIC_MS});
    if (!ms) return;
    if (framed) post({ type: "haptic", ms: ms });
    else try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {}
  }

  // Audio: resume every context on the first real input; offer a splash while audio is locked.
  var contexts = [];
  ["AudioContext", "webkitAudioContext"].forEach(function (name) {
    var Native = window[name];
    if (!Native) return;
    var Wrapped = function (options) { var ctx = options === undefined ? new Native() : new Native(options); contexts.push(ctx); return ctx; };
    Wrapped.prototype = Native.prototype;
    try { window[name] = Wrapped; } catch (e) {}
  });
  var unlocked = false, splash = null;
  function locked() { for (var i = 0; i < contexts.length; i++) if (contexts[i].state === "suspended") return true; return false; }
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    for (var i = 0; i < contexts.length; i++) { try { contexts[i].resume(); } catch (e) {} }
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    splash = null;
  }
  ["pointerdown", "touchend", "keydown"].forEach(function (type) {
    window.addEventListener(type, function (event) { if (event.isTrusted) unlock(); }, true);
  });
  setTimeout(function () {
    if (unlocked || !locked() || !document.body) return;
    splash = document.createElement("div");
    splash.setAttribute("data-andy-arcade", "splash");
    splash.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);color:#fde047;font:900 clamp(20px,6vw,40px)/1.2 system-ui,sans-serif;letter-spacing:.08em;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent";
    splash.textContent = touchDevice ? "\\u25B6 TAP TO PLAY" : "\\u25B6 PRESS ANY KEY";
    splash.addEventListener("pointerdown", function (event) { event.preventDefault(); event.stopPropagation(); unlock(); });
    document.body.appendChild(splash);
  }, 400);

  // Page lock: no scrolling, rubber-banding, selection or long-press menu while playing.
  function lockPage() {
    if (document.getElementById("andy-arcade-lock")) return;
    var style = document.createElement("style");
    style.id = "andy-arcade-lock";
    style.textContent = "html,body{margin:0;width:100%;height:100%;overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}canvas{touch-action:none}";
    (document.head || document.documentElement).appendChild(style);
    window.addEventListener("contextmenu", function (event) { event.preventDefault(); });
  }

  function dirOf(dx, dy, dead) {
    var out = { up: false, down: false, left: false, right: false };
    var distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < dead) return out;
    var ax = Math.abs(dx), ay = Math.abs(dy);
    var horizontal = ax >= ay || ax / ay > 0.414;
    var vertical = ay > ax || ay / ax > 0.414;
    out.up = vertical && dy < 0; out.down = vertical && dy > 0; out.left = horizontal && dx < 0; out.right = horizontal && dx > 0;
    return out;
  }
  function gestureOf(dx, dy, ms) {
    var distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 12 && ms < 350) return { type: "tap" };
    if (distance >= 30 && ms < 600) {
      if (Math.abs(dx) > Math.abs(dy)) return { type: "swipe", dir: dx > 0 ? "right" : "left" };
      return { type: "swipe", dir: dy > 0 ? "down" : "up" };
    }
    return null;
  }

  // On-screen controls: a stick (d-pad or joystick) on the left, face buttons on the right.
  var layer = null;
  function el(tag, css, parent) { var node = document.createElement(tag); node.style.cssText = css; if (parent) parent.appendChild(node); return node; }
  function buildStick(kind) {
    var size = 150, radius = size / 2;
    var base = el("div", "position:absolute;left:max(16px,env(safe-area-inset-left));bottom:max(20px,env(safe-area-inset-bottom));width:" + size + "px;height:" + size + "px;border-radius:" + (kind === "dpad" ? "28px" : "50%") + ";background:rgba(15,23,42,.35);border:2px solid rgba(255,255,255,.35);pointer-events:auto;touch-action:none", layer);
    base.setAttribute("data-andy-arcade", kind);
    if (kind === "dpad") {
      el("div", "position:absolute;left:50%;top:12%;bottom:12%;width:30%;transform:translateX(-50%);background:rgba(255,255,255,.18);border-radius:8px", base);
      el("div", "position:absolute;top:50%;left:12%;right:12%;height:30%;transform:translateY(-50%);background:rgba(255,255,255,.18);border-radius:8px", base);
    }
    var knob = el("div", "position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:rgba(255,255,255,.45);box-shadow:0 0 18px rgba(253,224,71,.45);transition:transform .06s", base);
    var pointer = null, current = { up: false, down: false, left: false, right: false };
    function apply(next) {
      var changed = false;
      for (var dir in DIR_KEY) {
        if (next[dir] && !current[dir]) { press("keydown", DIR_KEY[dir]); changed = true; }
        if (!next[dir] && current[dir]) press("keyup", DIR_KEY[dir]);
      }
      if (changed) vibrate(8);
      current = next;
    }
    function move(event) {
      var rect = base.getBoundingClientRect();
      var dx = event.clientX - (rect.left + radius), dy = event.clientY - (rect.top + radius);
      var distance = Math.sqrt(dx * dx + dy * dy), max = radius - 20;
      var k = distance > max ? max / distance : 1;
      knob.style.transform = "translate(" + dx * k + "px," + dy * k + "px)";
      apply(dirOf(dx, dy, kind === "dpad" ? 18 : 22));
    }
    function end(event) {
      if (pointer !== event.pointerId) return;
      pointer = null;
      knob.style.transform = "";
      apply({ up: false, down: false, left: false, right: false });
    }
    base.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      if (pointer !== null) return;
      pointer = event.pointerId;
      try { base.setPointerCapture(pointer); } catch (e) {}
      move(event);
    });
    base.addEventListener("pointermove", function (event) { if (pointer === event.pointerId) move(event); });
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
  }
  function buildButtons(buttons) {
    var LABEL = { a: "A", b: "B", x: "X", y: "Y" };
    var COLOR = { a: "rgba(250,204,21,.55)", b: "rgba(56,189,248,.5)", x: "rgba(167,139,250,.5)", y: "rgba(74,222,128,.5)" };
    var box = el("div", "position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));display:flex;flex-wrap:wrap-reverse;justify-content:flex-end;align-items:flex-end;gap:14px;max-width:170px;pointer-events:none", layer);
    buttons.forEach(function (name, index) {
      var size = index === 0 ? 84 : 66;
      var button = el("div", "width:" + size + "px;height:" + size + "px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:900 " + Math.round(size / 2.6) + "px system-ui,sans-serif;color:#fff;background:" + COLOR[name] + ";border:2px solid rgba(255,255,255,.55);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none", box);
      button.textContent = LABEL[name];
      button.setAttribute("data-andy-arcade", "button-" + name);
      var pointer = null;
      button.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        pointer = event.pointerId;
        try { button.setPointerCapture(pointer); } catch (e) {}
        button.style.transform = "scale(.9)";
        press("keydown", BUTTON_KEY[name]);
        vibrate(10);
      });
      function up(event) {
        if (pointer !== event.pointerId) return;
        pointer = null;
        button.style.transform = "";
        press("keyup", BUTTON_KEY[name]);
      }
      button.addEventListener("pointerup", up);
      button.addEventListener("pointercancel", up);
    });
  }
  function buildGestures(kind) {
    var starts = {};
    window.addEventListener("pointerdown", function (event) {
      if (event.target && event.target.closest && event.target.closest("[data-andy-arcade]")) return;
      starts[event.pointerId] = { x: event.clientX, y: event.clientY, t: Date.now() };
      if (kind === "tap") press("keydown", "Space");
    }, { passive: true });
    function finish(event) {
      var start = starts[event.pointerId];
      if (!start) return;
      delete starts[event.pointerId];
      if (kind === "tap") { press("keyup", "Space"); }
      var gesture = gestureOf(event.clientX - start.x, event.clientY - start.y, Date.now() - start.t);
      if (!gesture) return;
      gesture.x = start.x; gesture.y = start.y;
      emit("gesture", gesture);
      if (kind === "swipe") { tapKey(gesture.type === "tap" ? "Space" : DIR_KEY[gesture.dir]); vibrate(8); }
    }
    window.addEventListener("pointerup", finish, { passive: true });
    window.addEventListener("pointercancel", function (event) { delete starts[event.pointerId]; if (kind === "tap") press("keyup", "Space"); }, { passive: true });
  }
  function buildLayer() {
    if (layer || !config || !touchDevice || !document.body) return;
    if (config.touch === "dpad" || config.touch === "joystick") {
      layer = el("div", "position:fixed;inset:0;z-index:2147483645;pointer-events:none", document.body);
      layer.setAttribute("data-andy-arcade", "controls");
      buildStick(config.touch);
      buildButtons(config.buttons.length ? config.buttons : ["a"]);
    } else if (config.touch === "swipe" || config.touch === "tap") {
      layer = true;
      buildGestures(config.touch);
    }
  }

  function fit(canvas, width, height) {
    if (!canvas || !canvas.style) return;
    width = Math.max(1, Math.round(Number(width) || canvas.width || 960));
    height = Math.max(1, Math.round(Number(height) || canvas.height || 540));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    function resize() {
      var scale = Math.min(window.innerWidth / width, window.innerHeight / height);
      canvas.style.position = "fixed";
      canvas.style.left = "50%";
      canvas.style.top = "50%";
      canvas.style.width = Math.floor(width * scale) + "px";
      canvas.style.height = Math.floor(height * scale) + "px";
      canvas.style.transform = "translate(-50%,-50%)";
    }
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
  }

  window.AndyArcade = Object.freeze({
    version: ${ARCADE_SDK_VERSION},
    isTouch: touchDevice,
    inShell: framed,
    submitScore: function (value) {
      var score = Math.floor(Number(value));
      if (!isFinite(score) || score < 0) return;
      post({ type: "score", score: Math.min(score, ${MAX_SCORE}) });
    },
    configure: function (options) {
      options = options || {};
      var touch = ["dpad", "joystick", "swipe", "tap", "pointer", "none"].indexOf(options.touch) >= 0 ? options.touch : "dpad";
      var buttons = [];
      (options.buttons || ["a"]).forEach(function (b) { if (BUTTON_KEY[b] && buttons.indexOf(b) < 0) buttons.push(b); });
      var orientation = ["landscape", "portrait", "any"].indexOf(options.orientation) >= 0 ? options.orientation : "any";
      config = { touch: touch, buttons: buttons.slice(0, 4), orientation: orientation };
      if (options.lockPage !== false) lockPage();
      if (document.body) buildLayer(); else document.addEventListener("DOMContentLoaded", buildLayer);
      post({ type: "config", config: config });
    },
    fit: fit,
    on: function (name, fn) { if (listeners[name] && typeof fn === "function") listeners[name].push(fn); },
    off: function (name, fn) { var list = listeners[name]; if (list) { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); } },
    vibrate: vibrate,
    menu: function () { post({ type: "menu" }); },
    exit: function () { post({ type: "exit" }); }
  });

  window.addEventListener("message", function (event) {
    if (!framed || event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== SHELL) return;
    if (data.type === "key" && CODE[data.code]) press(data.down ? "keydown" : "keyup", data.code);
    if (data.type === "pause" || data.type === "resume") {
      releaseAll();
      if (!emit(data.type, {})) tapKey("KeyP");
    }
  });
  window.addEventListener("blur", releaseAll);
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.repeat || !event.isTrusted) return;
    var now = Date.now();
    if (now - lastEscape < 600) post({ type: "menu" });
    lastEscape = now;
  }, true);
  post({ type: "ready", version: ${ARCADE_SDK_VERSION} });
})();`;

export const ARCADE_RUNTIME_SOURCE = RUNTIME_SOURCE;

const HEAD_TAG = /<head(?:\s[^>]*)?>/i;

/** True when generated code uses the SDK and therefore needs the runtime injected. */
export function usesArcadeSdk(...sources: Array<string | null | undefined>): boolean {
    return sources.some((source) => typeof source === "string" && source.includes("AndyArcade"));
}

/** Injects the runtime before any game script runs: right after <head>, or first in the document. Idempotent. */
export function injectArcadeRuntime(doc: string): string {
    if (doc.includes("data-andy-arcade-runtime")) return doc;
    const tag = `<script data-andy-arcade-runtime="v${ARCADE_SDK_VERSION}">${RUNTIME_SOURCE}</script>`;
    // `<head>` or `<head …>`, never `<header>`.
    if (HEAD_TAG.test(doc)) return doc.replace(HEAD_TAG, (head) => `${head}${tag}`);
    return `${tag}${doc}`;
}
