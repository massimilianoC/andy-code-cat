import type { LlmStructuredResponse } from "@andy-code-cat/contracts";
import { jsonrepair } from "jsonrepair";

/**
 * Last-resort repair for JSON strings truncated mid-way (e.g. LLM hit max_tokens limit).
 * Closes any open string, arrays, and objects to produce parseable (partial) JSON.
 */
function repairTruncatedJson(input: string): string {
    const stack: ("{" | "[")[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i]!;

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
        } else if (ch === "{") {
            stack.push("{");
        } else if (ch === "[") {
            stack.push("[");
        } else if (ch === "}") {
            if (stack.at(-1) === "{") stack.pop();
        } else if (ch === "]") {
            if (stack.at(-1) === "[") stack.pop();
        }
    }

    let suffix = "";
    if (inString) suffix += '"';
    for (let i = stack.length - 1; i >= 0; i--) {
        suffix += stack[i] === "{" ? "}" : "]";
    }

    return input + suffix;
}

function repairInvalidJsonEscapes(input: string): string {
    let out = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i]!;
        const code = input.charCodeAt(i);

        if (!inString) {
            if (ch === '"') {
                inString = true;
            }
            out += ch;
            continue;
        }

        if (escaped) {
            const valid = ch === '"' || ch === "\\" || ch === "/" || ch === "b" || ch === "f" || ch === "n" || ch === "r" || ch === "t" || ch === "u";
            if (!valid) {
                // Keep literal backslash when model emits invalid escapes like "\ "
                out += "\\\\";
                out += ch;
            } else {
                out += ch;
            }
            escaped = false;
            continue;
        }

        if (ch === "\\") {
            out += ch;
            escaped = true;
            continue;
        }

        if (ch === '"') {
            inString = false;
            out += ch;
            continue;
        }

        // Repair literal unescaped control characters inside JSON string values.
        // LLMs sometimes emit raw newlines inside HTML/JS string content which
        // makes JSON.parse throw even though the rest of the JSON is valid.
        if (code === 0x0a) { out += "\\n"; continue; }
        if (code === 0x0d) { out += "\\r"; continue; }
        if (code === 0x09) { out += "\\t"; continue; }

        out += ch;
    }

    return out;
}

/**
 * Repairs JSON where a string value is prematurely closed by a bare `"` that follows
 * `\\` (an escaped backslash). Some models emit `\\"` consistently for HTML attribute
 * quotes but occasionally emit `\\"` as just `\\ + "` by mistake, causing JSON.parse
 * to terminate the string mid-content.
 *
 * Heuristic: if the `"` that would close a string is NOT followed (after whitespace) by
 * a valid JSON continuation character (`,`, `}`, `]`), treat it as escaped instead.
 */
function repairPrematureStringTermination(input: string): string {
    let out = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i]!;

        if (!inString) {
            if (ch === '"') inString = true;
            out += ch;
            continue;
        }

        if (escaped) {
            escaped = false;
            out += ch;
            continue;
        }

        if (ch === "\\") {
            escaped = true;
            out += ch;
            continue;
        }

        if (ch === '"') {
            // Peek ahead (skip whitespace) to determine if this is a legitimate string end.
            let j = i + 1;
            while (j < input.length && (input[j] === ' ' || input[j] === '\t' || input[j] === '\r' || input[j] === '\n')) j++;
            const nextCh = j < input.length ? input[j] : "";
            // ":" is also a valid JSON string continuation (closing quote of a key,
            // e.g. "key": value). Without it, the function incorrectly escapes the
            // closing " of every JSON key, leaving the parser stuck in "in-string"
            // mode for the rest of the document and corrupting all repair output.
            if (nextCh === "," || nextCh === "}" || nextCh === "]" || nextCh === ":" || nextCh === "") {
                out += '"';
                inString = false;
            } else {
                // Premature termination: escape the quote to keep the string open.
                out += '\\"';
            }
            continue;
        }

        out += ch;
    }

    return out;
}

/**
 * Some models double-encode HTML attribute quotes (emitting `\\\"` in the JSON,
 * which parses to `\"` backslash+quote in the html value) and newlines (`\\n` → `\n`).
 * These break HTML rendering: `lang=\"it\"` is not valid HTML.
 * Detect by the presence of `=\"` pattern and unescape one level.
 */
function unescapeDoubleEncodedHtml(html: string): string {
    if (!html.includes('=\\"')) return html;
    return html
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
}

/**
 * Post-parse normalization of the HTML artifact to fix model-generated markup
 * aberrations that are syntactically broken in browsers but tolerated by some
 * LLMs. Applied after JSON parsing and HTML unescape, so it operates on real
 * HTML characters, not JSON-encoded ones.
 *
 * Rules (safe to run on any HTML string):
 * 1. Doubled-digit heading tags: `<h11>` ↔ `<h1>`, `</h22>` ↔ `</h2>`, etc.
 *    Pattern: `<(/)? h (\d) \2 >` — takes the first digit as the level.
 * 2. Empty closing tags `</>` — non-standard, produced by some models after
 *    link elements; removed entirely.
 */
function normalizeHtmlArtifact(html: string): string {
    if (!html) return html;
    return html
        // Rule 1: doubled-digit heading tags (e.g. <h11> → <h1>, </h33> → </h3>)
        .replace(/<(\/?)h(\d)\2>/gi, "<$1h$2>")
        // Rule 2: empty closing tags </> — remove
        .replace(/<\/>/g, "");
}

/**
 * When a model puts everything inside artifacts.html (a single self-contained document)
 * and leaves artifacts.css / artifacts.js empty, extract the inline style and script
 * blocks so the side-panel editors are populated.
 *
 * The HTML is left untouched — it keeps the inline <style>/<script> so the iframe
 * continues to render correctly.
 */
function extractArtifactsFromHtml(html: string): { css: string; js: string } {
    // Extract first <style> block (skip <style> with scoped/media on complex attributes — simple match is fine)
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const css = styleMatch?.[1]?.trim() ?? "";

    // Extract first inline <script> (skip CDN scripts that have a src= attribute)
    const scriptMatch = html.match(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/i);
    const js = scriptMatch?.[1]?.trim() ?? "";

    return { css, js };
}

function normalizeArtifactCssJs(content: string, kind: "css" | "js"): string {
    const trimmed = content.trim();
    if (!trimmed) return "";

    if (kind === "css") {
        const match = trimmed.match(/^<style[^>]*>([\s\S]*?)<\/style>$/i);
        return (match?.[1] ?? trimmed).trim();
    }

    const match = trimmed.match(/^<script[^>]*>([\s\S]*?)<\/script>$/i);
    return (match?.[1] ?? trimmed).trim();
}

function extractFocusPatch(parsed: Partial<LlmStructuredResponse>): LlmStructuredResponse["focusPatch"] {
    const fp = parsed.focusPatch;
    if (!fp) return undefined;
    if (!["html", "css", "js"].includes(fp.targetType)) return undefined;
    // anchor is optional in inspector mode (server derives it from selectedElement.outerHtml)
    if (fp.anchor !== undefined && (typeof fp.anchor !== "string" || !fp.anchor.trim())) return undefined;
    if (typeof fp.replacement !== "string" || !fp.replacement.trim()) return undefined;
    return fp;
}

/**
 * Converts a successfully-parsed (possibly partial) LLM response object into
 * the canonical LlmStructuredResponse, applying all post-parse artifact
 * normalizations. Returns null if the required fields are absent.
 * Centralises the assembly logic that was previously duplicated across every
 * repair try-catch branch.
 */
function assembleResult(parsed: Partial<LlmStructuredResponse>): LlmStructuredResponse | null {
    if (!parsed?.chat || !parsed?.artifacts) return null;
    const htmlStr = normalizeHtmlArtifact(unescapeDoubleEncodedHtml(String(parsed.artifacts.html ?? "")));
    let cssStr = normalizeArtifactCssJs(String(parsed.artifacts.css ?? ""), "css");
    let jsStr = normalizeArtifactCssJs(String(parsed.artifacts.js ?? ""), "js");
    if (!cssStr || !jsStr) {
        const extracted = extractArtifactsFromHtml(htmlStr);
        if (!cssStr) cssStr = extracted.css;
        if (!jsStr) jsStr = extracted.js;
    }
    return {
        chat: {
            summary: String(parsed.chat.summary ?? ""),
            bullets: Array.isArray(parsed.chat.bullets) ? parsed.chat.bullets.map(String) : [],
            nextActions: Array.isArray(parsed.chat.nextActions) ? parsed.chat.nextActions.map(String) : [],
        },
        artifacts: { html: htmlStr, css: cssStr, js: jsStr },
        focusPatch: extractFocusPatch(parsed),
    };
}

/**
 * Attempts to parse a single JSON candidate string using a sequence of repair
 * strategies, from least to most invasive. Returns the assembled result on the
 * first success, or null if all strategies fail.
 *
 * Strategy order:
 * 1. Direct JSON.parse — no transformation
 * 2. repairInvalidJsonEscapes — fixes \> and literal control chars inside strings
 * 3. Triple-pass premature-termination + escape repair (gemma \\" pattern)
 * 4. repairTruncatedJson — closes open strings/arrays/objects (max_tokens cut-off)
 * 5. jsonrepair library — broad heuristic, last resort
 */
function tryParseWithRepairs(candidate: string): LlmStructuredResponse | null {
    const strategies: Array<() => string> = [
        () => candidate,
        () => repairInvalidJsonEscapes(candidate),
        () => repairInvalidJsonEscapes(repairPrematureStringTermination(repairInvalidJsonEscapes(candidate))),
        () => repairTruncatedJson(repairInvalidJsonEscapes(candidate)),
        () => jsonrepair(candidate),
    ];
    for (const getRepaired of strategies) {
        try {
            const text = getRepaired();
            const result = assembleResult(JSON.parse(text) as Partial<LlmStructuredResponse>);
            if (result !== null) return result;
        } catch { /* try next strategy */ }
    }
    return null;
}

/**
 * Quality score for a parsed LlmStructuredResponse. Used to select the best
 * result when multiple candidates parse successfully (e.g. a complete parse
 * from a repaired candidate vs. a truncated parse from repairTruncatedJson).
 *
 * Higher = better. A truncated parse always loses to a complete one because
 * it lacks structural HTML closing markers and has shorter html content.
 */
function scoreResult(r: LlmStructuredResponse): number {
    let score = 0;
    const html = r.artifacts.html;
    score += Math.min(html.length, 50000) / 100;
    if (/<!doctype\s+html/i.test(html)) score += 100;
    else if (/<html\b/i.test(html)) score += 80;
    if (/<\/html>/i.test(html)) score += 60;
    if (/<head\b/i.test(html)) score += 20;
    if (/<body\b/i.test(html)) score += 20;
    if (r.chat.summary.length > 10) score += 20;
    if (r.chat.bullets.length > 0) score += 10;
    if (r.chat.nextActions.length > 0) score += 5;
    if (r.artifacts.css.length > 50) score += 15;
    else if (r.artifacts.css.length > 0) score += 5;
    if (r.artifacts.js.length > 0) score += 3;
    return score;
}

/**
 * Hunyuan-A13B and similar models sometimes emit a stray `>",` (or `>"`)
 * between JSON object fields — an HTML closing-bracket artifact that leaks
 * out of the HTML-in-JSON value into the surrounding JSON structure.
 *
 * Typical pattern produced:
 *   "html": "...\n</html>",   ← valid: closes html value + comma
 *   \n>",                     ← STRAY: \n > " ,  (invalid at object level)
 *   \n    "css": "..."        ← the real next field
 *
 * Implemented as a string-aware state machine (matching all other repair
 * functions in this file) to avoid false positives on `>` characters that
 * legitimately appear inside JSON string values (HTML content).
 * The `>` is only treated as stray when it appears OUTSIDE a JSON string AND
 * is followed by an orphaned `"` + optional `,` before the next real field.
 */
function repairStrayGtBetweenFields(input: string): string {
    let out = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i]!;

        if (inString) {
            if (escaped) {
                escaped = false;
                out += ch;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                out += ch;
                continue;
            }
            if (ch === '"') {
                inString = false;
                out += ch;
                continue;
            }
            out += ch;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }

        // Outside a string: `>` is never a valid JSON structural character.
        // Detect and remove the Hunyuan stray-gt pattern:
        //   `>` + optional-`"` + optional-`,` followed (after whitespace) by `"`
        if (ch === ">") {
            let j = i + 1;
            // skip orphaned closing quote
            if (j < input.length && input[j] === '"') j++;
            // skip orphaned trailing comma
            if (j < input.length && input[j] === ',') j++;
            // verify next meaningful char is the start of a real JSON field
            let k = j;
            while (k < input.length && (input[k] === ' ' || input[k] === '\t' || input[k] === '\r' || input[k] === '\n')) k++;
            if (k < input.length && input[k] === '"') {
                // Confirmed stray: skip `>` + orphaned `"` + orphaned `,`
                // Resume from the whitespace + real field quote (j onwards).
                i = j - 1; // loop will increment to j
                continue;
            }
            // Not a confirmed stray — emit as-is
            out += ch;
            continue;
        }

        out += ch;
    }

    return out;
}

function extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === "{") depth++;
        if (ch === "}") {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

export function tryParseStructuredJson(raw: string): { structured: LlmStructuredResponse | null; parseValid: boolean } {
    const trimmed = raw.trim();

    // Primary: explicit string operations to strip ```json ... ``` fences
    let stripped = trimmed;
    if (stripped.startsWith("```")) {
        stripped = stripped.replace(/^```(?:json)?\s*\n?/i, "");
        const lastFence = stripped.lastIndexOf("```");
        if (lastFence > 0) stripped = stripped.slice(0, lastFence).trim();
    }

    // Secondary: regex-based extraction
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/is);

    // Pre-repair the raw text to fix premature string terminations before extraction.
    // Some models (e.g. gemma) inconsistently escape HTML attribute quotes: they open
    // with \" (correct) but close with a bare " which terminates the JSON string early.
    // extractFirstJsonObject then counts braces inside raw HTML/CSS and returns a
    // truncated blob. Repairing BEFORE extraction gives extractFirstJsonObject correct
    // string boundaries so it returns the full JSON object.
    const preRepaired = repairInvalidJsonEscapes(
        repairPrematureStringTermination(repairInvalidJsonEscapes(trimmed))
    );

    // Repair stray `>","` tokens between JSON fields (Hunyuan-A13B artifact).
    // Applied to the fence-stripped text so it can combine with per-candidate
    // repair passes (e.g. repairInvalidJsonEscapes for \> inside the html value).
    const sourceForGtRepair = stripped !== trimmed ? stripped : trimmed;
    const gtRepaired = repairStrayGtBetweenFields(sourceForGtRepair);

    const rawCandidates = [
        stripped !== trimmed ? stripped : null,
        fenceMatch?.[1]?.trim() ?? null,
        extractFirstJsonObject(trimmed),
        preRepaired !== trimmed ? extractFirstJsonObject(preRepaired) : null,
        stripped !== trimmed ? extractFirstJsonObject(stripped) : null,
        // Stray-gt-repaired candidates (covers Hunyuan >\", pattern between fields)
        gtRepaired !== sourceForGtRepair ? gtRepaired : null,
        gtRepaired !== sourceForGtRepair ? extractFirstJsonObject(gtRepaired) : null,
    ];
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const c of rawCandidates) {
        if (c && !seen.has(c)) { seen.add(c); candidates.push(c); }
    }

    // Try every candidate with all repair strategies; collect successful results.
    // Return the highest-quality result rather than the first successful parse —
    // this prevents truncated/partial repairs from winning over complete parses
    // (e.g. repairTruncatedJson on a later candidate should not beat a clean parse
    // of an earlier, fully-formed one).
    let best: LlmStructuredResponse | null = null;
    let bestScore = -1;
    for (const candidate of candidates) {
        const result = tryParseWithRepairs(candidate);
        if (result !== null) {
            const score = scoreResult(result);
            if (score > bestScore) {
                best = result;
                bestScore = score;
            }
        }
    }

    if (best !== null) {
        return { parseValid: true, structured: best };
    }

    return { parseValid: false, structured: null };
}

export function buildFormattedReply(structured: LlmStructuredResponse): string {
    const { summary, bullets, nextActions } = structured.chat;
    return [
        summary,
        bullets?.length ? bullets.map(b => `• ${b}`).join("\n") : null,
        nextActions?.length ? "Prossimi passi:\n" + nextActions.map((a, i) => `${i + 1}. ${a}`).join("\n") : null,
    ].filter(Boolean).join("\n\n") || summary;
}
