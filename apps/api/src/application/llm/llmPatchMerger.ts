import type { LlmFocusedPatch, LlmStructuredArtifacts } from "@andy-code-cat/contracts";
import { extractPfId, replaceElementByPfId, findAndReplaceByTagAndClasses } from "./htmlIdInjector";

/**
 * Applies a server-side focused patch to the base artifacts.
 *
 * Matching strategy (in order):
 * 1. Exact verbatim search — fastest, most accurate.
 * 2. Whitespace-flexible regex — handles cases where the LLM slightly altered
 *    indentation or line endings but otherwise copied the anchor correctly.
 *    The anchor is escaped for regex safety, then all whitespace runs are
 *    replaced with `\s+` so `\n    ` and `\n  ` both match.
 *
 * `serverAnchor` (optional) — when the caller has a reliable anchor (e.g. derived
 * from selectedElement.outerHtml), pass it here to bypass the LLM-supplied anchor.
 * This is preferred for element-inspector mode where the LLM only produces replacement.
 *
 * Returns `fallback` unchanged if neither strategy matches, so the call site
 * always gets a valid artifacts object even if the LLM produced a bad anchor.
 */
export interface FocusPatchResult {
    artifacts: LlmStructuredArtifacts;
    /** true when the patch anchor was found and the replacement was applied */
    patchApplied: boolean;
}

/**
 * Strip runtime DOM mutations that JS libraries inject but are absent from
 * (or inconsistent across) source HTML versus live DOM snapshots:
 *   - data-pf-h / data-pf-s  : inspector highlight/select markers
 *   - aos-init / aos-animate  : AOS.js scroll-animation runtime classes
 *   - style=""                : empty style attributes added by WYSIWYG or browser
 *   - lucide SVG expansion    : <svg data-lucide="name">…</svg>  →  <i data-lucide="name"></i>
 *                               lucide.createIcons() replaces <i data-lucide> placeholders with
 *                               full <svg> elements at runtime, so the live-DOM anchor differs
 *                               from the stored artifact source.  Reverting both sides to the
 *                               canonical <i> form lets Strategy 1/2 compare them fairly.
 *
 * Applied to BOTH the anchor AND the source before comparison so they are
 * normalised the same way.  The final merged HTML will also be free of these
 * runtime artefacts, which is desirable because they are re-added at runtime.
 */
function normalizeForMatching(html: string): string {
    return html
        .replace(/ data-pf-[a-z]+(="[^"]*")?/g, "")
        .replace(/ (aos-init|aos-animate)/g, "")
        .replace(/ style=""/g, "")
        // Reverse Lucide SVG expansion: live DOM has full <svg data-lucide="name">…</svg>;
        // source artifact has <i data-lucide="name" …></i>.  Collapse both to the same
        // canonical form so Strategy 1/2 can still match.
        .replace(/<svg[^>]*\sdata-lucide="([^"]+)"[^>]*>[\s\S]*?<\/svg>/g, '<i data-lucide="$1"></i>')
        .replace(/<i\s[^>]*\bdata-lucide="([^"]+)"[^>]*><\/i>/g, '<i data-lucide="$1"></i>');
}

export function applyFocusPatch(
    base: { html?: string; css?: string; js?: string },
    patch: LlmFocusedPatch,
    fallback: LlmStructuredArtifacts,
    serverAnchor?: string
): FocusPatchResult {
    const { targetType, replacement } = patch;

    // Prefer server-derived anchor (from selectedElement.outerHtml) over the LLM-supplied one.
    const rawAnchor = serverAnchor ?? patch.anchor ?? "";

    // ── Strategy 0: stable ID-based replacement (takes priority, model-agnostic) ──
    // Requires the anchor element to have a data-pf-id attribute (injected at snapshot
    // creation time).  Works regardless of whitespace or class differences.
    if (targetType === "html" && rawAnchor) {
        const pfId = extractPfId(rawAnchor);
        if (pfId) {
            const idResult = replaceElementByPfId(base.html ?? "", pfId, replacement);
            if (idResult.applied) {
                return {
                    artifacts: {
                        html: idResult.html,
                        css: base.css ?? fallback.css,
                        js: base.js ?? fallback.js,
                    },
                    patchApplied: true,
                };
            }
            console.warn(`[focusPatch] Strategy 0: ID data-pf-id="${pfId}" not found in base HTML — falling through.`);
        }
    }

    const anchor = normalizeForMatching(rawAnchor);

    if (!anchor) {
        console.warn("[focusPatch] no anchor available — returning base artifacts unchanged.");
        return { artifacts: fallback, patchApplied: false };
    }

    // Normalize BOTH anchor and source so runtime-only attributes (aos-init,
    // style="", data-pf-*) that may differ between the DOM snapshot used as
    // the anchor and the stored artifact HTML do not prevent matching.
    const rawSource = base[targetType] ?? "";
    const source = normalizeForMatching(rawSource);

    // ── Strategy 1: exact match ───────────────────────────────────────────────
    // Prefer replacing in rawSource (un-normalised) so surrounding data-pf-id and
    // other attributes are preserved in the output.  Fall back to the normalised
    // source only when the raw anchor isn't found verbatim (e.g. the anchor itself
    // carried runtime attributes that were stripped during normalisation).
    if (source.includes(anchor)) {
        if (rawAnchor && rawSource.includes(rawAnchor)) {
            console.info(`[focusPatch] strategy=1 applied (raw source)`);
            return { artifacts: buildResult(rawSource, rawAnchor, replacement, targetType, base, fallback), patchApplied: true };
        }
        console.info(`[focusPatch] strategy=1 applied (normalised source)`);
        return { artifacts: buildResult(source, anchor, replacement, targetType, base, fallback), patchApplied: true };
    }

    // ── Strategy 2: whitespace-flexible regex match ───────────────────────────
    try {
        const escapedAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const flexPattern = escapedAnchor.replace(/\s+/g, "\\s+");
        const flexRegex = new RegExp(flexPattern);
        const matchNorm = source.match(flexRegex);
        if (matchNorm && matchNorm[0]) {
            // Try the same flex-pattern against the raw source to preserve attributes.
            const rawMatch = rawSource.match(flexRegex);
            if (rawMatch && rawMatch[0]) {
                console.info(
                    `[focusPatch] strategy=2 applied (raw source). ` +
                    `anchor preview: ${anchor.slice(0, 80)}`
                );
                return { artifacts: buildResult(rawSource, rawMatch[0], replacement, targetType, base, fallback), patchApplied: true };
            }
            console.info(
                `[focusPatch] strategy=2 applied (normalised source). ` +
                `anchor preview: ${anchor.slice(0, 80)}`
            );
            return { artifacts: buildResult(source, matchNorm[0], replacement, targetType, base, fallback), patchApplied: true };
        }
    } catch {
        // Regex construction failed (e.g. extremely long anchor) — fall through.
    }

    console.warn(
        `[focusPatch] anchor not found in base.${targetType} — trying strategy=3. ` +
        `anchor preview: ${anchor.slice(0, 80)}`
    );

    // ── Strategy 3: tag + class signature match (cheerio) ─────────────────────
    // Last resort when text matching fails, e.g. the targeted element's content
    // was replaced in a previous focused-edit turn (changing its text completely)
    // but the tag name and class fingerprint are still uniquely identifiable.
    // Only fires when exactly ONE element in the base matches the signature to
    // prevent accidentally replacing the wrong element on class-name collisions.
    if (targetType === "html" && rawAnchor) {
        const tagMatch = rawAnchor.match(/^<([a-zA-Z][a-zA-Z0-9]*)/i);
        const classAttrMatch = rawAnchor.match(/\bclass="([^"]*)"/);
        if (tagMatch && classAttrMatch) {
            const tag = (tagMatch[1] ?? "").toLowerCase();
            const RUNTIME = new Set(["aos-init", "aos-animate"]);
            const anchorClasses = (classAttrMatch[1] ?? "")
                .split(/\s+/)
                .filter((c) => c && !RUNTIME.has(c));
            if (anchorClasses.length > 0) {
                const s3Result = findAndReplaceByTagAndClasses(rawSource, tag, anchorClasses, replacement);
                if (s3Result.applied) {
                    console.info(
                        `[focusPatch] strategy=3 applied (structural: ${tag}[${anchorClasses.slice(0, 3).join(",")}])`
                    );
                    return {
                        artifacts: {
                            html: s3Result.html,
                            css: base.css ?? fallback.css,
                            js: base.js ?? fallback.js,
                        },
                        patchApplied: true,
                    };
                }
            }
        }
    }

    console.warn(
        `[focusPatch] all strategies failed for base.${targetType} — returning base artifacts unchanged. ` +
        `anchor preview: ${anchor.slice(0, 80)}`
    );
    return { artifacts: fallback, patchApplied: false };
}

function buildResult(
    source: string,
    actualAnchor: string,
    replacement: string,
    targetType: "html" | "css" | "js",
    base: { html?: string; css?: string; js?: string },
    fallback: LlmStructuredArtifacts
): LlmStructuredArtifacts {
    const idx = source.indexOf(actualAnchor);
    const merged = source.slice(0, idx) + replacement + source.slice(idx + actualAnchor.length);
    return {
        html: targetType === "html" ? merged : (base.html ?? fallback.html),
        css: targetType === "css" ? merged : (base.css ?? fallback.css),
        js: targetType === "js" ? merged : (base.js ?? fallback.js),
    };
}
