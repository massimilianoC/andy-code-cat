# Testable Steps

> This runbook now mixes three layers:
> 1. established platform baseline checks,
> 2. current active validation tracks,
> 3. older deferred milestone sections kept as backlog references.
>
> Do not assume every section below is the current delivery priority.
> For active milestone focus, use [`docs/DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md)
> and [`docs/project/ROADMAP.md`](../project/ROADMAP.md).

---

## BASELINE - Layer 1 already working (✅)

### Step 1 - Health

- `GET /health`
- Expected: `200 { status: "ok", service: "api" }`

### Step 2 - Register

- `POST /v1/auth/register` — body: email, password, firstName, lastName
- Expected: `201 { user, defaultProject }`

### Step 3 - Login

- `POST /v1/auth/login` — body: email, password
- Expected: `200 { accessToken, refreshToken, projects, activeProjectId, requiresPasswordChange, emailVerificationRequired }`

### Step 3a - Refresh Rotation

- `POST /v1/auth/refresh` — body: `{ "refreshToken": "..." }`
- Expected: `200 { accessToken, refreshToken, activeProjectId }`
- Verify: the returned `refreshToken` differs from the submitted one.
- Verify: replaying the old refresh token now returns `401`.

### Step 3b - Legacy Password Upgrade

- Precondition: use a legacy account without `passwordPolicyVersion` or with an older version.
- `POST /v1/auth/login`
- Expected: `requiresPasswordChange === true` while login still succeeds.
- `POST /v1/auth/change-password` with bearer token and body `{ currentPassword, newPassword }`
- Expected: `200 { reauthRequired: true, requiresPasswordChange: false }`
- Verify: a new login with the updated password returns `requiresPasswordChange === false`.

### Step 4 - List Projects

- `GET /v1/projects` — headers: `Authorization: Bearer TOKEN`
- Expected: list of projects owned by the authenticated user

### Step 5 - Create Project

- `POST /v1/projects` — body: `{ "name": "Test Project" }`
- Expected: `201 { project }`

### Step 6 - Sandbox Check

- `POST /v1/projects/:projectId/sessions` — headers: `x-project-id: PROJECT_ID`
- Expected: `201` if the user is the owner, `403` otherwise

### Step 7 - Seed

- `npm run seed`
- Expected: user `owner@andy-code-cat.local` and default project created (idempotent)

### Step 8 - LLM Catalog

- `GET /v1/llm/providers`
- Expected: `200 { source: "env", providers: [...] }`

### Step 9 - LLM Catalog Mongo Seed (optional)

- Precondition: `LLM_CATALOG_SOURCE=mongo`
- `npm run seed:llm`
- Expected: idempotent upsert in the `llm_providers` collection. It adds missing code defaults but
  preserves the operator's provider/model activation, model name, role, prompt fields and manually
  added or live-discovered models.

### Step 9a - Superadmin Model Activation

- Precondition: login with a user that has role `superadmin`
- Open `/admin/models`, choose a provider and set one model to `ON`.
- Expected: the button becomes primary blue, the UI reports `1 model set ON`, and a reload keeps it
  `ON`.
- Run `Sync seed → Mongo`, reload the page, and verify that the same model remains `ON` (and an
  `OFF` model remains `OFF`).

### Step 10 - Chat Preview

- `POST /v1/projects/:id/llm/chat-preview`
- body: `{ message: "Create a landing page for an SEO agency" }`
- Expected: `200 { reply, structured: { chat, artifacts } }`
- If the LLM response contains `asset://media/<key>` placeholders, it must also contain `structured.mediaManifest.requests[]`
- Expected: resolved preview artifacts contain internal `/p/media/:assetId` URLs, not provider URLs or unresolved `asset://media/*` placeholders

### Step 11 - Chat Preview Streaming

- `POST /v1/projects/:id/llm/chat-preview/stream`
- Expected: SSE events `thinking` → `answer` → `done`
- Verify: `done.result.structured.artifacts` contains `html/css/js`
- Verify: media placeholders from `done.result.structured.mediaManifest` are resolved before the final `done` payload is saved/applied

### Step 11a - Superadmin Governance Config

- Precondition: login with a user that has role `superadmin`
- Open `/admin/governance`
- Expected: product scope selector, prompt template editors, injection editors, nginx parameters are visible
- Save for `productKey = default`
- Expected: success state in UI and persisted values returned by `GET /v1/admin/config`

### Step 11b - Declarative Form Runtime (mailto)

- Configure `PUT /v1/projects/:projectId/services/forms` with bearer token and matching
  `x-project-id`; use `mode: "mailto"`, a recipient, and an HTTPS privacy notice.
- Generate or save an artifact with a `service-manifest-v1` and a matching
  `data-pf-form-id` slot.
- Expected: preview/capture load distinct platform script elements before generated JS; publish
  and ZIP contain `pf-runtime-core.v1.js`, `pf-runtime-config.v1.js`, `pf-forms-ui.v1.js`, and
  `pf-forms-mailto.v1.js` plus a matching `runtime-plan-v1` in API responses.
- Expected: submission requests an email draft and asks the visitor to verify the email app; no
  form data is sent to or persisted by the API, and `pf:mailto` contains no values or complete URI.
- Save invalid generated JS with `activate: false`: preview form runtime still mounts. Activation,
  publish and ZIP must return `422` mentioning invalid `artifacts.js`.
- Change the recipient after snapshot creation, then fetch the same snapshot again.
- Expected: the preview runtime contains the new recipient and not the previous recipient, proving
  that canonical snapshots do not persist compiled tenant configuration.
- Reopen a legacy snapshot whose `artifacts.js` ends with the historical `form-runtime-v1`
  mailto IIFE. Expected: delivery removes that exact suffix and emits the separate v1 runtime
  files; a similar incomplete or non-terminal project script is left untouched.
- For a multi-step manifest, verify required fields block Continue/Submit and Back/Continue update
  the announced step count.
- Verify: a different user or a mismatched project header receives a sandbox denial.
- Automated isolated gate:
  `npx playwright test tests/e2e/form-runtime.spec.ts --project=chromium` with
  `E2E_API_URL` and `E2E_BASE_URL` pointing at the isolated stack documented in
  `docs/specs/FORM_RUNTIME_MAILTO_FOUNDATION.md`.

### Step 11b - Backward Compatibility of Platform Config

- Call `PATCH /v1/admin/config` with payload containing only legacy fields:
  - `registrationOpen`
  - `emailVerificationRequired`
  - `defaultUserLimits`
- Expected: 200 OK and no regression in existing config reads/writes
- Verify: `governanceByProduct` remains optional and does not break old clients

### Step 11c - Superadmin User Sidebar Operations

- Precondition: login with a user that has role `superadmin`
- Open `/admin/users`
- Click a row in the users table
- Expected: a right sidebar opens with status, profile, roles, limits, password controls, and project summary
- Change first name / last name / email and confirm save
- Expected: updated values are persisted and reloaded in the sidebar and list
- Trigger `Force reset next login`
- Expected: user detail reports `requiresPasswordChange = true`
- Reset password with a temporary password and keep `Force change on next login` enabled
- Expected: reset succeeds and existing sessions for that user are invalidated
- Block the user
- Expected: user becomes blocked and public published sites owned by the user return HTTP 403

### Step 11d - Preset Registry and Start UX

- Precondition: login with a user that has role `superadmin`
- Open `/admin/presets`
- Click `Sync presets → Mongo`
- Expected: the preset seed is persisted and editable from the superadmin UI
- Alternative CLI reseed: `npm run seed:presets`
- Docker/Droplet reseed procedure: [`docs/runbooks/PRESET_RESEED.md`](PRESET_RESEED.md)
- Expected after current seed: `freerunner` and `data-dashboard` are present in admin but hidden from the standard dashboard picker (`isActive=false`)
- Expected after current seed: preset default feature tags use the valid `feat:*` prefix
- Change category, short hint, sort order, or recommended model for one preset and save
- Expected: the preset remains visible in the registry with the updated metadata
- Open `/dashboard`
- Expected: presets are grouped by category, `Blank` remains available, and recommended-model badges are shown when configured
- Create a project from a preset that has a recommended model
- Expected: the workspace defaults to that provider/model when available in the runtime catalog

### Step 11e - Template Preprompting Governance

- Precondition: login with a user that has role `superadmin`
- Open `/admin/governance`
- Verify the optimized preprompting section is visible and editable
- Expected: the superadmin can tune the pre-generation rewriting layer used by the active project-type template model

### Step 11e-bis - Advanced LLM Runtime Catalog (optional)

- Open `/admin/models` only if runtime-provider maintenance is needed
- Expected: this area is clearly secondary and does not replace the template-model governance flow

### Step 11f - AI-assisted Template Authoring

- Precondition: login with a user that has role `superadmin`
- Open `/admin/presets`
- In the `AI Template Workbench`, write a short instruction for a new template family (for example VR, 3D game, or poster format)
- Click `Generate AI draft`
- Expected: the current template form is enriched with AI-generated brief, style direction, tags, and preprompt module suggestions

### Step 11g - Current UX/E2E Validation Boundary

The current preset-governance wave is considered validated when:

- Step 11d passes
- Step 11e passes
- the dashboard start flow remains smooth for blank and categorized template models
- the workspace still opens correctly after project creation and recommended runtime auto-selection

The following are **not blockers** for the current UX/E2E cycle:

- drag-and-drop preset reordering
- user-private presets or `pending_review` submission flows

These two items are additive roadmap improvements and can be delivered after the current browser validation cycle.

---

## CURRENT ACTIVE VALIDATION TRACKS

### Step 11qa - R2/R3 Verification Gate

This gate validates the current platform before widening runtime scope with BaaS or other
large-surface features.

- Open `/dashboard`
- Expected: VibeCore entry renders and existing project cards still render
- Create a project from VibeCore with a prompt that implies a concrete artifact family, for example:
  - `crea un mini gioco interattivo per presentare un portfolio`
  - `crea una landing con immagine hero e sezione servizi`
  - `crea una presentazione interattiva per un evento`
- Attach at least one eligible asset where possible
- Expected: upload succeeds and the asset shows `enrichmentTrace` status (`pending`, `ready`, or `failed`) in project asset UI/API
- Expected: VibeCore classification/prefill stays in the authenticated project sandbox
- Complete handoff into `/launch/:projectId` or `/workspace/:projectId`
- Expected: the same `projectId` remains editable in Workspace
- Generate or auto-send the first artifact
- Expected: a snapshot is created and can be selected from snapshot history
- Expected: if media placeholders are emitted, they are resolved or explicitly marked degraded
- `GET /v1/projects/:projectId/llm/prompt-preview`
- Expected: active layers include preset context, Layer S template skills when the current preset has a `by-template/<presetId>/` folder, and style/brand/document context when applicable
- Export the active snapshot
- Expected: ZIP export succeeds when no unresolved `asset://media/*` placeholders remain
- Publish the active snapshot
- Expected: path-based publish succeeds and returns a public URL
- Create or simulate a snapshot with unresolved `asset://media/test-key`
- Expected: export and publish are blocked, no public files are overwritten, and user/admin notifications are emitted
- Review execution/cost surfaces
- Expected: generation, media, export, and publish outcomes are traceable through execution logs, cost summaries, or notifications without reading raw container logs

Passing this gate means R2/R3 are sufficiently stable to begin the Layer S implementation track.

### Step 11qb - Template Skills Filesystem Seed

This gate verifies the filesystem-backed Layer S resolver.

- Open `docs/specs/TEMPLATE_SKILLS_INJECTION_PLAN.md`
- Expected: filesystem-first strategy is documented
- Open `docs/specs/TEMPLATE_SKILLS_LAYER_S_POLICY.md`
- Expected: ownership, forbidden content, validation workflow, impact rubric, and rollback are documented
- Open `docs/specs/TEMPLATE_SKILLS_LAYER_S_IMPLEMENTATION.md`
- Expected: resolver, env contract, trace persistence, Docker packaging, and validation are documented
- Open `docs/research/template-skills/AGENT_SKILLS_TREND_REPORT_2026-07-08.md`
- Expected: the report cites external agent-skill and domain-craft sources
- Open `docs/skills/template-skills/README.md`
- Expected: README describes `by-template/<presetId>/*.md` as the runtime source for Layer S
- Parse `docs/skills/template-skills/template-skill-map.json`
- Expected: valid JSON; every skill id resolves to `docs/skills/template-skills/seed-catalog/<skill-id>.md`
- Open `docs/skills/template-skills/by-template/landing/`
- Expected: landing has strong style-forward skills including `premium-landing-art-direction`, `modern-impact-visual-direction`, `brand-led-identity-system`, and `anti-ai-slop-ui-review`
- Open `docs/skills/template-skills/by-template/website/`
- Expected: website has product/interface craft plus strong style-forward skills including `product-interface-craft`, `modern-impact-visual-direction`, `brand-led-identity-system`, and `anti-ai-slop-ui-review`
- Open every file under `docs/skills/template-skills/seed-catalog/`
- Expected: each manual contains a focused directive, practical rules, and output checks
- `GET /v1/projects/:projectId/llm/prompt-preview`
- Expected with `LLM_TEMPLATE_SKILLS_ENABLED=true`: prompt trace contains Layer S with source `filesystem-template-skills:<presetId>:<skillIds>`, `chars > 0`, and `effectiveSystemPrompt` contains `## LAYER S — TEMPLATE SKILLS`
- Expected with `LLM_TEMPLATE_SKILLS_ENABLED=false`: Layer S is present in `layers[]` but empty
- Send a real chat generation for the same project
- Expected: assistant message `metadata.promptingTrace.effectiveSystemPrompt` contains the same Layer S block sent to the provider
- Expected: latest `prompt_execution_logs` row for the project has `renderedSystemPrompt` containing `## LAYER S — TEMPLATE SKILLS`
- Generate before/after artifacts for one `landing` and one `website` prompt
- Expected: stronger first-screen distinctiveness, clearer CTA/interface hierarchy, no JSON parse regression, no obvious duplication with Layer A/B/E

### Step 11h - VibeCore Config Surface

- `GET /v1/vibecore/config` with authenticated user
- Expected: response includes `attachmentPolicy` and `documentContextPolicy`
- If `projectId` is provided, verify the project must belong to the authenticated user
- Expected: unauthorized project access returns `403`

### Step 11i - VibeCore Classify

- `POST /v1/vibecore/classify`
- body: `{ "prompt": "portfolio per studio creativo", "attachmentMeta": [] }`
- Expected: authenticated request succeeds and returns `projectId`
- Expected: response may include `templateId`, `formatHint`, `confidence`, `warnings`, and `attachmentPolicy`
- Expected: if no `projectId` is supplied, the backend creates or pins a real owned draft project so follow-up calls stay in a valid sandbox

### Step 11j - VibeCore Prefill

- `POST /v1/vibecore/prefill`
- body: `{ "prompt": "landing page per consulente SEO con CTA contatti", "projectId": "..." }`
- Expected: response includes `draft`, `confidence`, `projectId`, and optional `warnings`
- Expected: if the project contains eligible document assets, Layer D document context can enrich the resulting draft
- Expected: invalid foreign `projectId` returns `403`

### Step 11k - Dashboard Entry and Launch Handoff

- Open `/dashboard`
- Expected: VibeCore entry is visible above the legacy dashboard content
- Expected: the initial chat has no manual `Auto` / `Website` selector; template and flow routing are classifier-owned
- Switch between `easy`, `medium`, and `hard`
- Expected:
  - `easy` stays on the entry surface
  - `medium` opens the guided project-creation dialog/launch path
  - `hard` routes toward the advanced workspace flow
- From the VibeCore flow, complete a project creation path that redirects to `/launch/[projectId]`
- Expected: guided handoff uses the same project identity later openable in `/workspace/[projectId]`
- Attach at least one structured dataset (`csv`, `xlsx`, `json`) in the VibeCore entry
- Expected: a dataset-count badge appears, enrichment waits for readiness, and any upload warnings/errors are localized in both `it` and `en`

### Step 11l - Notifications Surface

- Trigger a backend notification event, for example via media fallback/failure or publish/export unresolved-media blocking
- `GET /v1/notifications`
- Expected: unread items are returned for the owning user
- If logged in as superadmin, `GET /v1/admin/notifications`
- Expected: admin-visible notification stream is available for operational review

### Step 11m - Grounded Data Dashboard Runtime

- Open `/dashboard/data/:projectId`
- Upload one `CSV`, `XLSX`, `JSON`, simple tabular `XML`, or supported `SQL` dump asset
- Expected: upload succeeds through the existing asset route and the dataset appears in the left-side picker
- Expected: the dataset card reports profile/cache readiness, with cache becoming reusable after enrichment or first runtime load
- Select the uploaded dataset
- Expected: the page loads a grounded profile with row count, column count, inferred types, sample rows, and deterministic column statistics
- If the dataset exposes multiple tables or sheets, switch the selected table
- Expected: schema, insights, suggestions, and sample rows all update to the selected grounded table
- Run a manual query such as `sum` or `avg` on a numeric column
- Expected: response includes `facts[]`, `rowCountBeforeFilters`, `rowCountAfterFilters`, and a deterministic result
- Add a grounded filter on one column before running the query
- Expected: the filter is reflected in the executed payload and the result changes deterministically with updated `rowCountAfterFilters`
- Add a second grounded filter and a sort direction on one visible column
- Expected: runtime browsing and manual query payloads remain explicit, with no hidden heuristics; sorting changes row order deterministically without changing aggregated facts unless filters also change
- Use the row browser on the selected table
- Expected: runtime rows load with deterministic pagination, `offset` advances with `Next`, and filtered browsing changes `totalRowsAfterFilters` without inventing or summarizing unseen rows
- Expected: row browsing honors the selected sort and up to two grounded filters while preserving the raw row values as source of truth
- Ask a supported question such as `What is the total <numeric_column>?`
- Expected: the answer is grounded, references the interpreted operation, and can attach the executed query payload
- Ask an unsupported question such as a causal or speculative question
- Expected: the runtime refuses explicitly and does not invent numerical claims
- Open dashboard suggestions
- Expected: KPI/bar/line/table suggestions are derived only from the detected schema and column types
- For nested JSON datasets, expected: nested objects are exposed as dotted columns (for example `telemetry.output.kwh`) and nested arrays are called out in limitations instead of being hallucinated as direct numeric facts
- For XML datasets, expected: repeated sibling nodes become grounded tables, while non-tabular XML is flattened into a single-row structure with limitations shown explicitly
- For SQL datasets, expected: `INSERT INTO ... (columns) VALUES (...)` blocks become grounded tables; schema-only SQL or stored procedures must be refused or surfaced as unsupported

### Step 11n - VibeCore Game Preset Matching

- `POST /v1/vibecore/classify` with body `{ "prompt": "voglio un gioco interattivo" }`
- Expected: `templateId = "videogame"`, `confidence >= 0.65`
- Expected: project is created/updated with `presetId = "videogame"`
- Expected: Layer B in the system prompt contains the `VIDEOGAME EXPERIENCE` module
- Verify: every preset in `PRESET_CATALOG`, including UI-hidden specialist presets, appears in the canonical AI matching context used by both classifier and prefill
- `POST /v1/vibecore/classify` with `{ "prompt": "crea un gioco infinite runner con ostacoli e punteggio" }`
- Expected: `templateId = "freerunner"`; the persisted project preset, launch badge, normalized brief and Layer S template id all remain `freerunner`
- Verify: `POST /v1/vibecore/prefill` returns the same `presetId` and populates applicable expressive fields (`contentStructure`, `functionalRequirements`, `interactionModel`, `successCriteria`)
- Verify: the normalized brief contains `[SOURCE_REQUEST]` and states that inferred sections are additive; an explicit negative instruction is preserved in `[MUST_AVOID]`
- Verify: a legacy non-empty admin override cannot remove the current preset catalog or reduce the response to the old four-value `siteType` contract

### Step 11o - Global Brand Identity: Platform Scope (Admin)

- `POST /v1/admin/brand-assets` with body `{ "role": "company_name", "policy": "must_use", "valueType": "text", "textValue": "Acme Corp" }`
  - Expected: 201, `{ asset: { id, scope: "platform", role: "company_name", policy: "must_use", ... } }`
- `POST /v1/admin/brand-assets` with body `{ "role": "brand_color_palette", "policy": "must_use", "valueType": "color_list", "textValue": "#FF0000,#00FF00,#0000FF" }`
  - Expected: 201, `{ asset: { role: "brand_color_palette", valueType: "color_list", ... } }`
- `GET /v1/admin/brand-assets` — Expected: returns the two assets above
- `GET /v1/projects/:projectId/llm/prompt-preview` — Expected: `layers.g_brandContext` contains both assets with `[MUST USE / Platform]` prefix
- Verify: Layer G appears in `composed` between Layer C and Layer D

### Step 11p - Global Brand Identity: User Scope

- `POST /v1/users/me/brand-assets` with body `{ "role": "social_instagram", "policy": "prefer", "valueType": "url", "textValue": "https://instagram.com/acmecorp" }`
  - Expected: 201, `{ asset: { scope: "user", ownerUserId: <userId>, ... } }`
- `GET /v1/users/me/brand-assets` — Expected: returns the asset above
- `GET /v1/projects/:projectId/llm/prompt-preview` — Expected: `layers.g_brandContext` now contains both platform AND user assets, ordered platform → user

### Step 11q - Global Brand Identity: Project Scope

- `POST /v1/projects/:projectId/brand-assets` with body `{ "role": "client_logo", "policy": "must_use", "valueType": "text", "textValue": "Client Logo Label" }`
  - Expected: 201, `{ asset: { scope: "project", projectId: "<projectId>", ... } }`
- `GET /v1/projects/:projectId/brand-assets` — Expected: returns the asset above
- `GET /v1/projects/:projectId/llm/prompt-preview` — Expected: `layers.g_brandContext` contains platform + user + project assets in that order

### Step 11r - Global Brand Identity: Must-Use Mandatory Section and Retrocompatibility

- Verify: when any asset has `policy: "must_use"`, Layer G ends with a `MANDATORY RULES` section listing must-use roles
- Verify: `PATCH /v1/admin/brand-assets/:id` with `{ "isActive": false }` stops the asset from appearing in Layer G
- Verify: `DELETE /v1/admin/brand-assets/:id` removes the asset and it no longer appears in Layer G
- Retrocompatibility: `GET /v1/projects/:projectId/llm/prompt-preview` on a project with NO brand assets configured returns `g_brandContext: ""` and the composed prompt is identical to what it was before the feature was deployed

### Step 11s - Reusable Brand Document: one-time extraction (User Scope)

- `POST /v1/users/me/brand-assets/document` (multipart) with a PDF/DOCX brand book — Expected: 201 with `enrichmentStatus` and `valueType: "document_ref"`
- Re-fetch `GET /v1/users/me/brand-assets` — Expected: the document shows `hasDocumentFragment: true` once enrichment completes (`enrichmentStatus: "ready"`)
- Verify: the LLM document analysis ran exactly once (one enrichment cost entry in the ledger for that document)

### Step 11t - Reusable Brand Document: cross-project injection

- With the user-scope brand document from 11s present, open `GET /v1/projects/:projectId/llm/prompt-preview` on ANY project (even one with no attachments)
- Expected: `layerD` contains a `## LAYER D — BRAND REFERENCE MATERIALS` block with the document's cached fragment
- Open a SECOND, different project — Expected: the same brand-document block appears with NO new enrichment call (fragment reused verbatim)

### Step 11u - Reusable Brand Document: promote reuses extraction

- Upload a document as a project attachment and let it enrich; then `POST /v1/users/me/brand-assets/promote` with `{ "role": "brand_document", "sourceAssetId": "<assetId>" }`
- Expected: 201 with the promoted document carrying the source's cached fragment and ZERO new LLM cost

### Step 11v - Reusable Brand Document: budget + retrocompat

- Verify: combined Layer D (brand documents + project attachments) never exceeds `ENRICHMENT_LAYER_D_MAX_CHARS`; brand documents claim the budget first
- Retrocompatibility: with NO brand documents, `layerD` is byte-identical to before this feature (only project attachments, or empty)

---

## M0.5 - Focused Asset Control

> Historical naming note: the sections below retain the older `M0.5` / `M1` / `M2` labels
> because linked specs and older handoff notes still reference them. They should be read as
> backlog or deferred validation tracks unless the current development plan explicitly reactivates them.

### Step 12 - Preview Inspect Toggle

- Open the Workspace with generated artifacts present
- Enable the `Inspect` toggle
- Expected: hovering the iframe highlights the node under the mouse; clicking selects the node

### Step 13 - Selected Element Metadata

- With an element selected, click `Copy metadata JSON`
- Expected: payload contains at least `stableNodeId`, `selector`, `tag`, `classes`

### Step 14 - Focus Context In Prompt

- Click `Use in prompt` and send a message such as "optimize this block"
- Expected: request backend include `focusContext.mode = "preview-element"`
- Expected: tracing `messagesSentToLlm` contains the focus block inside registered Layer Q; Layer Q
  is an empty row for non-focused requests.
- Verify: `effectiveSystemPrompt` is byte-identical to `messagesSentToLlm[0].content`, every
  descriptor is present in canonical order, and every non-empty span slices its complete marker
  block. A mismatch must fail before the provider call.

### Step 15 - Code Selection Focus

- In the `HTML/CSS/JS` tabs, select a range and send a prompt
- Expected: request include `focusContext.mode = "code-selection"` + `startLine/endLine`

### Step 16 - Snapshot History

- Send 3 consecutive prompts with changes
- Expected: 3 snapshots ordered by timestamp, browsable from the history combo box
- Expected: restoring a previous snapshot is available

### Step 16a - Asset Storage Adapter

- Set `STORAGE_ADAPTER=minio` with valid MinIO credentials and start the stack
- Upload an image from the project asset manager
- Expected: upload, list, download, and delete continue to work through the same API routes
- Verify: the object is isolated under the same user/project sandbox path and the file can still be streamed back from the API

### Step 16b - Provider-backed Image Generation

- Ensure `SILICONFLOW_API_KEY` is configured and `STORAGE_ADAPTER=minio`
- In the workspace, enable `Inspect`, select an element, open the media inspector, and click `Generate image`
- Expected: `POST /v1/projects/:id/assets/generate-image` returns `202 queued` with a placeholder asset immediately
- Expected: `POST /v1/projects/:id/images/regenerate-stock` returns `201` with a `platform_generated` asset and an internal `/p/media/:assetId` URL; applying that URL in Edit mode should create a new preview snapshot with `finishReason: stock-image-regenerated`
- Expected: edit-mode stock regeneration is primary-provider-only. If the configured provider cannot resolve the request, the action fails explicitly and must not fallback to another stock provider or Picsum.
- Expected: within a few seconds, the asset changes to `generationStatus = ready`
- Verify: the saved asset now includes provider metadata such as provider, model, image size, prompt, timing, cost, and the persisted semantic classification payload
- Verify: the binary is stored in MinIO and can be applied back into the WYSIWYG preview

### Step 16c - Manifest-backed Artifact Media Resolution

- Send or simulate a structured LLM response with `artifacts.html/css` using `asset://media/hero-main` and a matching `mediaManifest.requests[0].key = "hero-main"`
- Expected: `ResolveArtifactMedia` persists a `platform_generated` `ProjectAsset`
- Expected: the persisted generated asset carries first-class lineage in `generationMetadata` (`mediaKey`, `semanticQuery`, `resolutionRoute`, and when available `conversationId` / `parentSnapshotId`)
- Expected: the returned artifact replaces every `asset://media/hero-main` occurrence in HTML and CSS with `/p/media/:assetId`
- Expected: `done.result.mediaResolution` contains trace IDs, asset IDs, media keys, and `degraded` status, and the saved `PreviewSnapshot.metadata.mediaResolution` preserves the same linkage
- Expected: after the snapshot is saved with `sourceMessageId`, `GET /v1/projects/:projectId/conversations/:conversationId` shows the assistant message with `metadata.snapshotId` and `metadata.mediaResolution`
- Expected: missing manifest requests fail explicitly instead of saving an active artifact with unresolved media placeholders
- Expected: provider fallback or persistence failure creates an unread backend notification visible through `GET /v1/notifications` and `GET /v1/admin/notifications`
- Expected: configured fallback is allowed in this full artifact-generation path so the platform can return a complete first artifact when the primary provider fails
- Verify locally with `npm run test -w apps/api -- ResolveArtifactMedia PreviewSnapshotMediaResolution PublishExportMediaGuardrails RegenerateMediaByKey replaceMediaPlaceholders llmParser.mediaManifest`

### Step 16d - Media-Key Regeneration

- Precondition: a saved snapshot has `metadata.mediaResolution.mediaKeys[]` and the selected DOM node still carries `data-media-key="hero-main"`
- `POST /v1/projects/:id/media/hero-main/regenerate`
- Expected: API regenerates from the latest persisted trace for `hero-main`, stores a new `ProjectAsset`, writes a new `MediaResolutionTrace`, and returns `{ mediaKey, traceId, assetUrl }`
- Expected: workspace edit mode uses this route automatically when `data-media-key` is available, then applies the returned `assetUrl` through the existing save-new-snapshot flow
- Expected: this edit-mode path passes `allowFallback: false` internally. Provider failure should return an error and must not create a replacement trace or apply a new asset.

### Step 16e - Artifact Media End-To-End Smoke

- Precondition: stock provider keys are configured, storage is reachable, and the project has a valid active project sandbox (`x-project-id`)
- `GET /v1/projects/:id/llm/prompt-preview`
- Expected: `layers.budgetPolicy` contains `asset://media/<lowercase-kebab-key>`, `mediaManifest.version must be media-manifest-v1`, and `data-media-key="<same-key>"`; this layer is hardcoded and appears after the editable `layers.e_prePromptTemplate`.
- Generate an artifact from the workspace with a prompt that requires at least one hero/background image
- Expected: LLM structured response includes `mediaManifest.requests[]`; final preview HTML/CSS includes `/p/media/:assetId`, not provider URLs and not unresolved `asset://media/*`
- Expected: every generated media element that should be editable carries `data-media-key`. Foreground `<img src="asset://media/<key>">` placeholders are annotated automatically during backend replacement; CSS background elements must be emitted by the LLM with `data-media-key` on the owning HTML element.
- Save/activate the generated snapshot
- Expected: the snapshot contains `metadata.mediaResolution.traceIds[]`, `assetIds[]`, and `mediaKeys[]`
- Open the media inspector on the generated image/background and click stock regenerate
- Expected: keyed regeneration creates a new project asset, applies it to the selected code fragment, and creates a new snapshot version
- Publish the resolved snapshot
- Expected: publish succeeds without invoking any media provider
- Create or simulate a snapshot with unresolved `asset://media/hero-main`, then publish/export it
- Expected: publish/export fails explicitly and `GET /v1/notifications?status=unread` includes the matching blocked event

Current automation coverage for this flow is backend-focused. Add Playwright coverage for the browser path before considering the end-to-end UX fully regression protected.

### Step 16f - Artifact Media Implementation Status Handoff

- Read `docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md` before starting any new media-orchestrator work.
- Expected: the report identifies the verified default provider policy, Docker-local smoke status, current implementation files, manual E2E path, and open P0/P1/P2 gaps.
- Expected: future work starts from `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md` for short-term fixes or `docs/specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md` for strategy/resolver expansion.
- Expected: if the implementation state changes, update the status report or create a new dated report and link it from `docs/INDEX.md` and `docs/agents/CODE_AGENT_INDEX.md`.

---

## M1 — Context Bridge

### Step 17 - contextStats.atCapacity

- Execute 6+ turns in a conversation with long messages
- Expected: `contextStats.atCapacity === true` in the response

### Step 18 - Job Creation

- `POST /v1/projects/:id/generate`
- body: `{ conversationId: "...", fromChat: true }`
- Expected: `201 { jobId }`

### Step 19 - Job Status

- `GET /v1/jobs/:jobId`
- Expected: `200 { job: { id, status: "queued", projectId, createdAt } }`

---

## M2 — PrepromptEngine

### Step 20 - Profiles List

- `GET /v1/preprompt-profiles`
- Expected: at least 2 default profiles (`landing-page-standard`, `mini-site-portfolio`)

### Step 21 - Preprompt Test Preview

- `POST /v1/preprompt-profiles/landing-page-standard/test`
- body: `{ prompt: "Landing page for SEO agency SpeedRank", projectId: "..." }`
- Expected: `200 { resolvedPrompt, resolvedClaudeMd, resolvedOpenCodeJson, tokenEstimate }`
- Verify: `resolvedPrompt` is not empty and contains the prompt text

### Step 22 - Layer Condizionale

- Create a profile with a conditional layer `condition: "input.hasPdf == true"`
- Test with `hasPdf: false` → layer is NOT included
- Test with `hasPdf: true` → layer is included

---

## M3 — GenerationWorker

### Step 23 - BullMQ Queue

- `POST /generate` with Redis available
- Verify in Redis: `EXISTS bull:generation:*`

### Step 24 - Workspace Setup

- Expected: `/data/workspaces/{jobId}/` is created with `opencode.json`, `CLAUDE.md`, `skills/`

### Step 25 - SSE Log Stream

- `GET /v1/jobs/:jobId/logs` (SSE)
- Expected: log stream from OpenCode stdout
- Verify: SIGTERM timeout works if OpenCode hangs

### Step 26 - Generation Completed

- Wait until `job.status === "completed"`
- Expected: `/data/workspaces/{jobId}/dist/index.html` exists
- Expected: git log shows commit `iteration-1`

---

## M4 — DeployWorker

### Step 27 - Deploy Job

- `POST /v1/projects/:id/deploy`
- Expected: `202 { deployJobId }`

### Step 28 - Nginx Config

- Expected: `/etc/nginx/sites-available/{slug}.conf` is created
- Verify: `nginx -t` → OK

### Step 29 - Site Live

- `GET /v1/projects/:id/deployment`
- Expected: `{ status: "live", url: "http://slug.Andy Code Cat.local" }`
- Verify: `curl http://slug.Andy Code Cat.local` → site HTML

### Step 30 - Export ZIP

- `POST /v1/projects/:id/export/layer1`
- Expected: downloadable ZIP metadata containing `index.html`
- Expected: if selected/active snapshot still contains `asset://media/*`, export returns an explicit error before creating an export record or ZIP file

### Step 30a - Publish/Export Media Guardrail

- Precondition: create or simulate a snapshot whose HTML or CSS still contains `asset://media/hero-main`
- `POST /v1/projects/:id/publish` with that `snapshotId`
- Expected: publish fails explicitly and does not write or overwrite public files
- Expected: `GET /v1/notifications?domain=publish&status=unread` returns a notification with `sourceEventType = "publish_blocked_unresolved_media"`
- `POST /v1/projects/:id/export/layer1` with that `snapshotId`
- Expected: export fails explicitly and `GET /v1/notifications?domain=export&status=unread` returns `sourceEventType = "export_blocked_unresolved_media"`

---

## M5 — Credit System

### Step 31 - Insufficient Credits

- Seed a user with 0 credits
- `POST /generate` → `402 { error: "insufficient_credits", required: 6.5, balance: 0 }`

### Step 32 - Credits Deducted

- Seed a user with 20 credits
- Complete one generation + deploy flow
- `GET /v1/profile/credits` → reduced balance (6.5 credits: 0.5 preprompt + 5 generation + 1 deploy)

### Step 33 - SSE Credits Event

- During the job, the SSE listener receives `{ type: "credits_charged", amount: N, balance: M }`

---

## Repository Governance — Gitflow Release

### Step 34 - Release Version Format

- `npm run release:version`
- Expected: prints the contents of `RELEASE_VERSION` in `YYYY.MM.DD.N` format

### Step 35 - Release Version Validation

- `npm run release:version:validate`
- Expected: output `Release version OK: ...`

### Step 36 - Gitflow Branch Guard

- `npm run gitflow:guard`
- Expected: the current branch passes only if it matches one of these forms:
  - `main`
  - `develop`
  - `feat/*`
  - `fix/*`
  - `docs/*`
  - `chore/*`
  - `refactor/*`
  - `release/YYYY.MM.DD.N`
  - `hotfix/*`

### Step 37 - Release Branch Naming

- Create branch `release/<RELEASE_VERSION>` from `develop`
- Expected: branch name matches the canonical version stored in `RELEASE_VERSION`

### Step 38 - Release Merge Intent

- Open PR from `release/<RELEASE_VERSION>` to `main`
- Expected: no new feature scope is present on the branch; only release hardening fixes, docs, and chore work

### Step 39 - Agent Release Checklist Available

- Open `docs/guides/AGENT_RELEASE_CHECKLIST.md`
- Expected: the checklist covers branch selection, release identity, commit hygiene, PR targets, merge order, and back-merge rules

---

## ARTIFACT MEDIA ORCHESTRATOR — Local Docker Test Procedure

> Verifies the full stock-image pipeline end-to-end in a local Docker environment.
> Run in order. Each step must pass before proceeding.

### Prerequisites

Before running these steps:

1. Ensure `.env.docker` contains at least one stock API key **or** accepts LoremFlickr fallback (no key needed):
   ```
   PEXELS_API_KEY=your-key          # recommended — 200 req/h free
   # or leave empty — LoremFlickr fallback activates automatically
   ```
2. Verify `PUBLIC_API_BASE_URL` in `.env.docker`:
   - If accessing through nginx on port 80: `PUBLIC_API_BASE_URL=http://localhost`
   - If accessing the API directly on port 4000: `PUBLIC_API_BASE_URL=http://localhost:4000`
   - The value must be reachable from the browser that opens the workspace. Wrong value = broken image previews.
3. Stack running: `docker compose up` or `npm run local:dev:up`

### Step M1 — Provider status

```
GET /v1/projects/:projectId/images/provider-status
Authorization: Bearer TOKEN
```

Expected response:
```json
{
  "activeProvider": "pexels",         // or "loremflickr" if no key configured
  "fallbackMode": "notify",
  "providerOrder": ["pexels", "pixabay", "unsplash", "loremflickr", "picsum"],
  "persistenceEnabled": true,
  "configuredProviders": {
    "pexels": false,                  // true if PEXELS_API_KEY set or DB key present
    "loremflickr": true               // always true
  }
}
```

If `activeProvider` is `loremflickr` and you want real stock images, add a Pexels/Pixabay key via Admin → Integration Hub or `.env.docker`.

### Step M2 — Prompt preview (verify media rules are in system prompt)

```
GET /v1/projects/:projectId/llm/prompt-preview
Authorization: Bearer TOKEN
```

Check in the `budgetPolicy` layer:
- Contains `asset://media/<lowercase-kebab-key>`
- Contains `data-media-key`
- Contains `mediaManifest.version must be media-manifest-v1`
- Contains `non-editable platform rules`
- Does NOT contain `loremflickr.com` or `pexels.com` in the budget policy layer (may appear in other layers as legacy examples)

### Step M3 — Generate an artifact and verify image resolution

1. Send a chat-preview request with a prompt that implies images (e.g. "crea una landing page con un'immagine hero"):
   ```
   POST /v1/projects/:projectId/llm/chat-preview
   Authorization: Bearer TOKEN
   { "message": "crea una landing page con hero image e sezione servizi con immagini" }
   ```

2. Check response:
   - `structured.artifacts.html` must NOT contain `asset://media/` (all placeholders resolved)
   - `structured.artifacts.html` may contain `/p/media/:assetId` URLs (resolved assets)
   - `structured.artifacts.html` may contain `loremflickr.com` or `picsum.photos` only if no keys are configured AND the LLM used legacy URL format
   - `mediaResolution.traceIds` should be present if manifest-based resolution ran
   - `mediaResolution.degraded` should be `false` if all images resolved correctly

3. If `structured.artifacts.html` still contains `asset://media/`:
   - The LLM generated placeholders but resolution failed
   - Check API logs for `[media] mediaManifest validation failed` or `media resolution failed`
   - Verify `activeProvider` has a configured key

### Step M4 — Verify ProjectAsset creation

```
GET /v1/projects/:projectId/assets
Authorization: Bearer TOKEN
```

Expected: new asset(s) with `source: "platform_generated"` and `generationMetadata.provider` matching the active provider.
Asset ID should match the `/p/media/:assetId` URLs in the generated HTML.

### Step M5 — Verify asset URL is accessible from browser

Take one `/p/media/:assetId` URL from the generated HTML and open it in a browser.
Expected: the image loads directly (the API serves it via the `/p/` route proxied by nginx).

If the image does not load:
- Check that `PUBLIC_API_BASE_URL` in `.env.docker` matches the URL the browser uses to reach the app.
- Check that nginx proxies `/p/*` to the API (verify `nginx/sites-enabled/local.conf`).

### Step M6 — Verify snapshot saved with mediaResolution metadata

```
GET /v1/projects/:projectId/preview-snapshots
Authorization: Bearer TOKEN
```

The most recent snapshot should have:
```json
{
  "metadata": {
    "mediaResolution": {
      "version": "media-resolution-v1",
      "traceIds": ["..."],
      "assetIds": ["..."],
      "mediaKeys": ["hero-main", "..."],
      "degraded": false
    }
  }
}
```

### Step M7 — Edit-mode: regenerate image by media key

1. In the workspace, click on an image that has `data-media-key` in its HTML.
2. In MediaInspectorPanel, click "Regenerate stock".
3. Expected:
   - New asset is created with the same media key
   - New trace is written linking the new asset to the same `mediaKey`
   - A new preview snapshot version is created
   - The image in the preview changes

Via API:
```
POST /v1/projects/:projectId/media/hero-main/regenerate
Authorization: Bearer TOKEN
{ "snapshotId": "optional-snapshot-id" }
```
Expected `201 { mediaKey, traceId, asset, assetUrl, fallbackUsed: false }`.
If provider fails: `4xx` error (no fallback in edit mode).

### Step M8 — Publish guardrail: block on unresolved placeholder

1. Manually create or find a snapshot whose HTML contains `asset://media/test-key` (unresolved).
2. Attempt to publish:
   ```
   POST /v1/projects/:projectId/publish
   ```
3. Expected: `409` error with message mentioning unresolved media keys.
4. Check notifications: `GET /v1/notifications` should show an unread notification with `domain: "media"`.

### Step M9 — Admin: set provider policy and verify

1. In Admin → Integration Hub → "Stock provider policy", change the primary provider.
2. Reload the workspace.
3. Check `GET /v1/projects/:projectId/images/provider-status` — `activeProvider` matches the new setting.
4. Generate a new artifact and check that `mediaResolution` traces show the new provider.

### Step M10 — Workspace refactor no-regression smoke

1. Run `npm run build -w apps/web`.
2. Start the freshly built web app on a free local port without replacing the running Docker web service.
3. Log in with the isolated E2E bot and create a disposable project.
4. Set `andy-code-cat_workspace_split=60` and `andy-code-cat_chat_vsplit=85`, then open `/workspace/:projectId`.
5. Expected: HTTP 200, `.workspace-shell` and `.workspace-chat-panel` are visible, and no client-side context/provider exception is logged.
6. Expected: the horizontal grid starts at 60% and the vertical chat split starts at 85% after mount/reload.
7. Delete the disposable bot project.
8. Permanent gate: run `npx playwright test tests/e2e/workspace-refactor.spec.ts --project=chromium` with `E2E_BASE_URL` pointing to the freshly built web app and `E2E_API_URL` pointing to the isolated API stack.
9. When adding workspace behavior, place deterministic chat, focus/media, or preview transformation logic under the matching `app/workspace/features/*` directory; do not add a context unless state must be shared by independent render subtrees.
10. From Vibe Mode, complete the Guided Mode handoff and launch Workspace with a configured preferred model that is also the active default.
11. Expected: the stored handoff prompt is consumed exactly once and content generation starts automatically; an unavailable preferred model must fall back to the active workspace model rather than blocking generation.
12. Publish or republish a snapshot containing project media, then open the path link shown by the workspace.
13. Expected locally: the link uses `http://<browser-host>/p/<publishId>/` through nginx, CSS/JS return 200, and generated media references use `/p/media/<assetId>` rather than a build-time `localhost:4000` origin.
14. Recreate only the deploy-stack API with `docker compose -f docker-compose.deploy.yml up -d --no-deps --force-recreate api`, then reload the published path.
15. Expected: nginx continues to route `/p/*` to the recreated API without a 502; all local file storage remains available under `./data/`.
16. Create a snapshot whose HTML uses at least three Tailwind utility classes but deliberately omits the Tailwind CDN script; include CSS custom properties used by colour utilities.
17. Publish it and open the nginx path URL. Expected: Tailwind 3.4.17 and the derived theme are injected, layout and custom colours are applied, and the published head keeps the Tailwind config immediately after the CDN runtime.
18. Permanent gate: run `npx playwright test tests/e2e/publish-local.spec.ts --project=chromium` with `E2E_PUBLIC_BASE_URL=http://localhost`.

### Diagnosis checklist: images not appearing

| Symptom | Check | Fix |
|---|---|---|
| `asset://media/` still in artifact HTML | API logs: `mediaManifest validation failed` | LLM produced invalid manifest — now drops gracefully, legacy resolver runs. If persisting: check LLM JSON output format. |
| `/p/media/:assetId` in HTML but image broken in browser | `PUBLIC_API_BASE_URL` mismatch | Set `PUBLIC_API_BASE_URL` to the URL browsers use to reach the app. |
| `provider: "loremflickr"` in traces | No stock API key configured | Add `PEXELS_API_KEY` to `.env.docker` or via Admin → Integration Hub. |
| Generation request returns 500 | API logs: media resolution error | Since fix 2026-05-29, media errors are caught and artifacts delivered without images. If still 500, check LLM key / provider config. |
| `fallbackUsed: true` in traces | Primary provider failed | Check API key validity. In edit mode regeneration always fails explicitly (no fallback). |
| Snapshot `degraded: true` | Some images failed during generation | Use Edit mode to regenerate failed images individually before publishing. |
