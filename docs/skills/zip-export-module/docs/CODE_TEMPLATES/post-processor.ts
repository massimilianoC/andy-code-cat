/**
 * Portable post-processor: turns raw LLM-agent artifacts (HTML with possibly inline
 * <style>/<script>, plus optional separate CSS/JS fields) into clean, deploy-ready
 * files, and detects assets the user needs to replace before deploying.
 *
 * Pure function, no I/O — unit-test this directly with fixture HTML strings before
 * wiring any routes/storage around it. See docs/PORTING_CHECKLIST.md.
 */

export interface Artifacts {
    html: string; // full HTML document, may contain inline <style>/<script>
    css: string;   // may be empty — some agents return CSS separately from HTML
    js: string;    // may be empty — same as above
}

export interface AssetPlaceholder {
    path: string;              // e.g. "assets/placeholder-hero.jpg"
    usedIn: string;            // e.g. "<img> in HTML"
    recommendedSize?: string;  // e.g. "1200x800px"
}

export interface ProcessedArtifacts {
    html: string;
    css: string;
    js: string;
    placeholders: AssetPlaceholder[];
}

// ---------------------------------------------------------------------------
// Step 1 — strip anything preview-only, not deploy-relevant.
// Adapt this to whatever your platform injects purely for sandboxed preview
// rendering (CSP meta tags, preview-only data attributes, etc.).
// ---------------------------------------------------------------------------
// NOTE: these three helpers scan with indexOf instead of a single backtracking
// regex like /<meta[^>]+.../ or /<style>([\s\S]*?)<\/style>/. HTML here comes
// from an LLM agent (untrusted, attacker-shaped in the worst case) — a lazy
// "[\s\S]*?" or unbounded "[^>]+" over that input backtracks catastrophically
// on crafted strings (e.g. many "<meta" with no closing ">", or repeated
// "<style</style" with no ">"). Every failure path below stops the whole scan
// instead of retrying — if a closing sequence isn't found from a position
// onward, it can't be found later either, so bailing is both safe and O(n).

function stripMetaCsp(html: string): string {
    const lower = html.toLowerCase();
    let result = "";
    let cursor = 0;

    while (cursor < html.length) {
        const idx = lower.indexOf("<meta", cursor);
        if (idx === -1) { result += html.slice(cursor); return result; }

        const gtIdx = html.indexOf(">", idx);
        if (gtIdx === -1) { result += html.slice(cursor); return result; }

        const tag = html.slice(idx, gtIdx + 1);
        const isCsp = /http-equiv\s*=\s*["']content-security-policy["']/i.test(tag);

        result += html.slice(cursor, idx);
        if (!isCsp) result += tag;
        cursor = gtIdx + 1;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Step 2 — extract inline <style>/<script> blocks.
// ---------------------------------------------------------------------------
function extractInlineCss(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    const lower = html.toLowerCase();
    let result = "";
    let cursor = 0;

    while (cursor < html.length) {
        const openIdx = lower.indexOf("<style", cursor);
        if (openIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        const openGtIdx = html.indexOf(">", openIdx);
        if (openGtIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        const closeIdx = lower.indexOf("</style", openGtIdx);
        if (closeIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        const closeGtIdx = html.indexOf(">", closeIdx);
        if (closeGtIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        const content = html.slice(openGtIdx + 1, closeIdx).trim();
        if (content) blocks.push(content);

        result += html.slice(cursor, openIdx);
        cursor = closeGtIdx + 1;
    }

    return { html: result, extracted: blocks.join("\n\n") };
}

function extractInlineJs(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    const lower = html.toLowerCase();
    let result = "";
    let cursor = 0;

    while (cursor < html.length) {
        const openIdx = lower.indexOf("<script", cursor);
        if (openIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        const openGtIdx = html.indexOf(">", openIdx);
        if (openGtIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        const closeIdx = lower.indexOf("</script", openGtIdx);
        if (closeIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        const closeGtIdx = html.indexOf(">", closeIdx);
        if (closeGtIdx === -1) { result += html.slice(cursor); return { html: result, extracted: blocks.join("\n\n") }; }

        // Only extract <script> tags WITHOUT a src attribute — don't eat
        // <script src="..."> (CDN libraries, or the script.js this module adds).
        const attrs = html.slice(openIdx + "<script".length, openGtIdx);
        const hasSrc = /\bsrc\s*=/i.test(attrs);
        if (hasSrc) {
            result += html.slice(cursor, closeGtIdx + 1);
            cursor = closeGtIdx + 1;
            continue;
        }

        const content = html.slice(openGtIdx + 1, closeIdx).trim();
        if (content) blocks.push(content);

        result += html.slice(cursor, openIdx);
        cursor = closeGtIdx + 1;
    }

    return { html: result, extracted: blocks.join("\n\n") };
}

// ---------------------------------------------------------------------------
// Step 3 — pick canonical source, dedupe near-identical blocks.
//
// LOAD-BEARING RULE: if the dedicated field (agent's separate CSS/JS output) is
// populated, treat it as canonical — the agent also embeds the same content
// inline in HTML purely for iframe preview, so merging both would duplicate
// rules. Only fall back to what was extracted from <style>/<script> tags when
// the dedicated field is empty (agent didn't provide separate fields at all).
// Do NOT "simplify" this into always merging both sources.
// ---------------------------------------------------------------------------
function joinUniqueBlocks(...parts: string[]): string {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const key = trimmed.replace(/\s+/g, " ").trim(); // normalize whitespace before hashing
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(trimmed);
    }
    return unique.join("\n\n");
}

function pickCanonical(dedicatedField: string, extractedFromHtml: string): string {
    return dedicatedField.trim() ? dedicatedField.trim() : joinUniqueBlocks(extractedFromHtml);
}

// ---------------------------------------------------------------------------
// Step 4 — rewrite HTML to reference the separated files. Idempotent — safe to
// call even if a matching tag already exists.
// ---------------------------------------------------------------------------
function ensureLinkTag(html: string): string {
    const linkTag = '<link rel="stylesheet" href="style.css">';
    if (html.includes('href="style.css"')) return html;
    return html.replace(/<\/head>/i, `  ${linkTag}\n</head>`);
}

function ensureScriptTag(html: string): string {
    const scriptTag = '<script src="script.js"></script>';
    if (html.includes('src="script.js"')) return html;
    return html.replace(/<\/body>/i, `  ${scriptTag}\n</body>`);
}

// ---------------------------------------------------------------------------
// Step 5 — asset placeholder detection. Tune these regexes to whatever
// placeholder conventions YOUR agent's system prompt actually produces — the
// three below match the source project's conventions, not a universal standard.
// ---------------------------------------------------------------------------
function detectPlaceholders(html: string, css: string): AssetPlaceholder[] {
    const placeholders: AssetPlaceholder[] = [];

    // Empty or literally-named-"placeholder" <img src>. Scan tag-by-tag with
    // indexOf and only regex-test the small per-tag substring — see the note
    // above extractInlineCss on why a document-wide "<img[^>]+...[^>]*>" isn't safe.
    const lowerHtml = html.toLowerCase();
    let imgCursor = 0;
    while (imgCursor < html.length) {
        const openIdx = lowerHtml.indexOf("<img", imgCursor);
        if (openIdx === -1) break;
        const gtIdx = html.indexOf(">", openIdx);
        if (gtIdx === -1) break;

        const tag = html.slice(openIdx, gtIdx + 1);
        const srcMatch = /src\s*=\s*["']([^"']*)["']/i.exec(tag);
        const src = srcMatch?.[1];
        if (!src || /placeholder/i.test(src)) {
            placeholders.push({
                path: `assets/placeholder-${placeholders.length + 1}.jpg`,
                usedIn: "<img> in HTML",
                recommendedSize: "1200x800px",
            });
        }
        imgCursor = gtIdx + 1;
    }

    // Explicit author intent: "/* replace: ... */" comments in CSS. Scan
    // comment-by-comment with indexOf for the same reason as above.
    let cssCursor = 0;
    while (cssCursor < css.length) {
        const openIdx = css.indexOf("/*", cssCursor);
        if (openIdx === -1) break;
        const closeIdx = css.indexOf("*/", openIdx + 2);
        if (closeIdx === -1) break;

        const comment = css.slice(openIdx + 2, closeIdx);
        const replaceMatch = /^\s*replace:\s*([\s\S]+)$/i.exec(comment);
        if (replaceMatch) {
            placeholders.push({
                path: `assets/replace-${placeholders.length + 1}`,
                usedIn: `CSS comment: ${replaceMatch[1]!.trim()}`,
            });
        }
        cssCursor = closeIdx + 2;
    }

    // Empty CSS url()
    const emptyUrlRe = /url\(["']?\s*["']?\)/gi;
    let m: RegExpExecArray | null;
    while ((m = emptyUrlRe.exec(css)) !== null) {
        placeholders.push({
            path: `assets/placeholder-${placeholders.length + 1}.jpg`,
            usedIn: "CSS url() empty value",
        });
    }

    // Dedupe by generated path
    const seen = new Set<string>();
    return placeholders.filter((p) => {
        if (seen.has(p.path)) return false;
        seen.add(p.path);
        return true;
    });
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------
export function postProcess(artifacts: Artifacts): ProcessedArtifacts {
    let { html, css, js } = artifacts;

    html = stripMetaCsp(html);

    const { html: htmlNoCss, extracted: extractedCss } = extractInlineCss(html);
    html = htmlNoCss;
    const { html: htmlNoJs, extracted: extractedJs } = extractInlineJs(html);
    html = htmlNoJs;

    css = pickCanonical(css, extractedCss);
    js = pickCanonical(js, extractedJs);

    if (css.trim()) html = ensureLinkTag(html);
    if (js.trim()) html = ensureScriptTag(html);

    const placeholders = detectPlaceholders(html, css);

    return { html: html.trim(), css: css.trim(), js: js.trim(), placeholders };
}

// ---------------------------------------------------------------------------
// README generator — the exported ZIP must be self-explanatory without the
// platform. Optional chatHistory param: only pass it for chat-driven agents;
// omit entirely for non-chat agents rather than passing an empty array.
// ---------------------------------------------------------------------------
export function generateReadme(options: {
    projectName: string;
    exportId: string;
    placeholders: AssetPlaceholder[];
    filesIncluded: string[];
}): string {
    const date = new Date().toISOString().slice(0, 10);
    const assetTable =
        options.placeholders.length === 0
            ? "_No placeholders detected._"
            : [
                "| File | Used in | Recommended size |",
                "|---|---|---|",
                ...options.placeholders.map((p) => `| ${p.path} | ${p.usedIn} | ${p.recommendedSize ?? "—"} |`),
            ].join("\n");

    return `# ${options.projectName} — Export

**Export date:** ${date}
**Export ID:** ${options.exportId}

## Quick deploy

Open \`index.html\` directly in a browser, or serve the folder:

\`\`\`bash
npx serve .
\`\`\`

Or point any static host (NGINX, Apache, Netlify, Vercel static) at this folder.

## Files

${options.filesIncluded.map((f) => `- \`${f}\``).join("\n")}

## Assets to replace

${assetTable}
`;
}
