# Section-Aware Context Optimization — Implementation Spec

## Problem

In focused-edit mode (surgical element patching) the API sends the entire page HTML
artifact to the LLM even when the user is editing a single element inside a specific
section.  The attached real-world trace shows **14 K tokens** spent to alter a single
transparency property inside the Hero component.  Most of those tokens carry HTML,
CSS, and chat history that are completely irrelevant to the patch.

## Solution

When the env flag `LLM_FOCUS_SECTION_CONTEXT=true` is set:

1. **Extract only the section that contains the focused element** from the current
   artifacts HTML and pass that instead of the full page HTML.
2. **Filter CSS** to only rules that reference class-names or IDs present in that section.
3. **Pass a compact page-map** (one entry per top-level body child) so the LLM keeps
   awareness of the full page structure without seeing all the HTML.
4. **Reduce history** in focused mode via `LLM_FOCUS_HISTORY_MODE`:
   - `full`   — same as today (default, backward-compatible)
   - `user_only` — include only user messages (strips assistant HTML artifacts from history)
   - `none`  — no history at all (maximum token savings)
5. **Add section-oriented HTML guidance** to the focused-mode system-prompt addendum so
   the LLM knows the output should be structured as `<section>` blocks.

The feature is **fully backward-compatible**: when the env flag is off (default), all
existing behaviour is unchanged.

---

## Architecture

### New module — `sectionContextExtractor.ts`

```
apps/api/src/application/llm/sectionContextExtractor.ts
```

Exported functions:

| Function | Purpose |
|---|---|
| `extractPageSections(html, targetPfId?)` | Returns `PageSection[]` — one entry per direct body child with tag, id, classes, headline, isTarget flag |
| `extractSectionForPfId(html, pfId)` | Finds the body-level ancestor section of the element with that `data-pf-id`; returns `{ sectionHtml, sectionPfId }` or `null` |
| `extractClassNamesAndIds(html)` | Regex extraction of all `.classname` and `#id` references from an HTML string |
| `filterCssForSection(css, classNames, elementIds)` | Heuristic CSS filter: keeps `@`-rules, `:root`, `body`, `*` and any rule whose selector or declaration references a class/id from the section |

### Modified modules

#### `config.ts` — new env vars

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `LLM_FOCUS_SECTION_CONTEXT` | boolean string | `false` | Master toggle for the feature |
| `LLM_FOCUS_SECTION_HTML_MAX_CHARS` | int | `8000` | Hard cap for section HTML sent to LLM |
| `LLM_FOCUS_HISTORY_MODE` | `full\|user_only\|none` | `full` | History strategy when feature is active |

#### `llmRoutes.ts` — `buildMessagesWithHistory()`

New optional parameter `sectionContextOpts`:

```ts
interface SectionContextOpts {
    sectionHtml: string;
    sectionPfId?: string;
    pageMap: PageSection[];
    filteredCss?: string;
    historyMode: 'full' | 'user_only' | 'none';
}
```

When present and focused mode is active:

- Replace the `[Codice attualmente generato]` block with a `[Sezione target — contesto ottimizzato]` block
- Block content: `pageMap JSON` + `sectionHtml` + `filteredCss` + `JS (full, truncated to 4000 chars)`
- Filter `history` according to `historyMode`
- Total artifact-block budget: `LLM_FOCUS_SECTION_HTML_MAX_CHARS` instead of `LLM_ARTIFACT_CONTEXT_MAX_CHARS`

#### `focusedPrompt.ts` — section structure guidance

When triggered in section-context mode (opt: receives `pageMap`), appends:

```
### Page structure — section map
The page is structured as independent sections (direct body children).
Do NOT output a whole-page replacement. Your focusPatch.replacement must
target only the section shown above.

Section map (informational only):
[{...page map JSON...}]
```

---

## Data Flow — Section-Aware Focus Path

```
POST /llm/chat-preview or /stream
        │
        ├── isFocusedMode=true  AND  env.LLM_FOCUS_SECTION_CONTEXT=true
        │
        ▼
extractPfId(focusContext.selectedElement.outerHtml)
        │ pfId (may be undefined → fallback to full path)
        ▼
extractSectionForPfId(currentArtifacts.html, pfId)
        │ { sectionHtml, sectionPfId } | null → null = fallback to full path
        ▼
extractPageSections(currentArtifacts.html, pfId)      → pageMap[]
extractClassNamesAndIds(sectionHtml)                  → { classNames, elementIds }
filterCssForSection(currentArtifacts.css, ...)        → filteredCss
        │
        ▼
buildMessagesWithHistory(..., sectionContextOpts)
        │
        ├── artifactBlock replaced with sectionContextBlock:
        │       "[Sezione target — contesto ottimizzato]"
        │       "Mappa pagina: <pageMap JSON (compact)>"
        │       "HTML sezione: <sectionHtml (≤8000 chars)>"
        │       "CSS rilevante: <filteredCss>"
        │       "JS: <js (≤4000 chars)>"
        │
        ├── history filtered per historyMode
        │
        ▼
effectiveSystemPrompt includes buildFocusedModeSystemAddendum()
  → extended with section-map guidance when pageMap is provided
        │
        ▼
LLM → focusPatch.replacement (only the evolved section element)
        │
        ▼
applyFocusPatch() ← unchanged (Strategy 0: pfId-based replacement)
```

---

## Token Budget Comparison

| Mode | HTML context | CSS context | History | Est. chars |
|---|---|---|---|---|
| Current (full) | up to 16,000 | included in 16K cap | up to 7,000 | ~23,000 |
| Section-aware (`user_only`) | ≤ 8,000 | filtered ≤ 3,000 | user msgs only ≤ 2,000 | ~13,000 |
| Section-aware (`none`) | ≤ 8,000 | filtered ≤ 3,000 | 0 | ~11,000 |

Estimated token reduction: **4,000–6,000 tokens** per focused-edit request (40–60%).

---

## Fallback Guarantees

The feature degrades gracefully at each step:

1. `pfId` cannot be extracted from `outerHtml` → full artifact path used
2. `extractSectionForPfId()` finds no matching element → full artifact path used
3. CSS filter crashes (e.g. malformed CSS) → full CSS passed unchanged
4. Section HTML exceeds `LLM_FOCUS_SECTION_HTML_MAX_CHARS` → section HTML truncated with `...[sezione-troncata]`

Patch application (`applyFocusPatch()`) is completely unchanged — Strategy 0 via `data-pf-id` works identically regardless of how much context was sent to the LLM.

---

## Section-Oriented HTML Output Guidance

To maximise benefit from section-aware context, the generic system prompt template
should guide the LLM toward structured section-based HTML output:

- Every top-level content block must be a `<section>`, `<header>`, `<footer>`, `<nav>`,
  `<main>`, or `<aside>` element.
- Each section should carry a semantic `id` attribute (e.g. `id="hero"`, `id="services"`).
- No flat `<div>` soup at the body root — nest content inside named sections.
- CSS class names within a section should be prefixed or namespaced to that section
  (e.g. `hero__title`, `services__card`).

This guidance is injected into `buildOutputBudgetPolicy()` and the preprompt template.

---

## Reversibility

- Toggle `LLM_FOCUS_SECTION_CONTEXT=false` (or remove the var) to revert to current behaviour.
- No schema changes, no migration needed.
- The new env vars are added to `.env.example` with commented explanation.
- If the feature is active but section extraction fails for any reason, the request automatically falls back to the full-artifact path.
