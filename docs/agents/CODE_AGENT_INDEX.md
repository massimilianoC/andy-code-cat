# CODE_AGENT_INDEX

## What To Read Before Coding

1. `AGENTS.md` — non-negotiable rules, layer boundaries, isolation model
2. `docs/DEVELOPMENT_PLAN.md` — current development plan with milestones and status (R1→R4 active)
3. `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` — current codebase structure
4. `docs/architecture/PIPELINE_LAYERS.md` — 2-layer architecture and transition mechanism
5. `docs/security/SECURITY_BASELINE.md` — auth and isolation baseline
6. `docs/guides/GITFLOW_RELEASE_POLICY.md` — branch governance, release flow, `RELEASE_VERSION`
7. `docs/guides/AGENT_RELEASE_CHECKLIST.md` — operational checklist for branch, commit, merge, release, hotfix
8. `docs/runbooks/TESTABLE_STEPS.md` — testable steps for each milestone
9. `docs/specs/PRESET_TYPED_SPECS.md` — catalog of 9 typed presets with `outputSpec` and `systemPromptModule`
10. `docs/specs/PROMPTING_SERVICE_PLATFORM_SPEC.md` — reusable prompt-task infrastructure, task routing, audit logging, and admin governance for prompt-driven helpers
11. `docs/specs/EXPORT_AND_PUBLISH_SPEC.md` — ZIP export + web publishing specification

---

## Active Development Focus

**R1 - Prompt Architecture Layer** is the current priority milestone.
Goal: structure the system prompt as a composition of 4 layers of architectural constraints.
See `docs/DEVELOPMENT_PLAN.md §2.2` and §R1 for details.

**Key files for R1:**

- `apps/api/src/presentation/http/routes/llmRoutes.ts` — `buildMessagesWithHistory()` (to be modularized)
- `apps/api/src/application/llm/styleContextBuilder.ts` — Layer C already implemented
- `apps/api/src/domain/entities/ProjectPreset.ts` — static preset catalog (Layer B source)
- `docs/specs/PRESET_TYPED_SPECS.md` — full specification of the 9 presets with `systemPromptModule`

---

## Current Codebase State

### Already implemented (do not change without a good reason)

```text
apps/api/src/
  domain/entities/
    User.ts                  ← user with llmPreferences
    Project.ts               ← project with ownerUserId + presetId
    Session.ts               ← refresh token session
    Conversation.ts          ← messages, MessageMetadata, backgroundTasks
    LlmCatalog.ts            ← provider/model catalog
    LlmPromptConfig.ts       ← prePromptTemplate per project
    StyleTag.ts              ← static catalog of 82 tags + VALID_TAG_IDS + MAX_TAGS_PER_CATEGORY
    UserStyleProfile.ts      ← user style profile (10 tag categories + brandBio)
    ProjectMoodboard.ts      ← per-project moodboard (style override + project brief)
    ProjectPreset.ts         ← static catalog of 9 presets with outputSpec + systemPromptModule
    ProjectAsset.ts          ← uploaded asset with source user_upload/platform_generated
    PreviewSnapshot.ts       ← artifact versioning for assistant responses
    ExportRecord.ts          ← ZIP export record with TTL
    GenerationWorkspace.ts   ← generation workspace for the pipeline
    ExecutionLog.ts          ← execution log with TTL 90 days
    SiteDeployment.ts        ← Level 3 publish deployment
    WysiwygEditSession.ts    ← WYSIWYG Edit Light sessions

  application/use-cases/
    RegisterUser.ts / LoginUser.ts
    CreateConversation.ts / AddMessage.ts / GetConversation.ts / GetConversations.ts
    GetLlmCatalog.ts / SeedLlmCatalog.ts
    GetLlmPromptConfig.ts / SetLlmPromptConfig.ts
    LogBackgroundTask.ts
    GetUserStyleProfile.ts / UpdateUserStyleProfile.ts
    GetProjectMoodboard.ts / UpdateProjectMoodboard.ts
    DeleteProject.ts / DuplicateProject.ts
    UploadProjectAsset.ts / ListProjectAssets.ts / DeleteProjectAsset.ts
    ExportLayer1Zip.ts / GetExport.ts
    PrepareGenerationWorkspace.ts
    PublishProject.ts / UnpublishProject.ts

  application/llm/
    styleContextBuilder.ts   ← merge profile+moodboard → "## STYLE CONTEXT" block (Layer C)
    sectionContextExtractor.ts ← section-aware token optimization (40-60% reduction)
    focusedPrompt.ts         ← focused-mode system prompt addendum
    llmPatchMerger.ts        ← 4 merge strategies for focused edit

  presentation/http/routes/
    authRoutes.ts            ← register / login / refresh
    projectRoutes.ts         ← CRUD + sandbox middleware + DELETE + duplicate + moodboard
    conversationRoutes.ts    ← message CRUD + background tasks
    llmRoutes.ts             ← chat-preview + stream + prompt-config + catalog
    previewSnapshotRoutes.ts ← snapshot CRUD + activate + capture
    wysiwygRoutes.ts         ← WYSIWYG edit sessions (create/resume, autosave, commit)
    userProfileRoutes.ts     ← GET /v1/style-tags (public) + GET|PUT /v1/users/me/profile
    publishRoutes.ts         ← Level 3 path-based publish (/p/{publishId})
    assetRoutes.ts           ← upload/list/delete/download asset with double sandbox
    exportRoutes.ts          ← ZIP export Layer 1 + download token
    healthRoutes.ts

  presentation/http/middlewares/
    authMiddleware.ts        ← JWT verify
    sandboxMiddleware.ts     ← x-project-id + ownership check
    errorHandler.ts

  infra/repositories/
    MongoUserStyleProfileRepository.ts
    MongoProjectMoodboardRepository.ts
    MongoProjectAssetRepository.ts
    MongoExportRepository.ts
    MongoSiteDeploymentRepository.ts

  infra/storage/
    IFileStorage.ts          ← port interface
    LocalFileStorage.ts      ← disk-based adapter (DEV)
    MinioFileStorage.ts      ← MinIO/S3 adapter (PROD)
    StorageFactory.ts        ← selects adapter from STORAGE_DRIVER env

  infra/capture/
    PuppeteerCaptureService.ts ← Chromium screenshot JPG/PDF

packages/contracts/src/
  auth.ts / conversation.ts / llm.ts   ← shared Zod schemas
  preview.ts                           ← PreviewSnapshot schemas
  wysiwyg.ts                           ← WysiwygEditSession schemas + DTO
  userProfile.ts                       ← updateUserStyleProfileSchema + UserStyleProfileDto
  moodboard.ts                         ← updateProjectMoodboardSchema + ProjectMoodboardDto

apps/web/app/
  login / register / dashboard / workspace/[projectId]
  onboarding/                          ← 3-step wizard (TagPicker, skip flows, redirect)

apps/web/components/
  TagPicker.tsx                        ← multi-select tag grid by category
  ProjectCard.tsx                      ← project card with thumbnail + ⋮ menu (open/duplicate/delete)
  TipsPanel.tsx                        ← collapsible sidebar with suggestions
  GuideBanner.tsx                      ← onboarding banner with guide videos
  NotificationPanel.tsx                ← Chrome-download style notification panel

apps/web/lib/
  api.ts                               ← all API helper functions
  notifications.tsx                    ← NotificationsProvider + useNotifications()
```

⚠️ **Route ordering in app.ts**: `createUserProfileRoutes()` MUST be registered BEFORE `createProjectRoutes()` — the `projectRoutes` router has a global `router.use(authMiddleware)` that blocks `/v1/style-tags` (public route) if it comes first.

### To build (in priority order)

| Milestone | Component | Dependencies |
| --- | --- | --- |
| M0.5 | Focused Asset Control (`focusContext`, inspect preview, code selection) | ✅ DONE |
| M1 | `contextStats` in the LLM response | none |
| M1 | `Job` entity + `MongoJobRepository` | none |
| M1 | `POST /generate` stub + `GET /jobs/:id` | Job entity |
| M2 | `PrepromptProfile` entity + CRUD | none |
| M2 | `LayerComposer` (Nunjucks + JSONata) | PrepromptProfile |
| M2 | `PrepromptEngine.process()` | LayerComposer |
| M3 | BullMQ setup + `QueueService` | Redis in docker-compose |
| M3 | `GenerationWorker` | BullMQ + PrepromptEngine |
| M3 | `GET /jobs/:id/logs` SSE | GenerationWorker |
| M4a | `ExportRecord` schema + `ExportProjectZip` use-case | M3 (dist/) |
| M4a | `POST /export/zip` + `GET /download/:token` (signed JWT) | ExportProjectZip |
| M4a | Post-processor: separate inline CSS/JS, identify asset placeholders | ExportProjectZip |
| M4b | nginx service in `docker-compose.yml` + `nginx/nginx.conf` + template vhost | none |
| M4b | `NginxController` (dockerode, reload via socket) | nginx in Docker |
| M4b | `SubdomainAllocation` schema + `SiteDeployment` schema | none |
| M4b | `SubdomainGenerator` (wordlist adj×nouns×N, uniqueness) | SubdomainAllocation |
| M4b | `PublishProject` use-case (type: random) + `DeployWorker` | NginxController + schemas |
| M4b | `SubdomainCleanupWorker` (BullMQ repeat every 1h, removes expired items) | DeployWorker |
| M4b | `POST /projects/:id/publish` + `GET /deployments/:id` | PublishProject |
| M4c | `GET /subdomains/check` (uniqueness + blacklist + format) | SubdomainAllocation |
| M4c | extended `PublishProject` use-case (type: reserved, quota check) | M4b |
| M4c | `DELETE /deployments/:id` (release subdomain + nginx cleanup) | M4b |
| M5 | `CreditService` + `CreditTransaction` | Job entity |

---

## Implementation Boundaries

- **Architecture:** Clean Architecture — required flow `presentation → application → domain`, `infra → domain`
- **Contracts:** every HTTP input must be validated with a Zod schema in `packages/contracts/`
- **Isolation:** every mutable operation must pass through `authMiddleware` + `sandboxMiddleware`
- **Secrets:** no hardcoded secrets — use only `process.env.*` via `apps/api/src/config.ts`
- **Queue:** workers must never call HTTP routes directly — they use domain/application use-cases
- **LLM providers:** adding a new provider means adding a `default<Name>Catalog.ts`, updating `GetLlmCatalog`, `SeedLlmCatalog`, `index.ts`, `seed-llm.ts`, and `.env.example`. See `defaultOpenRouterCatalog.ts` as the example.
- **Gitflow:** every git operation must follow `docs/guides/GITFLOW_RELEASE_POLICY.md`; release versioning uses `RELEASE_VERSION`, not `package.json`.

## Do Not Do

- Do not bypass `authMiddleware` in protected routes
- Do not access MongoDB directly from routes (use repositories)
- Do not mix domain logic into infra adapters
- Do not create global state for tenant context
- Do not hardcode secrets in source code
- Do not start jobs without checking available credits (from M5 onward)

## CRITICAL: Docker Stack Safety (read before any Docker command)

There are TWO compose stacks with DIFFERENT MongoDB storage:

- `docker-compose.yml` (dev) → bind mount `./data/mongodb` → separate empty database
- `docker-compose.deploy.yml` (deploy/test) → named volume `site-builder_mongodb_data` → real data

**Absolute rules:**

1. Before any `docker compose` command, verify which stack is active: `docker ps --format '{{.Names}}'`
2. To update env without touching MongoDB/Redis, ALWAYS use `--no-deps`:
   - Deploy stack: `docker compose -f docker-compose.deploy.yml up -d --no-deps api`
   - Dev stack: `docker compose up -d --no-deps api`
3. NEVER use `docker compose up -d api` without `--no-deps` — it recreates all dependencies.
4. NEVER mix the dev compose file with the deploy stack, or vice versa.
5. `npm run docker:test` / `docker:test:nocache` rebuild the deploy stack — DO NOT run them without explicit user confirmation.

## LLM Provider Config - Runtime Only, No Seed Required

With `LLM_CATALOG_SOURCE=env` (active by default), the provider/model catalog is read from env at runtime.
`seed-llm.ts` is not needed unless you explicitly switch to `LLM_CATALOG_SOURCE=mongo`.
To change token limits or API keys: edit `.env.docker` + run `docker compose -f docker-compose.deploy.yml up -d --no-deps api`.

---

## Patterns To Follow For New Modules

### New entity (for example, Job)

```text
domain/entities/Job.ts                    ← pure TypeScript interface
domain/repositories/JobRepository.ts     ← repository interface
infra/repositories/MongoJobRepository.ts ← Mongoose implementation
application/use-cases/CreateJob.ts       ← use case
presentation/http/routes/jobRoutes.ts    ← HTTP route
packages/contracts/src/job.ts            ← Zod schema
```

### New BullMQ worker

```text
application/workers/GenerationWorker.ts  ← worker logic (uses domain + infra)
application/services/QueueService.ts     ← BullMQ initialization
```

Workers must:

1. Update `Job.status` at each state change
2. Emit SSE events via `JobEventEmitter`
3. Charge credits before each stage
4. Handle timeouts with SIGTERM + SIGKILL
5. Write structured logs (pino)

---

## Seed Requirements

The seed script (`npm run seed`) must remain idempotent and create:

- A default owner user
- A default project for that user
- From M2 onward: at least 2 default preprompt profiles (`landing-page-standard`, `mini-site-portfolio`)
- From M5 onward: initial credit balance for the seed user (for example, 50 credits)
