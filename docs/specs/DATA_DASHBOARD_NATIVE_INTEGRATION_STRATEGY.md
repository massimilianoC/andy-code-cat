# Data Dashboard Native Integration Strategy

**Version:** 1.1  
**Status:** Alpha-only experimental strategy  
**Date:** 2026-06-05

---

## 0. Implementation Status

Status aligned to the current codebase on **2026-06-04**.

### Overall estimated completion

- **Native data-dashboard strategy overall:** `63%`
- **Native UI exposure status:** `rolled back from primary UX`

This percentage reflects implemented production code, not planned work.

### Wave-by-wave status

| Wave | Scope | Status | Completion |
| --- | --- | --- | --- |
| Wave 1 | Native intent classification | completed | `100%` |
| Wave 2 | Asset interpretation upgrade | in progress | `70%` |
| Wave 3 | Dashboard-specific prefill | completed | `100%` |
| Wave 4 | Layer X grounded data context | completed | `100%` |
| Wave 5 | Native preset and artifact structure | in progress | `60%` |
| Wave 6 | God Mode manual controls | partial | `25%` |
| Wave 7 | Launch/runtime integration | in progress | `45%` |
| Wave 8 | Editing, regeneration, observability | early partial | `20%` |

### Completed in code

- `data-dashboard` preset/runtime family exists in code but is now hidden from the main preset UX.
- Dedicated dashboard-specific prefill draft exists.
- Layer X grounded dataset context exists.
- Layer D can now append a compact dataset-aware analytical appendix generated from a deterministic dataset envelope, not from raw file dumps.
- The native asset enrichment job now reuses the existing async document pipeline for structured data and can add a best-effort LLM dataset appendix on top of deterministic profiling.
- Shared contracts for published dataset bindings and snapshot sidecar metadata are implemented.
- Publish foundation can now write nested publish files, including `data/manifest.json` and local runtime sidecars when dashboard binding metadata exists.
- Admin-only experimental entry path exists for explicit testing.

### 0.1 Alpha rescoping note

As of **2026-06-05**, the implementation is intentionally treated as **alpha** and is no longer considered part of the default user-facing Vibe / Zero Effort experience.

Operational consequence:

- no primary dashboard CTA should open the data-dashboard flow
- no automatic VibeCore routing should send regular users into it
- no grounded dataset Layer X should be injected into the standard native website flow unless the project is explicitly a `data-dashboard`
- access should happen only through explicit superadmin experimental routes

Current explicit path:

- `/admin/experimental/data-dashboard`
- `/admin/experimental/data-dashboard/[projectId]`

Backward-compatible redirect/guard:

- legacy `/dashboard/data/[projectId]` is no longer a promoted user route and should be treated as compatibility-only

### Still incomplete

- end-to-end producer of `datasetBindings` metadata from generated dashboard artifacts
- source-file publication for dataset bindings
- publish-scoped public backend query/browse/insights routes for live dashboards
- frontend manifest-driven runtime adapter in generated `script.js`
- power-user God Mode controls inside the workspace prompt panel
- governance thresholds and exposure controls for published dataset bindings
- explicit observability/audit events for publish-time binding decisions

### 0.2 Layer D structured-data enrichment status

Current status on **2026-06-05**:

- `completed`: compact deterministic dataset envelope is available in Layer D
- `completed`: raw CSV-style flooding is suppressed when normalized dataset runtime exists
- `completed`: a second best-effort LLM pass can enrich Layer D in appendix form using only deterministic dataset facts
- `completed`: the appendix is appended in calce and does not alter the native website prompt structure
- `not completed`: no public/native UI currently surfaces the appendix as a first-class debug panel
- `not completed`: no dedicated observability breakdown yet separates brief-call cost from dataset-appendix cost

### Status interpretation rule

- `100%` means implemented and already wired into the active flow.
- `60%` means foundation is in code, but the feature is not yet complete end-to-end.
- `<50%` means only partial UI/plumbing/foundation exists.

---

## 1. Purpose

This document defines how the grounded dataset runtime should evolve from an additive,
parallel feature into a first-class, native product path inside the existing:

- VibeCore entry flow
- Zero Effort guided flow
- God Mode workspace
- artifact generation pipeline

The goal is to let users attach structured datasets and describe a desired dashboard in
natural language, while preserving the current website-generation architecture and avoiding
regressions.

This strategy does **not** replace the current website/landing/product templates.

At the present stage, it should be treated as:

- an experimental analytical capability
- detached from the main UX
- reusable at runtime and backend level
- not yet mature enough to steer the default generative entry flow

---

## 2. Executive Summary

Current state:

- A grounded dataset runtime already exists for `CSV`, `XLSX`, `JSON`, tabular `XML`, and
  `SQL` dumps.
- It supports normalization, profiling, deterministic queries, grounded Q&A, dashboard
  suggestions, and row browsing.
- It is currently exposed mainly through an additive route:
  `apps/web/app/dashboard/data/[projectId]/page.tsx`

Target state:

- Introduce a native **Data Dashboard** template/preset family integrated into the same
  VibeCore → Zero Effort / God Mode orchestration path used by existing artifact flows.
- Keep the existing additive data dashboard route as an optional expert surface.
- Add a dedicated data-processing layer before final prompt composition.
- Generate not only `artifacts.html/css/js`, but also structured dashboard metadata and
  dataset bindings, so the result remains grounded at runtime.

Core principle:

- The LLM must never become the source of truth for numerical claims.
- The backend dataset runtime remains the source of truth.
- The LLM is used to:
  - classify intent
  - shape the dashboard
  - explain facts
  - suggest views and interactions
  - enrich interpretation above deterministic facts

---

## 3. Non-Negotiable Product Requirements

### 3.1 No regressions

The following flows must continue to work without behavior changes unless a user explicitly
opts into the new data-dashboard mode:

- standard website generation from VibeCore
- Zero Effort website prefill
- God Mode website workspace generation
- current additive `/dashboard/data/[projectId]` flow
- existing asset upload, enrichment, snapshot, publish, and export behavior

### 3.2 Backward compatibility

- Existing projects with no dataset intent must remain byte-compatible in prompt assembly.
- Existing presets and format hints remain valid and unchanged.
- Existing additive data-dashboard UI must not be removed or deprecated.
- Existing `PreviewSnapshot.artifacts` behavior remains supported.

### 3.3 Grounding and anti-hallucination

- Numeric facts shown in the UI must come from deterministic backend computation.
- Unsupported analytical questions must fail explicitly.
- The LLM may summarize, compare, prioritize, and explain only above grounded facts.
- Raw dataset content must not be blindly dumped into prompt context when a structured
  runtime representation is available.

### 3.4 Shared orchestration

The new flow must reuse the existing:

- project model
- asset storage model
- sandbox model
- prompting governance model
- snapshot lifecycle
- publish/export lifecycle

This is an extension of the native system, not a separate sub-product.

---

## 4. Current State Analysis

### 4.1 Already implemented and reusable

- project asset upload and ownership enforcement
- document/image enrichment pipeline
- Layer D prompt injection for enriched assets
- VibeCore classify and Zero Effort prefill
- typed preset catalog and prompt modules
- grounded dataset runtime:
  - normalization
  - profiling
  - persisted dataset cache
  - deterministic query engine
  - browse/filters/sort
  - grounded insights
  - dashboard suggestions

### 4.2 Main gap

The dataset runtime is currently excellent as an additive analytical surface, but it is not
yet a native artifact-generation path.

Specifically missing:

- dataset-aware `templateId` / `formatHint`
- native dashboard-data prefill contract
- dedicated prompt layer for dataset runtime context
- structured dashboard artifact/binding model
- manual and automatic mode selection inside VibeCore / God Mode
- refined attachment interpretation strategy across all asset types

---

## 5. Strategic Decision

The correct strategic move is:

1. Keep the current additive data dashboard route.
2. Introduce a new native template family for dataset dashboards.
3. Integrate dataset-driven generation into existing VibeCore / Zero Effort / God Mode flows.
4. Preserve manual user control over activation.
5. Add specialized UI for power users without forcing it on standard website users.

This yields:

- lower regression risk
- reuse of current architecture
- clear UX separation
- easier progressive rollout

---

## 6. Target Product Model

### 6.1 New native template family

Introduce a new preset family, for example:

- `data-dashboard`

Suggested category:

- `data-analytics`

Suggested user-facing labels:

- `Data Dashboard`
- `Dashboard Dati`

This preset becomes a first-class sibling of:

- landing
- website
- form
- infographic
- slideshow
- other specialized presets

### 6.2 Two complementary usage modes

The product should support both:

1. **Dedicated data mode**
   - selected explicitly by the user
   - optimized for power users
   - guided by dataset-specific options

2. **Auto-detected data intent**
   - triggered when VibeCore detects dataset-heavy input
   - always reviewable and overridable by the user

### 6.3 Keep the current additive route

The current route:

- `/dashboard/data/[projectId]`

must remain available as:

- expert inspector
- runtime validation surface
- fallback operational console
- low-risk entry point during rollout

This route should become optional but fully supported.

---

## 7. Prompting and Runtime Architecture

### 7.1 Split responsibilities clearly

The future flow must separate four responsibilities:

1. **Attachment interpretation**
   - identify what kind of asset was uploaded
   - choose the correct interpretation path

2. **Dataset operational runtime**
   - parse and normalize structured data
   - compute deterministic facts
   - build queryable runtime views

3. **Dashboard composition layer**
   - infer analytical structure
   - choose UI zones and bindings
   - decide which deterministic queries feed which view

4. **LLM enrichment layer**
   - explain facts
   - create narrative summaries
   - suggest salience and layout priorities

### 7.2 New prompt layer

Do not overload Layer D with the full dataset-runtime responsibility.

Instead introduce a dedicated data layer, for example:

- **Layer X — Grounded Data Context**

Responsibilities:

- dataset profile summary
- tables/sheets exposed
- key column types
- row/column counts
- KPI candidates
- top deterministic insights
- query affordances
- filtering dimensions
- data limitations
- binding-safe sample data

Rules:

- content only
- no technical contradictions with existing prompt layers
- built from the dataset runtime, not generic text extraction
- token-bounded and deterministic

### 7.3 Layer D remains valid

Layer D should continue to serve:

- PDFs
- DOCX
- textual references
- image/design reference analysis
- generic contextual project materials

Dataset-heavy assets should preferentially feed:

- dataset runtime
- Layer X

not only text-summary Layer D.

---

## 8. Attachment Interpretation Strategy

This strategy should improve attachment handling in general, not only for dashboards.

### 8.1 Asset interpretation classes

Every uploaded asset should be classified into one of these operational classes:

- `reference_document`
- `design_reference_image`
- `dataset_structured`
- `presentation_source`
- `mixed_or_unknown`

This classification is independent from MIME type alone.

### 8.2 Interpretation routing

Suggested routing:

- `reference_document`
  - parser/enrichment → Layer D

- `design_reference_image`
  - image analysis → Layer D

- `dataset_structured`
  - dataset runtime → Layer X
  - optional compact Layer D note only

- `presentation_source`
  - structured presentation parser → Layer D

- `mixed_or_unknown`
  - conservative text fallback

### 8.3 General guardrails

- Never send entire large raw files into LLM prompts by default.
- Prefer distilled structured representations over raw excerpts.
- Use MIME + extension + parser success + runtime shape detection together.
- Preserve parser failures as explicit limitations, not silent degradation.
- Keep a deterministic pre-rendered prompt fragment cache per interpretation path.

---

## 9. Native User Flow Design

### 9.1 VibeCore entry

VibeCore should support:

- natural-language prompt
- dataset attachment
- explicit mode selector

Suggested new mode affordances:

- `Website`
- `Data Dashboard`
- `Auto`

Behavior:

- `Auto`: classifier decides, user can override
- `Website`: dataset may still inform content, but no dashboard pipeline
- `Data Dashboard`: activates dataset-native flow

### 9.2 Zero Effort flow

If `Data Dashboard` is selected or inferred:

- the standard website prefill contract is insufficient
- use a dashboard-specific prefill

Suggested new draft:

- `ZeroEffortDataDashboardDraft`

Suggested fields:

- `dashboardName`
- `dashboardGoal`
- `primaryAudience`
- `primaryDatasets`
- `mainEntities`
- `timeDimension`
- `kpiCandidates`
- `questionCandidates`
- `preferredVisualizationStyle`
- `notes`

### 9.3 God Mode flow

God Mode should remain the expert path, but gain a visible data mode.

Suggested manual activation points:

- prompt panel mode toggle:
  - `Website`
  - `Data Dashboard`

- attachment inspector:
  - `Use as data source`
  - `Use as reference material`

- advanced controls for power users:
  - primary table
  - time column
  - metric columns
  - dimensions
  - preferred chart styles
  - strict grounding mode
  - include/exclude selected assets

This should feed the same native artifact pipeline, not a disconnected UI path.

---

## 10. UI Guidelines

### 10.1 General UI stance

- Do not remove the current additive dataset route.
- Expose the native data-dashboard mode only when meaningful.
- Avoid forcing dashboard-specific complexity into basic website users' default path.

### 10.2 VibeCore UI

Recommended additions:

- mode pill:
  - `Auto`
  - `Website`
  - `Data Dashboard`

- dataset attachment indicator:
  - show count of structured datasets separately from other assets

- classifier review chip:
  - `Detected: Data Dashboard`
  - `Detected: Website`

- override action:
  - `Change mode`

### 10.3 Zero Effort UI

Recommended additions when data mode is active:

- review card for inferred dashboard structure
- list of attached datasets
- selected primary table
- inferred KPI groups
- inferred filters/dimensions
- user-editable analytical focus

### 10.4 God Mode UI

Recommended power-user controls:

- `Grounded data mode` toggle
- `Datasets used in generation` multi-select
- `Primary table` selector
- `Metrics` selector
- `Dimensions / filters` selector
- `Time axis` selector
- `Visualization policy` selector
  - KPI-heavy
  - exploratory
  - executive
  - operations

- `Strict no-hallucination mode` badge
- `Regenerate dashboard structure`
- `Open runtime data console`

### 10.5 Keep optional UIs distinct

If dedicated dataset UIs are introduced, they must remain:

- optional
- clearly labeled
- non-destructive to existing website flows

Do not silently repurpose existing website UI as a data workflow without visible user control.

---

## 11. Artifact Model Evolution

### 11.1 Current limitation

Current native artifact output is centered on:

- `artifacts.html`
- `artifacts.css`
- `artifacts.js`

This is not enough for a robust, runtime-grounded data dashboard.

### 11.2 Proposed extension

Add an additive structured artifact payload for data dashboards, for example:

- `artifactKind: "website" | "data_dashboard"`
- `dashboardDefinition`
- `datasetBindings`
- `querySpecs`
- `chartSpecs`

Guiding rule:

- keep `html/css/js` as the rendered presentation layer
- add structured metadata for runtime binding and editing

### 11.3 Backward compatibility rule

- Existing consumers that only understand `html/css/js` must continue to work.
- New dashboard metadata must be optional and additive.
- Website artifacts remain unchanged.

---

## 12. Backward Compatibility Rules

The following rules are mandatory during implementation:

1. No existing route semantics may change for standard website generation.
2. Existing projects without data intent must not receive extra data prompt layers.
3. Existing presets remain valid and unchanged by default.
4. Existing dashboard/data route remains available.
5. Existing asset interpretation for document/image references remains supported.
6. New structured dashboard metadata must be optional.
7. New UI entry points must be feature-flag friendly.
8. Auto-detection must always be user-overridable.

---

## 13. Rollout Guardrails

### 13.1 Technical guardrails

- Feature-flag the native data-dashboard template flow.
- Keep prompt-layer additions isolated and testable.
- Reuse shared contracts wherever possible.
- Add route-level and prompt-level observability for data-mode activation.

### 13.2 Product guardrails

- Data mode must never silently replace website mode.
- If classification confidence is low, default to existing behavior and show the option.
- If dataset runtime preparation fails, degrade visibly and safely.

### 13.3 Analytical guardrails

- No fabricated metrics
- No unsupported chart claims
- No hidden transformations
- No silent table switching
- No raw-file over-truncation without explicit limitation notes

### 13.4 No simulation rule

For this feature family, silent simulation is forbidden.

This applies to:

- fake dataset values
- mock KPI numbers presented as real
- invented row samples
- simulated backend query results
- placeholder runtime bindings treated as valid
- fallback demo dashboards presented as grounded outputs

Mandatory rule:

- if the real dataset, real binding, or real runtime path is unavailable, the product must fail explicitly or degrade visibly

Allowed only when explicit and visible in UI:

- empty state
- unsupported state
- binding unresolved state
- publish blocked state
- runtime unavailable state

Forbidden:

- hidden mocks
- silent fake data
- undocumented simulated systems
- agent-introduced demo payloads pretending to be project truth

Agent directive:

- agents must never implement or preserve simulated dataset/runtime behavior unless it is explicitly documented, explicitly labeled in UI as simulation, and explicitly approved as a product requirement
- when in doubt, prefer a hard failure or a visible unsupported state over a hidden mock path

---

## 14. Detailed Implementation Plan

The work should be delivered in waves, with some serial dependencies and some parallelizable
tracks.

### Wave 0 — Foundations audit and contracts

**Type:** serial  
**Goal:** define the native data-dashboard path without changing user-facing behavior

Deliverables:

- introduce spec-approved terminology:
  - `data dashboard`
  - `dataset structured asset`
  - `Layer X`
- add contract placeholders for:
  - mode selection
  - dashboard prefill draft
  - dashboard artifact metadata
- document feature flags

Acceptance:

- no runtime behavior changes
- docs and contracts aligned

### Wave 1 — Native intent classification

**Type:** serial

Deliverables:

- extend `FormatHint` or equivalent template-resolution model for data dashboards
- extend `VibeClassify` to detect:
  - website intent
  - data-dashboard intent
- include attachment-aware classifier signals
- expose classifier result in VibeCore UI with manual override

Acceptance:

- website flows unchanged when no dataset intent is present
- classifier can return `data-dashboard`
- user can override

### Wave 2 — Asset interpretation upgrade

**Type:** parallel with Wave 1 finishing hooks

Deliverables:

- introduce explicit attachment interpretation classes
- route `dataset_structured` assets to dataset runtime first
- preserve document/image Layer D behavior
- improve generic attachment interpretation quality and explainability

Acceptance:

- structured dataset assets are distinguished from generic documents
- JSON/XML are not treated only as text summaries when a dataset runtime view exists

### Wave 3 — Dashboard-specific prefill

**Type:** serial

Deliverables:

- add `ZeroEffortDataDashboardDraft`
- add new prefill path for data mode
- reuse existing VibeCore orchestration and project creation
- preserve current website prefill path untouched

Acceptance:

- Zero Effort can prefill a dashboard-oriented brief
- existing website prefill remains stable

### Wave 4 — Layer X grounded data context

**Type:** serial

Deliverables:

- implement dedicated prompt layer from dataset runtime
- include:
  - schema summary
  - facts
  - KPI candidates
  - filters/dimensions
  - chart/query affordances
  - limitations
- keep token budget bounded and deterministic

Acceptance:

- data dashboards use Layer X
- website prompts do not receive Layer X unless explicitly in data mode

### Wave 5 — Native preset and artifact structure

**Type:** serial

Deliverables:

- add `data-dashboard` preset in preset catalog
- add category and recommended model
- define dashboard-specific prompt module
- introduce additive structured artifact metadata:
  - `artifactKind`
  - `dashboardDefinition`
  - `datasetBindings`
  - `querySpecs`

Acceptance:

- artifact generation can target `data-dashboard`
- website artifact path still works unchanged

### Wave 6 — God Mode manual controls

**Type:** parallel after Wave 5 contracts

Deliverables:

- prompt-panel mode switch
- dataset asset selection controls
- power-user configuration:
  - primary table
  - metrics
  - dimensions
  - time axis
  - analysis style
  - strict grounding

Acceptance:

- power users can manually force data mode
- the result still flows into native artifact generation

### Wave 7 — Launch/runtime integration

**Type:** serial

Deliverables:

- generated dashboard artifacts bind to dataset runtime at execution time
- row browser, filters, grounded query panel, and insights can be surfaced inside the
  dashboard experience
- additive `/dashboard/data/[projectId]` route remains usable as an expert console
- the publish-time binding model follows
  [PUBLISHED_DATASET_BINDINGS_SPEC.md](PUBLISHED_DATASET_BINDINGS_SPEC.md)

Acceptance:

- generated dashboard is not merely static
- dashboard remains grounded on real project datasets

### Wave 8 — Editing, regeneration, and observability

**Type:** parallelizable by sub-track

Deliverables:

- edit/re-generate dashboard structure from prompt refinements
- inspect runtime bindings inside workspace
- audit logs for:
  - data-mode activation
  - dataset interpretation
  - Layer X generation
  - query-source usage
- admin/owner observability for data pipelines

Acceptance:

- dashboard evolution is traceable
- operators can diagnose failures and grounding decisions

---

## 15. Serial vs Parallel Track Map

### Serial backbone

1. contracts and naming
2. intent classification
3. dashboard prefill
4. Layer X
5. preset and artifact metadata
6. runtime binding

### Parallel tracks

- attachment interpretation quality improvements
- additive expert UI hardening
- God Mode power-user controls
- observability and logs
- admin governance tuning

---

## 16. Testing and Verification Requirements

Each wave must prove:

- no regression on website generation
- no regression on current Zero Effort website prefill
- no regression on current God Mode website generation
- no regression on current additive `/dashboard/data/[projectId]` route

Additional dedicated checks:

- data intent classification with and without dataset attachments
- manual override behavior
- dashboard prefill correctness
- Layer X prompt injection only in data mode
- dashboard artifact binding to actual dataset runtime
- explicit refusal on unsupported data questions

---

## 17. Governance and Admin Surface

Superadmin-governed controls should include:

- enable/disable native data-dashboard mode
- classifier thresholds for data intent
- default recommended model for `data-dashboard`
- Layer X token budget
- max datasets per prompt
- strict grounding defaults
- allowed chart families

These controls must be additive to the current governance model.

---

## 18. Recommended First Implementation Slice

The best low-risk first slice is:

1. add `data-dashboard` preset
2. add mode override in VibeCore UI
3. extend classifier to detect data intent
4. add dashboard prefill draft
5. add Layer X using the already-built dataset runtime

This creates a native path quickly without forcing artifact-model rewrites on day one.

---

## 19. Explicit Do-Not-Do List

- Do not dump raw large datasets directly into prompts by default.
- Do not merge the additive data dashboard route into the website route.
- Do not remove or hide the current expert data console.
- Do not silently switch website projects into data mode.
- Do not let the LLM invent dataset metrics not produced by deterministic runtime logic.
- Do not redesign current prompt layers in a way that risks website regressions.
- Do not simulate missing dataset bindings, missing runtime payloads, or missing backend query paths with fake data.

---

## 20. Final Recommendation

The data-dashboard direction is not a separate product.

It should become a native, specialized branch of the current artifact-generation platform:

- same project model
- same assets
- same prompting governance
- same artifact lifecycle
- same VibeCore / Zero Effort / God Mode orchestration

but with:

- a dedicated template family
- a dedicated grounded data-processing layer
- dedicated power-user controls
- additive expert runtime consoles

This is the highest-leverage path because it extends current architecture rather than
forking it, preserves compatibility, and turns the existing dataset runtime into a strategic
core capability of the product.
