/**
 * The Arcade runtime: a small platform-owned script injected into a game's sandboxed document
 * (docs/specs/ARCADE_MODE_MVP.md §3). It is the only bridge between a generated game and the
 * console shell:
 *
 * - `window.AndyArcade.submitScore(n)` posts the score to the shell, which stores it;
 * - key messages from the shell (gamepad input) become keyboard events inside the game, so a game
 *   written for WASD/arrows plays with any controller without knowing one exists;
 * - a double Escape asks the shell to go back to the library.
 *
 * The game runs in an iframe sandboxed with `allow-scripts` only: an opaque origin, no access to
 * the app's storage or tokens. Messages are matched on `source`, never on origin.
 */

/** Keys the shell may press inside the game: exactly the ARCADE PLAYABILITY contract. */
export const ARCADE_KEY_CODES = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter", "ShiftLeft", "KeyK", "KeyP", "Escape"] as const;
export type ArcadeKeyCode = (typeof ARCADE_KEY_CODES)[number];

export const ARCADE_SHELL_SOURCE = "andy-arcade-shell";
export const ARCADE_GAME_SOURCE = "andy-arcade";

export type ArcadeGameMessage =
    | { source: typeof ARCADE_GAME_SOURCE; type: "ready" }
    | { source: typeof ARCADE_GAME_SOURCE; type: "score"; score: number }
    | { source: typeof ARCADE_GAME_SOURCE; type: "exit" };

export function parseArcadeGameMessage(data: unknown): ArcadeGameMessage | null {
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message.source !== ARCADE_GAME_SOURCE) return null;
    if (message.type === "ready" || message.type === "exit") return { source: ARCADE_GAME_SOURCE, type: message.type };
    if (message.type === "score" && typeof message.score === "number" && Number.isInteger(message.score) && message.score >= 0 && message.score <= 1_000_000_000) {
        return { source: ARCADE_GAME_SOURCE, type: "score", score: message.score };
    }
    return null;
}

const RUNTIME_SOURCE = `(function () {
  if (window.AndyArcade) return;
  var KEY = { ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Space: " ", Enter: "Enter", ShiftLeft: "Shift", KeyK: "k", KeyP: "p", Escape: "Escape" };
  var CODE = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, Enter: 13, ShiftLeft: 16, KeyK: 75, KeyP: 80, Escape: 27 };
  var lastEscape = 0;
  function post(message) {
    message.source = "${ARCADE_GAME_SOURCE}";
    try { window.parent.postMessage(message, "*"); } catch (e) {}
  }
  function press(type, code) {
    var event = new KeyboardEvent(type, { key: KEY[code], code: code, bubbles: true, cancelable: true });
    try {
      Object.defineProperty(event, "keyCode", { get: function () { return CODE[code]; } });
      Object.defineProperty(event, "which", { get: function () { return CODE[code]; } });
    } catch (e) {}
    (document.activeElement || document.body || document).dispatchEvent(event);
  }
  window.AndyArcade = Object.freeze({
    version: 1,
    submitScore: function (value) {
      var score = Math.floor(Number(value));
      if (!isFinite(score) || score < 0) return;
      post({ type: "score", score: Math.min(score, 1000000000) });
    },
    exit: function () { post({ type: "exit" }); }
  });
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== "${ARCADE_SHELL_SOURCE}" || data.type !== "key" || !CODE[data.code]) return;
    press(data.down ? "keydown" : "keyup", data.code);
  });
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.repeat) return;
    var now = Date.now();
    if (now - lastEscape < 600) post({ type: "exit" });
    lastEscape = now;
  }, true);
  post({ type: "ready" });
})();`;

/** Injects the runtime before any game script runs: right after <head>, or first in the document. */
export function injectArcadeRuntime(doc: string): string {
    const tag = `<script data-andy-arcade-runtime="v1">${RUNTIME_SOURCE}</script>`;
    if (doc.includes("data-andy-arcade-runtime")) return doc;
    if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (head) => `${head}${tag}`);
    return `${tag}${doc}`;
}
