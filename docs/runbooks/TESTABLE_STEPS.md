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

### Step 11 - Chat Preview Streaming

- `POST /v1/projects/:id/llm/chat-preview/stream`
- Expected: SSE events `thinking` → `answer` → `done`
- Verify: `done.result.structured.artifacts` contains `html/css/js`

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

- `GET /v1/projects/:id/export/zip`
- Expected: downloadable ZIP containing `index.html`

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
