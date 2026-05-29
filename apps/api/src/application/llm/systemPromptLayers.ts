import { PRESET_MAP, type ProjectPreset } from "../../domain/entities/ProjectPreset";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { AssetEnrichmentTrace } from "../../domain/entities/AssetEnrichmentTrace";
import { FORMAT_HINT_RULES } from "../prompting/formatHintRules";
import { env } from "../../config";

/** Default per-asset fragment budget. Tuned so 3 assets fit comfortably under the 50 KB Layer D max. */
const ASSET_FRAGMENT_DEFAULT_BUDGET = 8_000;

/**
 * Render the per-asset Layer D fragment.
 *
 * This is the SINGLE source of truth for how an enriched asset is serialised into
 * Layer D text. It is deterministic — same trace in → same fragment out — and
 * intentionally has no global state. The output is cached on the trace itself
 * (`AssetEnrichmentTrace.renderedFragment`) by `buildEnrichmentTrace()` so that
 * every consumer (VibePrefill brief pass, OptimizePrompt, God Mode generation)
 * uses the exact same text without recomputing.
 *
 * Output format:
 *   ---
 *   Asset: <distilledTitle>
 *   Type: <assetKind>
 *   Summary: <distilledSummary>
 *   ...brief / palette / visual / signals / structured data...
 *   ---
 */
export function renderAssetLayerDFragment(
    trace: AssetEnrichmentTrace,
    opts?: { maxChars?: number },
): string {
    const maxChars = opts?.maxChars ?? ASSET_FRAGMENT_DEFAULT_BUDGET;
    const lines: string[] = [
        `Asset: ${trace.distilledTitle}`,
        `Type: ${trace.assetKind}`,
    ];

    if (trace.distilledSummary) {
        lines.push(`Summary: ${trace.distilledSummary}`);
    }

    const brief = trace.documentBrief;
    if (brief) {
        if (brief.purposeSentence) lines.push(`Purpose: ${brief.purposeSentence}`);
        if (brief.contentSummary) lines.push(`Content: ${brief.contentSummary}`);
        if (brief.detectedBrandName) lines.push(`Brand: ${brief.detectedBrandName}`);
        if (brief.toneLabel) lines.push(`Tone: ${brief.toneLabel}`);
        if (brief.targetAudience) lines.push(`Audience: ${brief.targetAudience}`);
        if (brief.mainArgumentOrValue) lines.push(`Main value: ${brief.mainArgumentOrValue}`);
        if (brief.keyMessages.length > 0) {
            lines.push("Key messages:");
            brief.keyMessages.forEach((m) => lines.push(`- ${m}`));
        }
        if (brief.ctaText) lines.push(`Call to action: ${brief.ctaText}`);
    } else if (trace.textLayer?.extractedTextSnippet) {
        lines.push(`Text preview (analysis pending): ${trace.textLayer.extractedTextSnippet.slice(0, 1500)}`);
    }

    const palette = trace.colorPalette;
    const visual = trace.visualAnalysis;
    const signals = trace.designSignals;
    if (palette && palette.dominantNames.length > 0) {
        lines.push(`Color palette: ${palette.dominantNames.join(", ")}`);
    }
    if (visual?.moodLabel) lines.push(`Mood: ${visual.moodLabel}`);
    if (visual?.sceneDescription) lines.push(`Scene: ${visual.sceneDescription}`);
    if (signals?.suggestedWebUse && signals.suggestedWebUse.length > 0) {
        lines.push(`Design signals: ${signals.suggestedWebUse.join(", ")}`);
    }

    if (trace.distilledTags.length > 0) {
        lines.push(`Tags: ${trace.distilledTags.join(", ")}`);
    }

    // Structured data: spreadsheets and presentations.
    // Truncation is per-fragment using its own budget — deterministic, independent of
    // sibling assets present in the same Layer D render.
    const sd = trace.structuredData;
    if (sd?.sheets && sd.sheets.length > 0) {
        lines.push(`Structured data (${sd.sheets.length} sheet${sd.sheets.length > 1 ? "s" : ""}):`);
        for (const sheet of sd.sheets) {
            const headerLine = `Sheet "${sheet.name}" — ${sheet.rowCount} rows — columns: ${sheet.columnHeaders
                .map((h, i) => `${h}[${sheet.columnTypes[i] ?? "text"}]`)
                .join(", ")}`;
            lines.push(headerLine);
            const current = lines.join("\n").length;
            const csvBudget = Math.max(200, maxChars - current - 80);
            const csvTruncated = sheet.csvBlock.length > csvBudget
                ? `${sheet.csvBlock.slice(0, csvBudget)}\n...(truncated)`
                : sheet.csvBlock;
            lines.push("```csv");
            lines.push(csvTruncated);
            lines.push("```");
            if (lines.join("\n").length >= maxChars) break;
        }
    } else if (sd?.slides && sd.slides.length > 0) {
        lines.push(`Presentation (${sd.slides.length} slides):`);
        for (const slide of sd.slides.slice(0, 20)) {
            const title = slide.title ?? "(untitled)";
            const body = slide.body.slice(0, 200);
            lines.push(`  Slide ${slide.index}: ${title}${body ? ` — ${body}` : ""}`);
            if (lines.join("\n").length >= maxChars) break;
        }
    }

    return `---\n${lines.join("\n")}\n---`;
}

/**
 * TemplateResolution — the output of Layer Φ (VibeClassify) or an explicit user selection.
 * Used by Layer T to decide what to inject between Layer B and Layer C.
 */
export interface TemplateResolution {
    /** Preset id from the PRESET_MAP (takes priority over everything). */
    presetId?: string | null;
    /** User-template id from the user_templates collection. */
    userTemplateId?: string | null;
    /** Canonical format hint key — fallback when no full preset/template matched. */
    formatHint?: import("@andy-code-cat/contracts").FormatHint | null;
    confidence: number;
    reasoning: string;
    source: "layer_phi" | "user_explicit" | "zero_effort_form";
}

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
        "- All JavaScript MUST go exclusively in artifacts.js. Never embed script logic inline in the HTML artifact — not in <script> tags, not as event attributes. In the HTML, reference JS only with: <script src=\"script.js\"></script>.",
        "- For vanilla (non-Tailwind) CSS, reference the stylesheet exactly once in <head> with: <link rel=\"stylesheet\" href=\"style.css\">. The platform serves artifacts.css as style.css and artifacts.js as script.js — NEVER use other filenames (e.g. app.css, app.js, main.js) or they will 404 in publication.",
        "",
        "HTML compactness rules (mandatory):",
        "- Target HTML under 30 KB (approx 30 000 chars). Aim for the minimum markup that achieves the design.",
        "- Use 2-space indentation — never 4-space or tabs.",
        "- Do NOT add HTML comments in the output.",
        "- Never duplicate a structural pattern — extract repeating markup into reusable CSS classes instead.",
        "- Avoid inline style= attributes; put all styling in artifacts.css.",
        "- Do not repeat identical class lists across sibling elements — factor them into a shared parent or CSS rule.",
        "",
        "Visibility-without-JS rules (NON-EDITABLE platform rules — they override any project/model/governance template; preview iframe runs allow-scripts only and external assets may fail):",
        "- All primary content (text, images, sections) MUST be visible on initial render with CSS alone, before any JS executes.",
        "- Never set `opacity:0`, `visibility:hidden`, `height:0`, `display:none`, or off-screen `transform` as the DEFAULT state of content unless a pure-CSS rule restores it without JS (e.g. a `@keyframes` animation that ENDS in the visible state and is applied directly in CSS).",
        "- JavaScript may ENHANCE (animate, reveal, interact) but must never GATE the appearance of static content. If the script never runs, every section, card, image and text block must still be fully visible.",
        "- FORBIDDEN unless you ALSO ship a CSS-only visible fallback AND load every required plugin: scroll-reveal libraries (AOS, WOW.js, ScrollReveal), and Alpine directives that hide content (`x-show`, `x-collapse`, `x-cloak`, `x-transition`).",
        "- Specifically: do NOT use Alpine `x-collapse` or `x-cloak` unless you load the matching plugin via CDN (e.g. `@alpinejs/collapse`) AND the content is visible by default without it. Prefer the native HTML `<details>`/`<summary>` element for collapsible sections — it needs no JS and is always visible.",
        "- Reveal-on-scroll pattern that is SAFE: start elements visible, then add an OPTIONAL entrance animation via `@keyframes` in CSS only. Do not couple visibility to a JS-added class without a CSS fallback.",
        "- The HTML must reference exactly one external script: `<script src='script.js'></script>` placed immediately before `</body>`. Do not add `defer`, `async`, `type='module'`, or inline `<script>` blocks.",
        "- The iframe sandbox is `allow-scripts` only: no `window.parent`/`top` access, no top-level navigation, no `localStorage` writes from the page logic that affect the parent. Persist game state to memory only.",
        "",
        "Canvas / game-engine container rules (mandatory when using Phaser, Three.js, A-Frame, p5.js, etc.):",
        "- The mounting parent MUST be a `<div>` (or `<a-scene>` for A-Frame) with a non-empty id, explicit width/height in CSS, and visible by default.",
        "- NEVER pass the id of a `<canvas>` element as the engine `parent` — engines create their own canvas inside the parent div.",
        "- For Phaser: `new Phaser.Game({ parent: 'game-root', ... })` where `<div id='game-root'></div>` exists in the HTML with sized CSS.",
        "- Loaders take URL strings only: `this.load.image('key', '<url>')`. Never pass a function call (e.g. a generated dataURL helper) as the URL argument; if you need a procedural texture, generate it inside `create()` via `this.textures.generate(...)` or `Graphics.generateTexture(...)`.",
        "- Provide an HTML `<noscript>` fallback inside the game container describing the experience so the page is never visually empty when JS is disabled or fails to load.",
    ].join("\n");
}

/**
 * Layer B — Preset-specific output format constraints.
 * Injected ONLY when the project has a presetId.
 * Contains the preset's systemPromptModule (structural format rules) and optional
 * cssConstraints (verbatim CSS required in the generated output).
 */
export function buildPresetLayerFromPreset(preset?: Pick<ProjectPreset, "outputSpec"> | null): string {
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

export function buildPresetLayer(presetId?: string | null): string {
    if (!presetId) return "";
    const preset = PRESET_MAP.get(presetId);
    return buildPresetLayerFromPreset(preset);
}

/**
 * Layer D — Document context from enriched project assets.
 * Owned by: Agente context/embed (see PROMPTING_PIPELINE_AGENT_GUARDRAILS.md §4.1).
 * Returns "" when no enriched assets are available — the layer is then omitted by composeSystemPrompt.
 * Contains only content (briefs, summaries, tags) — zero technical instructions.
 */
export function buildProjectKnowledgeLayer(
    assets: ProjectAsset[],
    opts?: { maxChars?: number; maxAssets?: number; includeUnenrichedAssets?: boolean },
): string {
    if (!env.enrichmentInjectLayerD) return "";

    const maxChars = opts?.maxChars ?? env.ENRICHMENT_LAYER_D_MAX_CHARS;
    const maxAssets = opts?.maxAssets ?? env.ENRICHMENT_LAYER_D_MAX_ASSETS;

    // Filter: ready traces, OR pending traces that already have textLayer/structuredData
    // (the pipeline saves these immediately after parsing, before the LLM brief is done).
    const ready = assets.filter(a => {
        const trace = a.enrichmentTrace;
        if (!trace && !opts?.includeUnenrichedAssets) return false;
        if (trace) {
            const status = trace.provenance.enrichmentStatus;
            const hasContent =
                status === "ready" ||
                (status === "pending" && (trace.textLayer !== null || trace.structuredData !== null));
            if (!hasContent) return false;
        }
        if (a.useInProject === false && !a.styleRole && !opts?.includeUnenrichedAssets) return false;
        return true;
    });

    // Rank: useInProject=true first, then styleRole=inspiration, material, then createdAt desc
    const roleOrder: Record<string, number> = { inspiration: 1, material: 2, reference: 3 };
    const ranked = [...ready].sort((a, b) => {
        if (a.useInProject && !b.useInProject) return -1;
        if (!a.useInProject && b.useInProject) return 1;
        const ra = roleOrder[a.styleRole ?? ""] ?? 9;
        const rb = roleOrder[b.styleRole ?? ""] ?? 9;
        if (ra !== rb) return ra - rb;
        return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
    });

    const selected = ranked.slice(0, maxAssets);
    if (selected.length === 0) return "";

    const blocks: string[] = [];
    let totalChars = 0;

    const header = "## LAYER D — DOCUMENT CONTEXT\n\nThe following materials were provided by the user as reference for this project.\nUse them to inform the content, copy, brand voice, and visual direction of the output.\nDo not reproduce raw extracted text verbatim — synthesize it into the design.\n\n### Reference materials";
    totalChars += header.length + 2;

    for (const asset of selected) {
        const trace = asset.enrichmentTrace;
        // Prefer the fragment that was pre-rendered during enrichment (deterministic,
        // single-pass). Fall back to on-the-fly rendering for legacy traces that
        // predate the cache field.
        const block = trace?.renderedFragment ?? (trace ? renderAssetLayerDFragment(trace) : renderUnenrichedAssetLayerDFragment(asset));
        if (totalChars + block.length + 2 > maxChars) break;
        blocks.push(block);
        totalChars += block.length + 2;
    }

    if (blocks.length === 0) return "";

    return `${header}\n\n${blocks.join("\n\n")}`;
}

function renderUnenrichedAssetLayerDFragment(asset: ProjectAsset): string {
    const label = asset.label || asset.originalName;
    return [
        `- ${label}`,
        `  - Type: ${asset.mimeType}`,
        asset.descriptionText ? `  - Notes: ${asset.descriptionText}` : undefined,
        asset.styleRole ? `  - Intended role: ${asset.styleRole}` : undefined,
        "  - Status: uploaded reference; detailed extraction is still pending.",
    ].filter((line): line is string => Boolean(line)).join("\n");
}

/**
 * Layer T — Template resolution slot.
 * Injected between Layer B (preset constraints) and Layer C (style context)
 * ONLY when a TemplateResolution is provided.
 *
 * Priority of resolution:
 *   1. presetId  → full preset constraints already handled by Layer B; Layer T is empty.
 *   2. userTemplateId → the caller must supply the prepromptBlock separately.
 *   3. formatHint → canonical format rules from FORMAT_HINT_RULES.
 *
 * Returns "" when resolution is null/undefined — fully backward-compatible.
 *
 * Sentinels allow programmatic audit:
 *   <!-- LAYER_T_START source=<source> confidence=<n> -->
 *   ...content...
 *   <!-- LAYER_T_END -->
 */
export function buildLayerT(
    resolution: TemplateResolution | null | undefined,
    opts?: {
        /** Pre-fetched prepromptBlock for the resolved userTemplateId, if any. */
        userTemplatePreprompt?: string;
    },
): string {
    if (!resolution) return "";

    // presetId is already covered by Layer B — Layer T adds nothing.
    if (resolution.presetId) return "";

    let content = "";

    if (resolution.userTemplateId && opts?.userTemplatePreprompt) {
        content = opts.userTemplatePreprompt;
    } else if (resolution.formatHint) {
        const rule = FORMAT_HINT_RULES[resolution.formatHint];
        if (rule) {
            content = [
                `## LAYER T — FORMAT GUIDANCE (${resolution.formatHint})`,
                rule.canonicalRules,
            ].join("\n\n");
        }
    }

    if (!content) return "";

    return [
        `<!-- LAYER_T_START source=${resolution.source} confidence=${resolution.confidence.toFixed(2)} -->`,
        content,
        `<!-- LAYER_T_END -->`,
    ].join("\n");
}
