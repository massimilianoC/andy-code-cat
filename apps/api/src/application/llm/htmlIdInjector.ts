import * as cheerio from "cheerio";
import { randomBytes } from "crypto";

/**
 * Stable element ID injection/replacement for focus-patch operations.
 *
 * Industry standard pattern used by:
 *   - GrapesJS   →  data-gjs-id
 *   - Elementor  →  data-id          (8-char hex on .elementor-element)
 *   - Builder.io →  builder-id       (UUID)
 *   - Webflow    →  data-node-id     (nanoid)
 *
 * We inject `data-pf-id` on every block-level element at snapshot-save time.
 * This lets the server locate and replace any element by a unique key that
 * is completely independent of the element's HTML content — no text matching,
 * no LLM cooperation required.
 */

// Block-level elements that are meaningful editing targets.
// Inline elements (span, a, strong, em, …) are intentionally excluded.
const BLOCK_SELECTOR = [
    "div", "section", "article", "header", "footer", "main",
    "nav", "aside", "form", "ul", "ol", "table", "figure",
    "blockquote", "details", "fieldset", "summary",
].join(",");

/** 6 random hex characters — ~16 million values, more than enough for a 100-element page. */
function genId(): string {
    return randomBytes(3).toString("hex");
}

/**
 * Injects `data-pf-id` attributes into every block-level element that does
 * not already have one.  Safe to call multiple times — existing IDs are
 * preserved so elements keep their identity across incremental saves.
 *
 * Returns the full HTML document unchanged on any parse error.
 */
export function injectStableIds(html: string): string {
    if (!html?.trim()) return html;
    try {
        const $ = cheerio.load(html);
        $(BLOCK_SELECTOR).each((_, el) => {
            const $el = $(el);
            if (!$el.attr("data-pf-id")) {
                $el.attr("data-pf-id", genId());
            }
        });
        return $.html();
    } catch {
        // Never corrupt the stored artifact if cheerio fails.
        return html;
    }
}

/**
 * Extracts the `data-pf-id` attribute from the root element of an HTML
 * fragment string.  Returns undefined if the attribute is absent.
 *
 * Pure regex — no DOM parse overhead, safe to call on any string.
 */
export function extractPfId(fragmentHtml: string): string | undefined {
    return fragmentHtml.match(/\bdata-pf-id="([^"]+)"/)?.[1];
}

/**
 * Injects the given pfId into the root opening tag of a replacement HTML fragment.
 * Preserves element identity across successive focused-edit turns: after the patch
 * is applied the new element retains the same data-pf-id, so Strategy 0 continues
 * to work without requiring the user to re-click the element.
 *
 * If the replacement already carries a data-pf-id (e.g. the LLM echoed one), it is
 * overwritten with the canonical ID we control.
 */
function preservePfIdInReplacement(replacementHtml: string, pfId: string): string {
    if (/data-pf-id=/.test(replacementHtml)) {
        // Overwrite any existing data-pf-id with the canonical one.
        return replacementHtml.replace(/data-pf-id="[^"]*"/, `data-pf-id="${pfId}"`);
    }
    // Inject the attribute immediately after the root tag name.
    // Matches: <tagName> | <tagName ...> | <tagName/>
    return replacementHtml.replace(
        /(<[a-zA-Z][a-zA-Z0-9]*)(\s|>|\/)/,
        (_, tag, next) => `${tag} data-pf-id="${pfId}"${next}`
    );
}

/**
 * Replaces the element identified by `data-pf-id` in the base HTML document.
 *
 * The replacement root element inherits the same data-pf-id so element identity
 * is preserved across incremental focused-edit turns — Strategy 0 keeps working
 * without requiring a re-selection after every successful patch.
 *
 * @returns `{ html: updated, applied: true }` on success.
 * @returns `{ html: base, applied: false }` if the ID is not found (empty
 *          string pfId, wrong snapshot version, etc.).
 */
export function replaceElementByPfId(
    baseHtml: string,
    pfId: string,
    replacement: string
): { html: string; applied: boolean } {
    if (!baseHtml || !pfId) return { html: baseHtml, applied: false };
    try {
        const $ = cheerio.load(baseHtml);
        // CSS attribute selector — guaranteed unique because we generate random IDs.
        const el = $(`[data-pf-id="${pfId}"]`);
        if (el.length === 0) return { html: baseHtml, applied: false };
        // Inject the same pfId into the replacement so the element keeps its identity.
        el.replaceWith(preservePfIdInReplacement(replacement, pfId));
        return { html: $.html(), applied: true };
    } catch {
        return { html: baseHtml, applied: false };
    }
}

// Runtime classes injected by JS libraries that are absent from stored source HTML.
// Must be excluded when comparing class signatures in structural matching.
const STRUCTURAL_RUNTIME_CLASSES = new Set(["aos-init", "aos-animate"]);

/**
 * Finds a unique element in the base HTML by tag name and class signature, then
 * replaces it with the replacement HTML.  Used as Strategy 3 in focused-patch
 * fallback when content-based text matching fails (e.g. element was previously
 * edited so its text no longer matches the anchor) but the tag+class fingerprint
 * is still uniquely identifiable on the page.
 *
 * Safety constraint: only applies when EXACTLY ONE element matches the signature
 * — refuses to act on ambiguous matches (0 or >1) to prevent replacing the wrong
 * element.
 *
 * Runtime classes ("aos-init", "aos-animate") are stripped from both the anchor
 * class list and each candidate before comparison so live-DOM captures do not
 * produce false mismatches.
 *
 * @param anchorClasses  Already-filtered class list (no runtime classes) extracted
 *                       from the anchor's class="" attribute.
 */
export function findAndReplaceByTagAndClasses(
    baseHtml: string,
    tagName: string,
    anchorClasses: string[],
    replacement: string
): { html: string; applied: boolean } {
    if (!baseHtml || !tagName || anchorClasses.length === 0) {
        return { html: baseHtml, applied: false };
    }
    try {
        const $ = cheerio.load(baseHtml);
        const anchorSet = new Set(anchorClasses);
        const candidates = $(tagName)
            .toArray()
            .filter((el) => {
                const rawClass = $(el).attr("class") ?? "";
                const elClasses = rawClass
                    .split(/\s+/)
                    .filter((c) => c && !STRUCTURAL_RUNTIME_CLASSES.has(c));
                const elSet = new Set(elClasses);
                if (elSet.size !== anchorSet.size) return false;
                for (const c of anchorSet) {
                    if (!elSet.has(c)) return false;
                }
                return true;
            });
        if (candidates.length !== 1) return { html: baseHtml, applied: false };
        $(candidates[0]).replaceWith(replacement);
        return { html: $.html(), applied: true };
    } catch {
        return { html: baseHtml, applied: false };
    }
}
