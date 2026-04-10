# Focused Component Edit — Integration Spec

## Overview

**Focused Edit** is a surgical LLM editing protocol that lets the user target a single element (via the DOM inspector) or a code selection (via Monaco) and send a minimal edit request to the LLM. Instead of regenerating the entire page, the LLM returns only the modified component (`focusPatch.replacement`). The server merges it back into the current artifact and produces a new versioned snapshot.

**Goals:**

- Token efficiency: avoid regenerating the full page for small changes
- Precision: edits are scoped to the selected component
- Safety: if the merge fails, the base artifacts are returned unchanged (no data loss)

> **Hardening applied (2026-04):** Four robustness improvements were shipped together:
>
> 1. `selectedElement` state cleared on snapshot change to prevent stale-ID mismatch across turns.
> 2. `data-pf-id` preserved in replacement element so Strategy 0 keeps working across successive focused-edit turns on the same element.
> 3. Strategy 3 (structural tag+class match) added as final fallback when all text-based strategies fail.
> 4. Companion CSS/JS now appended to base styles instead of replacing them; notification shown when focal patch fails.

---

## Architecture — Request Flow

```
User selects element in iframe inspector
          │
          ▼
[Frontend] PF_INSPECT_SCRIPT captures outerHTML
          + strips transient markers only: data-pf-h, data-pf-s, data-pf-e  ← preserves data-pf-id
          + strips aos-init, aos-animate, style=""
          + truncates at 4000 chars
          │
          ▼
[Frontend] Builds focusContext = { mode: "preview-element", targetType, selectedElement }
          + selectedElement.outerHtml contains data-pf-id (stable element identity)
          + reads currentArtifacts from activeBaselineSnapshot (isActive=true in DB)
          │
          ▼
[API] POST /llm/chat-preview  (or /stream)
          │
          ▼
[API] buildMessagesWithHistory():
          - system prompt = prePromptTemplate + buildFocusedModeSystemAddendum(focusContext)
          - user message includes [Codice attualmente generato] block with currentArtifacts.html
          │
          ▼
[LLM] Generates focusPatch JSON:
      {
        "chat": { "summary", "bullets", "nextActions" },
        "artifacts": { "html": "", "css": "", "js": "" },
        "focusPatch": {
          "targetType": "html",
          "replacement": "<section id=\"petcare\">...</section>"
        }
      }
          │
          ▼
[API] tryParseStructuredJson() — multi-pass repair chain
          │
          ▼
[API] isFocusedMode branch:
        serverAnchor = selectedElement.outerHtml  (contains data-pf-id)
        if focusPatch present →
            Strategy 0: extractPfId(serverAnchor) → replaceElementByPfId() via cheerio
            Strategy 1: normalizeForMatching(source).includes(normalizeForMatching(anchor))
            Strategy 2: whitespace-flexible regex match
            → first match wins; if all fail → return currentArtifacts unchanged
        if focusPatch absent  → return currentArtifacts unchanged (no snapshot created)
          │
          ▼
[API] structured.artifacts = merged full-page artifacts
          │
          ▼
[Frontend] receives LlmChatPreviewResult.structured.artifacts
          + guard: if (artifacts.html && convId) → createPreviewSnapshot()
          │
          ▼
[API] previewSnapshotRoutes: injectStableIds(artifacts.html) before save
          → all block elements get/keep data-pf-id for future focused edits
          + new snapshot activated as baseline for next turn
          │
          ▼
[Frontend] iframe re-renders with merged artifacts
```

---

## Components

### Frontend — `apps/web/app/workspace/[projectId]/page.tsx`

#### State

| State | Type | Purpose |
|---|---|---|
| `inspectMode` | `boolean` | Inspector on/off toggle |
| `selectedElement` | `LlmFocusContext["selectedElement"]` | Element picked via DOM inspector — **cleared automatically when `artifactsKey` changes** (new snapshot active) and when `focusPatchApplied === false` |
| `codeEditorSelection` | `LlmFocusContext["codeSelection"]` | Lines selected in Monaco |
| `activeBaselineSnapshot` | `PreviewSnapshot` | The `isActive=true` snapshot — baseline for merges and LLM context |

#### `PF_INSPECT_SCRIPT` (injected into iframe)

A minified IIFE injected into every preview iframe alongside the page HTML. Stays idle until `{ type: "pf-inspect", on: true }` postMessage.

- `over(e)` — mouseover handler: sets `data-pf-h=""` on hovered element (CSS outline)
- `clk(e)` — click handler: sets `data-pf-s=""` on selected element, calls `mkdata(el)`, fires `postMessage({ type: "pf-select", element: ... })`
- `mkdata(el)` — serializes element metadata, crucially captures `outerHtml` and **strips runtime DOM mutations** before sending:

  ```js
  oh = oh.replace(/ data-pf-[hse](="")?/g, '');   // transient markers only: h=hover, s=selected, e=edit
  oh = oh.replace(/ (aos-init|aos-animate)/g, '');  // AOS runtime classes
  oh = oh.replace(/ style=""/g, '');                // empty style attrs
  oh = oh.slice(0, 4000);                           // size cap
  ```

> **Why strip only `[hse]`?** `data-pf-h`, `data-pf-s`, and `data-pf-e` are transient hover/select/edit markers. `data-pf-id` is a **stable element identity attribute** (see [Stable Element IDs](#stable-element-ids--data-pf-id)) that must survive the round-trip so the server can perform ID-based replacement (Strategy 0). AOS classes are stripped because AOS.js injects them at runtime but they are absent from the stored source HTML.

#### `focusContext` builder

```ts
const focusContext: LlmFocusContext | undefined = (() => {
    if (inspectMode && selectedElement) {
        return {
            mode: "preview-element",
            targetType: getElementTargetType(selectedElement.tag),
            userIntent: content,
            selectedElement,  // includes cleaned outerHtml
        };
    }
    if (codeEditorSelection && previewTab !== "preview") {
        return {
            mode: "code-selection",
            targetType: codeEditorSelection.language,
            codeSelection,
        };
    }
    return undefined;  // "project" mode = normal full-page generation
})();
```

#### `currentArtifacts`

```ts
const currentArtifacts =
    activeBaselineSnapshot?.artifacts ??
    latestAssistant?.metadata?.generatedArtifacts;
```

**Critical:** `activeBaselineSnapshot` is the snapshot with `isActive: true` in MongoDB. The user activates a snapshot via the version picker. This becomes the merge base for subsequent focused edits. If `isActive` is corrupted (e.g. a failed request overwrote it with empty HTML), all subsequent focused edits will merge against empty content.

#### Snapshot creation guard

```ts
if (llm.structured?.artifacts && llm.structured.artifacts.html && convId) {
    await createPreviewSnapshot(...);
}
```

If `artifacts.html` is empty (e.g. focused mode returned unchanged base because merge failed), no snapshot is created.

---

### API — `apps/api/src/application/llm/focusedPrompt.ts`

Builds the system prompt addendum injected when focused mode is active.

**When `selectedElement` is present (inspector mode):**

- Includes `outerHtml` as a reference block for the LLM to understand the current structure
- Instructs the LLM to **omit** `focusPatch.anchor` — server derives it from `outerHtml`
- Only `focusPatch.replacement` is needed from the LLM

**When only `codeSelection` is present:**

- Includes `anchor` field in the required JSON shape (LLM must copy verbatim from source)

**Why anchor-free for inspector mode?**  
Asking small models (≤30B) to copy large HTML blocks verbatim as JSON strings causes encoding failures — bare attribute quotes `"` inside the `anchor` JSON string break `JSON.parse`. Since `outerHtml` is already available server-side, the LLM is relieved of the copy task entirely.

---

### API — `apps/api/src/application/llm/htmlIdInjector.ts`

Utility module for stable `data-pf-id` injection and ID-based element replacement. Used by `previewSnapshotRoutes.ts` (injection) and `llmPatchMerger.ts` (lookup).

```ts
// Injects data-pf-id on every block-level element — idempotent, never overwrites existing IDs
export function injectStableIds(html: string): string

// Reads data-pf-id from the root element of a raw outerHTML string — pure regex, no DOM parse
export function extractPfId(fragmentHtml: string): string | undefined

// Cheerio-based replacement: $('[data-pf-id="pfId"]').replaceWith(replacement)
export function replaceElementByPfId(
    baseHtml: string,
    pfId: string,
    replacement: string
): { html: string; applied: boolean }
```

---

### API — `apps/api/src/application/llm/llmPatchMerger.ts`

```ts
export interface FocusPatchResult {
    artifacts: LlmStructuredArtifacts;
    patchApplied: boolean;  // true when a strategy matched and replacement was applied
}

export function applyFocusPatch(
    base: { html?: string; css?: string; js?: string },
    patch: LlmFocusedPatch,
    fallback: LlmStructuredArtifacts,
    serverAnchor?: string          // from selectedElement.outerHtml (contains data-pf-id)
): FocusPatchResult
```

**Anchor resolution order:**

1. `serverAnchor` (preferred — from request body; frontend cleaned transient markers, kept `data-pf-id`)
2. `patch.anchor` (LLM-supplied — used only for code-selection mode)
3. Empty string → logs warn, returns `{ artifacts: fallback, patchApplied: false }`

**`normalizeForMatching` (applied to BOTH anchor AND source for text-matching strategies):**

```ts
function normalizeForMatching(html: string): string {
    return html
        .replace(/ data-pf-[a-z]+(="[^"]*")?/g, "")  // strip ALL data-pf-* incl. data-pf-id
        .replace(/ (aos-init|aos-animate)/g, "")       // AOS runtime classes
        .replace(/ style=""/g, "");                    // empty style attrs
}
```

> Both the anchor and the source are passed through `normalizeForMatching` before comparison. `data-pf-id` is stripped here too — but Strategy 0 reads `rawAnchor` *before* normalization so the ID is still available on that path.

**Matching strategies (in priority order):**

0. **Stable ID-based** (cheerio) — extracts `data-pf-id` from `rawAnchor` before any normalization; uses `$('[data-pf-id="…"]').replaceWith(replacement)`. Works regardless of whitespace, class differences, or attribute reordering. Only available for snapshots created after the stable-ID feature was deployed.
   - **After replacement**: the same `data-pf-id` is injected into the replacement root element (`preservePfIdInReplacement`). This preserves element identity across successive focused-edit turns — the user can keep patching the same element across multiple LLM turns without re-clicking.

1. **Exact verbatim** — `normalizeForMatching(source).includes(normalizeForMatching(rawAnchor))`

2. **Whitespace-flexible regex** — escape anchor for regex safety, replace all `\s+` runs with `\s+` pattern; handles minor indentation/line-ending differences

3. **Structural tag+class signature** (cheerio, last resort) — extracts tag name and class list from `rawAnchor`; uses cheerio to find all elements with the same tag+classes in the base; replaces ONLY when exactly ONE matching element exists (safe against ambiguous class collisions). Runtime classes (`aos-init`, `aos-animate`) are stripped from both sides before comparison. Handles the case where element content was previously replaced but its tag+class fingerprint is still unique on the page.

If no strategy matches, `{ artifacts: fallback, patchApplied: false }` is returned, a warning is logged, and the frontend shows a notification asking the user to re-select the element.

---

### API — `apps/api/src/application/llm/llmParser.ts`

Multi-pass JSON repair chain applied to every LLM raw response:

```
rawReply
  ├─ Strip markdown fences (```json ... ```)
  ├─ Pass 1: JSON.parse() directly
  ├─ Pass 2: repairInvalidJsonEscapes() → JSON.parse()
  ├─ Pass 3: repairInvalidJsonEscapes(repairPrematureStringTermination(repairInvalidJsonEscapes()))
  └─ Pass 4: repairTruncatedJson() → JSON.parse()
```

| Repair function | Fixes |
|---|---|
| `repairInvalidJsonEscapes` | Literal `\n`, `\r`, `\t` inside strings; invalid escape sequences like `\` |
| `repairPrematureStringTermination` | Bare `"` inside string that isn't followed by `,`, `}`, `]` — escapes it as `\"` to keep the string open |
| `repairTruncatedJson` | Model hit token limit mid-response; closes open strings/arrays/objects |
| `unescapeDoubleEncodedHtml` | Models that double-escape attributes (`lang=\"it\"` → `lang="it"`) |

**`extractFocusPatch`** validates the parsed `focusPatch` field:

```ts
function extractFocusPatch(parsed): LlmFocusedPatch | undefined {
    const fp = parsed.focusPatch;
    if (!fp) return undefined;
    if (!["html","css","js"].includes(fp.targetType)) return undefined;
    // anchor is optional — server derives it in inspector mode;
    // if present, it must be a non-empty string
    if (fp.anchor !== undefined && (typeof fp.anchor !== "string" || !fp.anchor.trim())) return undefined;
    if (typeof fp.replacement !== "string" || !fp.replacement.trim()) return undefined;
    return fp;
}
```

---

### API — `apps/api/src/presentation/http/routes/llmRoutes.ts`

**`isFocusedMode` detection:**

```ts
const isFocusedMode = Boolean(
    body.focusContext &&
    body.focusContext.mode !== "project" &&
    body.currentArtifacts &&
    (body.currentArtifacts.html || body.currentArtifacts.css || body.currentArtifacts.js)
);
```

**Post-parse merge logic (both `/chat-preview` and `/chat-preview/stream`):**

```ts
if (isFocusedMode && body.currentArtifacts) {
    if (parsed.structured?.focusPatch) {
        // serverAnchor still contains data-pf-id (PF_INSPECT_SCRIPT only strips transient markers);
        // applyFocusPatch tries Strategy 0 (ID-based) first, then text-matching fallbacks.
        const serverAnchor = body.focusContext?.selectedElement?.outerHtml;
        const patchResult = applyFocusPatch(
            body.currentArtifacts,
            parsed.structured.focusPatch,
            { html: body.currentArtifacts.html ?? "", ... },
            serverAnchor
        );
        structured = { ...structured, artifacts: patchResult.artifacts };
        focusPatchApplied = patchResult.patchApplied;
    } else {
        // Parse failed or LLM returned chat-only — preserve currentArtifacts
        // so the frontend guard prevents a bad snapshot from being created.
        structured.artifacts = {
            html: body.currentArtifacts.html ?? "",
            css:  body.currentArtifacts.css  ?? "",
            js:   body.currentArtifacts.js   ?? "",
        };
    }
}
```

---

### Contracts — `packages/contracts/src/llm.ts`

```ts
export interface LlmFocusedPatch {
    targetType: "html" | "css" | "js";
    anchor?: string;      // Optional — server derives it in inspector mode
    replacement: string;  // New HTML/CSS/JS that replaces the anchored region
}

export interface LlmStructuredResponse {
    chat: LlmStructuredChat;
    artifacts: LlmStructuredArtifacts;
    focusPatch?: LlmFocusedPatch;  // Present only in focused-edit mode
}

export interface LlmFocusContext {
    mode: "project" | "preview-element" | "code-selection";
    targetType: "html" | "css" | "js" | "component" | "section";
    userIntent?: string;
    selectedElement?: {
        stableNodeId: string;
        selector: string;
        tag: string;
        classes: string[];
        textSnippet?: string;
        outerHtml?: string;  // DOM outerHTML, pre-cleaned of runtime attributes
    };
    codeSelection?: {
        language: "html" | "css" | "js";
        startLine: number;
        endLine: number;
        selectedText?: string;
    };
}
```

---

## LLM Protocol — focusPatch JSON Shape

### Inspector mode (selectedElement present)

```json
{
  "chat": { "summary": "...", "bullets": [...], "nextActions": [...] },
  "artifacts": { "html": "", "css": "", "js": "" },
  "focusPatch": {
    "targetType": "html",
    "replacement": "<section id=\"petcare\">...</section>"
  }
}
```

- `anchor` is **omitted** — server uses `selectedElement.outerHtml` as the anchor
- All attribute quotes in `replacement` must be escaped as `\"`
- `artifacts.*` must be empty strings `""`

### Code-selection mode (anchor required)

```json
{
  "chat": { ... },
  "artifacts": { "html": "", "css": "", "js": "" },
  "focusPatch": {
    "targetType": "css",
    "anchor": ".hero { background: #1e293b; }",
    "replacement": ".hero { background: linear-gradient(135deg, #1e293b, #0f172a); }"
  }
}
```

- `anchor` is a **verbatim substring** of the source code
- Should be long enough to be unique in the file
- Must include the complete block (opening tag + all children + closing tag for HTML)

---

## Stable Element IDs — `data-pf-id`

Every block-level element in a snapshot's HTML receives a `data-pf-id` attribute (6 random hex chars, e.g. `data-pf-id="a1b2c3"`) injected by the server at snapshot-save time. Pattern identical to GrapesJS (`data-gjs-id`), Elementor (`data-id`), Builder.io (`builder-id`), Webflow (`data-node-id`).

**Injection:** `previewSnapshotRoutes.ts` → `injectStableIds(artifacts.html)` before every `createPreviewSnapshot.execute()`. Idempotent — existing IDs are preserved across incremental saves.

**Usage:** `applyFocusPatch` calls `extractPfId(rawAnchor)` to read the ID before normalization, then tries `replaceElementByPfId` (cheerio) as Strategy 0 — completely independent of HTML text content.

**Backward compatibility:** Old snapshots (without IDs) fall back to text-matching Strategies 1 and 2 transparently.

**Targeted elements:** `div`, `section`, `article`, `header`, `footer`, `main`, `nav`, `aside`, `form`, `ul`, `ol`, `table`, `figure`, `blockquote`, `details`, `fieldset`, `summary`. Inline elements are excluded.

---

## Runtime DOM Mutations — Reference

These attributes/classes are **injected at runtime** and must not pollute text-matching anchors. `data-pf-id` is the exception — it is a stable attribute that must be preserved.

| Source | Attribute/Class | Treatment |
|---|---|---|
| Inspector script | `data-pf-h=""` (hover) | **Strip** — transient (Frontend `/[hse]/` + Backend `normalizeForMatching`) |
| Inspector script | `data-pf-s=""` (selected) | **Strip** — transient (Frontend `/[hse]/` + Backend `normalizeForMatching`) |
| Inspector script | `data-pf-e=""` (edit mode) | **Strip** — transient (Frontend `/[hse]/` + Backend `normalizeForMatching`) |
| AOS.js | `aos-init` (class) | **Strip** — runtime animation class (Frontend + Backend `normalizeForMatching`) |
| AOS.js | `aos-animate` (class) | **Strip** — runtime animation class (Frontend + Backend `normalizeForMatching`) |
| WYSIWYG/browser | `style=""` (empty attr) | **Strip** — spurious empty attribute (Frontend + Backend `normalizeForMatching`) |
| Server injection | `data-pf-id="abc123"` | **Preserve** — stable element identity; stripped only inside `normalizeForMatching` (text path), NOT by frontend |

**Frontend** (`PF_INSPECT_SCRIPT`, `mkdata()`): regex `/data-pf-[hse](="")?/` — strips only single-letter transient suffixes `h`, `s`, `e`.

**Backend** (`normalizeForMatching`): strips ALL `data-pf-*` including `data-pf-id` — correct for text comparison path. Strategy 0 bypasses normalization by reading `rawAnchor` first.

---

## Baseline Snapshot — `isActive` Invariant

The `activeBaselineSnapshot` (with `isActive: true` in MongoDB) is the source of truth for:

1. **`currentArtifacts`** — the HTML/CSS/JS that focused patches are merged against
2. **Preview display** — what's shown in the iframe when no explicit snapshot is selected

**Invariant:** `isActive` must always point to a snapshot with valid, non-empty `html`. If a failed request creates a snapshot with empty/dummy HTML and marks it active, all subsequent focused edits will merge against empty content, producing incorrect output.

**Protection mechanisms:**

- Frontend guard: `if (artifacts.html && convId)` — only creates a snapshot if `html` is non-empty
- Backend fallback: if `isFocusedMode` and `focusPatch` is absent, `currentArtifacts` are returned intact (no dummy HTML from `buildFallbackStructured`)
- Merge fallback: if anchor not found, `currentArtifacts` are returned unchanged

---

## Debug Checklist

When a focused edit doesn't appear in the preview:

1. **Check `structuredParseValid`** in the message `metadata.structuredParseValid`
   - `false` → JSON repair chain failed. Check `rawResponse` for the raw LLM output. Look for unescaped `"` in `replacement`.
   - `true` → parse succeeded, continue to next check.

2. **Check `focusPatch` presence** in `metadata.promptingTrace`
   - If `focusPatch` is absent in the parsed structured response but `artifacts.html` is empty, the LLM followed the protocol but no merge was attempted.

3. **Check Docker logs for `[focusPatch]`**
   - `Strategy 0: ID data-pf-id="X" not found in base HTML` → ID in anchor but not in base; old snapshot without IDs, or wrong snapshot version. Falls through to text matching — if text matching also fails, tries structural match.
   - `all strategies failed for base.html` → Strategies 0–3 all failed. Diff `outerHtml` vs `currentArtifacts.html` for runtime attribute/class differences not covered by `normalizeForMatching`.
   - `strategy=3 applied (structural: tagName[...])` → Text matching failed but structural match succeeded. Consider why text matching failed to prevent future regressions.
   - `no anchor available` → `selectedElement.outerHtml` was empty/missing and no `patch.anchor` in LLM output.

4. **Check MongoDB — active snapshot**

   ```
   db.preview_snapshots.findOne({ projectId: "...", isActive: true })
   ```

   - `artifacts.html` empty → baseline was corrupted. Manually activate a good snapshot via the UI version picker.

5. **Check `currentArtifacts` in user message** (`messagesSentToLlm[last].content`)
   - If the `[Codice attualmente generato]` block is absent or shows only `....[troncato]`, the context may have been cut off. Increase `LLM_ARTIFACT_CONTEXT_MAX_CHARS` env var or reduce the page size.

6. **Frontend shows "Focus patch non applicata" notification**
   - All 4 server strategies failed. Re-select the element in the inspector: the fresh click will capture the correct `data-pf-id` from the current active snapshot. The notification clears `selectedElement` automatically.

7. **Anchor mismatch — remaining causes after stripping**
   - `style="..."` with non-empty value (WYSIWYG edits inline style)
   - `contenteditable` attr from WYSIWYG mode
   - `data-aos` value differences (e.g. `fade-up` vs `fade-right`)
   - Add targeted stripping in `llmPatchMerger.ts` for any new runtime attribute found

---

## File Map

| File | Role |
|---|---|
| `apps/web/app/workspace/[projectId]/page.tsx` | Frontend orchestration, inspector script, focusContext builder, snapshot creation |
| `apps/api/src/application/llm/focusedPrompt.ts` | System prompt addendum for focused mode |
| `apps/api/src/application/llm/htmlIdInjector.ts` | `injectStableIds`, `extractPfId`, `replaceElementByPfId` — stable ID injection and cheerio-based lookup |
| `apps/api/src/application/llm/llmPatchMerger.ts` | `normalizeForMatching` + three-strategy patch merge (Strategy 0 ID-based, 1 exact, 2 flex-regex) |
| `apps/api/src/application/llm/llmParser.ts` | Multi-pass JSON repair, `extractFocusPatch` validation |
| `apps/api/src/presentation/http/routes/llmRoutes.ts` | `isFocusedMode` detection, merge orchestration, both endpoints |
| `apps/api/src/presentation/http/routes/previewSnapshotRoutes.ts` | Calls `injectStableIds` before every snapshot save |
| `packages/contracts/src/llm.ts` | `LlmFocusedPatch`, `LlmFocusContext`, `LlmStructuredResponse` types |
