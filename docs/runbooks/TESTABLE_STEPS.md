# Testable Steps

> Follow the milestones in order. Each step must pass before moving to the next one.
> For the full plan, see [`docs/DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md).

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
- Expected: idempotent upsert in the `llm_providers` collection

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

## M0.5 - Focused Asset Control

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
- Expected: tracing `messagesSentToLlm` contains the focus block

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

### Diagnosis checklist: images not appearing

| Symptom | Check | Fix |
|---|---|---|
| `asset://media/` still in artifact HTML | API logs: `mediaManifest validation failed` | LLM produced invalid manifest — now drops gracefully, legacy resolver runs. If persisting: check LLM JSON output format. |
| `/p/media/:assetId` in HTML but image broken in browser | `PUBLIC_API_BASE_URL` mismatch | Set `PUBLIC_API_BASE_URL` to the URL browsers use to reach the app. |
| `provider: "loremflickr"` in traces | No stock API key configured | Add `PEXELS_API_KEY` to `.env.docker` or via Admin → Integration Hub. |
| Generation request returns 500 | API logs: media resolution error | Since fix 2026-05-29, media errors are caught and artifacts delivered without images. If still 500, check LLM key / provider config. |
| `fallbackUsed: true` in traces | Primary provider failed | Check API key validity. In edit mode regeneration always fails explicitly (no fallback). |
| Snapshot `degraded: true` | Some images failed during generation | Use Edit mode to regenerate failed images individually before publishing. |
