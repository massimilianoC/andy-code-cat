import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

interface IdIndexEntry {
    tag: string;
    classes: string[];
    textSnippet: string;
}

export interface InstrumentHtmlResult {
    instrumentedHtml: string;
    idIndex: Map<string, IdIndexEntry>;
}

const BLOCK_TAGS = new Set([
    "div", "section", "article", "aside", "header", "footer", "main", "nav",
    "figure", "figcaption", "blockquote", "pre", "ul", "ol", "li", "table",
    "thead", "tbody", "tfoot", "tr", "td", "th", "form", "fieldset",
    "h1", "h2", "h3", "h4", "h5", "h6", "p",
]);

const MEDIA_TAGS = new Set(["img", "video", "audio", "canvas", "svg", "picture", "iframe"]);

function isSignificant(el: cheerio.Cheerio<AnyNode>): boolean {
    const tag = el.prop("tagName")?.toLowerCase() ?? "";
    if (!tag || tag === "html" || tag === "body" || tag === "head" || tag === "script" || tag === "style" || tag === "meta" || tag === "link") {
        return false;
    }
    let score = 0;
    if (el.attr("data-pf-id")) score += 6;
    if (el.attr("id")) score += 5;
    if (BLOCK_TAGS.has(tag)) score += 3;
    if (MEDIA_TAGS.has(tag)) score += 8;
    const text = el.text().trim();
    if (text.length > 0) score += 1;
    return score >= 3;
}

export function instrumentArtifactHtml(rawHtml: string): InstrumentHtmlResult {
    const $ = cheerio.load(rawHtml);
    const idIndex = new Map<string, IdIndexEntry>();
    let counter = 0;

    $("*").each((_, elem) => {
        const el = $(elem);
        if (!isSignificant(el)) return;

        const existing = el.attr("data-pf-id");
        if (existing && existing.startsWith("pf-")) {
            if (!idIndex.has(existing)) {
                idIndex.set(existing, {
                    tag: el.prop("tagName")?.toLowerCase() ?? "",
                    classes: (el.attr("class")?.split(/\s+/).filter(Boolean) ?? []),
                    textSnippet: el.text().trim().slice(0, 120),
                });
            }
            return;
        }

        const pfId = `pf-${counter++}`;
        el.attr("data-pf-id", pfId);

        idIndex.set(pfId, {
            tag: el.prop("tagName")?.toLowerCase() ?? "",
            classes: (el.attr("class")?.split(/\s+/).filter(Boolean) ?? []),
            textSnippet: el.text().trim().slice(0, 120),
        });
    });

    const instrumentedHtml = $.html();
    return { instrumentedHtml, idIndex };
}

export function validateAnchors(
    anchors: Array<{ kind: string; pfId?: string; lineRange?: [number, number] }>,
    idIndex: Map<string, IdIndexEntry>,
    lineCounts: { html: number; css: number; js: number },
): { valid: typeof anchors; dropped: typeof anchors } {
    const valid: typeof anchors = [];
    const dropped: typeof anchors = [];

    for (const a of anchors) {
        if (a.kind === "preview" || a.kind === "html") {
            if (a.pfId && idIndex.has(a.pfId)) {
                valid.push(a);
                continue;
            }
            dropped.push(a);
            continue;
        }
        if (a.kind === "css" || a.kind === "js") {
            const maxLines = a.kind === "css" ? lineCounts.css : lineCounts.js;
            if (a.lineRange && a.lineRange[0] >= 0 && a.lineRange[1] <= maxLines && a.lineRange[0] <= a.lineRange[1]) {
                valid.push(a);
                continue;
            }
            dropped.push(a);
            continue;
        }
        if (a.kind === "prompt") {
            valid.push(a);
            continue;
        }
        dropped.push(a);
    }

    return { valid, dropped };
}
