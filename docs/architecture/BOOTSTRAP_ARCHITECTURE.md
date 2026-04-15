# Bootstrap Architecture

## Services

- **web**: Next.js 15 App Router — UI client
- **api**: Express + TypeScript — backend API built with Clean Architecture
- **mongodb**: primary database (host port 27018)
- **redis**: cache and BullMQ queue (host port 6380)
- **workspace**: container for the OpenCode worker (planned for M3)

## Clean Architecture Map (API)

```
apps/api/src/
  domain/          ← pure TypeScript entities + repository interfaces (zero external dependencies)
  application/     ← use-cases + orchestration (depends only on domain)
  infra/           ← Mongoose adapters + bcrypt + JWT (implements domain interfaces)
  presentation/    ← Express routes + middleware (calls application)
```

Required flow: `presentation → application → domain`, `infra → domain`

## What Is Built

### Domain entities (✅)

- `User` — with `llmPreferences.defaultProvider` and `passwordPolicyVersion` for legacy password migration
- `Project` — with `ownerUserId` for sandbox isolation
- `Session` — session-bound refresh token rotation (only a hashed refresh token is stored in the DB)
- `Conversation` + `Message` + `MessageMetadata` + `BackgroundTask`
- `LlmCatalog` — provider/model registry
- `ProjectPreset` — preset library with category taxonomy, ordering, and recommended-model metadata
- `LlmPromptConfig` — project-level `prePromptTemplate`
- `StyleTag` — static catalog of 82 tags across 10 categories
- `UserStyleProfile` — user style profile with onboarding state
- `ProjectMoodboard` — per-project style override, brief, and target-business context

### Application use-cases (✅)

- Auth: `RegisterUser`, `LoginUser`, `RefreshSession`, `ChangePassword`
- Projects: currently handled through route-level orchestration
- Conversations: `CreateConversation`, `AddMessage`, `GetConversation`, `GetConversations`, `LogBackgroundTask`
- LLM: `GetLlmCatalog`, `SeedLlmCatalog`, `GetLlmPromptConfig`, `SetLlmPromptConfig`
- Style profiling: `GetUserStyleProfile`, `UpdateUserStyleProfile`
- Moodboard: `GetProjectMoodboard`, `UpdateProjectMoodboard`
- Project ops: `DeleteProject`, `DuplicateProject`

### API routes (✅)

- `GET /health`
- `POST /v1/auth/register` · `POST /v1/auth/login` · `POST /v1/auth/refresh` · `POST /v1/auth/change-password`
- `GET/POST /v1/projects` · `GET /v1/projects/:id`
- `DELETE /v1/projects/:id` · `POST /v1/projects/:id/duplicate`
- `POST /v1/projects/:id/sessions`
- `GET/POST /v1/projects/:id/conversations`
- `GET /v1/projects/:id/conversations/:convId`
- `POST /v1/projects/:id/conversations/:convId/messages`
- `POST /v1/projects/:id/conversations/:convId/messages/:msgId/tasks`
- `POST /v1/projects/:id/llm/chat-preview`
- `POST /v1/projects/:id/llm/chat-preview/stream` (SSE)
- `GET/PUT /v1/projects/:id/llm/prompt-config`
- `GET /v1/llm/providers`
- `GET /v1/presets` (public preset catalog from Mongo with static fallback)
- `GET /v1/style-tags` (public — no auth)
- `GET|PUT /v1/users/me/profile`
- `GET|PUT /v1/projects/:id/moodboard`

⚠️ **Route ordering:** `createUserProfileRoutes()` must be registered BEFORE `createProjectRoutes()` in `app.ts`. The `projectRoutes` router uses `router.use(authMiddleware)`, which will also block `/v1/style-tags` if project routes are registered first.

### Frontend screens (✅)

- `/login` · `/register` (with redirect to `/login?registered=1` after sign-up)
- `/dashboard` — ProjectCard grid + GuideBanner + TipsPanel + toast notifications
- `/onboarding` — 3-step wizard with `TagPicker` for user style preferences
- `/workspace/[projectId]` — split panel with chat and preview iframe
- `/admin` · `/admin/users` · `/admin/users/[userId]` · `/admin/config` · `/admin/presets` · `/admin/models` · `/admin/governance` — superadmin control plane

### Frontend components (✅)

- `TagPicker` — multi-select tag grid by category
- `ProjectCard` — card with colored thumbnail and contextual menu (Open / Duplicate / Delete / Copy Prompt)
- `TipsPanel` — collapsible sidebar with suggestions and unread state tracking
- `GuideBanner` — guide banner that opens `VideoModal`
- `VideoModal` — embedded YouTube modal

### Storage adapters (✅)

- `IFileStorage` — port interface (`upload` / `getSignedUrl` / `delete`)
- `LocalFileStorage` — disk-based storage for DEV (`STORAGE_DRIVER=local`)
- `MinioFileStorage` — MinIO/S3 storage for PROD (`STORAGE_DRIVER=minio`)
- `StorageFactory` — selects the adapter from env

### Layer 1 — Chat Preview (✅)

- Streaming SSE with `thinking` / `answer` / `done` events
- History injection (latest N turns, 6000-token budget)
- Artifact context injection (previous HTML/CSS/JS)
- Structured JSON response: `{ chat: { summary, bullets, nextActions }, artifacts: { html, css, js } }`
- `contextStats: { estimatedTokens, historyTurns, atCapacity }` planned for M1

## What Is NOT Built Yet

- `Job` entity + BullMQ queue → **M1/M3**
- `PrepromptProfile` + `LayerComposer` + `PrepromptEngine` → **M2**
- `GenerationWorker` (OpenCode spawn) → **M3**
- `DeployWorker` (nginx automation) → **M4**
- `CreditService` + `CreditTransaction` → **M5**
- Frontend wizard + job progress UI → **M6**

## Single Source Of Truth

- Validation contracts: `packages/contracts/src/`
- Environment shape: `apps/api/src/config.ts`
- Docker topology: `docker-compose.yml`
- Pipeline architecture: `docs/architecture/PIPELINE_LAYERS.md`
- Documentation index: `docs/INDEX.md`

## LLM Catalog Bootstrap

- `LLM_CATALOG_SOURCE=env` (default) — catalog from code, no seed required
- `LLM_CATALOG_SOURCE=mongo` — catalog from the `llm_providers` collection
- Seed: `npm run seed:llm` (idempotent)

### Registered providers

| Provider | Auth | Notes |
|---|---|---|
| `siliconflow` | Bearer (`SILICONFLOW_API_KEY`) | Discovery filters out image/video generation models by ID |
| `lmstudio` | none | Local model, no key required |
| `openrouter` | Bearer (`OPENROUTER_API_KEY`) | Discovery filters by `architecture.modality` to keep only text-capable models; `:free` models are available without credits |

`OPENROUTER_API_KEY` is optional. Without a key, the catalog still exposes the free models by default. With a key, paid models and the full filtered catalog are also available.

## Tenant Isolation Model (Double Sandbox)

1. **User sandbox**: JWT subject (`authMiddleware`)
2. **Project sandbox**: `x-project-id` header + `project.ownerUserId === jwt.sub` (`sandboxMiddleware`)

Both checks are mandatory for every mutable route.
Layer 2 follows the same isolation pattern at the filesystem level:
`/data/workspaces/{jobId}/` is isolated per job and `/var/www/Andy Code Cat/{slug}/` is isolated per project.

## Admin Governance Configuration

- `PlatformConfig` supports optional `governanceByProduct` keys for product-level governance.
- Governance scope contains:
  - Prompt templates (`generationSystem`, `focusedEditSystem`, `reviewSystem`)
  - Global injection snippets (`headHtml`, `headerHtml`, `footerHtml`, script blocks, analytics IDs)
  - Nginx runtime knobs (`publicDomain`, `publishSubdomainPattern`, cache/body-size tuning, extra directives)
- Backward compatibility is preserved: existing deployments using only base platform config fields remain valid.
- Current runtime status:
  - `/admin/governance` is active and persists data through `GET|PATCH /v1/admin/config`
  - Registration and email-verification switches are active runtime controls
  - Governance prompt, injection, and nginx fields are persisted and editable, but not yet fully consumed by the generation/publish runtime

## Admin User Operations

- `/admin/users` supports inline superadmin configuration through a right-sidebar workflow.
- Available actions:
  - block/unblock a user
  - edit email, first name, last name, and verification state
  - edit roles
  - edit plan and limits overrides
  - reset the password with optional forced change on next login
  - force or clear password reset requirement
  - delete the user
- When a user is blocked:
  - active sessions are invalidated
  - public sites owned by that user return HTTP 403 until the account is restored

## Auth Hardening Notes

- Refresh tokens are bound to a session token identifier (`sid`) and rotated after each successful refresh.
- Legacy refresh tokens without `sid` are accepted once and upgraded during the next successful refresh.
- Legacy accounts can still sign in, but the frontend must force the authenticated password-change flow before normal workspace use.
- Email verification remains bypassable through environment configuration until a safe operational delivery flow is available.
