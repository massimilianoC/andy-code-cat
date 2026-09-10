# LLM JSON Parsing — Guidelines and Techniques

Guida pratica e riusabile per gestire risposte JSON generate da LLM nei sistemi di produzione.
Extracted and generalised from this project's `llmParser.ts` pipeline.

---

## Contents

1. [The problem](#the-problem)
2. [Overall architecture](#overall-architecture)
3. [Phase 1 — Pre-parsing cleanup](#phase-1--pre-parsing-cleanup)
4. [Phase 2 — Candidate extraction](#phase-2--candidate-extraction)
5. [Phase 3 — Repair strategy chain](#phase-3--repair-strategy-chain)
6. [Phase 4 — Selecting the best result](#phase-4--selecting-the-best-result)
7. [Phase 5 — Post-parse normalisation](#phase-5--post-parse-normalisation)
8. [Structural field validation](#structural-field-validation)
9. [Naming conventions](#naming-conventions)
10. [Table of LLM bugs covered](#table-of-llm-bugs-covered)
11. [Common pitfalls](#common-pitfalls)
12. [Recommended order of application](#recommended-order-of-application)

---

## The problem

LLM output produces JSON that occasionally fails `JSON.parse()` for a recurring set of reasons:

- Markdown fences (`\`\`\`json ... \`\`\``) inserted around the output
- Unescaped control characters inside strings (literal `\n`, `\r`, `\t`)
- Invalid escapes (`\>`, `\`, etc.) not recognized by the JSON standard
- Premature string termination: a `"` not preceded by `\` but not in a valid closing position
- Response truncated by the `max_tokens` limit, leaving objects and arrays unclosed
- Double HTML encoding (`lang=\"it\"` instead of `lang="it"`)
- Malformed HTML tags in the HTML value (`<h11>`, `</>`)
- Empty strings, or `<style>`/`<script>` wrappers, in the CSS/JS sections
- Stray tokens between JSON fields (e.g. Hunyuan model: `>",` between two fields)

---

## Overall architecture

```
rawLlmOutput
    │
    ▼
[1] Pre-parse cleanup (fence stripping, pre-repair)
    │
    ▼
[2] Generation of multiple candidates (stripped, fenced, extracted, pre-repaired...)
    │
    ▼
[3] For each candidate → chain of repair strategies
    │   ├─ Direct JSON.parse
    │   ├─ repairInvalidJsonEscapes
    │   ├─ triple-pass (escape + premature-termination + escape)
    │   ├─ repairTruncatedJson
    │   └─ jsonrepair (last resort)
    │
    ▼
[4] Select the highest-scoring result
    │
    ▼
[5] Post-parse normalization (HTML, CSS/JS, duplicate fields)
    │
    ▼
Validated canonical result
```

---

## Phase 1 — Pre-parsing cleanup

### 1.1 Strip markdown fence

Strip the \`\`\`json ... \`\`\` delimiters with string operations (more robust than a regex when the content is huge):

```ts
let stripped = trimmed;
if (stripped.startsWith("```")) {
    stripped = stripped.replace(/^```(?:json)?\s*\n?/i, "");
    const lastFence = stripped.lastIndexOf("```");
    if (lastFence > 0) stripped = stripped.slice(0, lastFence).trim();
}
// Regex fallback for fences embedded in the text
const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/is);
```

**Rule:** ALWAYS apply this before any other repair. Never rely on JSON.parse against the raw text.

### 1.2 Pre-repair before extraction

Some models (gemma, for instance) terminate a string prematurely with an unescaped `"`. That makes `extractFirstJsonObject` miscount the braces inside the HTML and return a truncated object.

Solution: apply the escape and premature-termination repairs BEFORE extracting the first object:

```ts
const preRepaired = repairInvalidJsonEscapes(
    repairPrematureStringTermination(repairInvalidJsonEscapes(trimmed))
);
```

---

## Phase 2 — Candidate extraction

Generate several candidate versions of the same input and deduplicate them:

```ts
const rawCandidates = [
    stripped !== trimmed ? stripped : null,          // fence-stripped
    fenceMatch?.[1]?.trim() ?? null,                  // regex-fence
    extractFirstJsonObject(trimmed),                  // brace-scan raw
    extractFirstJsonObject(preRepaired),              // brace-scan pre-repaired
    extractFirstJsonObject(stripped),                 // brace-scan stripped
    gtRepaired !== source ? gtRepaired : null,        // stray-gt-repaired
    gtRepaired !== source ? extractFirstJsonObject(gtRepaired) : null,
];
// Deduplicazione order-preserving
const seen = new Set<string>();
const candidates = rawCandidates.filter(c => c && !seen.has(c) && seen.add(c));
```

### extractFirstJsonObject — brace-depth state machine

```ts
function extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) { escaped = false; }
            else if (ch === "\\") { escaped = true; }
            else if (ch === '"') { inString = false; }
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "{") depth++;
        if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
}
```

**Critical rule:** extraction must use a state machine that honours `inString + escaped`. Never use `indexOf("{")` / `lastIndexOf("}")` without string tracking - every `{` inside HTML counts towards depth.

---

## Phase 3 — Repair strategy chain

Apply them in order, least to most invasive. Stop at the first success per candidate, then compare scores.

### Strategy 1 — Direct parse

```ts
JSON.parse(candidate)
```

### Strategy 2 — `repairInvalidJsonEscapes`

Corregge due classi di errori dentro stringhe JSON:

**a) Escape sequences invalide** (`\>`, `\`, ecc.):

```ts
// If the character after \ is not a valid JSON escape (\", \\, \/, \b, \f, \n, \r, \t, \u)
// → replace with \\ + char (keeps the literal backslash)
out += "\\\\";
out += ch;
```

**b) Caratteri di controllo non escapati** (LLM emette newline reale dentro stringa):

```ts
if (code === 0x0a) { out += "\\n"; continue; }  // newline
if (code === 0x0d) { out += "\\r"; continue; }  // carriage return
if (code === 0x09) { out += "\\t"; continue; }  // tab
```

The state machine's base pattern (identical across every repair function):

```ts
let inString = false, escaped = false;
for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!inString) {
        if (ch === '"') inString = true;
        out += ch;
        continue;
    }
    if (escaped) { escaped = false; /* processa ch */ continue; }
    if (ch === "\\") { escaped = true; out += ch; continue; }
    if (ch === '"') { inString = false; out += ch; continue; }
    // → at this point we are inside a string, not in an escape
}
```

### Strategy 3 — Triple-pass (gemma pattern)

```ts
repairInvalidJsonEscapes(
    repairPrematureStringTermination(
        repairInvalidJsonEscapes(candidate)
    )
)
```

**Why three passes:** some models emit correct `\"` to open HTML attributes but close them with a `"` carrying no backslash. The first `repairInvalidJsonEscapes` pass leaves `"` alone (they are not escape sequences), so `repairPrematureStringTermination` is needed to recognise the premature closes, followed by a second escape-repair pass.

### `repairPrematureStringTermination`

Logic: on encountering a `"` inside a string, look ahead (skipping whitespace) and check whether the next character is a valid JSON value terminator:

```ts
if (ch === '"') {
    let j = i + 1;
    while (j < input.length && /\s/.test(input[j])) j++;
    const nextCh = j < input.length ? input[j] : "";
    // ":" is required for JSON keys - without it, every key would look "internal"
    if (nextCh === "," || nextCh === "}" || nextCh === "]" || nextCh === ":" || nextCh === "") {
        out += '"';
        inString = false;
    } else {
        out += '\\"';  // prematura: escapa
    }
    continue;
}
```

**Critical pitfall:** without `":"` among the valid characters, **every JSON key** (`"key":`) is read as a premature termination, corrupting the whole document. The `":"` is the key-value separator - the `"` closing a key is always followed by `:`.

### Strategy 4 — `repairTruncatedJson`

Used when the model hit the `max_tokens` limit and the response ends mid-string or with open objects or arrays.

```ts
function repairTruncatedJson(input: string): string {
    const stack: ("{" | "[")[] = [];
    let inString = false, escaped = false;
    // ... scan per tracciare stack di {[ aperti ...
    let suffix = "";
    if (inString) suffix += '"';           // chiudi stringa aperta
    for (let i = stack.length - 1; i >= 0; i--)
        suffix += stack[i] === "{" ? "}" : "]";  // chiudi in ordine inverso
    return input + suffix;
}
```

**Note:** the result is partial JSON - the last field's content may be truncated. That is precisely why scoring is used, to prefer complete results.

### Strategy 5 — `jsonrepair` (library)

```ts
import { jsonrepair } from "jsonrepair";
JSON.parse(jsonrepair(candidate));
```

Last resort. It covers unforeseen patterns but can introduce unwanted transformations. Apply it only when every preceding strategy has failed.

### Additional repair — `repairStrayGtBetweenFields` (Hunyuan-A13B)

Some models emit a spurious `>",` token between JSON fields (the trailing `>` of the HTML "escaping" out of the string):

```
"html": "...</html>",
>"`,             ← SPURIO
"css": "..."
```

Solution: detect a `>` outside a string followed by an optional `"` and an optional `,`, confirm the next significant character is a `"` (a new field), and skip the spurious sequence:

```ts
if (ch === ">") {
    let j = i + 1;
    if (input[j] === '"') j++;
    if (input[j] === ',') j++;
    // salta whitespace
    let k = j;
    while (k < input.length && /\s/.test(input[k])) k++;
    if (input[k] === '"') {
        i = j - 1;  // salta il token spurio
        continue;
    }
    out += ch;
}
```

---

## Phase 4 — Selecting the best result

When several candidates parse successfully, choose the one with the **highest score** - not the first. This stops a `repairTruncatedJson` result on a degraded candidate from "beating" a clean, complete parse of a better one.

### Scoring function

```ts
function scoreResult(r: ParsedResult): number {
    let score = 0;
    const html = r.artifacts.html;
    score += Math.min(html.length, 50000) / 100;    // più HTML = meglio
    if (/<!doctype\s+html/i.test(html)) score += 100;  // documento completo
    else if (/<html\b/i.test(html)) score += 80;
    if (/<\/html>/i.test(html)) score += 60;           // chiuso correttamente
    if (/<head\b/i.test(html)) score += 20;
    if (/<body\b/i.test(html)) score += 20;
    if (r.chat.summary.length > 10) score += 20;
    if (r.chat.bullets.length > 0) score += 10;
    if (r.artifacts.css.length > 50) score += 15;
    if (r.artifacts.js.length > 0) score += 3;
    return score;
}
```

**Principle:** a truncated parse always has shorter HTML and lacks `</html>` → low score → discarded whenever a complete parse exists.

---

## Phase 5 — Post-parse normalisation

### 5.1 `unescapeDoubleEncodedHtml`

Some models double-encode HTML attributes inside the JSON (`lang=\"it\"` reaches the HTML value as `lang=\"it\"` instead of `lang="it"`):

```ts
function unescapeDoubleEncodedHtml(html: string): string {
    if (!html.includes('=\\"')) return html;  // fast path
    return html
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
}
```

**Rule:** apply this ONLY when the `=\"` pattern is present - it avoids unwanted transformations of normal HTML.

### 5.2 `normalizeHtmlArtifact`

Fixes post-parse markup aberrations:

```ts
function normalizeHtmlArtifact(html: string): string {
    if (!html) return html;
    return html
        // Heading tags with a doubled digit: <h11> → <h1>, </h33> → </h3>
        .replace(/<(\/?)h(\d)\2>/gi, "<$1h$2>")
        // Empty closing tags </> — non-standard, remove
        .replace(/<\/>/g, "");
}
```

### 5.3 `normalizeArtifactCssJs`

Some models wrap CSS and JS in their respective tags despite instructions to the contrary:

```ts
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
```

### 5.4 Fallback: extracting CSS/JS from the HTML

When `artifacts.css` and `artifacts.js` are empty but the model inlined everything into the HTML:

```ts
function extractArtifactsFromHtml(html: string): { css: string; js: string } {
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const css = styleMatch?.[1]?.trim() ?? "";
    // Only scripts without src= (excludes external CDNs)
    const scriptMatch = html.match(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/i);
    const js = scriptMatch?.[1]?.trim() ?? "";
    return { css, js };
}
```

**Rule:** apply the fallback only when the field is empty after `normalizeArtifactCssJs`.

---

## Structural field validation

After parsing, validate every optional field explicitly before accepting it:

```ts
function extractFocusPatch(parsed: Partial<LlmResponse>): FocusPatch | undefined {
    const fp = parsed.focusPatch;
    if (!fp) return undefined;
    // Enum check
    if (!["html", "css", "js"].includes(fp.targetType)) return undefined;
    // Optional field: when present it must be a non-empty string
    if (fp.anchor !== undefined && (typeof fp.anchor !== "string" || !fp.anchor.trim())) return undefined;
    // Required field: non-empty string
    if (typeof fp.replacement !== "string" || !fp.replacement.trim()) return undefined;
    return fp;
}
```

**Principi:**

- Distinguish **optional** fields (`!== undefined` before the type check) from **required** ones
- Use `trim()` to reject whitespace-only strings
- Enum checks must be explicit; do not rely on the type system at runtime
- Return `undefined` (not `null`) for absent optional fields

### Canonical assembly with defaults

```ts
function assembleResult(parsed: Partial<LlmResponse>): LlmResponse | null {
    if (!parsed?.chat || !parsed?.artifacts) return null;
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
```

**Regole:**

- `String(value ?? "")` for required string fields - never assume a field is already a string
- `Array.isArray(arr) ? arr.map(String) : []` for arrays - never assume the element type
- Centralise assembly in one function - do not duplicate it in every try-catch branch

---

## Naming conventions

| Pattern | Snake_case | camelCase | Meaning |
|---|---|---|---|
| Repair function | - | `repairXxx` | Transforms a string; does not mutate state |
| Normalisation function | - | `normalizeXxx` | Cleans and harmonises an already-parsed value |
| Extraction function | - | `extractXxx` | Derives a subset from a larger value |
| Field validation function | — | `extractXxx` | Validates and returns the field, or undefined |
| Assembly function | — | `assembleXxx` | Builds the final canonical result |
| Scoring function | - | `scoreXxx` | Computes the quality score of a result |
| Public parsing function | — | `tryParseXxx` | Public entry point, returns `{ result, valid }` |

**Naming rules:**

- `repair*` never throws - it always returns a string
- `try*` catches exceptions internally — returns `null` or `{ valid: false }` on failure
- `assemble*` returns `null` when required fields are missing
- Repair names describe **what they fix**, not the model that caused it (`repairPrematureStringTermination`, not `repairGemmaDoubleQuoteBug`)

---

## Table of LLM bugs covered

| Bug | Known models | Repair function |
|---|---|---|
| Markdown fence `\`\`\`json` around the response | almost all | fence stripping (phase 1) |
| Invalid escape sequences (`\>`, `\`) | various | `repairInvalidJsonEscapes` |
| Literal newlines/tabs inside JSON strings | various | `repairInvalidJsonEscapes` |
| Premature string termination with an unescaped `"` | gemma, phi | `repairPrematureStringTermination` |
| Response truncated by `max_tokens` | all | `repairTruncatedJson` |
| Double HTML encoding `lang=\"it\"` | qwen, mistral | `unescapeDoubleEncodedHtml` |
| Duplicated heading tags `<h11>` | various | `normalizeHtmlArtifact` |
| Empty closing tags `</>` | various | `normalizeHtmlArtifact` |
| CSS/JS wrapped in `<style>`/`<script>` | various | `normalizeArtifactCssJs` |
| CSS/JS empty but inlined in the HTML | various | `extractArtifactsFromHtml` |
| Stray token `>",` between JSON fields | Hunyuan-A13B | `repairStrayGtBetweenFields` |

---

## Common pitfalls

### ❌ A repair that does not respect string boundaries

```ts
// WRONG: global regex over the raw string - it also hits HTML values
json.replace(/\n/g, "\\n")

// CORRECT: state machine that tracks inString + escaped
```

### ❌ `repairPrematureStringTermination` without the `":"` case

```ts
// WRONG: missing ":" → every JSON key is "held open"
if (nextCh === "," || nextCh === "}" || nextCh === "]" || nextCh === "") {

// CORRECT
if (nextCh === "," || nextCh === "}" || nextCh === "]" || nextCh === ":" || nextCh === "") {
```

### ❌ Taking the first successful parse instead of the best one

```ts
// WRONG: repairTruncatedJson on a degraded candidate "wins"
for (const candidate of candidates) {
    const result = tryParseWithRepairs(candidate);
    if (result) return result;  // ← first success, and it may be truncated
}

// CORRECT: collect every success, return the best by score
```

### ❌ Applying `unescapeDoubleEncodedHtml` unconditionally

```ts
// WRONG: transforms normal HTML that does not need it
const html = unescapeDoubleEncodedHtml(rawHtml);

// CORRECT: fast path with a preventive check
if (!html.includes('=\\"')) return html;
```

### ❌ Duplicating assembly logic in every branch

```ts
// WRONG: every catch/else reassembles the result its own way
// CORRECT: a single assembleResult() function called from every branch
```

### ❌ Using standard `"` in HTML attributes inside JSON

When the prompt instructs an LLM to generate HTML inside JSON, mandate **single quotes** for every HTML attribute:

```
// In the system prompt sent to the LLM:
Use single quotes for ALL HTML attributes.
WRONG: <html lang="it">
RIGHT: <html lang='it'>
```

This eliminates 90% of HTML-in-JSON escaping problems at the root.

---

## Recommended order of application

```
Input raw LLM
    │
    ├─1─ trim()
    ├─2─ fence strip (string ops + regex fallback)
    ├─3─ repairStrayGtBetweenFields (models with token artifacts)
    ├─4─ pre-repair: repairInvalidJsonEscapes(repairPrematureStringTermination(repairInvalidJsonEscapes(raw)))
    │
    ├─ Generate candidates (deduplicated):
    │     [ stripped, fenceMatch, extractFirstJsonObject(raw),
    │       extractFirstJsonObject(preRepaired), extractFirstJsonObject(stripped),
    │       gtRepaired, extractFirstJsonObject(gtRepaired) ]
    │
    ├─ For each candidate, apply the strategies:
    │     1. JSON.parse(candidate)
    │     2. JSON.parse(repairInvalidJsonEscapes(candidate))
    │     3. JSON.parse(repairInvalidJsonEscapes(repairPrematureStringTermination(repairInvalidJsonEscapes(candidate))))
    │     4. JSON.parse(repairTruncatedJson(repairInvalidJsonEscapes(candidate)))
    │     5. JSON.parse(jsonrepair(candidate))
    │
    ├─ Collect every valid result → select by score
    │
    ├─ Post-parse:
    │     unescapeDoubleEncodedHtml(html)
    │     normalizeHtmlArtifact(html)
    │     normalizeArtifactCssJs(css, "css")
    │     normalizeArtifactCssJs(js, "js")
    │     extractArtifactsFromHtml(html)  ← only if css/js are empty
    │
    └─ assembleResult() → validated canonical result
```

---

## Implementation reference

File sorgente nel progetto: `apps/api/src/application/llm/llmParser.ts`

External dependency: [`jsonrepair`](https://www.npmjs.com/package/jsonrepair) - used as the last resort in strategy 5.
