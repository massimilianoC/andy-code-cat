/**
 * The section plan — the contract between the `plan` stage and the section fan-out
 * (docs/specs/PARALLEL_SECTION_GENERATION_SPEC.md §6).
 *
 * This is the object that makes the fan-out affordable. Each child call carries the plan's shared
 * design tokens plus exactly one section, instead of the 47,021-char system prompt the monolithic
 * generate stage sends today (§6.1). Ten children carrying that prompt would cost ~139k input
 * tokens against 13,938 for one call — the fan-out only pays for itself if the context is distilled
 * first, which is what this shape is for.
 *
 * The design tokens live on the plan and not in the children for the one risk the fan-out
 * introduces: N sections written independently drift apart visually. They are decided once, and
 * every child is handed the same ones verbatim.
 */

import { parseJsonWithRepairs } from "./llmParser";

/**
 * Shared visual decisions every section must honour. Deliberately small and literal: these are
 * copied into each child prompt, so anything here is paid for N times.
 */
export interface SectionDesignTokens {
    palette: string[];
    headingFont?: string;
    bodyFont?: string;
    /** Free-form, one line: "editorial, generous whitespace, no drop shadows". */
    styleNote?: string;
}

export interface PlannedSection {
    /** Stable across retries — how an outcome is matched back to its section. */
    key: string;
    title: string;
    /** What this section must say. The child expands this; it does not re-derive it. */
    contentBrief: string;
    /**
     * The length contract, in characters of rendered text. Characters rather than tokens because
     * this is what the prompt states to the model, and a model reasons about prose length far
     * better than about its own tokeniser. `max_tokens` cannot express this: it truncates, it does
     * not condense (§1).
     */
    charBudget: number;
    mediaIntent?: string;
}

export interface SectionPlan {
    sections: PlannedSection[];
    designTokens: SectionDesignTokens;
}

/** Guards the fan-out against a plan that would cost more than the monolith it replaces. */
export const MAX_PLANNED_SECTIONS = 24;
export const MIN_CHAR_BUDGET = 200;
export const MAX_CHAR_BUDGET = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isPlanShape(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && Array.isArray(value.sections);
}

/**
 * Normalises one raw section, or returns null if it carries nothing usable.
 *
 * A section without a `contentBrief` is dropped rather than defaulted: the child's whole input is
 * this brief, so inventing one here would mean generating a section nobody asked for — the same
 * "plausible-looking guess rendered as fact" the progress-inspector plan rejects for progress tips.
 */
function normalizeSection(raw: unknown, index: number, fallbackBudget: number): PlannedSection | null {
    if (!isRecord(raw)) return null;

    const contentBrief = asString(raw.contentBrief) ?? asString(raw.brief) ?? asString(raw.content);
    if (!contentBrief) return null;

    const title = asString(raw.title) ?? `Section ${index + 1}`;
    const key = asString(raw.key) ?? `section-${index + 1}`;

    const rawBudget = typeof raw.charBudget === "number" ? raw.charBudget : fallbackBudget;
    const charBudget = Math.min(MAX_CHAR_BUDGET, Math.max(MIN_CHAR_BUDGET, Math.round(rawBudget)));

    return {
        key,
        title,
        contentBrief,
        charBudget,
        mediaIntent: asString(raw.mediaIntent) ?? asString(raw.media),
    };
}

function normalizeDesignTokens(raw: unknown): SectionDesignTokens {
    if (!isRecord(raw)) return { palette: [] };
    const palette = Array.isArray(raw.palette)
        ? raw.palette.filter((c): c is string => typeof c === "string").slice(0, 8)
        : [];
    return {
        palette,
        headingFont: asString(raw.headingFont),
        bodyFont: asString(raw.bodyFont),
        styleNote: asString(raw.styleNote),
    };
}

export interface ParsedSectionPlan {
    plan: SectionPlan;
    /**
     * True when the JSON only parsed after a repair strategy fired. The plan is still usable, but
     * it is evidence the plan call itself was truncated — which means sections the model intended
     * to write are simply absent, and no downstream retry can recover a section nobody knows about.
     */
    repaired: boolean;
    /** Sections the model emitted that carried nothing usable. Non-zero is worth surfacing. */
    droppedSections: number;
}

/**
 * Extracts a section plan from a model reply.
 *
 * Reuses the artifact parser's repair chain (`parseJsonWithRepairs`) rather than growing a second
 * one — the plan call meets the same model quirks the artifact call does.
 */
export function parseSectionPlan(raw: string, fallbackBudget = 900): ParsedSectionPlan | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Models wrap JSON in prose or fences far more often than they emit it bare; take the widest
    // brace-delimited span and let the repair chain deal with what is inside it.
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    const candidates = [
        trimmed,
        firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : null,
        // A truncated plan never closes its last brace — hand the chain the open remainder too.
        firstBrace >= 0 ? trimmed.slice(firstBrace) : null,
    ].filter((c): c is string => c !== null);

    for (const candidate of candidates) {
        const parsed = parseJsonWithRepairs(candidate, isPlanShape);
        if (!parsed) continue;

        const rawSections = parsed.value.sections as unknown[];
        const normalized: PlannedSection[] = [];
        let dropped = 0;
        for (const [index, rawSection] of rawSections.slice(0, MAX_PLANNED_SECTIONS).entries()) {
            const section = normalizeSection(rawSection, index, fallbackBudget);
            if (section) normalized.push(section);
            else dropped++;
        }
        if (normalized.length === 0) continue;

        return {
            plan: {
                sections: normalized,
                designTokens: normalizeDesignTokens(parsed.value.designTokens),
            },
            repaired: parsed.repaired,
            droppedSections: dropped,
        };
    }

    return null;
}

/**
 * The plan stage's output contract, stated to the model.
 *
 * Kept terse on purpose. The monolithic path already spends 4,750 characters on an output-budget
 * policy layer, and the run it governed still terminated at exactly 32,768 tokens (§6.1) — prose
 * asking for brevity does not bound output. What bounds it is that this call is asked for an
 * outline, not a document.
 */
export const SECTION_PLAN_OUTPUT_CONTRACT = `Reply with ONE JSON object and nothing else:
{
  "designTokens": { "palette": ["#hex", ...], "headingFont": "...", "bodyFont": "...", "styleNote": "one line" },
  "sections": [
    { "key": "kebab-case-id", "title": "...", "contentBrief": "what this section must say, 1-3 sentences", "charBudget": 900, "mediaIntent": "optional, one line" }
  ]
}
Rules:
- Plan the sections only. Do NOT write the sections themselves, and do NOT emit HTML or CSS.
- contentBrief is an instruction to a writer, not the finished copy.
- charBudget is the rendered text length that section should occupy, between 200 and 4000.
- designTokens are decided once here and reused by every section, so state them concretely.`;
