# Prompt Layer Restructure — Format-Agnostic Core & Template-Driven Layout

> Status: **implemented** (waves 0–6 + regression fixes A–D) on branch `feat/brand-reusable-context`
> Maintainer decisions (2026-07-01): full Layer A slimming approved; new `viewportModel` field
> (not enum extension); soft-responsive wording so assertive templates win. Regression gaps
> closed post-review: static viewport fallback pre-reseed (PP-018), default document framing
> for preset-less projects, awaited (never fire-and-forget) brand-doc enrichment with stale
> guard, final-authority visibility imperative restored in budget policy.
> Reseed is MANDATORY per deploy — see `docs/runbooks/PRESET_RESEED.md` and
> `docs/guides/AGENT_RELEASE_CHECKLIST.md` §10.
> Date: 2026-06-30
> Related: [PROMPTING_PIPELINE_AGENT_GUARDRAILS.md](../agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md) ·
> [ProjectPreset.ts](../../apps/api/src/domain/entities/ProjectPreset.ts) ·
> [systemPromptLayers.ts](../../apps/api/src/application/llm/systemPromptLayers.ts) ·
> [PRESET_RESEED.md](../runbooks/PRESET_RESEED.md)

---

## 0. Problem statement

Choosing a **full-screen** template (videogame, game3d, vr-aframe, slideshow, keynote) too
often yields a **scrollable landing-style document with the experience embedded inside**,
instead of a true full-viewport experience. Root cause is **not** the gaming template text
(which even says *"Non generare una landing sul gioco"*) — it is:

1. **Layer A leaks landing/document layout assumptions** into *every* prompt, overriding the
   soft per-template guidance.
2. **The preset data model cannot express "full-screen"**, so games are modelled identically
   to landings (`single_page` / `scroll`).
3. **Redundant directives** restated across layers dilute the single-source-of-truth contract.

The goal is to realign the layers to the architecture **already intended** in the guardrails:
Layer A = universal *technical* floor; Layer B (preset) = format/layout characterization;
let prompt + context drive variability, with rigid rules limited to technical safety.

---

## 1. Current-state audit (evidence)

### 1.1 Layer A exceeds its authorized scope (contract violation)

Per [GUARDRAILS §1](../agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md), Layer A authorized
content is: *"1+1+1 output format, CDN-only, no framework, JS exclusively in artifacts.js,
HTML compactness."* The current [`buildBaseConstraintsLayer()`](../../apps/api/src/application/llm/systemPromptLayers.ts#L232)
also contains **layout/document directives that are not authorized**:

| Line | Directive | Problem |
|---|---|---|
| L241 | `Mobile-first responsive design: optimize for 375 / 768 / 1280` | Hard landing/document breakpoints; wrong framing for full-viewport experiences; over-rigid |
| L242 | `Semantic HTML5: <header>/<nav>/<main>/<section>/<article>/<footer>` | Imposes a document/landing skeleton on games, slides, posters |
| L244 | `loading="lazy" on below-the-fold images` | Assumes a scrollable page with a fold |

These three are **layout characterization**, not technical floor → they belong to the
preset (Layer B), not Layer A.

### 1.2 Redundancy across layers (single-source violations)

- **Visibility-without-JS** rules appear BOTH in Layer A (L259–267) AND in
  [`buildOutputBudgetPolicy()`](../../apps/api/src/application/llm/llmMessageBuilder.ts#L67).
  Per PP-002/PP-003 there must be one authoritative source. Keep in Layer A (technical
  safety), reduce the budget-policy line to a one-line pointer or remove.
- **Media placeholder / `asset://media`** intent is asserted in budget policy and partially
  echoed elsewhere — audit for overlap (lower priority; not layout-related).

### 1.3 Preset model cannot express full-screen

[`PresetOutputSpec`](../../apps/api/src/domain/entities/ProjectPreset.ts#L10):
`pageModel ∈ {single_page, multi_page, slide_deck, print_a4}`,
`sectionModel ∈ {scroll, paginated, masonry, stepped_form}` — **no viewport/fullscreen value**.
`videogame` and `game3d` are declared `single_page` + `scroll` — structurally a landing.

### 1.4 Game/presentation modules are too soft on viewport

The [videogame module](../../apps/api/src/domain/entities/ProjectPreset.ts#L744) asks for a
*"GAME AREA dimensionata"* (a sized area) — not *full viewport, no page scroll, fill
100dvh/100dvw*. Against Layer A's strong responsive-document framing, the soft guidance loses.

---

## 2. Target architecture (intended responsibilities)

| Layer | Keeps / becomes | Drops |
|---|---|---|
| **A — base** | Universal **technical** floor only: 1+1+1 files, CDN-only, vanilla JS, JS-in-artifacts.js, HTML compactness, accessibility baseline (technical), visibility-without-JS (technical safety), canvas/engine container rules (technical safety) | `mobile-first 375/768/1280`, semantic `header/nav/section/footer`, `below-the-fold lazy` → move to presets |
| **A — responsive wording** | Neutral, non-rigid: *"Make the output responsive to the target viewport(s) defined by the chosen format/preset and the request; do not assume a scrollable document unless the format implies one."* | Hard pixel breakpoints as a universal mandate |
| **B — preset** | Owns **layout/viewport characterization** per format via `systemPromptModule` + a new structural field | — |
| **Budget** | Single source for OUTPUT/REASONING + media contract; one-line visibility pointer only | Duplicated visibility block |

**Design principle (per the user's directive):** strengthen *technical, format-agnostic*
directives that increase safe variability (e.g. "respect the target viewport", "fill the
container", canvas safety), and remove *rigid stylistic/layout* mandates so output is driven
by prompt + context + preset, not by a one-size landing template.

---

## 3. Preset model extension — first-class viewport mode

Add to `PresetOutputSpec`:

```ts
// New, optional → retrocompatible. Absent = "document" (today's behaviour).
viewportModel?: 'document_scroll' | 'fullscreen_app' | 'slide_deck' | 'print';
```

Mapping to set on each preset:

| Preset | viewportModel | Module assertion to add |
|---|---|---|
| landing, website, neutral, manifesto, infographic | `document_scroll` | mobile-first responsive scrollable doc, semantic sections, lazy below-the-fold (moved from Layer A) |
| videogame, freerunner, seriousgame, game3d, vr-aframe | `fullscreen_app` | **Fill the viewport: root container 100dvw×100dvh, no page scroll, no document chrome (no marketing header/footer). The experience IS the page.** |
| slideshow, keynote | `slide_deck` | full-viewport slides, one slide per viewport, keyboard/touch paging, no document scroll |
| a4poster | `print` | fixed print canvas (existing print rules) |

`buildPresetLayerFromPreset()` emits a short, deterministic **VIEWPORT MODE** block derived
from `viewportModel` (single source, not free text), prepended to the preset's
`systemPromptModule`. Absent field → no block → byte-identical to today.

---

## 4. Concrete changes (per file)

### 4.1 Layer A — `buildBaseConstraintsLayer()` *(FROZEN ZONE — requires approval)*
- Remove L241/L242/L244 layout directives.
- Replace with one neutral responsiveness line (technical, non-rigid).
- Keep all technical safety (files, CDN, JS placement, compactness, visibility-without-JS,
  canvas/engine container rules, accessibility baseline).
- Cite `PP-002` (JS placement unchanged) and note the frozen-zone consensus in the PR.

### 4.2 Preset model + catalog — `ProjectPreset.ts`
- Add `viewportModel?` to `PresetOutputSpec` and the contracts mirror in `packages/contracts`.
- Set `viewportModel` on every preset (table §3).
- Add the moved layout directives to landing/website/document presets' `systemPromptModule`.
- Strengthen game/3D/VR/slide modules with full-viewport assertions.

### 4.3 Layer B builder — `buildPresetLayerFromPreset()`
- Emit the deterministic VIEWPORT MODE block from `viewportModel`.

### 4.4 Budget policy — `buildOutputBudgetPolicy()`
- Collapse the duplicated visibility block (L67) to a one-line pointer to Layer A (PP-003).

### 4.5 Persistence / reseed
- `MongoProjectPresetRepository` maps `viewportModel`.
- Reseed the preset catalog per [PRESET_RESEED.md](../runbooks/PRESET_RESEED.md) (the live
  catalog is Mongo-backed; static defaults are the fallback).

### 4.6 Guardrails doc
- Update [GUARDRAILS §1](../agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md) Layer A/B authorized
  content to reflect the new split; add a `PP-0xx` rule: *"Layout/viewport characterization
  lives in Layer B (preset), never in Layer A."*

---

## 5. Wave plan

| Wave | Scope | Build green? | Risk |
|---|---|---|---|
| 0 | This MD + guardrails update (authorized-content table, new PP rule) | ✅ docs | none |
| 1 | `viewportModel?` in entity + contracts + Mongo mapping (no behaviour change) | ✅ types | none — additive |
| 2 | VIEWPORT MODE block in `buildPresetLayerFromPreset()`; unit test empty→"" | ✅ | low |
| 3 | Set `viewportModel` + module text on all presets; reseed | ✅ | medium (content) |
| 4 | Layer A slimming (remove 3 directives, neutral responsiveness line) — **frozen-zone PR** | ✅ | high — affects all presets |
| 5 | Budget-policy visibility de-dup (PP-003) | ✅ | low |
| 6 | Tests + prompt-preview verification + TESTABLE_STEPS | ✅ | — |

Waves 1–3 are safe and additive and can land before the frozen-zone Wave 4. Wave 4 is the
only one that changes existing behaviour for all presets and must ship with full verification.

---

## 6. Retrocompatibility & verification

- `viewportModel` optional → existing presets/records unaffected until set.
- After Wave 4, verify via prompt-preview (now showing the **real** sent prompt):
  - **videogame** → composed prompt contains VIEWPORT MODE = fullscreen_app, no
    mobile-first/below-the-fold landing directives; generated output fills the viewport with
    no page scroll.
  - **landing** → still responsive scrollable document (directives now sourced from the preset).
  - **slideshow** → slide_deck full-viewport paging.
- Watch the `artifact_repaired` canary (GUARDRAILS §7) for regressions after Layer A change.

---

## 7. Open decisions for the maintainer

1. **Layer A is a frozen zone** — approve the slimming (Wave 4) or keep Layer A as-is and only
   *add* the preset-side full-viewport assertions (weaker fix, leaves the conflict but reduces it)?
2. Extend the existing `pageModel`/`sectionModel` enums instead of adding `viewportModel`?
   (Recommendation: add `viewportModel` — orthogonal concern, cleaner, fully retrocompatible.)
3. How aggressive should the neutral responsiveness wording in Layer A be — fully delegate to
   preset/context, or keep a soft universal "responsive by default unless the format is fixed-canvas"?
