import { PRESET_MAP, type ProjectPreset } from "../../domain/entities/ProjectPreset";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { AssetEnrichmentTrace } from "../../domain/entities/AssetEnrichmentTrace";
import { FORMAT_HINT_RULES } from "../prompting/formatHintRules";
import { env } from "../../config";
import type { ResolvedBrandContext } from "../use-cases/ResolveBrandContext";
import type { BrandAssetScope, BrandAssetPolicy } from "../../domain/entities/BrandAsset";

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
    if (sd?.dataset) {
        lines.push(`Structured dataset (${sd.dataset.sourceFormat}):`);
        lines.push(`Global facts: ${sd.dataset.facts.rowCount} rows, ${sd.dataset.facts.columnCount} columns, ${sd.dataset.facts.numericColumnCount} numeric, ${sd.dataset.facts.categoricalColumnCount} categorical, ${sd.dataset.facts.dateColumnCount} date`);
        for (const table of sd.dataset.tables.slice(0, 2)) {
            const visibleHeaders = table.sampleHeaders.slice(0, 8).join(", ");
            const measureHints = table.columns
                .filter((column) => column.valueType === "number")
                .slice(0, 5)
                .map((column) => column.label || column.key)
                .join(", ");
            const dimensionHints = table.columns
                .filter((column) => column.valueType === "string" || column.valueType === "date" || column.valueType === "boolean")
                .slice(0, 5)
                .map((column) => column.label || column.key)
                .join(", ");

            lines.push(`Table "${table.name}" — ${table.rowCount} rows — ${table.columnCount} columns`);
            if (visibleHeaders) lines.push(`Headers: ${visibleHeaders}`);
            if (measureHints) lines.push(`Measures: ${measureHints}`);
            if (dimensionHints) lines.push(`Dimensions: ${dimensionHints}`);
            if (table.sampleRows.length > 0) {
                const previewRows = table.sampleRows
                    .slice(0, 3)
                    .map((row) => row.slice(0, 8).join(" | "))
                    .join("\n");
                lines.push("Sample rows:");
                lines.push(previewRows);
            }
            if (lines.join("\n").length >= maxChars) break;
        }
        if (sd.dataset.limitations && sd.dataset.limitations.length > 0) {
            lines.push(`Limitations: ${sd.dataset.limitations.slice(0, 3).join(" | ")}`);
        }
        // Inject llmAppendix inline so the generator sees analytical signals
        // in the same per-asset block, not buried in a global appendix.
        const app = sd.dataset.llmAppendix;
        if (app) {
            if (app.analyticalSummary) {
                lines.push(`Analytical summary: ${app.analyticalSummary}`);
            }
            if (app.keySignals.length > 0) {
                lines.push(`Key signals: ${app.keySignals.slice(0, 6).join(" | ")}`);
            }
            if (app.suggestedQuestions.length > 0) {
                lines.push("Questions this dataset can answer for the page:");
                app.suggestedQuestions.slice(0, 5).forEach((q) => lines.push(`- ${q}`));
            }
            if (app.cautions.length > 0) {
                lines.push(`Grounding cautions: ${app.cautions.slice(0, 3).join(" | ")}`);
            }
        }
    } else if (sd?.sheets && sd.sheets.length > 0) {
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

const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    it: "Italian",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    nl: "Dutch",
    pl: "Polish",
    ru: "Russian",
    zh: "Chinese",
    ja: "Japanese",
    ko: "Korean",
    ar: "Arabic",
    tr: "Turkish",
    sv: "Swedish",
    da: "Danish",
    fi: "Finnish",
    nb: "Norwegian",
    cs: "Czech",
    ro: "Romanian",
    hu: "Hungarian",
    el: "Greek",
    he: "Hebrew",
    uk: "Ukrainian",
    vi: "Vietnamese",
    th: "Thai",
};

/**
 * Layer L — Output language directive.
 * Injected immediately after Layer A (base constraints) and before Layer B (preset).
 * Only present when an explicit output language is resolved (never injected in God Mode).
 */
export function buildLanguageLayer(bcp47: string): string {
    const code = bcp47.toLowerCase().split("-")[0]!;
    const name = LANGUAGE_NAMES[code] ?? bcp47;
    return [
        "## LAYER L — OUTPUT LANGUAGE",
        "",
        `Produce all user-visible copy, labels, navigation, headings, body text,`,
        `calls-to-action, and placeholder content in: **${name}** (${code}).`,
        "",
        "This directive applies to all text in the generated artifact.",
        "It overrides any language implied by template names or style labels.",
    ].join("\n");
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
    opts?: { maxChars?: number; maxAssets?: number; includeUnenrichedAssets?: boolean; includeStructuredDataAppendix?: boolean },
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
        // Additionally: if the cached fragment exists but the dataset has a llmAppendix
        // that is NOT yet reflected in it (legacy traces built before Fix A), re-render
        // on-the-fly so analytical signals are always included without a DB migration.
        let block: string;
        if (!trace) {
            block = renderUnenrichedAssetLayerDFragment(asset);
        } else if (
            trace.renderedFragment &&
            !(trace.structuredData?.dataset?.llmAppendix && !trace.renderedFragment.includes("Analytical summary:"))
        ) {
            block = trace.renderedFragment;
        } else {
            // Re-render: either no cached fragment, or cached fragment is pre-Fix-A
            block = renderAssetLayerDFragment(trace);
        }
        if (totalChars + block.length + 2 > maxChars) break;
        blocks.push(block);
        totalChars += block.length + 2;
    }

    if (blocks.length === 0) return "";

    let content = `${header}\n\n${blocks.join("\n\n")}`;

    if (opts?.includeStructuredDataAppendix !== false) {
        const appendix = buildStructuredDataLayerDAppendix(selected, {
            maxChars: Math.max(0, maxChars - content.length - 2),
        });
        if (appendix) {
            content = `${content}\n\n${appendix}`;
        }
    }

    // Cross-asset correlation: only meaningful with 2+ enriched assets
    if (selected.length >= 2) {
        const correlation = buildCrossAssetCorrelationBlock(selected, {
            maxChars: Math.max(0, maxChars - content.length - 2),
        });
        if (correlation) {
            content = `${content}\n\n${correlation}`;
        }
    }

    return content;
}

/**
 * Cross-asset correlation block — injected at the end of Layer D when 2+ enriched assets
 * are present. Derives shared signals, thematic bridges, and tensions between assets so
 * the generator can produce output that is coherent across all reference materials rather
 * than treating each asset in isolation.
 *
 * Purely deterministic: no LLM call, synthesised from already-computed traces.
 */
function buildCrossAssetCorrelationBlock(
    assets: ProjectAsset[],
    opts?: { maxChars?: number },
): string {
    const maxChars = opts?.maxChars ?? 3_000;
    if (maxChars < 200) return "";

    const lines: string[] = ["### Cross-asset correlation"];

    // ── Shared audience ──────────────────────────────────────────────────────
    const audiences = assets
        .map((a) => a.enrichmentTrace?.documentBrief?.targetAudience)
        .filter((a): a is string => !!a);
    if (audiences.length >= 2) {
        lines.push(`- Shared audience context: ${[...new Set(audiences)].join(" | ")}`);
    }

    // ── Shared tone signals ───────────────────────────────────────────────────
    const tones = assets
        .map((a) => a.enrichmentTrace?.documentBrief?.toneLabel)
        .filter((t): t is string => !!t);
    if (tones.length >= 2) {
        lines.push(`- Tone convergence: ${[...new Set(tones)].join(" | ")}`);
    }

    // ── Shared tags across assets ─────────────────────────────────────────────
    const tagSets = assets.map((a) => new Set<string>(a.enrichmentTrace?.distilledTags ?? []));
    if (tagSets.length >= 2) {
        const [first, ...rest] = tagSets as [Set<string>, ...Set<string>[]];
        const intersection = [...first].filter((tag) => rest.every((s) => s.has(tag)));
        if (intersection.length > 0) {
            lines.push(`- Tags shared across all assets: ${intersection.slice(0, 8).join(", ")}`);
        }
    }

    // ── Dataset × copy bridge ─────────────────────────────────────────────────
    const datasetAssets = assets.filter((a) => a.enrichmentTrace?.structuredData?.dataset);
    const copyAssets = assets.filter((a) => a.enrichmentTrace?.documentBrief && !a.enrichmentTrace?.structuredData?.dataset);
    if (datasetAssets.length > 0 && copyAssets.length > 0) {
        const datasetNames = datasetAssets.map((a) => a.enrichmentTrace!.distilledTitle).join(", ");
        const copyNames = copyAssets.map((a) => a.enrichmentTrace!.distilledTitle).join(", ");
        lines.push(`- Dataset × copy bridge: structured data from [${datasetNames}] should be grounded in the narrative voice and messaging from [${copyNames}].`);
        lines.push("  Translate dataset signals into the tone and vocabulary present in the copy assets, not generic technical language.");
    }

    // ── Cross-dataset signal pool (when multiple datasets) ────────────────────
    if (datasetAssets.length >= 2) {
        const allSignals = datasetAssets.flatMap((a) =>
            a.enrichmentTrace?.structuredData?.dataset?.llmAppendix?.keySignals ?? [],
        );
        if (allSignals.length > 0) {
            lines.push(`- Combined dataset signals: ${[...new Set(allSignals)].slice(0, 8).join(" | ")}`);
        }
        const allQuestions = datasetAssets.flatMap((a) =>
            a.enrichmentTrace?.structuredData?.dataset?.llmAppendix?.suggestedQuestions ?? [],
        );
        if (allQuestions.length > 0) {
            lines.push("- Cross-dataset questions the page should synthesise:");
            [...new Set(allQuestions)].slice(0, 5).forEach((q) => lines.push(`  - ${q}`));
        }
    }

    // ── Key messages pool across all assets ───────────────────────────────────
    const allKeyMessages = assets.flatMap((a) => a.enrichmentTrace?.documentBrief?.keyMessages ?? []);
    if (allKeyMessages.length > 0) {
        const deduped = [...new Set(allKeyMessages)].slice(0, 6);
        lines.push(`- Top messages to synthesise into the output: ${deduped.join(" | ")}`);
    }

    if (lines.length <= 1) return ""; // only heading, nothing useful

    const result = lines.join("\n");
    return result.length > maxChars ? `${result.slice(0, maxChars - 15)}\n...(truncated)` : result;
}

export function buildGroundedDataContextLayer(
    assets: ProjectAsset[],
    opts?: { maxChars?: number; maxAssets?: number },
): string {
    const maxChars = opts?.maxChars ?? 8_000;
    const maxAssets = opts?.maxAssets ?? 4;

    const datasetAssets = assets
        .filter((asset) => asset.enrichmentTrace?.structuredData?.dataset)
        .slice(0, maxAssets);

    if (datasetAssets.length === 0) return "";

    const lines: string[] = [
        "## LAYER X — GROUNDED DATA CONTEXT",
        "The following structured datasets are available for this project.",
        "Use them to shape a data dashboard, but never invent numerical facts that are not explicitly present below.",
        "Prefer KPI cards, filters, chart areas, table exploration, and insight sections that align with these deterministic dataset facts.",
        "",
        "### Dataset runtime summary",
    ];

    for (const asset of datasetAssets) {
        const dataset = asset.enrichmentTrace?.structuredData?.dataset;
        if (!dataset) continue;
        lines.push(`- Dataset: ${asset.originalName}`);
        lines.push(`  - Format: ${dataset.sourceFormat}`);
        lines.push(`  - Tables: ${dataset.tables.length}`);
        lines.push(`  - Total rows: ${dataset.facts.rowCount}`);
        lines.push(`  - Total columns: ${dataset.facts.columnCount}`);
        lines.push(`  - Numeric columns: ${dataset.facts.numericColumnCount}`);
        lines.push(`  - Categorical columns: ${dataset.facts.categoricalColumnCount}`);
        lines.push(`  - Date columns: ${dataset.facts.dateColumnCount}`);
        lines.push(`  - Supported aggregations: ${dataset.facts.supportedAggregations.join(", ")}`);

        for (const table of dataset.tables.slice(0, 3)) {
            const columnSummary = table.columns
                .slice(0, 12)
                .map((column) => `${column.key}[${column.valueType}]`)
                .join(", ");
            lines.push(`  - Table "${table.name}": ${table.rowCount} rows, ${table.columnCount} columns`);
            lines.push(`    - Columns: ${columnSummary}`);
            const numericCandidates = table.columns
                .filter((column) => column.valueType === "number")
                .slice(0, 6)
                .map((column) => column.key);
            if (numericCandidates.length > 0) {
                lines.push(`    - KPI candidates: ${numericCandidates.join(", ")}`);
            }
            const dimensionCandidates = table.columns
                .filter((column) => column.valueType === "string" || column.valueType === "date" || column.valueType === "boolean")
                .slice(0, 6)
                .map((column) => column.key);
            if (dimensionCandidates.length > 0) {
                lines.push(`    - Filter or grouping dimensions: ${dimensionCandidates.join(", ")}`);
            }
        }

        if (dataset.limitations && dataset.limitations.length > 0) {
            lines.push(`  - Limitations: ${dataset.limitations.slice(0, 4).join(" | ")}`);
        }
        lines.push("");
        if (lines.join("\n").length >= maxChars) break;
    }

    const content = lines.join("\n").slice(0, maxChars);
    return content.trim();
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

function buildStructuredDataLayerDAppendix(
    assets: ProjectAsset[],
    opts?: { maxChars?: number },
): string {
    const maxChars = opts?.maxChars ?? 4_000;
    if (maxChars <= 0) return "";

    const datasetAssets = assets.filter((asset) => asset.enrichmentTrace?.structuredData?.dataset);
    if (datasetAssets.length === 0) return "";

    const lines: string[] = [
        "### Structured data appendix",
        "Deterministic notes extracted from structured attachments:",
    ];

    for (const asset of datasetAssets) {
        const dataset = asset.enrichmentTrace?.structuredData?.dataset;
        if (!dataset) continue;

        lines.push(`- Dataset asset: ${asset.originalName}`);
        lines.push(`  - Source format: ${dataset.sourceFormat}`);
        lines.push(`  - Global facts: ${dataset.facts.rowCount} rows, ${dataset.facts.columnCount} columns, ${dataset.facts.numericColumnCount} numeric, ${dataset.facts.categoricalColumnCount} categorical, ${dataset.facts.dateColumnCount} date`);

        for (const table of dataset.tables.slice(0, 2)) {
            const numericColumns = table.columns
                .filter((column) => column.valueType === "number")
                .slice(0, 5)
                .map((column) => column.label || column.key);
            const dimensionColumns = table.columns
                .filter((column) => column.valueType === "string" || column.valueType === "date" || column.valueType === "boolean")
                .slice(0, 5)
                .map((column) => column.label || column.key);

            lines.push(`  - Table "${table.name}": ${table.rowCount} rows, ${table.columnCount} columns`);
            if (table.sampleHeaders.length > 0) {
                lines.push(`    - Visible headers: ${table.sampleHeaders.slice(0, 8).join(", ")}`);
            }
            if (numericColumns.length > 0) {
                lines.push(`    - Possible measures: ${numericColumns.join(", ")}`);
            }
            if (dimensionColumns.length > 0) {
                lines.push(`    - Possible dimensions or filters: ${dimensionColumns.join(", ")}`);
            }
        }

        if (dataset.limitations && dataset.limitations.length > 0) {
            lines.push(`  - Runtime limitations: ${dataset.limitations.slice(0, 3).join(" | ")}`);
        }

        if (dataset.llmAppendix) {
            if (dataset.llmAppendix.analyticalSummary) {
                lines.push(`  - Analytical summary: ${dataset.llmAppendix.analyticalSummary}`);
            }
            if (dataset.llmAppendix.keySignals.length > 0) {
                lines.push(`  - Key signals: ${dataset.llmAppendix.keySignals.join(" | ")}`);
            }
            if (dataset.llmAppendix.suggestedQuestions.length > 0) {
                lines.push(`  - Questions the generated page SHOULD answer: ${dataset.llmAppendix.suggestedQuestions.join(" | ")}`);
            }
            if (dataset.llmAppendix.cautions.length > 0) {
                lines.push(`  - Grounding cautions: ${dataset.llmAppendix.cautions.join(" | ")}`);
            }
        }

        if (lines.join("\n").length >= maxChars) break;
    }

    const content = lines.join("\n");
    return content.length > maxChars
        ? `${content.slice(0, Math.max(0, maxChars - 15))}\n...(truncated)`
        : content;
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

const SCOPE_LABEL: Record<BrandAssetScope, string> = {
    platform: "Platform",
    user: "User",
    project: "Project",
};

const POLICY_LABEL: Record<BrandAssetPolicy, string> = {
    must_use: "MUST USE",
    prefer: "PREFER",
    optional: "OPTIONAL",
};

/**
 * Layer G — Global Brand Identity
 *
 * Injects all active brand assets for the current context (platform → user → project)
 * with their semantic role, usage policy, and resolved value/URL.
 * Returns "" when no brand assets are defined, preserving zero behavior change for existing callers.
 */
export function buildGlobalBrandLayer(context: ResolvedBrandContext, opts?: { maxChars?: number }): string {
    if (!context.entries.length) return "";

    const budget = opts?.maxChars ?? 4000;

    const grouped = new Map<string, typeof context.entries>();
    for (const entry of context.entries) {
        const key = entry.role === "custom" ? (entry.customRoleLabel ?? "custom") : entry.role;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(entry);
    }

    const lines: string[] = [
        "## GLOBAL BRAND IDENTITY",
        "",
        "Scope hierarchy: Platform → User → Project  |  must_use items are mandatory.",
        "",
    ];

    for (const [roleName, entries] of grouped) {
        const label = roleName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`### ${label}`);
        for (const e of entries) {
            const prefix = `[${POLICY_LABEL[e.policy]} / ${SCOPE_LABEL[e.scope]}]`;
            const value = e.displayValue || "(not set)";
            const desc = e.description ? `  — ${e.description}` : "";
            if (e.valueType === "asset_ref") {
                lines.push(`${prefix} ${e.originalName ?? roleName}${desc}`);
                lines.push(`  Asset URL: ${value}`);
                lines.push(`  Use this URL as the src attribute for ${label} elements in generated HTML.`);
            } else if (e.valueType === "color_list") {
                lines.push(`${prefix} ${value}${desc}`);
                lines.push(`  Use these exact hex values as the brand color palette.`);
            } else {
                lines.push(`${prefix} ${value}${desc}`);
            }
        }
        lines.push("");
    }

    if (context.hasMustUse) {
        lines.push(
            "### Mandatory rules",
            "- Items marked [MUST USE] are non-negotiable — include them in every generated artifact.",
            "- Never substitute a must_use logo or color with a placeholder or generic alternative.",
            "- must_use contact details must appear in the appropriate output sections (footer, contact page, etc.).",
        );
    }

    const result = lines.join("\n");
    if (result.length > budget) return "";
    return result;
}
