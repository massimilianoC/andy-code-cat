# WYSIWYG Edit Mode — Analysis, Research and Proposal

> **Status:** Proposal — to be reviewed before implementation  
> **Original request:** an EDIT toggle in the preview (analogous to Inspect), in-place editing with an icon/emoji picker, saving and snapshot versioning.  
> **Agenda:** research existing open-source solutions → pick an engine → implementation milestones.

---

## 1. Current Architectural Context

The workspace currently provides:

| Component | Status |
|---|---|
| Preview iframe (`sandbox="allow-scripts"`) | ✅ working |
| Injected `PF_INSPECT_SCRIPT` (hover/click select via postMessage) | ✅ working |
| Inspect ON/OFF toggle in the preview tab | ✅ working |
| Monaco editor (HTML/CSS/JS) with code selection → focusContext | ✅ working |
| Snapshot versioning with SnapshotHistoryPanel | ✅ working |
| Manual "✏ manuale" save via `handleSaveEditorSnapshot` | ✅ working |
| Preprompt: "no CDN except Google Fonts, placeholders for images" | ✅ active for Layer 1 |

**Natural integration points for EDIT mode:**

1. `PF_INSPECT_SCRIPT` is already a JS injection into the iframe via `srcDoc`.
2. The `pf-select` postMessage already carries the selected element to the parent (tag, classes, selector, textSnippet).
3. The data ends up in `editorHtml/editorCss/editorJs` → from there a snapshot is saved.
4. The iframe → postMessage → React state → Monaco → snapshot chain is already proven.

---

## 2. Open Source Solution Research

### 2.1 GrapesJS ⭐ **Main candidate**

- **GitHub:** <https://github.com/GrapesJS/grapesjs>
- **Stars:** ~22,000 (April 2026)  
- **Licence:** BSD 3-Clause (open source, commercially usable)
- **Active release:** v0.21.x, actively maintained
- **Bundle:** ~2.5 MB minified + gzip ~700 KB

**What GrapesJS does:**

- Full-page drag-and-drop WYSIWYG editor (HTML + CSS)
- Loads arbitrary HTML/CSS strings (`editor.setComponents(html)` + `editor.setStyle(css)`)
- Exports `editor.getHtml()` + `editor.getCss()` — clean, with no GrapesJS wrapper
- Visual Style Manager (CSS property panel)
- Layer Manager (component DOM tree)
- Block Manager (reusable drag-drop blocks)
- Asset Manager (images, replaceable with custom pickers)
- Custom Code plugin: `grapesjs-custom-code` — injects raw HTML/CSS/JS blocks
- Font plugin: `grapesjs-fonts`
- Icon plugin: iconify/FontAwesome support via community plugins
- Responsive breakpoints (mobile/tablet/desktop preview)
- Runs inside a DOM `<div>` — **not** inside a sandboxed iframe

**Limitations relative to the current architecture:**

1. GrapesJS **is** the canvas — it cannot be injected into an external `sandbox="allow-scripts"` iframe.
2. It requires remounting the preview as `<div id="grapesjs">` instead of the iframe.
3. Bundle weight ~2.5 MB (a Next.js dynamic import brings it to ~700 KB gzipped, acceptable given the optional use).
4. It requires GrapesJS's own CSS (a dark theme is available: `grapesjs/dist/css/grapes.min.css`).
5. The internal component structure (GrapesJS "components") can diverge from the plain HTML the LLM generates if advanced components are used — but "raw HTML" mode avoids that risk.

**GrapesJS verdict:**  
More powerful than any custom approach, but it means replacing the **iframe** with a new "EDIT" tab that mounts GrapesJS. The integration is feasible and reversible (the EDIT tab sits alongside the existing PREVIEW/HTML/CSS/JS tabs).

---

### 2.2 Puck (Measured Co)

- **GitHub:** <https://github.com/measuredco/puck>
- **Stars:** ~6 000
- **Licenza:** MIT
- **Nature:** a **React** framework for visual editing — built on pre-registered components.
- **Critical limitation:** it does not load arbitrary HTML. Every element must be a registered React component. Incompatible with the LLM's vanilla HTML/CSS output.
- **Verdict: ❌ Not suitable**

---

### 2.3 Craft.js

- **GitHub:** <https://github.com/prevwong/craft.js>
- **Stars:** ~7 000
- **Licenza:** MIT
- **Nature:** a React drag-and-drop framework for page builders, likewise built on registered components.
- **Critical limitation:** every block must be a React component. It does not load vanilla HTML/CSS.
- **Verdict: ❌ Not suitable**

---

### 2.4 Unlayer

- **GitHub:** <https://github.com/unlayer/embed>
- **Nature:** an embeddable email/landing-page editor. Proprietary (hosted SaaS); the embed SDK is not open source for every use case.
- **Verdict: ❌ Not suitable (licence)** — the free tier is limited to email

---

### 2.5 TinaCMS

- **GitHub:** <https://github.com/tinacms/tinacms>
- **Stars:** ~11 000
- **Nature:** headless CMS for Markdown/MDX. Not designed for vanilla HTML/CSS editing.
- **Verdict: ❌ Not suitable** for this use case

---

### 2.6 Froala / TinyMCE / CKEditor 5

- Rich text editors (for documents/blogs), not page builders.
- They can edit text inside elements but do not handle CSS, drag-drop or layout.
- **Verdict: ❌ Not suitable** for visual web page editing

---

### 2.7 micro-editor / custom contentEditable inject

- Custom approach: inject `contentEditable` + event listeners into the existing iframe via an extended `PF_INSPECT_SCRIPT`.
- Much lighter than GrapesJS.
- Supports: inline text editing, `src`/`href` attributes via prompt/popup, class swapping.
- Does not support: drag-drop, visual styling, responsive preview, layer manager.
- **Verdict: ✅ Feasible as "EDIT Light"** — a good fit for the first increment, M-WYSIWYG-1.

---

### 2.8 Pinegrow (non open source)

- Professional editor, not embeddable as a library.
- **Verdict: ❌ Not suitable**

---

## 3. Recommended Solution: Hybrid Two-Mode Architecture

Given the analysis, a **progressive dual** architecture is recommended:

```
┌─────────────────────────────────────────────────────────────────┐
│  CURRENT MODE (PREVIEW + Inspect)                               │
│  sandboxed iframe + PF_INSPECT_SCRIPT                           │
│  → element selection → focusContext → LLM patch                 │
└────────────────────┬────────────────────────────────────────────┘
                     │  EDIT toggle ON
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Injected into iframe: contentEditable + inline text + picker   │
│  Injected into iframe: contentEditable + inline text + img picker│
│  No external dependency                                         │
│  DOM serialisation → parent postMessage → snapshot save         │
└────────────────────┬────────────────────────────────────────────┘
                     │  click "⊕ Open Full Editor" (M-WYSIWYG-3)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  EDIT FULL — GrapesJS panel (separate "EDIT" tab)               │
│  GrapesJS dynamically imported only when active                 │
│  Loads current HTML+CSS → edit → export → snapshot              │
│  Style manager, drag-drop, responsive breakpoints               │
│  Custom Asset Manager with an Emoji + Iconify CDN picker        │
└─────────────────────────────────────────────────────────────────┘
```

**Integration principles:**

1. The two modes are **tap-in/tap-out** with respect to the existing architecture.
2. GrapesJS is loaded only when the user opens the EDIT tab (lazy `dynamic import`).
3. The exit point is always `export HTML+CSS → editorHtml/editorCss → handleSaveEditorSnapshot()`.
4. The EDIT tab is **additive** to the existing tabs (PREVIEW/HTML/CSS/JS/PROMPT) → zero breaking changes.
5. Inspect + EDIT Light continue to live inside the sandboxed iframe.

---

## 4. Feature Detail

### 4.1 EDIT Light (iframe injection, M-WYSIWYG-1)

An extension of `PF_INSPECT_SCRIPT` with an additional `PF_EDIT_SCRIPT` layer:

```
When EDIT mode is ON (and Inspect is ON):
  1. click a text element → contentEditable=true → inline input
  2. click an <img> → show the overlay picker (see §4.3)
  3. click a div/section with a background-image → show the overlay picker
  4. every change is tracked in a Map<element, originalContent>
  5. "Save EDIT" → serialise DOM → postMessage {type:'pf-edit-save', html: doc.documentElement.outerHTML}
  6. parent receives html → setEditorHtml → handleSaveEditorSnapshot
```

**UX behaviour:**

- Inspect ON → the `✎ EDIT` button appears (disabled when inspect is OFF)
- When both are ON: the preview shows a yellow banner, `"edit mode active — changes are local"`.
- Undo/Redo: Cmd+Z inside the iframe (native `contentEditable`); the parent does not handle undo.
- A "💾 Save EDIT changes" button → saves and creates a snapshot.

### 4.2 EDIT Full — GrapesJS Panel (M-WYSIWYG-3)

**GrapesJS setup:**

```typescript
// Lazy import in page.tsx
const GrapesJsEditor = dynamic(() => import('../../../components/GrapesJsEditorPanel'), { ssr: false });
```

**Loading:**

```
editor.setComponents(editorHtml);
editor.setStyle(editorCss);
```

**Export:**

```
const html = editor.getHtml();   // body HTML (no <html><head><body> wrapper)
const css  = editor.getCss();    // flat CSS
// recombine into a full document via the existing buildPreviewDoc logic
```

**Plugins to include:**

- `grapesjs-blocks-basic` — basic blocks (text, images, links, 1-2-3 columns)
- `grapesjs-plugin-forms` — form elements
- `grapesjs-custom-code` — raw custom HTML block (for sections not editable by drag-drop)
- Custom Asset Manager (§4.3)
- GrapesJS dark theme (matching the app palette)

**Do not include:**

- grapesjs-preset-webpage (opinionated, adds useless blocks)
- The export plugin (we use our own snapshot system)

### 4.3 Icon & Media Picker (M-WYSIWYG-2)

The picker is shown as a **popup overlay** (above both the iframe and the GrapesJS panel) when:

- Clicking an `<img>` in EDIT Light mode
- Clicking a div with a `background-image` in EDIT Light mode
- Clicking an image component in GrapesJS (via a custom `asset manager`)

**Picker architecture:**

```
┌──────────────────────────────────────────────────────┐
│  MEDIA PICKER PANEL                                  │
│                                                      │
│  [Tab: Emoji] [Tab: Iconify] [Tab: URL] [Tab: Asset] │
│                                                      │
│  🔍 Search: [________________]                       │
│                                                      │
│  Emoji tab: Unicode emoji grid (emoji-picker-element)│
│  Iconify tab: grid from https://api.iconify.design   │
│    Collections: lucide, heroicons, phosphor, mdi,    │
│    bootstrap-icons, tabler-icons, simple-icons       │
│    Filter by collection + full-text search           │
│    Output: <img src="https://api.iconify.design/     │
│              {collection}/{icon}.svg"> or inserts    │
│              the unicode emoji                       │
│  URL tab: enter src=URL by hand                      │
│  Asset tab: ProjectAssets of the current project     │
│              (already uploaded via M4a.1)            │
│                                                      │
│  Use as background-image: "CSS background" toggle    │
│  → output: style="background-image:url(…)"           │
└──────────────────────────────────────────────────────┘
```

**Candidate CDN libraries for the picker:**

- **Iconify Design API** (`https://api.iconify.design/{collection}/{name}.svg`) — 200,000+ icons, free, no key, ~30 KB of client JS (API queries only, no local bundle)
- **emoji-picker-element** — lightweight Web Component (~40 KB gzip), MIT, no API key, uses IndexedDB to cache emoji data
- No icon library is injected into the generated HTML — they are used as `<img src="...">` or `background-image`, so the document stays CDN-free in the preprompt's sense (iconify data are `.svg` images, not scripts).

**Impact on the preprompt:**
The "No CDN except Google Fonts" constraint in the preprompt applies to **LLM generation** (Layer 1). Icons inserted by hand in EDIT mode are deliberate user choices, so they do not breach the constraint (they are post-LLM changes).

---

## 5. Snapshot Migration Plan

Changes saved from EDIT mode must integrate **seamlessly** with the existing snapshot versioning system.

### Save flow

```
EDIT Light save:
  iframe DOM serialisation
  → postMessage {type:'pf-edit-save', html}
  → parent: setEditorHtml(html)
  → handleSaveEditorSnapshot()  // already exists — zero changes to this function
  → createPreviewSnapshot(..., metadata: { finishReason: 'wysiwyg-edit-light' })
  → SnapshotHistoryPanel: badge "✎ wysiwyg"

EDIT Full (GrapesJS) save:
  grapesEditor.getHtml()  → setEditorHtml
  grapesEditor.getCss()   → setEditorCss
  → handleSaveEditorSnapshot()  // same function
  → createPreviewSnapshot(..., metadata: { finishReason: 'wysiwyg-grapesjs' })
  → SnapshotHistoryPanel: badge "⊕ grapesjs"
```

**No backend change** — `createPreviewSnapshot` already accepts an arbitrary `metadata.finishReason`.

### Visual differentiation in SnapshotHistoryPanel

```typescript
// Already present in SnapshotHistoryPanel:
snap.metadata?.finishReason === "manual-save"   → badge "✏ manuale"
// To add:
snap.metadata?.finishReason === "wysiwyg-edit-light" → badge "✎ EDIT"
snap.metadata?.finishReason === "wysiwyg-grapesjs"   → badge "⊕ GJS"
```

---

## 6. Feasibility Analysis

| Aspect | Assessment | Notes |
|---|---|---|
| EDIT Light injection into the sandboxed iframe | ✅ Feasible | `sandbox="allow-scripts"` supports `contentEditable`. postMessage already tested. |
| DOM serialisation → clean HTML | ⚠️ Caution | `outerHTML` includes the `data-pf-h`, `data-pf-s` and `contenteditable` attributes added by the injection. Two or three lines of cleanup are needed before saving. |
| GrapesJS in Next.js 15 App Router | ✅ Feasible | `dynamic(() => import(...), {ssr: false})` — already used for Monaco. GJS bundle ~700 KB gzip; acceptable with lazy loading. |
| GrapesJS + the app's dark CSS theme | ⚠️ Caution | GrapesJS ships global CSS. It must be wrapped in an isolated `<div id="gjs-root">`. The GJS canvas already has a native dark theme. |
| GrapesJS loading the LLM's vanilla HTML/CSS | ✅ Feasible | Tested: `editor.setComponents(html)` + `editor.setStyle(css)` works with raw HTML. |
| Iconify API CDN picker | ✅ Feasible | Free REST API, no authentication. Call: `fetch('https://api.iconify.design/lucide/home.svg')`. |
| emoji-picker-element Web Component | ✅ Feasible | Standard Web Component, mounts inside a React `<div>` with `useEffect`. |
| ProjectAsset tab in the picker | ✅ Feasible | The `GET /v1/projects/:id/assets` API is already implemented (M4a.1). |
| No breaking change on the backend | ✅ Confirmed | The whole WYSIWYG feature is UI-only. The backend needs no changes until M-WYSIWYG-4 (should offline edits need persisting). |
| Integration with Monaco (bidirectional) | ✅ Feasible | Sequence: GJS edit → export → `setEditorHtml/Css` → Monaco updates automatically (the Monaco panels already read `editorHtml`). |

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GrapesJS restructures the HTML differently from the original (adds `div[data-gjs-type]` wrappers) | Medium | Medium | Use `editor.getHtml()`, which returns clean HTML with no GJS wrappers; avoid grapesjs-parser-postcss, which alters CSS |
| `contentEditable` deforms the HTML structure (extra newlines, `<br>` vs `<p>`) | Low | Low | Serialise with the body container's `innerHTML`, not the document's `outerHTML` |
| Iconify CDN unavailable or slow | Low | Low | Fallback UI: show a "service unavailable" message; the URL picker always keeps working |
| GrapesJS global CSS interferes with the app layout | Medium | Medium | GrapesJS lives in a separate tab (not overlaid on the iframe), CSS scoped with `#gjs-root .grp-*` |
| GrapesJS bundle size increases First Load JS | Medium | Low | `dynamic import` — downloaded only the first time the user opens the EDIT tab. Next.js splits the chunk automatically. |

---

## 8. Implementation Milestones

### M-WYSIWYG-0 (this document) ✅

Analysis, engine research, documented proposal. No implementation.

---

### M-WYSIWYG-1 — EDIT Light (2-3 days)

**Goal:** a ✎ EDIT toggle in the preview tab. Clicking elements → inline text editing in the iframe. Save → snapshot.

**Scope:**

- Add an `editMode: boolean` state in `page.tsx`
- `editMode` can only be switched on when `inspectMode === true` (the two go together, or EDIT implies inspect)
- Create `PF_EDIT_SCRIPT` (extending the PF_INSPECT_SCRIPT pattern):
  - Receives `{ type: 'pf-edit', on: bool }` via postMessage
  - ON: selected text elements become `contentEditable`
  - Click an `<img>` → postMessage `{ type: 'pf-edit-img-click', src, selector }` to the parent
  - Change tracking: a Map of `{ selector → originalHTML }`
  - Serialisation: `document.documentElement.outerHTML` with `[data-pf-*]` and `contenteditable` attributes cleaned up
  - postMessage `{ type: 'pf-edit-save', html: cleanedHtml }` when the user clicks "💾 Save EDIT"
- Warning banner inside the iframe when editMode is ON
- Strip `data-pf-h`, `data-pf-s` and `contenteditable` from the HTML before saving
- A "💾 Save EDIT" button in the preview toolbar → `setEditorHtml(received)` → `handleSaveEditorSnapshot()`
- A `"✎ EDIT"` badge in SnapshotHistoryPanel for `finishReason: 'wysiwyg-edit-light'`

**Testable:**

```
1. Inspect ON → the "✎ EDIT" button appears
2. EDIT ON → "edit mode" banner inside the iframe
3. Click text → editable inline
4. Change it → click "💾 Save EDIT" → snapshot created with the "✎ EDIT" badge
5. The Monaco HTML tab shows the updated HTML
6. The history dropdown shows the new version
```

---

### M-WYSIWYG-2 — Icon & Media Picker (1-2 days)

**Goal:** when editMode is ON and the user clicks an `<img>` (or a div[background-image]), show a picker above the iframe.

**Scope:**

- React component `MediaPickerPanel` (overlay above the preview canvas):
  - **Emoji** tab: embed the `emoji-picker-element` Web Component (CDN or local npm)
  - **Iconify** tab: REST search `https://api.iconify.design/search?query=X&limit=50`, SVG preview grid, click → replaces src
  - **Manual URL** tab: an `<input type="url">` + preview
  - **Project asset** tab: calls `GET /v1/projects/:id/assets`, lists uploaded images
  - **"Use as CSS background"** toggle: changes the output to `style="background-image:url(...)"`
- The picker is opened by the `pf-edit-img-click` postMessage from PF_EDIT_SCRIPT to the parent
- Output: postMessage to the iframe `{ type: 'pf-edit-set-src', selector, value, mode: 'src'|'background' }`
- PF_EDIT_SCRIPT applies the value in the DOM
- The picker closes after selection
- Escape closes it without applying

**Testable:**

```
1. EDIT ON → click an <img> → MediaPickerPanel appears
2. Iconify tab → search "home" → 10+ icons shown
3. Click the lucide/home icon → <img src="https://api.iconify.design/lucide/home.svg"> applied
4. Emoji tab → click an emoji → inserted as text in the parent element
5. Save EDIT → snapshot HTML updated with the new src
```

---

### M-WYSIWYG-3 — GrapesJS Full Editor Tab (3-4 days)

**Goal:** a separate "⊕ EDIT" tab (next to PREVIEW/HTML/CSS/JS/PROMPT) that mounts GrapesJS with the current HTML/CSS. Save → snapshot.

**Scope:**

- Installation: `npm install grapesjs grapesjs-blocks-basic grapesjs-plugin-forms grapesjs-custom-code` in `apps/web/package.json`
- New `GrapesJsEditorPanel` component (in `apps/web/components/`):
  - Dynamic import with `{ssr: false}` and `{loading: () => <Spinner />}`
  - Mounts GrapesJS in a `<div ref={containerRef}>`
  - `onMount`: `editor.setComponents(editorHtml)` + `editor.setStyle(editorCss)`
  - `onChange (editor 'update')`: live sync to `editorHtml`/`editorCss` (debounced 800ms)
  - Custom Asset Manager that opens `MediaPickerPanel` (reused from M-WYSIWYG-2)
  - A "💾 Save to Snapshot" button in the custom GrapesJS toolbar
- "⊕ EDIT" tab button added to `workspace-preview-tabs`
- When the EDIT tab is active: `previewTab === "edit"` → iframe hidden, GrapesJS shown
- GrapesJS theme: dark (`"grapesjs/dist/css/colibri-theme-dark.css"` or custom CSS vars)
- GrapesJS toolbar: reduce to Device Manager + Style Manager + Layer Manager (basic blocks optional)

**Testable:**

```
1. The "⊕ EDIT" tab appears in the workspace
2. Click the tab → GrapesJS loads the current HTML
3. Drag-drop the "Text" block → available
4. Click an element → Style Manager shows its CSS properties
5. Change the background colour → CSS updated live
6. "💾 Save to Snapshot" button → snapshot v+1 with the "⊕ GJS" badge
7. Back to the PREVIEW tab → the iframe shows the updated HTML
8. Monaco HTML tab → shows the updated HTML
```

---

### M-WYSIWYG-4 — Bidirectional Monaco ↔ GrapesJS Sync (1 day)

**Goal:** when the user edits code in Monaco and returns to the EDIT tab (GrapesJS), the editor reloads the new code. Conversely, when the user saves from GrapesJS, Monaco updates.

**Scope:**

- When `previewTab` changes from `"html"/"css"` → `"edit"`:
  - `grapesEditor.setComponents(editorHtml)` + `grapesEditor.setStyle(editorCss)` (re-init)
  - Optional: show a "Editor reloaded from Monaco code" toast
- GrapesJS `onChange` → `setEditorHtml/Css` → Monaco already reads the updated values (no extra work)
- React `key` on GrapesJsEditorPanel: when `artifactsKey` changes (a new snapshot from the LLM), unmount/remount GrapesJS with the new data

**Testable:**

```
1. GrapesJS changes the background to red → Monaco CSS shows "background: red"
2. Monaco CSS: change font-size → back to the EDIT tab → GrapesJS shows the updated font
3. A new LLM message arrives → GrapesJS resets with the new HTML
```

---

## 9. npm Dependencies to Add

```json
// apps/web/package.json — only if M-WYSIWYG-3 is implemented
"grapesjs": "^0.21.0",
"grapesjs-blocks-basic": "^0.2.0",
"grapesjs-plugin-forms": "^2.0.8",
"grapesjs-custom-code": "^1.0.1",

// M-WYSIWYG-2 (Emoji picker)
"emoji-picker-element": "^1.22.0"
```

**No backend dependency** — everything is frontend-only.

---

## 10. Recommended Decision

| Option | PROS | CONS | Recommendation |
|---|---|---|---|
| **A) EDIT Light only** (M-WYSIWYG-1+2) | No dependencies, zero architectural risk, full sandbox compatibility | Limited features (no drag-drop, no visual style manager) | ✅ Start here |
| **B) GrapesJS only** (M-WYSIWYG-3) | Maximum power, style/layer manager, drag-drop | ~700 KB dependency, more complex UI to integrate | ⚠️ Defer to M-WYSIWYG-3 |
| **C) Both**, in sequence A→B | Progressive increment, immediate value, upgrade path | Two code paths to maintain | ✅ **Recommended** |
| **D) GrapesJS as the main engine** (replacing the iframe) | A single code path | Breaking change to the current architecture, breaks the inspect flow | ❌ Not recommended |

**→ Start M-WYSIWYG-1** (EDIT Light injection) for immediate value at the lowest risk.  
**→ Plan M-WYSIWYG-3** (GrapesJS) for advanced use, without removing the lightweight approach.

---

## 11. Updates to INDEX.md and DEVELOPMENT_PLAN.md

Once this proposal is approved, update:

- `docs/INDEX.md`: add this spec to the "Technical Specifications" table
- `docs/DEVELOPMENT_PLAN.md`: add milestones M-WYSIWYG-0..4 after the existing M4a milestones

---

*Document generated on 2026-04-02. To be updated with post-review decisions.*
