/**
 * artifactSafetyRepair.ts
 *
 * Deterministic, content-preserving repairs applied to LLM-generated artifacts
 * BEFORE they are stored as a snapshot and rendered in the preview iframe.
 *
 * Rationale: prompt directives reduce — but never eliminate — recurrent failure
 * modes that produce a visually empty or broken page even when the JSON itself
 * parsed correctly. This module is a defense-in-depth layer that fixes the
 * highest-impact issues with safe, idempotent, no-LLM-roundtrip operations.
 *
 * Repairs implemented (each one is a no-op when the trigger pattern is absent):
 *
 *   R-1  AOS missing JS                — HTML uses `data-aos=""` attributes (and/or
 *                                         the AOS stylesheet) but never loads
 *                                         `aos.js`. Without the script, the AOS
 *                                         CSS rule `[data-aos]{opacity:0}` keeps
 *                                         the entire page invisible.
 *                                         Fix: inject the AOS <script> tag right
 *                                         before </body> and ensure `AOS.init()`
 *                                         is called from artifacts.js.
 *
 *   R-2  CSS literal escape sequences  — CSS containing the two-char sequence
 *                                         `\n` / `\t` / `\r` (because the model
 *                                         double-escaped a JSON string). These
 *                                         break `@keyframes` and selector parsing.
 *                                         Fix: convert literal escapes to real
 *                                         whitespace inside the CSS string.
 *
 *   R-3  Phaser parent points to canvas — `parent: 'game-canvas'` while the HTML
 *                                          declares `<canvas id='game-canvas'>`.
 *                                          Phaser then nests its canvas inside a
 *                                          <canvas>, which never renders.
 *                                          Fix: rename the offending parent id to
 *                                          a sibling div container if one exists,
 *                                          otherwise rewrite the canvas element to
 *                                          a div with the same id (Phaser will
 *                                          create its own canvas inside).
 *
 * Each repair returns a short tag in the `repairs` array so callers can log /
 * surface the action in execution logs without needing to diff the artifacts.
 */

export interface RepairableArtifacts {
    html: string;
    css: string;
    js: string;
}

export interface RepairResult extends RepairableArtifacts {
    repairs: string[];
}

const AOS_ATTR_RE = /\bdata-aos\s*=/i;
const AOS_SCRIPT_RE = /<script[^>]+aos[@\w./-]*\.js/i;
const AOS_CSS_LINK_RE = /<link[^>]+aos[@\w./-]*\.css/i;
const AOS_INIT_RE = /\bAOS\s*\.\s*init\s*\(/;
const AOS_CSS_HIDES_CONTENT_RE = /\[data-aos\][^{]*\{[^}]*opacity\s*:\s*0/i;

const AOS_SCRIPT_TAG =
    "<script src='https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js'></script>";

const PHASER_PARENT_RE = /parent\s*:\s*['"`]([A-Za-z][\w-]*)['"`]/g;

/**
 * Applies all deterministic repairs to a triple of artifacts.
 *
 * Idempotent: running the function twice yields the same result as running it
 * once. Every repair is a pure string transformation — no I/O, no LLM call.
 */
export function repairArtifactsForVisibility(input: RepairableArtifacts): RepairResult {
    const repairs: string[] = [];
    let { html, css, js } = input;

    // R-1: AOS pattern present but JS missing.
    if (html && AOS_ATTR_RE.test(html)) {
        const hasScript = AOS_SCRIPT_RE.test(html);
        const hasInit = AOS_INIT_RE.test(js) || AOS_INIT_RE.test(html);

        if (!hasScript) {
            html = injectScriptBeforeBodyClose(html, AOS_SCRIPT_TAG);
            repairs.push("aos-script-injected");
        }
        if (!hasInit) {
            const initLine = "if (typeof AOS !== 'undefined') { AOS.init(); }";
            js = js && js.trim().length > 0 ? `${js.trimEnd()}\n${initLine}\n` : `${initLine}\n`;
            repairs.push("aos-init-injected");
        }
    } else if (html && AOS_CSS_LINK_RE.test(html) && !AOS_SCRIPT_RE.test(html)) {
        // CSS linked but no markers and no JS — keep invisible-by-default rules
        // out of the page by stripping the orphan stylesheet link.
        html = html.replace(/\s*<link[^>]+aos[@\w./-]*\.css[^>]*>\s*/gi, "\n");
        repairs.push("aos-orphan-css-stripped");
    }

    // R-1b: AOS-style hide-by-default rules present in the inline CSS without any
    // matching JS. Strip the offending opacity:0 declaration so content is visible.
    if (css && AOS_CSS_HIDES_CONTENT_RE.test(css) && !AOS_SCRIPT_RE.test(html) && !AOS_INIT_RE.test(js)) {
        css = css.replace(
            /(\[data-aos\][^{]*\{[^}]*?)opacity\s*:\s*0\s*;?/gi,
            "$1/* repaired: opacity:0 removed (no AOS JS) */",
        );
        repairs.push("aos-css-opacity-neutralized");
    }

    // R-2: Literal \n / \t inside CSS — usually a JSON over-escape leak that
    // breaks @keyframes and selectors. Only touch the CSS artifact: the HTML
    // and JS tolerate these sequences inside string literals.
    if (css) {
        const before = css;
        css = css.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
        if (css !== before) repairs.push("css-literal-escapes-unescaped");
    }

    // R-3: Phaser/engine parent referencing a <canvas id="..."> in the HTML.
    if (js && /\bnew\s+Phaser\.Game\b/.test(js)) {
        const offending = collectPhaserParentMisuses(js, html);
        if (offending.length > 0) {
            for (const id of offending) {
                // Rewrite the offending <canvas id="X"> to <div id="X">.
                // Phaser will create its own <canvas> inside the div; this is the
                // safest non-destructive repair when no sibling div exists.
                html = html.replace(
                    new RegExp(`<canvas\\b([^>]*?\\bid=["']${escapeRegex(id)}["'][^>]*)>([\\s\\S]*?)</canvas>`, "g"),
                    (_m, attrs, inner) => `<div${attrs}>${inner}</div>`,
                );
            }
            repairs.push("phaser-parent-canvas-rewritten");
        }
    }

    return { html, css, js, repairs };
}

// ── internal helpers ────────────────────────────────────────────────────────

function injectScriptBeforeBodyClose(html: string, scriptTag: string): string {
    if (/<\/body>/i.test(html)) {
        return html.replace(/<\/body>/i, `  ${scriptTag}\n</body>`);
    }
    // No </body> — append at the end so the script still loads.
    return `${html}\n${scriptTag}\n`;
}

function collectPhaserParentMisuses(js: string, html: string): string[] {
    const ids: string[] = [];
    let match: RegExpExecArray | null;
    PHASER_PARENT_RE.lastIndex = 0;
    while ((match = PHASER_PARENT_RE.exec(js)) !== null) {
        const id = match[1];
        if (!id) continue;
        const canvasWithId = new RegExp(`<canvas\\b[^>]*\\bid=["']${escapeRegex(id)}["']`, "i");
        if (canvasWithId.test(html)) {
            ids.push(id);
        }
    }
    return ids;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
