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
function stripMetaCsp(html: string): string {
    return html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
}

// ---------------------------------------------------------------------------
// Step 2 — extract inline <style>/<script> blocks.
// ---------------------------------------------------------------------------
function extractInlineCss(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    const cleaned = html.replace(/<style(?:[^>]*)>([\s\S]*?)<\/style>/gi, (_m, content: string) => {
        const trimmed = content.trim();
        if (trimmed) blocks.push(trimmed);
        return "";
    });
    return { html: cleaned, extracted: blocks.join("\n\n") };
}

function extractInlineJs(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    // Only match <script> tags WITHOUT a src attribute. The negative lookahead on
    // the tag's attributes prevents eating <script src="..."> — CDN libraries, or
    // the very script.js reference this function is about to add.
    const cleaned = html.replace(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi, (_m, content: string) => {
        const trimmed = content.trim();
        if (trimmed) blocks.push(trimmed);
        return "";
    });
    return { html: cleaned, extracted: blocks.join("\n\n") };
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

    // Empty or literally-named-"placeholder" <img src>
    const imgRe = /<img[^>]+src=["']([^"']*)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(html)) !== null) {
        const src = m[1];
        if (!src || /placeholder/i.test(src)) {
            placeholders.push({
                path: `assets/placeholder-${placeholders.length + 1}.jpg`,
                usedIn: "<img> in HTML",
                recommendedSize: "1200x800px",
            });
        }
    }

    // Explicit author intent: "/* replace: ... */" comments in CSS
    const replaceCommentRe = /\/\*\s*replace:\s*([^*]+)\*\//gi;
    while ((m = replaceCommentRe.exec(css)) !== null) {
        placeholders.push({
            path: `assets/replace-${placeholders.length + 1}`,
            usedIn: `CSS comment: ${m[1]!.trim()}`,
        });
    }

    // Empty CSS url()
    const emptyUrlRe = /url\(["']?\s*["']?\)/gi;
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
