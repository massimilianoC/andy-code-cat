import type { LlmStructuredArtifacts } from "@andy-code-cat/contracts";
import * as cheerio from "cheerio";

export const MEDIA_PLACEHOLDER_RE = /asset:\/\/media\/([a-z0-9]+(?:-[a-z0-9]+)*)/g;

export function extractMediaPlaceholderKeys(artifacts: Pick<LlmStructuredArtifacts, "html" | "css">): string[] {
    const keys = new Set<string>();
    const sources = [artifacts.html ?? "", artifacts.css ?? ""];

    for (const source of sources) {
        for (const match of source.matchAll(MEDIA_PLACEHOLDER_RE)) {
            if (match[1]) keys.add(match[1]);
        }
    }

    return [...keys];
}

export function replaceMediaPlaceholders(
    artifacts: LlmStructuredArtifacts,
    replacements: Map<string, string>,
): { artifacts: LlmStructuredArtifacts; unresolvedKeys: string[] } {
    let html = annotateHtmlMediaKeys(artifacts.html, replacements);
    let css = artifacts.css;

    for (const [key, url] of replacements.entries()) {
        const placeholder = `asset://media/${key}`;
        html = html.split(placeholder).join(url);
        css = css.split(placeholder).join(url);
    }

    return {
        artifacts: { ...artifacts, html, css },
        unresolvedKeys: extractMediaPlaceholderKeys({ html, css }),
    };
}

/**
 * Returns all data-media-key values present in HTML elements.
 * Used to detect elements that were annotated by the LLM (or by annotateHtmlMediaKeys)
 * but never had their image actually resolved.
 */
export function extractDataMediaKeyAttributes(html: string): string[] {
    if (!html || !html.includes("data-media-key")) return [];
    try {
        const $ = cheerio.load(html, null, false);
        const keys = new Set<string>();
        $("[data-media-key]").each((_, element) => {
            const key = $(element).attr("data-media-key");
            if (key) keys.add(key);
        });
        return [...keys];
    } catch {
        return [];
    }
}

/**
 * Injects resolved media into elements that carry data-media-key="<key>" but had NO
 * asset://media/<key> placeholder (the "annotated empty element" convention).
 * - For <img> elements: sets the src attribute.
 * - For any other element: appends a scoped CSS rule
 *   [data-media-key='<key>']{ background-image:url('<url>'); ... }
 * This makes data-media-key a deterministic resolution anchor on par with the placeholder.
 */
export function injectMediaByDataKey(
    artifacts: LlmStructuredArtifacts,
    injections: Map<string, string>,
): LlmStructuredArtifacts {
    if (injections.size === 0) return artifacts;

    let html = artifacts.html;
    const cssRules: string[] = [];

    const ruleFor = (key: string, url: string) =>
        `[data-media-key="${key}"]{background-image:url('${url}');background-size:cover;background-position:center;background-repeat:no-repeat}`;

    try {
        const $ = cheerio.load(html, null, false);
        for (const [key, url] of injections.entries()) {
            const el = $(`[data-media-key='${key}']`).first();
            if (el.length > 0 && el.is("img")) {
                el.attr("src", url);
                continue;
            }
            // Element missing or not an <img> → scoped CSS background rule.
            cssRules.push(ruleFor(key, url));
        }
        html = $.html();
    } catch {
        for (const [key, url] of injections.entries()) {
            cssRules.push(ruleFor(key, url));
        }
    }

    const css = cssRules.length > 0
        ? `${artifacts.css}\n${cssRules.join("\n")}`
        : artifacts.css;

    return { ...artifacts, html, css };
}

function annotateHtmlMediaKeys(html: string, replacements: Map<string, string>): string {
    if (!html.includes("asset://media/") || replacements.size === 0) return html;

    try {
        const $ = cheerio.load(html, null, false);
        $("[src], [srcset], [style]").each((_, element) => {
            const node = $(element);
            if (node.attr("data-media-key")) return;

            const attrValues = [node.attr("src"), node.attr("srcset"), node.attr("style")]
                .filter((value): value is string => Boolean(value));

            for (const key of replacements.keys()) {
                if (attrValues.some((value) => value.includes(`asset://media/${key}`))) {
                    node.attr("data-media-key", key);
                    return;
                }
            }
        });

        return $.html();
    } catch {
        return html;
    }
}
