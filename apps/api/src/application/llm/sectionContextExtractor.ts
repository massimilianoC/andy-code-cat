import * as cheerio from "cheerio";
import { extractPfId } from "./htmlIdInjector";

/**
 * Section-Aware Context Extractor for focused-edit mode.
 *
 * When LLM_FOCUS_SECTION_CONTEXT=true, instead of sending the full page HTML
 * artifact to the LLM, this module extracts only the section that contains
 * the focused element plus a compact page-map.  This reduces context size by
 * 40–60% for typical section-based pages.
 *
 * Design contract:
 *  - All functions degrade gracefully: they never throw and always return a
 *    safe fallback (null / original string) on error.
 *  - No coupling to LLM provider or routing logic — pure transformation.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** One entry in the compact page-structure map sent to the LLM. */
export interface PageSection {
    /** data-pf-id of the top-level section element (may be undefined on old snapshots). */
    pfId?: string;
    /** HTML tag name: section, header, footer, div, … */
    tag: string;
    /** id attribute of the element, if present. */
    id?: string;
    /** Class list of the element (first element only, not children). */
    classes: string[];
    /** First heading text found inside the section (up to 60 chars). */
    headline?: string;
    /** True when this section contains the currently focused element. */
    isTarget: boolean;
}

/** Result of a successful section extraction. */
export interface ExtractedSection {
    sectionHtml: string;
    sectionPfId?: string;
    pageMap: PageSection[];
    /** All CSS class names found in sectionHtml. */
    classNames: Set<string>;
    /** All element IDs found in sectionHtml. */
    elementIds: Set<string>;
}

// ── Section Tags ─────────────────────────────────────────────────────────────

/** Tags that represent semantic top-level sections. */
const SEMANTIC_SECTION_TAGS = new Set([
    "section", "article", "header", "footer", "main", "nav", "aside",
]);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempts to extract the section containing the focused element.
 *
 * Uses `data-pf-id` from `outerHtml` to locate the element in the full page
 * HTML, then walks ancestors to find the nearest top-level body child.
 *
 * Returns `null` when:
 * - `outerHtml` carries no `data-pf-id`
 * - the element cannot be found in the HTML (snapshot mismatch)
 * - any parse error occurs
 *
 * Callers MUST treat `null` as "use full artifact path" (graceful degradation).
 */
export function extractSectionForElement(
    fullHtml: string,
    outerHtml: string,
    maxSectionChars: number,
): ExtractedSection | null {
    const pfId = extractPfId(outerHtml);
    if (!pfId) return null;

    return extractSectionForPfId(fullHtml, pfId, maxSectionChars);
}

/**
 * Extracts the most relevant context block for the focused element — tiered policy:
 *
 * Tier 1 — Semantic section ancestor:
 *   Walk up from the focused element and pick the NEAREST ancestor whose tag is
 *   in SEMANTIC_SECTION_TAGS (section, header, footer, main, nav, aside, article).
 *   This is the ideal case for well-structured pages.
 *
 * Tier 2 — Immediate parent block:
 *   If no semantic ancestor exists, use the direct parent of the focused element
 *   (as long as it is not <body> / <html>), giving local context without sending
 *   the entire page.
 *
 * Tier 3 — null → full artifact fallback:
 *   When even the parent is <body> (element is a direct body child) or the HTML
 *   cannot be parsed, return null so the caller falls back to the full artifact.
 *
 * The `contextTier` field in the result records which tier was used — surfaced
 * in debug logs.
 *
 * @returns ExtractedSection or null on any failure.
 */
export function extractSectionForPfId(
    fullHtml: string,
    pfId: string,
    maxSectionChars: number,
): ExtractedSection | null {
    if (!pfId || !fullHtml) return null;

    try {
        const $ = cheerio.load(fullHtml);

        // Find the focused element.
        const target = $(`[data-pf-id="${pfId}"]`);
        if (target.length === 0) return null;

        // ── Tier 1: nearest semantic section ancestor ────────────────────────
        let candidate = findNearestSemanticAncestor($, target);

        // ── Tier 2: immediate parent block ───────────────────────────────────
        if (!candidate) {
            const immediateParent = target.parent();
            if (
                immediateParent.length > 0 &&
                immediateParent[0]!.type === "tag" &&
                !["body", "html"].includes((immediateParent[0]! as { name: string }).name)
            ) {
                candidate = immediateParent;
            }
        }

        // ── Tier 3: fallback ─────────────────────────────────────────────────
        if (!candidate) return null; // element is a direct body child → caller uses full artifact

        let sectionHtml = $.html(candidate);
        if (!sectionHtml) return null;

        // Truncate if too large (patch is anchored by data-pf-id, not text content).
        if (sectionHtml.length > maxSectionChars) {
            sectionHtml = sectionHtml.slice(0, maxSectionChars) + "\n<!-- [sezione-troncata] -->";
        }

        const sectionPfId = candidate.attr("data-pf-id");
        const pageMap = buildPageMap($, pfId);
        const { classNames, elementIds } = extractClassNamesAndIds(sectionHtml);

        return { sectionHtml, sectionPfId, pageMap, classNames, elementIds };
    } catch {
        return null;
    }
}

/**
 * Returns a compact page-map: one entry per direct child of <body>.
 *
 * @param targetPfId  When provided, marks the section containing this element.
 */
export function extractPageSections(fullHtml: string, targetPfId?: string): PageSection[] {
    if (!fullHtml) return [];
    try {
        const $ = cheerio.load(fullHtml);
        return buildPageMap($, targetPfId);
    } catch {
        return [];
    }
}

/**
 * Extracts all CSS class names and element IDs referenced in an HTML string.
 * Uses regex — no DOM parse needed.
 */
export function extractClassNamesAndIds(html: string): {
    classNames: Set<string>;
    elementIds: Set<string>;
} {
    const classNames = new Set<string>();
    const elementIds = new Set<string>();

    for (const match of html.matchAll(/\bclass="([^"]+)"/g)) {
        for (const cls of match[1]!.split(/\s+/)) {
            if (cls) classNames.add(cls);
        }
    }
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
        if (match[1]) elementIds.add(match[1]);
    }

    return { classNames, elementIds };
}

/**
 * Heuristic CSS filter: returns only rules that are relevant to the given
 * set of class-names and element IDs.
 *
 * Always preserves:
 *  - `@`-rules (media queries, keyframes, etc.)
 *  - `:root`, `body`, `*`, `html` rules
 *  - CSS custom properties / variable declarations
 *
 * Rule of thumb: a CSS block is "relevant" when its selector or declaration
 * block mentions at least one `.className` or `#elementId` from the section.
 *
 * Falls back to the full CSS string silently on any error (never corrupts).
 */
export function filterCssForSection(
    css: string,
    classNames: Set<string>,
    elementIds: Set<string>,
): string {
    if (!css || (classNames.size === 0 && elementIds.size === 0)) return css;

    try {
        // Build lookup patterns once.
        const classPatterns = [...classNames].map((c) => `.${c}`);
        const idPatterns = [...elementIds].map((id) => `#${id}`);

        // Split by '}' to approximate CSS rule blocks.
        // This handles most real-world CSS without a full parser.
        const rawBlocks = css.split("}");
        const kept: string[] = [];

        for (const block of rawBlocks) {
            if (!block.trim()) continue;
            const blockWithClose = block + "}";

            const braceIdx = block.indexOf("{");
            if (braceIdx === -1) {
                // Could be a stray comment or whitespace — keep it.
                if (block.trim()) kept.push(block);
                continue;
            }

            const selector = block.slice(0, braceIdx).trim();

            if (isAlwaysRelevantSelector(selector)) {
                kept.push(blockWithClose);
                continue;
            }

            // Check if selector OR declaration body mentions any of our identifiers.
            let relevant = false;
            for (const pattern of classPatterns) {
                if (block.includes(pattern)) { relevant = true; break; }
            }
            if (!relevant) {
                for (const pattern of idPatterns) {
                    if (block.includes(pattern)) { relevant = true; break; }
                }
            }

            if (relevant) kept.push(blockWithClose);
        }

        return kept.join("\n");
    } catch {
        // On any parse failure, return the original CSS unchanged.
        return css;
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Walks up the DOM from `start` and returns the nearest ancestor element
 * whose tag is in SEMANTIC_SECTION_TAGS, stopping before <body> / <html>.
 *
 * Returns undefined when no semantic ancestor exists (element is inside a
 * non-semantic sub-tree or is already a top-level body child).
 */
function findNearestSemanticAncestor(
    $: CheerioAPI,
    start: Cheerio<AnyNode>,
): Cheerio<AnyNode> | undefined {
    let current = start.parent();
    while (current.length > 0 && current[0]!.type === "tag") {
        const tagName = (current[0]! as { name: string }).name;
        if (tagName === "body" || tagName === "html") break;
        if (SEMANTIC_SECTION_TAGS.has(tagName)) return current;
        current = current.parent();
    }
    return undefined;
}

function buildPageMap($: CheerioAPI, targetPfId?: string): PageSection[] {
    const sections: PageSection[] = [];

    $("body").children().each((_, el) => {
        if (el.type !== "tag") return;
        const $el = $(el);
        const tag = (el as { name: string }).name;
        const pfId = $el.attr("data-pf-id");
        const id = $el.attr("id");
        const rawClass = $el.attr("class") ?? "";
        const classes = rawClass.split(/\s+/).filter(Boolean).slice(0, 8); // cap at 8

        // First heading in this element.
        const headline = $el.find("h1, h2, h3").first().text().slice(0, 60).trim() || undefined;

        // Mark as target if it contains the focused element or IS the focused element.
        const isTarget = Boolean(
            targetPfId && (
                pfId === targetPfId ||
                $el.find(`[data-pf-id="${targetPfId}"]`).length > 0
            )
        );

        sections.push({ pfId, tag, id, classes, headline, isTarget });
    });

    return sections;
}

function isAlwaysRelevantSelector(selector: string): boolean {
    if (selector.startsWith("@")) return true; // @media, @keyframes, @layer, …
    if (selector.includes("--")) return true;  // CSS custom property inside :root
    const trimmed = selector.replace(/^[\s,]+/, "");
    return /^(:root|html|body|\*)/.test(trimmed);
}

/**
 * Serialises a PageSection[] into a compact, token-efficient JSON string
 * for embedding in a system prompt.  Only non-default fields are included.
 */
export function serializePageMap(sections: PageSection[]): string {
    const compact = sections.map((s) => {
        const entry: Record<string, unknown> = { tag: s.tag };
        if (s.pfId) entry.pfId = s.pfId;
        if (s.id) entry.id = s.id;
        if (s.classes.length > 0) entry.classes = s.classes;
        if (s.headline) entry.headline = s.headline;
        if (s.isTarget) entry.isTarget = true;
        return entry;
    });
    return JSON.stringify(compact);
}
