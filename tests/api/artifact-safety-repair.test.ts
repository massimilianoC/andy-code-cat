/**
 * Unit tests for repairArtifactsForVisibility().
 *
 * Run from repo root:
 *   npx tsx --test tests/api/artifact-safety-repair.test.ts
 *
 * Validates the exact failure modes observed in the failing fixture
 * `debug/sample/artifact/not_visible_v1.json`:
 *   - artifact 1: AOS markers + AOS CSS, missing aos.js script, plus literal
 *                 `\n` inside @keyframes float
 *   - artifact 2: AOS markers + AOS CSS missing script, plus Phaser parent
 *                 pointing to a <canvas> id
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairArtifactsForVisibility } from "../../apps/api/src/application/llm/artifactSafetyRepair";

describe("repairArtifactsForVisibility", () => {
    it("injects aos.js script when data-aos markers are present without it", () => {
        const html = `<!doctype html><html><head>
<link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/aos@2/dist/aos.css'>
</head><body>
<section data-aos='fade-up'><h1>Hello</h1></section>
</body></html>`;
        const r = repairArtifactsForVisibility({ html, css: "", js: "" });
        assert.match(r.html, /aos\.js/);
        assert.ok(r.repairs.includes("aos-script-injected"));
        assert.ok(r.repairs.includes("aos-init-injected"));
        assert.match(r.js, /AOS\.init\(\)/);
    });

    it("does not duplicate aos.js when already loaded", () => {
        const html = `<body><div data-aos='fade'></div>
<script src='https://cdn.jsdelivr.net/npm/aos@2/dist/aos.js'></script>
<script>AOS.init();</script></body>`;
        const r = repairArtifactsForVisibility({ html, css: "", js: "" });
        assert.equal(r.repairs.includes("aos-script-injected"), false);
    });

    it("strips an orphan AOS stylesheet when no markers exist", () => {
        const html = `<head><link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/aos@2/dist/aos.css'></head><body><h1>Hi</h1></body>`;
        const r = repairArtifactsForVisibility({ html, css: "", js: "" });
        assert.ok(r.repairs.includes("aos-orphan-css-stripped"));
        assert.doesNotMatch(r.html, /aos@2\/dist\/aos\.css/);
    });

    it("unescapes literal \\n / \\t inside the CSS artifact", () => {
        const css = "@keyframes float {\\n  0% { transform: translateY(0); }\\n  100% { transform: translateY(-10px); }\\n}";
        const r = repairArtifactsForVisibility({ html: "<body></body>", css, js: "" });
        assert.ok(r.repairs.includes("css-literal-escapes-unescaped"));
        assert.match(r.css, /\n {2}0%/);
        assert.doesNotMatch(r.css, /\\n/);
    });

    it("rewrites a <canvas id='X'> to <div id='X'> when Phaser parent points to X", () => {
        const html = `<body><canvas id='game-canvas'></canvas><script src='app.js'></script></body>`;
        const js = `const game = new Phaser.Game({ parent: 'game-canvas', width: 800, height: 600, scene: { create() {} } });`;
        const r = repairArtifactsForVisibility({ html, css: "", js });
        assert.ok(r.repairs.includes("phaser-parent-canvas-rewritten"));
        assert.match(r.html, /<div\b[^>]*id='game-canvas'[^>]*>/);
        assert.doesNotMatch(r.html, /<canvas\b[^>]*id='game-canvas'/);
    });

    it("leaves clean artifacts untouched (idempotent no-op)", () => {
        const html = `<body><h1>Hello</h1><script src='app.js'></script></body>`;
        const css = "body{margin:0}";
        const js = "console.log('ok')";
        const r = repairArtifactsForVisibility({ html, css, js });
        assert.deepEqual(r.repairs, []);
        assert.equal(r.html, html);
        assert.equal(r.css, css);
        assert.equal(r.js, js);
    });

    it("is idempotent when run twice on a repairable input", () => {
        const html = `<body><div data-aos='fade'></div></body>`;
        const first = repairArtifactsForVisibility({ html, css: "", js: "" });
        const second = repairArtifactsForVisibility({ html: first.html, css: first.css, js: first.js });
        assert.deepEqual(second.repairs, []);
        assert.equal(second.html, first.html);
        assert.equal(second.js, first.js);
    });
});
