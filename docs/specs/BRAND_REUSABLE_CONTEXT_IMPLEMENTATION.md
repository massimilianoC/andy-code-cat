# Brand Reusable Context — Analytic Implementation Plan (Wave-Based)

> Status: in implementation
> Branch: `feat/brand-reusable-context` (from `develop`)
> Date: 2026-06-30
> Author: coding agent (Opus)
> Related specs: [GLOBAL_BRAND_IDENTITY_SPEC.md](GLOBAL_BRAND_IDENTITY_SPEC.md) · [DOCUMENT_CONTEXT_LAYER_SPEC.md](DOCUMENT_CONTEXT_LAYER_SPEC.md)

---

## 0. Why this exists

The platform already has two prompt-context systems that overlap with the user's
"brand-as-development-context" vision, but neither alone covers it:

| System | Layer | Scope | What it carries | Reusable across projects? |
|---|---|---|---|---|
| **Brand Identity** | G | platform → user → project | Structured atoms: logo (`asset_ref` → download URL injected as `<img src>`), color palette, company name, tagline, contacts, social | ✅ user-scope atoms auto-inject into every project |
| **Document Context** | D | **project only** | Rich documents (PDF/DOCX/images) parsed once into `AssetEnrichmentTrace` with a deterministic, cached `renderedFragment` | ❌ bound to a single `ProjectAsset` |

**The gap:** a user cannot define a reusable *brand book* (PDF guidelines, tone-of-voice
doc, brand manual) that is analysed **once** and then injected as development context into
**every** new project — the way Layer G atoms already are. Today that PDF must be
re-uploaded and re-analysed per project.

**The fix (this plan):** make a brand asset able to be a *document*, run the existing
`AssetEnrichmentPipeline` **exactly once** at the moment it enters brand scope, persist the
resulting `renderedFragment` on the `BrandAsset`, and inject those cached fragments into
**Layer D of every project** the user generates. No re-extraction, no re-upload, no new
parsing pipeline.

### Design pillars

1. **Reuse-first.** No new enrichment pipeline, no new parser, no new storage backend, no
   new Docker service. We reuse `AssetEnrichmentPipeline.enrich()`, the cached
   `AssetEnrichmentTrace.renderedFragment`, `buildProjectKnowledgeLayer()` rendering, the
   `BrandAsset` hierarchy, and `getFileStorage()`.
2. **Extract once.** The LLM document analysis runs a single time (on promote: zero times —
   the source `ProjectAsset` is already enriched; on direct upload: once). The fragment is
   cached on the `BrandAsset` and reused for every project forever.
3. **Additive & retrocompatible.** When no brand documents exist, Layer D is byte-identical
   to today. All new entity fields are optional. No existing call site changes behaviour.
4. **Governed.** Same `must_use` / `prefer` / `optional` policy and platform → user →
   project hierarchy as Layer G atoms.

---

## 1. Reusability audit — what we reuse unchanged

| Existing piece | File | Reused how |
|---|---|---|
| Enrichment pipeline | `apps/api/src/application/documents/enrichment/AssetEnrichmentPipeline.ts` | `enrich({ asset, fileBuffer, ... })` run once for a direct-uploaded brand document |
| Pre-rendered fragment cache | `AssetEnrichmentTrace.renderedFragment` ([entity](../../apps/api/src/domain/entities/AssetEnrichmentTrace.ts)) | Stored on `BrandAsset`; injected verbatim — no recompute |
| Fragment renderer (fallback) | `renderAssetLayerDFragment()` in `systemPromptLayers.ts` | Fallback render if a legacy brand doc lacks the cached fragment |
| Layer D builder | `buildProjectKnowledgeLayer()` | Reference for rendering style; brand-doc block reuses its header conventions |
| Brand hierarchy & resolution | `ResolveBrandContext` / `MongoBrandAssetRepository.resolveForContext()` | Brand docs resolve through the same platform/user/project query |
| Brand routes | `adminRoutes.ts`, `userProfileRoutes.ts`, `projectAssetRoutes.ts` | Brand-doc upload/promote endpoints appended to existing brand routers |
| File storage | `getFileStorage()` / `StorageFactory` | Brand-doc files stored exactly like Layer G `asset_ref` files |
| Promote path | `SetBrandAsset` (sourceAssetId) | Copies `enrichmentTrace` from an already-enriched `ProjectAsset` — **zero re-extraction** |

**Net-new files (minimal):**

```
apps/api/src/application/use-cases/ResolveBrandDocumentContext.ts   (collect cached fragments)
apps/api/src/application/use-cases/EnrichBrandDocument.ts           (one-time direct-upload extraction adapter)
```

Everything else is additive edits to existing files.

---

## 2. Data model change

### `BrandAsset` entity — additive fields

Add to `apps/api/src/domain/entities/BrandAsset.ts`:

- New role: `"brand_document"` (added to `BrandAssetRole` union and `BRAND_ASSET_ROLES`).
- New value type: `"document_ref"` (added to `BrandAssetValueType`). Behaves like
  `asset_ref` for file storage but signals "carries an enrichment fragment".
- New optional fields:
  ```typescript
  /** Pre-rendered Layer D fragment, computed ONCE at upload/promote. Injected verbatim. */
  documentFragment?: string;
  /** Full enrichment trace (optional, for re-render/debug). */
  enrichmentTrace?: AssetEnrichmentTrace | null;
  /** Enrichment lifecycle for UI feedback. */
  enrichmentStatus?: "pending" | "ready" | "failed" | "skipped";
  ```

These are additive and default-absent → existing records and queries are unaffected.

### Mongo repository

`MongoBrandAssetRepository` maps the new fields through `toEntity()`. No index change
required (`document_ref` resolves through the same `resolveForContext` `$or` query). The
existing `{ scope, isActive }` indexes already cover the resolution path.

---

## 3. Resolution & injection design

```
Brand document upload/promote
        │  (enrichment runs ONCE here)
        ▼
BrandAsset.documentFragment  ◄── cached forever
        │
        │  every generation call, every project
        ▼
ResolveBrandDocumentContext({ userId, projectId })
        │   → platform + user + project brand docs (policy-ordered)
        ▼
buildBrandDocumentLayerD(fragments)   → "## LAYER D — BRAND REFERENCE MATERIALS" block
        │
        ▼
merged into documentContextLayer  ──►  composeSystemPrompt (Layer D slot)
```

**Merge strategy:** brand-document fragments are **prepended** to the project's own Layer D
content (brand book is higher-priority context than ad-hoc project attachments), under a
distinct sub-header so the LLM can tell durable brand guidelines from one-off project
materials. Combined Layer D respects the existing `ENRICHMENT_LAYER_D_MAX_CHARS` budget —
brand docs get first claim on the budget, project docs fill the remainder.

**Error isolation:** resolution is wrapped in `.catch(() => [])` exactly like
`ResolveBrandContext`, so a brand-doc failure never blocks generation.

---

## 4. Wave breakdown

Waves are ordered so the build stays green at every step. Lanes inside a wave marked
**∥** are independent and implemented in parallel.

### Wave 0 — Roadmap & docs alignment  *(no code risk; can run fully in parallel)*

| Lane | File | Change |
|---|---|---|
| 0a ∥ | `docs/project/ROADMAP.md` | Add **Brand Identity (Layer G)** as ✅ delivered (release 2026.06.10.1, PR #26); add this reusable-context track as 🟡 in progress; note Didactic Mode as live |
| 0b ∥ | `docs/DEVELOPMENT_PLAN.md` | Register Brand + Didactic under delivered foundations / active tracks |
| 0c ∥ | `docs/specs/GLOBAL_BRAND_IDENTITY_SPEC.md` | Flip header `Status: planned` → `delivered`; add pointer to this plan for the reusable-document extension |
| 0d ∥ | `docs/INDEX.md` | Link this implementation doc |

**Acceptance:** roadmap docs no longer describe Brand/Didactic as unbuilt; INDEX links this file.

### Wave 1 — Backend data model + contracts  *(foundation, mostly sequential within, ∥ with Wave 0)*

| Step | File | Change | Build? |
|---|---|---|---|
| 1a | `apps/api/src/domain/entities/BrandAsset.ts` | Add `brand_document` role, `document_ref` valueType, `documentFragment`, `enrichmentTrace`, `enrichmentStatus` | ✅ types |
| 1b | `packages/contracts/src/brandAssets.ts` + `index.ts` | Mirror new role/valueType in enums + DTO (`documentFragment?`, `enrichmentStatus?`) | ✅ |
| 1c | `apps/api/src/infra/repositories/MongoBrandAssetRepository.ts` | Map new fields in `toEntity()` and persistence | ✅ |

**Acceptance:** `tsc --noEmit` clean on api + contracts; existing brand records round-trip unchanged.

### Wave 2 — One-time enrichment + resolution use cases

| Step | File | Change | Build? |
|---|---|---|---|
| 2a | `apps/api/src/application/use-cases/EnrichBrandDocument.ts` *(new)* | Adapter: wrap a brand-doc file into a synthetic `ProjectAsset` shape, run `AssetEnrichmentPipeline.enrich()` **once**, return `{ documentFragment, enrichmentTrace, status }`. Promote path short-circuits: copy `enrichmentTrace` from the already-enriched source `ProjectAsset` → **zero LLM cost** | ✅ |
| 2b | `apps/api/src/application/use-cases/SetBrandAsset.ts` | When role=`brand_document`: on direct upload call `EnrichBrandDocument`; on promote copy `enrichmentTrace`/`documentFragment` from source asset; persist fragment | ✅ |
| 2c | `apps/api/src/application/use-cases/ResolveBrandDocumentContext.ts` *(new)* | `resolveForContext` → filter `document_ref` with a ready fragment → return policy/scope-ordered fragments | ✅ |
| 2d | `apps/api/src/application/llm/systemPromptLayers.ts` | Append `buildBrandDocumentLayerD(fragments, { maxChars })` — header `## LAYER D — BRAND REFERENCE MATERIALS`, reuses fragment text verbatim, budget-aware | ✅ all existing tests pass |

**Acceptance:** unit test — given a brand doc with a cached fragment, `ResolveBrandDocumentContext` returns it; `buildBrandDocumentLayerD([])` returns `""`.

### Wave 3 — Pipeline wiring (Layer D merge)

| Step | File | Change | Build? |
|---|---|---|---|
| 3a | `apps/api/src/presentation/http/routes/llmRoutes.ts` | Construct `ResolveBrandDocumentContext`; in both generation + preview handlers resolve brand-doc fragments and **prepend** to `documentContextLayer` via `buildBrandDocumentLayerD`, sharing the Layer D char budget | ✅ e2e |
| 3b | `llmRoutes.ts` prompt-preview | Include merged Layer D (brand docs visible) in `layerD` of the preview response | ✅ |

**Acceptance:** TESTABLE_STEPS step — user with a user-scope brand document opens any new project → prompt-preview `layerD` contains the brand-reference block; project with no docs of its own still shows the brand block.

### Wave 4 — HTTP routes for brand documents  *(3 lanes ∥)*

| Lane | File | Routes |
|---|---|---|
| 4a ∥ | `adminRoutes.ts` | `POST /admin/brand-assets/document` (upload), reuse existing `/promote` with role=`brand_document` |
| 4b ∥ | `userProfileRoutes.ts` | `POST /users/me/brand-assets/document` (upload) + promote |
| 4c ∥ | `projectAssetRoutes.ts` | `POST /projects/:id/brand-assets/document` + promote (source must belong to same project) |

All inherit existing auth/sandbox guards. Upload reuses the same multer config and storage
path convention as Layer G `asset_ref`.

**Acceptance:** upload a PDF as a user brand document → 201 with `enrichmentStatus`; fragment populated after enrichment completes.

### Wave 5 — Frontend: complete the Brand UI  *(lanes ∥)*

| Lane | File | Change |
|---|---|---|
| 5a ∥ | `apps/web/lib/api/brand.ts` | Client methods for brand-document upload + status across scopes |
| 5b ∥ | `apps/web/components/brand/BrandAssetsManager.tsx` | "Documents" section: upload PDF/DOCX, show `enrichmentStatus` badge (analyzing/ready/failed), promote-from-project-asset action |
| 5c ∥ | `apps/web/components/brand/BrandPromptPreview.tsx` *(new)* | Read-only render of the resolved Layer G + brand-doc Layer D so the user sees what the LLM receives |
| 5d ∥ | `apps/web/i18n/{it,en}.json` | Copy for brand documents, statuses, must_use verification |

**Acceptance:** from the brand manager a user uploads a brand book, sees it become "ready",
and sees it appear in the prompt preview; generating a project visibly uses it.

### Wave 6 — `must_use` verification + tests + docs

| Step | File | Change |
|---|---|---|
| 6a | `apps/api/.../__tests__/brandDocument.layerD.test.ts` *(new)* | Resolution + builder + budget + empty-context retrocompat |
| 6b | `docs/runbooks/TESTABLE_STEPS.md` | Steps 11s–11v: brand-document one-time extraction, cross-project reuse, budget, empty→no block |
| 6c | `apps/web/.../DidacticPanel`-style optional post-gen check (stretch) | Surface whether a `must_use` logo/colour actually appears in generated HTML |

---

## 5. Retrocompatibility invariants (verify after every wave)

1. No brand documents → `ResolveBrandDocumentContext` returns `[]`, `buildBrandDocumentLayerD([])` returns `""`, Layer D byte-identical to today.
2. All new `BrandAsset` fields optional → existing records load unchanged; existing `composeSystemPrompt` callers unaffected.
3. Promote path performs **zero** new LLM calls (reuses source `ProjectAsset.enrichmentTrace`).
4. Combined Layer D never exceeds `ENRICHMENT_LAYER_D_MAX_CHARS`.
5. Existing Layer G atom behaviour (logo/colour/contacts) is untouched.

---

## 6. Cost & "extract once" guarantee

- **Promote:** 0 LLM calls. The source project asset was already enriched at its own upload.
- **Direct brand-document upload:** exactly 1 enrichment run, attributed via the existing
  `recordEnrichmentCost` ledger path, then cached on `BrandAsset.documentFragment`.
- **Every subsequent project generation:** 0 additional enrichment calls — the cached
  fragment is injected verbatim. This is the core efficiency the user asked for.

---

## 7. Implementation order summary

```
Wave 0 (docs)  ──┐  (parallel with everything)
Wave 1 (model) ──┼─► Wave 2 (use cases) ─► Wave 3 (wiring) ─► Wave 4 (routes) ─► Wave 5 (UI) ─► Wave 6 (tests/docs)
```

Progress is tracked in this file (append a `## Progress` section per wave on completion,
mirroring `DIDACTIC_MODE_PROGRESS.md` convention).
