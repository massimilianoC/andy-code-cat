/**
 * Unit tests for repairArtifactsForVisibility().
 *
 * Validates the exact failure modes observed in the failing fixture
 * `debug/sample/artifact/not_visible_v1.json`:
 *   - artifact 1: AOS markers + AOS CSS, missing aos.js script, plus literal
 *                 `\n` inside @keyframes float
 *   - artifact 2: AOS markers + AOS CSS missing script, plus Phaser parent
 *                 pointing to a <canvas> id
 */

import { describe, it, expect } from "vitest";
import { repairArtifactsForVisibility } from "../artifactSafetyRepair";

describe("repairArtifactsForVisibility", () => {
    it("injects aos.js script when data-aos markers are present without it", () => {
        const html = `<!doctype html><html><head>
<link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css'>
</head><body>
<section data-aos='fade-up'><h1>Hello</h1></section>
</body></html>`;
        const r = repairArtifactsForVisibility({ html, css: "", js: "" });
        expect(r.html).toMatch(/aos\.js/);
        expect(r.repairs).toContain("aos-script-injected");
        expect(r.repairs).toContain("aos-init-injected");
        expect(r.js).toMatch(/AOS\.init\(\)/);
    });

    it("does not duplicate aos.js when already loaded", () => {
        const html = `<body><div data-aos='fade'></div>
<script src='https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.js'></script>
<script>AOS.init();</script></body>`;
        const r = repairArtifactsForVisibility({ html, css: "", js: "" });
        expect(r.repairs.includes("aos-script-injected")).toBe(false);
    });

    it("strips an orphan AOS stylesheet when no markers exist", () => {
        const html = `<head><link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/aos@2.3.4/dist/aos.css'></head><body><h1>Hi</h1></body>`;
        const r = repairArtifactsForVisibility({ html, css: "", js: "" });
        expect(r.repairs).toContain("aos-orphan-css-stripped");
        expect(r.html).not.toMatch(/aos@2\.3\.4\/dist\/aos\.css/);
    });

    it("unescapes literal \\n / \\t inside the CSS artifact", () => {
        const css = "@keyframes float {\\n  0% { transform: translateY(0); }\\n  100% { transform: translateY(-10px); }\\n}";
        const r = repairArtifactsForVisibility({ html: "<body></body>", css, js: "" });
        expect(r.repairs).toContain("css-literal-escapes-unescaped");
        expect(r.css).toMatch(/\n {2}0%/);
        expect(r.css).not.toMatch(/\\n/);
    });

    it("rewrites a <canvas id='X'> to <div id='X'> when Phaser parent points to X", () => {
        const html = `<body><canvas id='game-canvas'></canvas><script src='app.js'></script></body>`;
        const js = `const game = new Phaser.Game({ parent: 'game-canvas', width: 800, height: 600, scene: { create() {} } });`;
        const r = repairArtifactsForVisibility({ html, css: "", js });
        expect(r.repairs).toContain("phaser-parent-canvas-rewritten");
        expect(r.html).toMatch(/<div\b[^>]*id='game-canvas'[^>]*>/);
        expect(r.html).not.toMatch(/<canvas\b[^>]*id='game-canvas'/);
    });

    it("restores the Tailwind runtime and custom colour config for utility-only artifacts", () => {
        const html = `<html><head></head><body><main class='max-w-7xl flex gap-6 bg-ink text-cream font-display'>Hello</main></body></html>`;
        const css = `:root { --ink: #0A1628; --cream: #F5F1E8; }`;

        const r = repairArtifactsForVisibility({ html, css, js: "" });

        expect(r.repairs).toContain("tailwind-runtime-injected");
        expect(r.html).toMatch(/tailwind\.config=/);
        expect(r.html).toMatch(/"ink":"var\(--ink\)"/);
        expect(r.html).toMatch(/cdn\.tailwindcss\.com\/3\.4\.17/);
        expect(r.html.indexOf("cdn.tailwindcss.com")).toBeLessThan(r.html.indexOf("tailwind.config"));
    });

    it("does not inject Tailwind when compiled utility CSS is already supplied", () => {
        const html = `<body><div class='flex grid hidden gap-4'>Hello</div></body>`;
        const css = `.flex { display: flex; } .grid { display: grid; }`;

        const r = repairArtifactsForVisibility({ html, css, js: "" });

        expect(r.repairs.includes("tailwind-runtime-injected")).toBe(false);
    });

    it("leaves clean artifacts untouched (idempotent no-op)", () => {
        const html = `<body><h1>Hello</h1><script src='app.js'></script></body>`;
        const css = "body{margin:0}";
        const js = "console.log('ok')";
        const r = repairArtifactsForVisibility({ html, css, js });
        expect(r.repairs).toEqual([]);
        expect(r.html).toBe(html);
        expect(r.css).toBe(css);
        expect(r.js).toBe(js);
    });

    it("is idempotent when run twice on a repairable input", () => {
        const html = `<body><div data-aos='fade'></div></body>`;
        const first = repairArtifactsForVisibility({ html, css: "", js: "" });
        const second = repairArtifactsForVisibility({ html: first.html, css: first.css, js: first.js });
        expect(second.repairs).toEqual([]);
        expect(second.html).toBe(first.html);
        expect(second.js).toBe(first.js);
    });
});
