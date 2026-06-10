# Published Dataset Bindings Spec

**Version:** 1.0  
**Status:** Proposed  
**Date:** 2026-06-04

---

## 0. Implementation Status

Status aligned to the current codebase on **2026-06-04**.

### Overall estimated completion

- **Published dataset bindings wave overall:** `38%`

This wave is now in foundation stage: contracts and first publish-side plumbing exist, but the end-to-end live dashboard binding experience is not complete yet.

### Workstream status

| Workstream | Status | Completion |
| --- | --- | --- |
| Shared contracts and manifest DTOs | in progress | `80%` |
| Snapshot metadata sidecar for dashboard bindings | in progress | `70%` |
| Publish nested `data/*` file support | completed foundation | `90%` |
| Publish-time `manifest.json` generation | in progress | `60%` |
| Publish-time local normalized runtime sidecars | in progress | `50%` |
| Original source-file publication | not started | `0%` |
| Public publish-scoped backend query routes | not started | `0%` |
| Frontend manifest-driven runtime adapter | not started | `0%` |
| Governance thresholds and exposure controls | not started | `0%` |
| Republish cleanup semantics for stale `data/` files | early partial | `15%` |

### Completed in code

- Shared contracts for:
  - `DataDashboardArtifactMetadata`
  - dataset bindings
  - published manifest DTOs
- `PreviewSnapshot.metadata` can now carry additive `dataDashboard` sidecar metadata.
- Publish storage can now write nested files such as:
  - `data/manifest.json`
  - `data/runtime-<bindingId>.json`
- Publish foundation can materialize a local normalized runtime sidecar from the deterministic backend dataset cache when snapshot metadata includes dashboard bindings.
- Public static serving for `/p/{publishId}/data/:file` is implemented for manifest/runtime sidecars.

### Still incomplete

- automatic generation of `dataDashboard.datasetBindings` from artifact generation
- publication of original uploaded source dataset files
- public live backend query endpoints for backend-only or hybrid dashboards
- manifest-aware browser runtime adapter in generated dashboards
- policy engine driven by superadmin governance thresholds
- full stale-file cleanup on republish

### Percentage rule

- percentages are conservative and reflect end-to-end usability, not only code presence
- a feature can be above `50%` and still be unavailable in the default user flow

---

## 1. Purpose

This document specifies the next wave after the native data-dashboard integration strategy:

- how project datasets should be exposed to generated and published artifacts
- how `artifacts.html/css/js` should bind to real project datasets at runtime
- when the original dataset file should remain accessible
- when a normalized runtime payload should be published
- when the dashboard must query the backend instead of loading a static local file

This spec is additive to:

- [DATA_DASHBOARD_NATIVE_INTEGRATION_STRATEGY.md](DATA_DASHBOARD_NATIVE_INTEGRATION_STRATEGY.md)
- [EXPORT_AND_PUBLISH_SPEC.md](EXPORT_AND_PUBLISH_SPEC.md)

It must not break the current website generation model or publish lifecycle.

---

## 2. Problem Statement

The platform already supports:

- dataset upload as project assets
- deterministic normalization for `CSV`, `XLSX`, `JSON`, tabular `XML`, and `SQL` insert dumps
- persisted normalized runtime cache
- deterministic querying, browsing, and grounded insights

What is not yet fully defined is the **publish-time dataset binding model**.

The missing product decision is:

> when a native data dashboard is generated and published, should the artifact access:
>
> 1. only the original uploaded file  
> 2. only a normalized local runtime payload  
> 3. only backend query endpoints  
> 4. a hybrid combination of these modes

---

## 3. Goals

### 3.1 Functional goals

- Keep the original uploaded dataset as a first-class project asset.
- Allow published dashboard artifacts to access real project data.
- Preserve grounded analytics and anti-hallucination guarantees.
- Support browser-side interactive dashboards without forcing every interaction through the LLM.
- Scale from small self-contained dashboards to large industrial datasets.

### 3.2 Non-goals

- Replacing the current dataset runtime with a browser-only parser.
- Treating the LLM as the numerical source of truth.
- Publishing every dataset file publicly by default.
- Forcing all website projects to carry dataset runtime metadata.

---

## 4. Current State

Current implementation behavior:

- The **original dataset file** is stored as a normal project asset using `storedFilename`.
- The **normalized dataset runtime** is generated from that original file.
- The normalized runtime is cached as a persisted JSON payload in storage, not as a first-class Mongo row store.
- The asset enrichment trace stores a **dataset profile envelope**:
  - tables
  - column profiles
  - facts
  - limitations
- Dataset runtime routes operate server-side:
  - profile
  - summary
  - query
  - ask
  - browse
  - insights
  - dashboard suggestion

Important consequence:

- today, published artifacts do **not** yet receive a formal local dataset binding package by default
- the publish contract still centers on `html/css/js`

---

## 5. Option Analysis

### 5.1 Option A — Source file only

Published artifact receives only the original uploaded dataset file, for example:

- `data/source.csv`
- `data/source.json`
- `data/source.xlsx`

Browser JavaScript parses the source file directly.

#### Advantages

- maximum fidelity to the original source
- simple conceptual model
- easy lineage and traceability

#### Weaknesses

- poor support for `XLSX`, `XML`, and `SQL` in browser-only runtime
- larger client complexity
- duplicated normalization logic between backend and frontend
- weaker grounding guarantees because the browser may interpret the file differently than the backend runtime
- unsuitable for large industrial dumps

#### Verdict

- useful as an optional preservation mode
- not suitable as the primary product model

---

### 5.2 Option B — Normalized local runtime only

Published artifact receives a normalized JSON payload produced by the backend, for example:

- `data/runtime.json`
- `data/manifest.json`

Browser JavaScript renders the dashboard from the normalized payload only.

#### Advantages

- deterministic structure shared with backend runtime
- strong alignment with grounded query logic
- easy JS integration for filters, charts, and table browsing
- better compatibility across input formats

#### Weaknesses

- duplicates dataset content into a published static artifact
- weak fit for large datasets
- may expose more rows than desired if exported without policy limits
- original source lineage becomes indirect unless separately referenced

#### Verdict

- strong default for small and medium datasets
- insufficient alone for large runtime workloads

---

### 5.3 Option C — Backend query endpoint only

Published artifact receives no local dataset payload.  
All data interactions are executed against backend routes.

#### Advantages

- best scalability
- central policy enforcement
- easier revocation, rate limiting, and query auditing
- no need to publish data files statically

#### Weaknesses

- requires live API dependency for every interaction
- weak offline or static-host portability
- higher latency for exploration
- reduced simplicity for published standalone artifacts

#### Verdict

- necessary for large or sensitive datasets
- too restrictive as the only mode

---

### 5.4 Option D — Hybrid mode

Published artifact may use:

- the original source asset for lineage or download
- a normalized local runtime payload for interactive client rendering
- backend query endpoints for large, sensitive, or paginated operations

The binding mode is selected explicitly per dataset binding.

#### Advantages

- best fit across small, medium, and large datasets
- preserves original source authenticity
- keeps frontend dashboard logic simple and deterministic
- allows scalable fallback for large industrial data
- aligns with current architecture and current dataset runtime

#### Weaknesses

- more implementation complexity
- requires explicit policy and binding metadata
- needs stronger publish-time guardrails

#### Verdict

- **recommended architecture**

---

## 6. Decision

The platform should adopt **Hybrid mode** as the canonical published dataset binding model.

### 6.1 Core rule

Each generated data-dashboard artifact may bind a dataset in one of these runtime modes:

- `source_file`
- `normalized_local`
- `backend_query`
- `hybrid`

### 6.2 Product default

Default behavior should be:

- preserve original uploaded asset in project storage
- publish a normalized local runtime payload for small/medium dashboard datasets
- use backend query endpoints for large datasets
- optionally expose the original source file only when explicitly allowed by binding policy

---

## 7. Recommended Runtime Policy

### 7.1 Dataset exposure classes

Every bound dataset should declare one exposure class:

- `private_runtime_only`
- `published_runtime_only`
- `published_runtime_plus_source`
- `backend_only`

### 7.2 Recommended default mapping

- `CSV`, `JSON`, small tabular `XML`
  - default: `published_runtime_only`
- `XLSX`
  - default: `published_runtime_only`
  - source file optional
- `SQL dump`
  - default: `backend_only` or `published_runtime_only` only if normalization result is small and explicit
- large multi-table or industrial dumps
  - default: `backend_only`

### 7.3 Size-driven policy

Suggested publish heuristics:

- small dataset:
  - publish normalized local runtime
- medium dataset:
  - publish normalized runtime with row/sample caps
- large dataset:
  - publish manifest only, query backend

Suggested configuration points:

- `DATASET_PUBLISH_LOCAL_MAX_ROWS`
- `DATASET_PUBLISH_LOCAL_MAX_CELLS`
- `DATASET_PUBLISH_SOURCE_MAX_BYTES`
- `DATASET_PUBLISH_FORCE_BACKEND_THRESHOLD_BYTES`

---

## 8. Artifact Contract Extension

The current artifact model must remain backward-compatible:

- `artifacts.html`
- `artifacts.css`
- `artifacts.js`

For data dashboards, add optional metadata:

```ts
type ArtifactKind = "website" | "data_dashboard";

interface DatasetBinding {
  bindingId: string;
  assetId: string;
  originalName: string;
  sourceFormat: "csv" | "xlsx" | "json" | "xml" | "sql";
  tableName?: string;
  runtimeMode: "source_file" | "normalized_local" | "backend_query" | "hybrid";
  exposureClass: "private_runtime_only" | "published_runtime_only" | "published_runtime_plus_source" | "backend_only";
  publishedRuntimePath?: string;
  publishedSourcePath?: string;
  backendProfileUrl?: string;
  backendQueryUrl?: string;
  backendBrowseUrl?: string;
  backendInsightsUrl?: string;
  limitations: string[];
}

interface DataDashboardArtifactMetadata {
  artifactKind: "data_dashboard";
  datasetBindings: DatasetBinding[];
  dashboardDefinition?: Record<string, unknown>;
  querySpecs?: Record<string, unknown>[];
  chartSpecs?: Record<string, unknown>[];
}
```

This metadata must be optional and ignored safely by existing website consumers.

### 8.1 Manifest contract

The publish-time manifest should be explicitly versioned.

Suggested contract:

```ts
interface PublishedDatasetManifestV1 {
  version: "dataset-bindings-v1";
  publishId: string;
  projectId: string;
  generatedAt: string;
  artifactKind: "data_dashboard";
  bindings: DatasetBinding[];
  dashboardDefinition?: {
    title?: string;
    description?: string;
    defaultBindingId?: string;
    defaultTableName?: string;
    preferredInteractionMode?: "local_first" | "backend_first" | "hybrid";
  };
  querySpecs?: Array<{
    queryId: string;
    bindingId: string;
    tableName?: string;
    intent: "kpi" | "series" | "distribution" | "table" | "ranking";
    aggregation?: string;
    column?: string;
    groupBy?: string;
    filters?: Array<Record<string, unknown>>;
    limit?: number;
  }>;
  chartSpecs?: Array<{
    chartId: string;
    queryId: string;
    family: "line" | "bar" | "area" | "pie" | "table" | "metric";
    title: string;
    x?: string;
    y?: string;
    series?: string;
  }>;
  limitations: string[];
}
```

### 8.2 Binding invariants

Each `DatasetBinding` must obey these invariants:

- `bindingId` is stable within the published artifact version.
- `assetId` always points back to the source `ProjectAsset`.
- `runtimeMode` declares allowed execution modes, not just preferred modes.
- `publishedRuntimePath` must exist only when local runtime is actually written.
- `publishedSourcePath` must exist only when source exposure is explicitly allowed.
- backend URLs must be omitted when the published dashboard is intentionally static-only.

### 8.3 Artifact compatibility rule

The current `PreviewSnapshot.artifacts` triple remains valid and sufficient for:

- storage
- versioning
- export
- publish

The dataset binding metadata must remain an additive sidecar:

- stored alongside snapshot metadata
- ignored by existing consumers
- consumed only by data-dashboard aware publish/runtime logic

---

## 9. Publish Output Layout

### 9.1 Minimum publish output

All published dashboards keep:

- `index.html`
- `style.css`
- `script.js`

### 9.2 Additive data folder

When dataset bindings are active, publish may also write:

```text
/p/{publishId}/
  index.html
  style.css
  script.js
  data/
    manifest.json
    runtime-<bindingId>.json
    source-<bindingId>.<ext>   // optional
```

### 9.3 Manifest role

`data/manifest.json` should be the single browser entrypoint for dataset binding discovery.

It must describe:

- which bindings exist
- which runtime mode is active for each binding
- which files are locally available
- which backend endpoints are allowed
- which limitations apply

The page JavaScript should not guess these paths heuristically.

### 9.4 Publish-time materialization rules

Publish must materialize dataset assets only from deterministic backend state.

Allowed sources:

- normalized runtime cache generated by the backend
- original uploaded project asset
- deterministic profile envelope already persisted on the asset

Forbidden sources:

- fresh LLM reinterpretation at publish time
- browser-generated normalization artifacts
- silent transformation of already-published bindings

### 9.5 Publish-time resolution algorithm

For each dataset binding:

1. resolve the source `ProjectAsset`
2. load or build the normalized runtime from backend cache
3. evaluate exposure policy and thresholds
4. choose final publish mode:
   - local runtime
   - source file
   - backend only
   - hybrid
5. write local files when allowed
6. generate manifest entry
7. fail publish explicitly if the binding cannot be resolved safely

### 9.6 Republish rule

Republish must regenerate the binding package from current project state and current policy.

This means:

- modified datasets may change the published runtime payload
- changed exposure policies may suppress or expose files differently
- the manifest must always reflect the exact published binding state

No stale `data/` folder should survive a republish.

---

## 10. Frontend Runtime Model

### 10.1 Binding adapter

Generated `script.js` for data dashboards should use a stable adapter, for example:

```ts
loadDashboardManifest()
loadDatasetBinding(bindingId)
runDatasetQuery(bindingId, querySpec)
browseDatasetRows(bindingId, browseSpec)
getDatasetInsights(bindingId)
```

### 10.2 Policy

- Browser code must prefer the normalized runtime payload over reparsing the source file.
- Direct source-file parsing should be optional and narrow.
- Chart rendering must be driven by explicit `querySpecs` and `datasetBindings`, not by ad-hoc inference in generated JS.
- If a requested interaction exceeds local runtime limits, the script should switch to backend query mode only when allowed by manifest policy.

### 10.3 Runtime execution strategy

Recommended browser strategy:

1. load `data/manifest.json`
2. resolve the default binding
3. if local runtime is present:
   - hydrate local stores
   - render default KPI cards, charts, and row previews
4. if backend mode is allowed:
   - use backend routes for pagination, heavy grouping, or unsupported local operations
5. if neither local nor backend path is valid:
   - fail visibly with a grounding-safe UI state

### 10.4 JS responsibilities

The generated page JavaScript should be responsible for:

- manifest loading
- dataset binding selection
- local query execution when the manifest allows it
- backend fallback orchestration
- rendering tables, filters, KPIs, and chart data

The generated page JavaScript should not be responsible for:

- parsing arbitrary `XLSX` or `SQL` source files by default
- inventing field mappings not present in the manifest
- changing metric definitions silently

### 10.5 LLM generation rule

The LLM may design:

- layout
- information architecture
- filter and chart suggestions
- dashboard narrative

The LLM must not define hidden runtime assumptions outside structured metadata:

- no undocumented column aliases
- no implicit source-file parsing rules
- no opaque numerical transformations hardcoded only in free-form JS

---

## 11. Grounding Rules

### 11.1 Source of truth

Numerical truth is defined by:

- backend normalization logic
- backend deterministic query engine
- published normalized runtime payloads generated from that same backend logic

### 11.2 Forbidden behaviors

- browser-only reinterpretation that diverges from backend normalization
- hidden transformation of values after publish
- client-side invented metrics not defined by query specs
- exposing raw source files publicly by default without policy approval
- hidden simulation of missing bindings, missing data files, or missing backend query responses

### 11.3 Allowed behaviors

- client-side filtering/sorting on a published normalized runtime payload
- deterministic chart aggregation on published runtime payloads when query semantics are explicit
- backend fallback for pagination, heavy grouping, and large joins

---

## 12. Storage and Persistence Model

### 12.1 Original asset

The uploaded source dataset remains a normal `ProjectAsset` in project storage.

It remains:

- owner-scoped
- sandbox-protected
- downloadable through authenticated asset routes

### 12.2 Persisted normalized runtime

The normalized runtime remains a persisted cache in storage.

Current recommended evolution:

- keep the storage-backed normalized cache as the first implementation base
- do not force an immediate migration to Mongo row storage
- add publish-time materialization from the existing normalized cache

### 12.3 Future evolution

For large industrial datasets, a dedicated persistent dataset store/query engine may later replace or augment the cache model.

This future evolution must not block the current binding architecture.

### 12.4 Publish artifact persistence

Published binding files under `/p/{publishId}/data/` are publish artifacts, not canonical project storage.

They are:

- derived outputs
- regenerable on republish
- disposable on unpublish

They must never become the sole source of truth for project data.

---

## 13. Security and Exposure Policy

### 13.1 Default principle

Publishing a dashboard does **not** automatically imply publishing the original dataset file.

### 13.2 Safe default

The safest default policy is:

- publish normalized runtime only when within configured limits
- keep original source asset private unless explicitly allowed

### 13.3 Sensitive data guardrails

The binding layer should support:

- publish denial when dataset exceeds exposure policy
- source-file suppression even when runtime is published
- row/sample truncation rules
- explicit manifest limitation notes

### 13.4 Public backend query access

If published dashboards use backend query mode, they cannot reuse owner-authenticated project endpoints directly.

The recommended model is:

- publish-scoped public query endpoints
- authorized by `publishId`
- constrained to the manifest-approved bindings and query surface

For example:

- `GET /p/{publishId}/data/manifest`
- `POST /p/{publishId}/data/:bindingId/query`
- `POST /p/{publishId}/data/:bindingId/browse`
- `GET /p/{publishId}/data/:bindingId/insights`

These routes must:

- never expose arbitrary project assets
- never accept unrestricted project or asset identifiers
- enforce binding-level limits from the published manifest
- support rate limiting and audit logging

### 13.5 Query surface restriction

Public backend query routes must accept only supported deterministic operations:

- `count`
- `sum`
- `avg`
- `min`
- `max`
- `distinct_count`
- `top_values`
- deterministic browse with filter/sort/pagination

No arbitrary code execution, SQL, or free-form expression evaluation is allowed.

### 13.6 No simulation rule

The published dataset binding system must never silently simulate real data behavior.

Forbidden examples:

- returning fake rows when a binding cannot be resolved
- rendering invented KPIs because the runtime payload is missing
- substituting demo JSON for a missing published dataset
- simulating backend query success when the publish-scoped endpoint does not exist
- publishing a manifest that claims local or backend availability that is not real

Required behavior:

- unresolved binding -> explicit unresolved state
- missing runtime payload -> explicit runtime unavailable state
- unsupported publish mode -> explicit publish failure
- unavailable backend route -> explicit query failure

Agent directive:

- agents must not add mocks, fake datasets, fallback demo manifests, or undocumented simulated runtime systems to make this feature appear complete
- prefer a visible error, blocked publish, or unsupported state over any hidden simulation

---

## 14. Recommended Visualization Policy

### 14.1 Small and medium datasets

Use:

- local normalized runtime payload
- client-side table browsing
- client-side filters
- client-side charts
- backend-free interactions whenever possible

### 14.2 Large datasets

Use:

- manifest + backend query mode
- server-side browse pagination
- server-side heavy aggregations
- lightweight client rendering only

### 14.3 Mixed mode

Use hybrid mode when:

- the page needs instant KPIs from a local summary payload
- but row browsing or advanced grouping must remain backend-driven

### 14.4 Runtime UI policy

Every published data dashboard should expose, when relevant:

- visible binding source label
- active table name
- active filters
- limitation notices
- grounded-query failure states

This keeps data interpretation inspectable for end users.

---

## 15. Sequential vs Parallel Delivery Plan

## 15.1 Serial backbone

The next implementation wave should proceed in this order:

1. define artifact metadata contracts:
   - `artifactKind`
   - `datasetBindings`
   - manifest structure
2. implement publish-time materialization for normalized runtime payloads
3. implement manifest-driven `script.js` binding adapter
4. add policy engine for source/runtime/backend exposure selection
5. wire publish output writing
6. expose backend fallback URLs in manifest for eligible bindings
7. add public publish-scoped query routes
8. integrate generated `script.js` with manifest-first binding

Reason:

- the binding contract must exist before frontend runtime and publish logic can converge safely

### 15.2 Parallel tracks

The following can run in parallel once the contract is frozen:

- power-user UI controls for forcing binding mode
- admin governance controls for thresholds
- dataset sensitivity/exposure warnings
- observability and audit logs
- expert `/dashboard/data/[projectId]` integration with published-binding preview

### 15.3 Recommendation

Proceed with a **serial backbone plus parallel satellites**.

Not fully parallel:

- too much risk of contract drift across publish, frontend runtime, and dataset policy

Not fully serial:

- governance, observability, and power-user UI do not need to block the core binding engine

### 15.4 Suggested work packages

Suggested implementation work packages:

- `WP1 contracts`
  - shared manifest DTOs
  - dataset binding DTOs
  - snapshot metadata extension
- `WP2 backend publish materializer`
  - local runtime writer
  - source-file writer
  - policy resolver
- `WP3 public data runtime routes`
  - manifest route
  - query route
  - browse route
  - insights route
- `WP4 frontend runtime adapter`
  - manifest loader
  - local query adapter
  - backend query adapter
- `WP5 observability and governance`
  - logs
  - thresholds
  - exposure warnings

---

## 16. Acceptance Criteria

The wave is complete only when all of the following are true:

- A generated `data-dashboard` artifact can declare one or more `datasetBindings`.
- Publish can materialize a local normalized dataset runtime when policy allows it.
- Publish can suppress the original source file when policy forbids public exposure.
- Browser `script.js` can load a manifest and bind to real project data without reparsing arbitrary files by default.
- Large datasets can remain backend-driven without breaking the artifact contract.
- Public backend routes, when used, are binding-scoped and deterministic only.
- Existing website publish behavior remains unchanged when no dataset bindings exist.
- Existing additive dataset routes remain valid and useful.

---

## 17. Testing Requirements

### 17.1 Small dataset

- publish dashboard with small `CSV` or `JSON`
- verify:
  - `data/manifest.json` exists
  - `data/runtime-<bindingId>.json` exists
  - dashboard loads and filters locally

### 17.2 Source suppression

- publish dashboard with policy `published_runtime_only`
- verify:
  - no public source file is written
  - runtime payload still works

### 17.3 Source enabled

- publish dashboard with policy `published_runtime_plus_source`
- verify:
  - both normalized runtime and source file exist
  - manifest references both explicitly

### 17.4 Large dataset fallback

- publish dashboard with large dataset
- verify:
  - manifest exists
  - no large local runtime payload is written beyond threshold
  - dashboard uses backend browse/query routes

### 17.5 Regression

- publish normal website project without dataset bindings
- verify:
  - no data folder is written
  - website behavior remains unchanged

### 17.6 Public backend mode

- publish dashboard with backend-only binding
- verify:
  - manifest exposes only allowed public routes
  - public query route rejects unsupported operations
  - dashboard can browse/query within deterministic limits

### 17.7 Republish cleanup

- publish dashboard with one binding mode
- change policy or dataset size
- republish
- verify:
  - old `data/` files not valid for the new publish state
  - new manifest reflects the new binding mode exactly

---

## 18. Migration Plan

### 18.1 From current state

Current state already has:

- original project assets
- normalized runtime cache
- server-side deterministic dataset routes

Therefore the migration path should be incremental:

1. keep current dataset routes unchanged
2. add publish-side binding metadata
3. add manifest generation
4. add optional local runtime write
5. add public publish-scoped backend routes
6. migrate generated dashboards to the manifest-driven runtime adapter

### 18.2 Backward compatibility

No current project should be migrated destructively.

Rules:

- projects without `artifactKind = data_dashboard` remain unchanged
- snapshots without dataset metadata remain publishable as normal websites
- additive `/dashboard/data/[projectId]` remains the operational expert console

### 18.3 Future extensibility

The spec should remain compatible with future evolutions:

- real persistent dataset store
- multi-dataset joins
- project-level semantic metrics
- reusable dashboard widgets
- multi-page analytical applications

---

## 19. Governance Controls

Recommended superadmin controls:

- enable/disable published dataset bindings
- local runtime max row threshold
- local runtime max cell threshold
- max published source bytes
- default exposure class by format
- backend-only enforced formats
- publish-time deny-on-sensitive policy
- allowed public query operations

Recommended project-owner controls for power users:

- force `normalized_local`
- force `backend_query`
- allow source publish
- choose primary table
- choose strict row/sample cap

---

## 20. Failure Modes and Degradation Rules

If binding resolution fails:

- do not silently publish a broken dashboard
- fail publish with actionable diagnostics when binding is mandatory

If local runtime exceeds threshold:

- degrade to backend mode when allowed
- otherwise fail publish explicitly

If backend public query mode is disabled but required:

- fail publish explicitly

If the original asset disappears or is invalid:

- mark the binding unresolved
- block publish until the dataset is repaired or replaced

If a real runtime path is not implemented yet:

- do not fake it
- do not publish a manifest that claims it exists
- expose the limitation in diagnostics and in the implementation status sections

---

## 21. Final Recommendation

The correct next-wave decision is:

- **Hybrid mode is the canonical architecture**

Implementation recommendation:

- preserve the original dataset asset in project storage
- publish a normalized local runtime payload by default for small and medium dashboard datasets
- expose the original source file only by explicit policy
- fall back to backend query mode for large, sensitive, or operationally heavy datasets

This gives the platform:

- native dataset fidelity
- deterministic dashboard grounding
- browser-friendly runtime behavior
- scalability for industrial workloads
- no regression on the current artifact model
