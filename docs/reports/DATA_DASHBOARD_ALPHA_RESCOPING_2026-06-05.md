# Data Dashboard Alpha Rescoping — 2026-06-05

**Type:** architectural correction report  
**Status:** applied in code  
**Scope:** UI detachment, prompting detachment, experimental admin-only routing, runtime reuse assessment

---

## 1. Decision

The grounded dataset dashboard capability is no longer treated as part of the primary native Vibe / Zero Effort UX.

It is now classified as:

- **alpha**
- **explicit**
- **superadmin-only for UI access**
- **not auto-triggered from the standard entry flow**

This is a product-scoping correction, not a removal of backend capability.

---

## 2. What Was Detached

The following integrations were intentionally removed or downgraded:

- Data-dashboard option from the main `VibeCore` output-mode selector
- automatic VibeCore redirect into the dashboard-data route
- project-card shortcut from the user dashboard to the data dashboard
- implicit Layer X grounded dataset injection for normal website flows with generic selected attachments
- active preset visibility of `data-dashboard` in the default preset catalog

The following route is no longer a promoted user entrypoint:

- `/dashboard/data/[projectId]`

The capability is now exposed explicitly under:

- `/admin/experimental/data-dashboard`
- `/admin/experimental/data-dashboard/[projectId]`

The legacy route remains only as compatibility redirect/guard behavior.

---

## 3. Why This Was Necessary

The previous integration was too eager in three ways:

1. It polluted the main UX with a still-immature analytical mode.
2. It risked rerouting standard website intent toward a dashboard specialization.
3. It blurred the boundary between generic attachment enrichment and a specialized deterministic dataset runtime.

The platform is better served by:

- keeping the grounded dataset runtime alive
- keeping its APIs alive
- keeping the experimental console alive
- stopping it from steering the main generative user journey

---

## 4. Relation To Layer D

### 4.1 Short answer

Today the grounded dataset runtime and Layer D are **adjacent but mostly separate**.

### 4.2 What Layer D already does

Layer D is the generic attachment/document context layer.

Its current role is mainly:

- parse documents
- extract text snippets
- reuse enrichment traces
- inject narrative/contextual project knowledge into prompting

This is broad attachment interpretation.

### 4.3 What the dataset runtime does

The dataset runtime is a deterministic structured-data subsystem.

Its current role is mainly:

- normalize `CSV`, `XLSX`, `JSON`, tabular `XML`, supported `SQL` inserts
- infer schema
- compute facts
- execute deterministic query/browse flows
- generate grounded insights and dashboard suggestions

This is analytical structured-data processing.

### 4.4 Current reuse value for Layer D

The dataset runtime **does provide reusable value**, but not yet as a direct generic Layer D replacement.

Useful reusable pieces:

- structured-file detection
- deterministic schema understanding
- field/type/profile extraction
- safe summaries of structured attachments
- ability to distinguish numeric/tabular assets from narrative documents

Not yet generally reused in the standard Layer D pipeline:

- deterministic dataset profile summaries as first-class Layer D blocks for every structured attachment
- dataset-aware attachment ranking in ordinary website prompting
- generic structured-attachment abstraction shared across all prompt contexts

So the honest answer is:

- **yes, there is real reusable backend value**
- **no, the current data-dashboard path is not yet the right user-facing vehicle for that value**

---

## 5. Architectural Guidance Going Forward

Recommended near-term direction:

1. Keep dataset runtime APIs and cache model alive.
2. Keep the admin experimental console alive.
3. Do not reconnect the dashboard flow to primary UX yet.
4. Reuse the runtime selectively to improve structured-attachment interpretation inside Layer D.

The next valuable bridge is **not** “restore dashboard mode in VibeCore”.

The next valuable bridge is:

- extract a compact deterministic structured-attachment envelope
- inject it into the generic prompting pipeline only when useful
- keep dashboard generation as a separate experimental consumer

---

## 6. Applied Code-Level Outcome

Implemented in code on **2026-06-05**:

- main dashboard no longer links project cards to the data-dashboard console
- VibeCore no longer exposes data-dashboard in its main mode selector
- VibeCore no longer routes regular users into the dashboard-data flow
- classifier no longer auto-promotes default flows into `data_dashboard`
- Layer X is no longer injected for ordinary website flows just because attachments are selected
- `data-dashboard` preset is hidden from the main preset catalog via inactive status
- admin now has an explicit experimental entry surface

---

## 7. Product Position After Rescoping

The grounded dataset subsystem should now be understood as:

- **implemented backend capability**
- **experimental admin-facing exploration tool**
- **candidate source of future Layer D improvements**
- **not approved yet as a mainstream user-facing generation mode**
