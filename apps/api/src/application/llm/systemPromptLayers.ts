import { PRESET_MAP, type ProjectPreset } from "../../domain/entities/ProjectPreset";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import { FORMAT_HINT_RULES } from "../prompting/formatHintRules";
import { env } from "../../config";

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
        "- All JavaScript MUST go exclusively in artifacts.js. Never embed script logic inline in the HTML artifact — not in <script> tags, not as event attributes. In the HTML, reference JS only with: <script src=\"app.js\"></script>.",
        "",
        "HTML compactness rules (mandatory):",
        "- Target HTML under 30 KB (approx 30 000 chars). Aim for the minimum markup that achieves the design.",
        "- Use 2-space indentation — never 4-space or tabs.",
        "- Do NOT add HTML comments in the output.",
        "- Never duplicate a structural pattern — extract repeating markup into reusable CSS classes instead.",
        "- Avoid inline style= attributes; put all styling in artifacts.css.",
        "- Do not repeat identical class lists across sibling elements — factor them into a shared parent or CSS rule.",
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
    opts?: { maxChars?: number; maxAssets?: number },
): string {
    if (!env.enrichmentInjectLayerD) return "";

    const maxChars = opts?.maxChars ?? env.ENRICHMENT_LAYER_D_MAX_CHARS;
    const maxAssets = opts?.maxAssets ?? env.ENRICHMENT_LAYER_D_MAX_ASSETS;

    // Filter: only ready traces, only assets the user opted in or has a styleRole
    const ready = assets.filter(a => {
        const trace = a.enrichmentTrace;
        if (!trace || trace.provenance.enrichmentStatus !== "ready") return false;
        if (a.useInProject === false && !a.styleRole) return false;
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
        const trace = asset.enrichmentTrace!;
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
            if (brief.detectedBrandName) lines.push(`Brand: ${brief.detectedBrandName}`);
            if (brief.toneLabel) lines.push(`Tone: ${brief.toneLabel}`);
            if (brief.keyMessages.length > 0) {
                lines.push("Key messages:");
                brief.keyMessages.forEach(m => lines.push(`- ${m}`));
            }
            if (brief.ctaText) lines.push(`Call to action: ${brief.ctaText}`);
        }

        const palette = trace.colorPalette;
        const visual = trace.visualAnalysis;
        const signals = trace.designSignals;
        if (palette && palette.dominantNames.length > 0) {
            lines.push(`Color palette: ${palette.dominantNames.join(", ")}`);
        }
        if (visual?.moodLabel) lines.push(`Mood: ${visual.moodLabel}`);
        if (signals?.suggestedWebUse && signals.suggestedWebUse.length > 0) {
            lines.push(`Design signals: ${signals.suggestedWebUse.join(", ")}`);
        }

        if (trace.distilledTags.length > 0) {
            lines.push(`Tags: ${trace.distilledTags.join(", ")}`);
        }

        const block = `---\n${lines.join("\n")}\n---`;
        if (totalChars + block.length + 2 > maxChars) break;
        blocks.push(block);
        totalChars += block.length + 2;
    }

    if (blocks.length === 0) return "";

    return `${header}\n\n${blocks.join("\n\n")}`;
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
