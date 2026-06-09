# Data Dashboard Architectural Status — 2026-06-04

**Type:** Architecture and implementation report  
**Scope:** grounded dataset runtime, native data-dashboard integration, publish binding foundation  
**Status date:** 2026-06-04

---

## 1. Executive Summary

The data-dashboard capability has been developed as an **additive extension** of the native generative system, not as a forked product.

Current architectural position:

- the **grounded dataset runtime** already exists and is functional
- the **native intent/prefill/prompt integration** for data dashboards is partially integrated
- the **publish-time dataset binding layer** is only at foundation stage

In short:

- **internal project/runtime flow:** substantially working
- **native orchestration integration:** materially started and already visible in VibeCore/prompting
- **public live published dashboard model:** not complete yet

---

## 2. Overall Status

### 2.1 Strategic progress

| Area | Estimated completion | Notes |
| --- | --- | --- |
| Native data-dashboard strategy overall | `63%` | classifier, prefill, Layer X, preset, partial handoff are in code |
| Published dataset bindings wave | `38%` | contracts and publish-side foundation exist; end-to-end public runtime does not |

### 2.2 What is real today

- project assets can include structured datasets
- deterministic normalization exists for `CSV`, `XLSX`, `JSON`, tabular `XML`, and supported `SQL` insert dumps
- deterministic query/browse/insight flows are already available
- VibeCore can classify a request as `data_dashboard`
- data-dashboard prefill is implemented
- Layer X grounded data context is part of the native prompt pipeline
- a `data-dashboard` preset exists
- publish can now emit `data/manifest.json` and local runtime sidecars **if** snapshot metadata contains dataset binding metadata

### 2.3 What is not real yet

- automatic generation of dataset binding metadata from the artifact-generation flow
- live public dashboard runtime that uses manifest + binding adapter end-to-end
- source dataset publication policy fully implemented
- publish-scoped public query/browse/insight endpoints

---

## 3. Architectural Positioning

The feature sits across three layers of the product:

```text
1. Intake / orchestration
   VibeCore, Zero Effort, God Mode

2. Grounded data runtime
   normalization, profile, query, browse, insights

3. Native generative pipeline
   preset selection, prompt composition, preview snapshot, publish/export
```

This means the work is not a single feature patch. It crosses:

- frontend intake UX
- backend dataset runtime
- prompt system composition
- snapshot metadata model
- publish filesystem model

---

## 4. Relation To The Native Generative Architecture

### 4.1 Baseline native architecture

The native system already had this shape:

```text
User prompt
   ->
VibeCore / Workspace
   ->
Prompt composition
   ->
LLM artifact generation
   ->
PreviewSnapshot { html, css, js }
   ->
Publish / Export
```

This model is fundamentally **artifact-first**, with a stable triple:

- `artifacts.html`
- `artifacts.css`
- `artifacts.js`

### 4.2 How the data-dashboard work extends it

The data work does **not** replace that model.

It extends it like this:

```text
User prompt + dataset assets
   ->
VibeCore classify/prefill
   ->
Prompt composition + Layer X
   ->
LLM artifact generation
   ->
PreviewSnapshot { html, css, js }
              + metadata.dataDashboard (new sidecar)
   ->
Publish
   ->
public site + optional data sidecar files
```

Key principle:

- `html/css/js` remain the rendered contract
- dashboard/data metadata is additive sidecar data

### 4.3 Why this matters

This keeps compatibility with:

- existing snapshot lifecycle
- existing workspace editor model
- existing publish/export behavior for websites
- existing prompting governance

So the data-dashboard path is architecturally:

- **inside the same system**
- **parallel in capability**
- **not yet fully converged in publish/runtime**

---

## 5. Development Path Taken

The implementation evolved in three main tracks.

### 5.1 Track A — Grounded runtime first

This was the first solid base.

Implemented:

- dataset asset recognition
- deterministic normalization
- profile/facts/limitations
- query engine
- browse engine
- grounded Q&A
- dashboard suggestions

This track created a true source of truth independent from the LLM.

```text
ProjectAsset
   ->
DatasetLoader
   ->
NormalizedDataset cache
   ->
profile / query / browse / insights / ask
```

### 5.2 Track B — Native entry integration

Then the work moved toward the existing native orchestration.

Implemented:

- `data-dashboard` preset
- `analytics_dashboard` format hint
- `data_dashboard` generation mode
- VibeCore mode selector
- classifier support for dataset-heavy prompts
- dashboard-specific prefill
- Layer X in native prompt composition

This is where the feature stopped being only an expert console and started becoming part of the system’s main entry flow.

### 5.3 Track C — Publish binding foundation

The latest work started the publish-side convergence.

Implemented:

- shared contracts for dataset bindings and published manifest
- `PreviewSnapshot.metadata.dataDashboard` sidecar
- publish support for nested `data/*` files
- publish-side writer for:
  - `data/manifest.json`
  - `data/runtime-<bindingId>.json`
- public static serving of published `data/*`

This is not yet the full public runtime, but it is the first real bridge from dataset runtime into the publish model.

---

## 6. Current Architecture Map

### 6.1 End-to-end view

```text
                  +----------------------+
                  |  User / Power User   |
                  +----------+-----------+
                             |
                             v
                 +-----------+------------+
                 |   VibeCore / Dashboard |
                 |  mode: website | data  |
                 +-----------+------------+
                             |
                +------------+-------------+
                |                          |
                v                          v
      +---------+---------+      +--------+---------+
      | Website native    |      | Data-dashboard   |
      | path              |      | native extension |
      +---------+---------+      +--------+---------+
                |                         |
                |                         v
                |              +----------+-----------+
                |              | Grounded dataset     |
                |              | runtime              |
                |              +----------+-----------+
                |                         |
                +-------------+-----------+
                              |
                              v
                  +-----------+------------+
                  | Prompt composition     |
                  | Layer A/B/C/D/X/E/F    |
                  +-----------+------------+
                              |
                              v
                  +-----------+------------+
                  | LLM artifact output    |
                  | html / css / js        |
                  +-----------+------------+
                              |
                              v
                  +-----------+------------+
                  | PreviewSnapshot        |
                  | + metadata sidecars    |
                  +-----------+------------+
                              |
                              v
                  +-----------+------------+
                  | Publish foundation     |
                  | html/css/js + data/*   |
                  +------------------------+
```

### 6.2 Prompt architecture insertion point

```text
Layer A  base constraints
Layer B  preset module
Layer T  template resolution
Layer C  style context
Layer D  document/reference context
Layer X  grounded dataset context   <-- new
Layer E  pre-prompt template
Layer F  governance
Budget   output policy
```

Meaning:

- Layer D remains valid for documents and references
- Layer X carries deterministic dataset context
- the data-dashboard work respects the existing prompt architecture instead of rewriting it

---

## 7. How It Integrates With The Native System

### 7.1 Integrated parts

These parts are already integrated into the native system:

- preset catalog
- classifier
- prefill
- prompt composer
- prompt preview
- project creation path
- workspace handoff
- snapshot metadata model
- publish filesystem support

### 7.2 Parallel but adjacent parts

These still live as parallel operational surfaces:

- `/dashboard/data/[projectId]` expert runtime console
- server-side dataset runtime routes

These are not a problem. They are the operational substrate that the native path is reusing.

### 7.3 Not integrated yet

These are the missing convergence points:

- generated artifact -> automatic `datasetBindings`
- workspace-generated dashboard -> manifest-driven public runtime
- public dashboard -> real backend query fallback when needed

So today the architecture is:

```text
Native intake + native prompt integration
                YES

Native public runtime completion
                NO
```

---

## 8. Component-by-Component Placement

### 8.1 Existing native components now extended

| Component | Role in native system | Data-dashboard extension |
| --- | --- | --- |
| `VibeCoreEntry` | guided intake | mode selector + dashboard handoff |
| `VibeClassify` | intent/template routing | can resolve `data_dashboard` |
| `VibePrefill` | website brief prefill | dashboard brief prefill |
| `systemPromptComposer` | native prompt assembly | accepts Layer X |
| `llmRoutes.resolveContext()` | project-aware context assembly | computes data layer from dataset assets |
| `PreviewSnapshot.metadata` | artifact-side metadata | now supports `dataDashboard` sidecar |
| `PublishProject` | native publish use case | can emit data sidecar foundation |

### 8.2 Supporting subsystems

| Subsystem | Role |
| --- | --- |
| dataset runtime | deterministic truth layer |
| dataset cache store | persisted normalized runtime |
| dataset routes | operational query/browse/ask interface |
| additive data dashboard page | expert runtime console and validation surface |

---

## 9. Visual Integration Model

### 9.1 What is already joined

```text
dataset upload
   ->
project asset
   ->
runtime normalization
   ->
Layer X / dashboard prefill
   ->
native project path
```

### 9.2 What is still disconnected

```text
workspace artifact generation
   ->
automatic dataset binding metadata
   ->
published live dashboard runtime
```

That second chain is the main remaining integration gap.

---

## 10. Architectural Strengths

The current approach has several strong properties.

### 10.1 It preserves the native system

There is no rewrite of:

- snapshot contract
- workspace editing model
- prompt governance
- publish entrypoints

### 10.2 It keeps deterministic truth outside the LLM

This is the correct technical direction for real-data dashboards.

### 10.3 It uses additive sidecars instead of incompatible replacement

That makes rollout safer and keeps old consumers working.

### 10.4 It supports gradual convergence

The expert runtime console can continue to exist while the native public runtime matures.

---

## 11. Architectural Weaknesses / Gaps

### 11.1 Snapshot-to-binding producer gap

The system still lacks the real producer that says:

```text
this generated artifact depends on these datasets,
with these tables,
through these binding rules
```

Without that, publish-side data files are foundation only.

### 11.2 Public runtime gap

The browser runtime for published dashboards does not yet automatically:

- read the manifest
- hydrate local runtime
- switch to backend mode when needed

### 11.3 Governance gap

Thresholds and exposure policies are not yet wired into admin governance.

### 11.4 Observability gap

There is not yet a full audit trail for:

- why a binding mode was chosen
- why source publication was suppressed
- why backend mode was required

---

## 12. Recommended Next Architectural Steps

The correct next sequence is:

```text
1. artifact -> datasetBindings producer
2. publish-scoped manifest semantics hardening
3. public query/browse/insights routes
4. generated JS runtime adapter
5. governance + observability
```

### 12.1 Why this order

Because the first missing truth is:

- the system must know which datasets a generated artifact actually binds to

Until that exists, publish/runtime completion stays partial.

---

## 13. Architectural Conclusion

The data-dashboard work is already **inside the native generative architecture** in the following sense:

- native entry
- native prompt stack
- native preset model
- native snapshot model
- native publish filesystem

It is **not yet fully inside the native public artifact lifecycle** because the final runtime-binding bridge is still incomplete.

So the correct architectural reading is:

```text
Not a separate product
Not a fork
Not only an expert console

But also:
Not yet a fully completed public native runtime
```

The project is therefore in a **transitional but structurally correct state**:

- the chosen architecture is coherent
- the grounded runtime foundation is strong
- the native integration path is real
- the remaining work is concentrated in the last bridge from generated artifact to published live runtime

---

## 14. Reference Documents

- [docs/specs/DATA_DASHBOARD_NATIVE_INTEGRATION_STRATEGY.md](../specs/DATA_DASHBOARD_NATIVE_INTEGRATION_STRATEGY.md)
- [docs/specs/PUBLISHED_DATASET_BINDINGS_SPEC.md](../specs/PUBLISHED_DATASET_BINDINGS_SPEC.md)
- [docs/architecture/PIPELINE_LAYERS.md](../architecture/PIPELINE_LAYERS.md)
- [docs/runbooks/TESTABLE_STEPS.md](../runbooks/TESTABLE_STEPS.md)
