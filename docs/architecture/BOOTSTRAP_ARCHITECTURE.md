# Bootstrap Architecture

Last aligned review: 2026-06-03

This document describes the current platform shape as implemented in code.
It is not a historical roadmap. For milestone status, use `docs/DEVELOPMENT_PLAN.md`
and `docs/project/ROADMAP.md`.

---

## Services

- **web**: Next.js App Router client application
- **api**: Express + TypeScript backend following Clean Architecture
- **mongodb**: primary database (host port `27018`)
- **redis**: cache and queue support (host port `6380`)
- **minio**: S3-compatible object storage for project/user media (host ports `9000`, `9001`)
- **workspace**: shared mounted workspace container used by the local dev stack
- **nginx**: local HTTP entrypoint and public `/p/*` proxy/static layer

Notes:

- The local dev stack in `docker-compose.yml` already includes `workspace`, `minio`, and `nginx`.
- Async queue-driven generation is not the current center of implementation, even though Redis and
  workspace-level primitives already exist.

---

## Clean Architecture Map (API)

```text
apps/api/src/
  domain/          ← pure TypeScript entities + repository interfaces
  application/     ← use-cases + orchestration
  infra/           ← Mongo/crypto/storage/provider adapters
  presentation/    ← Express routes + middleware
```

Required dependency flow:

- `presentation -> application -> domain`
- `infra -> domain`

Forbidden:

- `domain -> infra`
- `domain -> presentation`
- `application -> presentation`

---

## Current Platform Shape

### Domain entities implemented

- `User`
- `Project`
- `Session`
- `Conversation`
- `LlmCatalog`
- `LlmPromptConfig`
- `PlatformConfig`
- `ProjectPreset`
- `StyleTag`
- `UserStyleProfile`
- `ProjectMoodboard`
- `ProjectAsset`
- `PreviewSnapshot`
- `MediaResolutionTrace`
- `SystemNotification`
- `ExecutionLog`
- `PromptExecutionLog`
- `CostTransaction`
- `GenerationWorkspace`
- `ExportRecord`
- `SiteDeployment`
- `PublishHistory`
- `ServiceApiKey`
- `AssetEnrichmentTrace`
- `UserTemplate`
- `WysiwygEditSession`

### Application/use-case surface implemented

Auth and identity:

- `RegisterUser`
- `LoginUser`
- `RefreshSession`
- `ChangePassword`

Workspace and conversation:

- `CreateConversation`
- `AddMessage`
- `GetConversation`
- `GetConversations`
- `GetOrCreateProjectConversation`
- `LogBackgroundTask`

Prompting and generation support:

- `GetLlmCatalog`
- `GetEffectiveLlmCatalog`
- `GetLlmPromptConfig`
- `SetLlmPromptConfig`
- `OptimizeUserPrompt`
- `DraftProjectTemplate`

Project/profile/content operations:

- `DeleteProject`
- `DuplicateProject`
- `GetProjectMoodboard`
- `UpdateProjectMoodboard`
- `GetUserStyleProfile`
- `UpdateUserStyleProfile`
- `PrepareGenerationWorkspace`

Assets, media, snapshots, publish:

- `UploadProjectAsset`
- `ListProjectAssets`
- `UpdateProjectAsset`
- `DeleteProjectAsset`
- `GenerateProjectImage`
- `RegenerateStockProjectImage`
- `RegenerateMediaByKey`
- `ResolveAndPersistHtmlImages`
- `CreatePreviewSnapshot`
- `CapturePreviewSnapshot`
- `ActivatePreviewSnapshot`
- `DeletePreviewSnapshot`
- `ListPreviewSnapshots`
- `GetPreviewSnapshot`
- `ExportLayer1Zip`
- `GetExport`
- `PublishProject`
- `UnpublishProject`
- `GetSiteDeployment`

Guided entry / Zero Effort / VibeCore:

- `LaunchZeroEffortProject`
- `VibeClassify`
- `VibePrefill`

Grounded data runtime:

- dataset normalization runtime for `CSV` / `XLSX` / `JSON` / tabular `XML` / `SQL` INSERT dumps
- nested JSON objects flattened into deterministic dotted columns for runtime querying
- simple tabular XML structures normalized as grounded tables; non-tabular XML is flattened with explicit limitations
- SQL dumps normalized when they expose `INSERT INTO ... (columns) VALUES (...)`; procedural or schema-only SQL stays unsupported by design
- persisted normalized dataset cache reused by profile/query routes
- deterministic dataset query engine
- grounded dataset insights and dashboard suggestion builders scoped to the selected table
- paginated row browsing with deterministic sort and explicit grounded filters

WYSIWYG:

- `CreateWysiwygEditSession`
- `SaveWysiwygEditState`
- `CommitWysiwygSession`

Analytics/admin:

- `GetProjectAiAnalytics`

---

## HTTP Route Surface

Current route modules registered in `apps/api/src/app.ts`:

- `healthRoutes`
- `authRoutes`
- `presetRoutes`
- `userProfileRoutes`
- `projectRoutes`
- `conversationRoutes`
- `llmRoutes`
- `previewSnapshotRoutes`
- `projectAssetRoutes`
- `exportRoutes`
- `generationWorkspaceRoutes`
- `pipelineRoutes`
- `wysiwygRoutes`
- `executionLogRoutes`
- `costRoutes`
- `vibecoreRoutes`
- `notificationRoutes`
- `datasetRoutes`
- `publicMediaRoutes`
- `publishRoutes`
- `adminRoutes`

Key functional surfaces currently active:

- `GET /health`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/change-password`
- `GET|POST /v1/projects`
- `GET /v1/projects/:id`
- `DELETE /v1/projects/:id`
- `POST /v1/projects/:id/duplicate`
- `GET|POST /v1/projects/:id/conversations`
- `POST /v1/projects/:id/conversations/:convId/messages`
- `POST /v1/projects/:id/llm/chat-preview`
- `POST /v1/projects/:id/llm/chat-preview/stream`
- `GET|PUT /v1/projects/:id/llm/prompt-config`
- `GET /v1/projects/:id/llm/prompt-preview`
- `GET|POST /v1/projects/:id/preview-snapshots`
- `POST /v1/projects/:id/preview-snapshots/:snapshotId/activate`
- `GET|POST /v1/projects/:id/assets`
- `POST /v1/projects/:id/assets/generate-image`
- `POST /v1/projects/:id/images/regenerate-stock`
- `POST /v1/projects/:id/media/:mediaKey/regenerate`
- `GET /v1/projects/:id/datasets`
- `GET /v1/projects/:id/datasets/:assetId/profile`
- `GET /v1/projects/:id/datasets/:assetId/summary`
- `GET /v1/projects/:id/datasets/:assetId/insights`
- `GET /v1/projects/:id/datasets/:assetId/dashboard-suggestion`
- `POST /v1/projects/:id/datasets/:assetId/query`
- `POST /v1/projects/:id/datasets/:assetId/ask`
- `POST /v1/projects/:id/datasets/:assetId/browse`
- `POST /v1/projects/:id/export/layer1`
- `POST /v1/projects/:id/publish`
- `POST /v1/projects/:id/unpublish`
- `GET /v1/llm/providers`
- `GET /v1/presets`
- `GET /v1/style-tags`
- `GET|PUT /v1/users/me/profile`
- `GET|PUT /v1/projects/:id/moodboard`
- `GET /v1/notifications`
- `GET /v1/admin/notifications`
- `GET /v1/pipeline/config`
- `POST /v1/pipeline/launch`
- `GET /v1/vibecore/config`
- `POST /v1/vibecore/classify`
- `POST /v1/vibecore/prefill`
- `GET /p/media/:assetId`
- publish static serving under `/p/:publishId/*`

Critical ordering rule:

- `createUserProfileRoutes()` must be registered before `createProjectRoutes()`, otherwise the
  public `GET /v1/style-tags` route is blocked by the project router's auth middleware.
- `createPublicMediaRoutes()` must be mounted before publish static routes, otherwise
  `/p/media/:assetId` is swallowed by publish file serving.

---

## Frontend Surface

### Public and authenticated routes implemented

- `/(public)`
- `/(public)/login`
- `/(public)/register`
- `/dashboard`
- `/dashboard/data/[projectId]`
- `/launch/[projectId]`
- `/onboarding`
- `/workspace/[projectId]`
- `/admin`
- `/admin/config`
- `/admin/governance`
- `/admin/integrations`
- `/admin/models`
- `/admin/presets`
- `/admin/projects`
- `/admin/users`
- `/admin/zero-effort`

### Current experience tracks

- **Dashboard / VibeCore entry**: single-prompt intake, automatic template/mode classification, guided project launch
- **Grounded data dashboard**: additive analytics route for dataset assets with deterministic facts/query execution
- **Grounded data dashboard**: additive analytics route for dataset assets with per-table inspection, deterministic row browsing, table-scoped insights/suggestions, and grounded queries with explicit filters/sort
- **Zero Effort launch flow**: simplified guided project setup under `/launch/[projectId]`
- **GodMode workspace**: split preview/chat/editor workflow under `/workspace/[projectId]`
- **Superadmin control plane**: governance, presets, integrations, model/runtime, user management

### Notable frontend components already present

- `VibeCoreEntry`
- `VibeCoreBackground`
- `ModeSelector`
- `ScrollBlurOverlay`
- `ProjectCard`
- `GuideBanner`
- `TipsPanel` / `TipsFab`
- `NotificationPanel`
- `MediaInspectorPanel`
- `TagPicker`

---

## Storage and Media Architecture

### Storage adapters

- `IFileStorage`
- `LocalFileStorage`
- `MinioFileStorage`
- `StorageFactory`

### Media resolution baseline

The current artifact-media flow is implemented and live:

- LLM artifacts can emit `asset://media/<key>` placeholders plus `mediaManifest.requests[]`
- backend resolution happens before snapshot persistence
- resolved files become first-class `ProjectAsset` rows
- `MediaResolutionTrace` records resolution lineage and replay context
- snapshot metadata persists `mediaResolution`
- publish/export activation paths block unresolved media placeholders
- edit-mode keyed regeneration reuses persisted traces and disables fallback

Additional implemented behaviors:

- conversation messages are patched with `metadata.snapshotId` and `metadata.mediaResolution`
  after snapshot creation from `sourceMessageId`
- `project_assets.generationMetadata` persists normalized lineage fields such as
  `conversationId`, `sourceMessageId`, `parentSnapshotId`, `mediaKey`, `semanticQuery`,
  `resolutionRoute`, and `fallbackUsed`
- persistent notifications exist for media fallback/failure and publish/export blocking events

Primary implementation references:

- `docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md`
- `docs/reports/MINIMAX_M3_PARITY_IMPLEMENTATION_2026-06-02.md`

---

## Observability and Governance

### Observability foundations implemented

- execution logs with TTL retention
- prompt execution logs
- cost transaction infrastructure
- backend notifications for users and superadmins
- project-level AI/cost aggregation surfaces

### Governance/admin foundations implemented

- platform config persistence
- governance editors under `/admin/governance`
- registration and email-verification runtime controls
- service/integration management surfaces
- superadmin user operations with block/reset/role management

Important nuance:

- governance data is editable and persisted today
- not every persisted governance field is fully consumed by every generation/publish runtime path

---

## What Is Established vs What Remains Open

### Established enough to treat as current platform behavior

- auth + refresh rotation baseline
- double sandbox project isolation
- layered/preset-aware prompting
- onboarding + style profile + moodboard flow
- chat-preview generation baseline
- WYSIWYG editing baseline
- snapshot versioning and activation
- path-based publish
- Layer 1 ZIP export
- media asset persistence and manifest-backed stock resolution
- dataset asset normalization with persisted profile data in `AssetEnrichmentTrace.structuredData.dataset`
- persisted per-user runtime cache for normalized dataset rows reused across grounded dataset queries
- deterministic dataset queries, grounded insights, and dashboard suggestions for runtime-loaded data assets
- cost/logging/notification infrastructure
- dashboard VibeCore entry and Zero Effort prefill API surface, with classifier-owned template routing and no manual `Auto/Website` selector in the initial chat

### Current open areas

- full browser E2E coverage for the media orchestrator path
- unsupported media manifest strategies (`image_generation`, `project_asset`, `user_library`)
- richer owner/admin observability dashboards on top of existing data
- wildcard subdomain/custom-domain/SSL completion
- unified `/settings` and user-owned API keys

Use `docs/DEVELOPMENT_PLAN.md` for milestone priority and `docs/specs/*` for implementation detail.

---

## Single Source Of Truth Map

- validation contracts: `packages/contracts/src/`
- runtime env contract: `apps/api/src/config.ts`
- runtime topology: `docker-compose.yml`
- docs index: `docs/INDEX.md`
- development state summary: `docs/DEVELOPMENT_PLAN.md`
- agent navigation: `docs/agents/CODE_AGENT_INDEX.md`

---

## LLM Catalog Runtime

- `LLM_CATALOG_SOURCE=env` is the active default
- `LLM_CATALOG_SOURCE=mongo` remains supported for explicit catalog persistence
- supported runtime providers currently include `siliconflow`, `lmstudio`, and `openrouter`

`OPENROUTER_API_KEY` is optional. Without it, free-model exposure still works through the runtime
catalog path when configured.

---

## Tenant Isolation Model

Every mutable user-facing operation must enforce:

1. **User sandbox** via JWT subject
2. **Project sandbox** via `x-project-id` and ownership verification

Pre-project VibeCore operations stay inside the same principle by creating or pinning a real
owned project before downstream billable LLM work continues.

---

## Auth Notes

- refresh tokens are stored only as hashes and rotated
- session-bound `sid` upgrade logic exists for legacy refresh tokens
- legacy accounts may require forced password change after login
- email verification remains runtime-configurable while rollout stays operator-controlled
