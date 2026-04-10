import { PRESET_MAP } from "../../domain/entities/ProjectPreset";

/**
 * Layer A — Base architectural constraints common to ALL Layer 1 output.
 * Always injected as the first element of the system message.
 * Static, ~200 tokens.
 */
export function buildBaseConstraintsLayer(): string {
    return [
        "## LAYER A — BASE ARCHITECTURAL CONSTRAINTS",
        "You are a static web page generator for the Andy Code Cat platform.",
        "Your output must always be a complete, self-contained page that can be served by nginx without modifications.",
        "",
        "Non-negotiable rules for ALL output types:",
        "- Produce exactly 1 HTML file + 1 CSS file + 1 JS file — standalone and executable without a build step.",
        "- All external dependencies (libraries, fonts, icons) via CDN only (<script src>, <link rel=stylesheet>) — never import via npm or require().",
        "- Mobile-first responsive design: optimize for 375px (mobile), 768px (tablet), 1280px (desktop).",
        "- Semantic HTML5: use <header>, <nav>, <main>, <section>, <article>, <footer> where semantically appropriate.",
        "- Accessibility baseline: meaningful alt text on images, sufficient color contrast (WCAG AA), keyboard-navigable focus.",
        "- Performance: no render-blocking resources above the fold, use loading=\"lazy\" on below-the-fold images.",
        "- No JavaScript framework (React, Vue, Angular, Svelte) — vanilla JS only.",
        "- CSS strategy: choose Tailwind CDN OR vanilla CSS — never both in the same output.",
        "- artifacts.css and artifacts.js must be plain strings without <style> or <script> wrappers.",
    ].join("\n");
}

/**
 * Layer B — Preset-specific output format constraints.
 * Injected ONLY when the project has a presetId.
 * Contains the preset's systemPromptModule (structural format rules) and optional
 * cssConstraints (verbatim CSS required in the generated output).
 */
export function buildPresetLayer(presetId?: string | null): string {
    if (!presetId) return "";
    const preset = PRESET_MAP.get(presetId);
    if (!preset) return "";

    const parts: string[] = [preset.outputSpec.systemPromptModule];

    if (preset.outputSpec.cssConstraints) {
        parts.push(
            "## REQUIRED CSS CONSTRAINTS\n" +
            "Inject the following CSS rules verbatim into artifacts.css:\n" +
            "```css\n" + preset.outputSpec.cssConstraints + "\n```"
        );
    }

    return parts.join("\n\n");
}
