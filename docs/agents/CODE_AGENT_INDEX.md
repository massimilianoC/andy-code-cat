# CODE_AGENT_INDEX

## What To Read Before Coding

1. `AGENTS.md` — regole non negoziabili, layer boundaries, isolation model
2. `docs/DEVELOPMENT_PLAN.md` — piano di sviluppo corrente con milestone e stato (R1→R4 attivi)
3. `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` — struttura del codebase attuale
4. `docs/architecture/PIPELINE_LAYERS.md` — architettura a 2 layer e meccanismo di transizione
5. `docs/security/SECURITY_BASELINE.md` — baseline auth e isolamento
6. `docs/runbooks/TESTABLE_STEPS.md` — step testabili per ogni milestone
7. `docs/specs/PRESET_TYPED_SPECS.md` — catalogo 9 preset tipizzati con outputSpec e systemPromptModule
8. `docs/specs/EXPORT_AND_PUBLISH_SPEC.md` — spec ZIP Export + Web Publishing

---

## Active Development Focus

**R1 — Prompt Architecture Layer** è la milestone attiva prioritaria.
Obiettivo: strutturare il system prompt come composizione di 4 layer di vincoli architetturali.
Vedere `docs/DEVELOPMENT_PLAN.md §2.2` e §R1 per i dettagli.

**File chiave per R1:**

- `apps/api/src/presentation/http/routes/llmRoutes.ts` — `buildMessagesWithHistory()` (da modularizzare)
- `apps/api/src/application/llm/styleContextBuilder.ts` — Layer C già implementato
- `apps/api/src/domain/entities/ProjectPreset.ts` — catalogo statico preset (Layer B source)
- `docs/specs/PRESET_TYPED_SPECS.md` — spec completa dei 9 preset con systemPromptModule

---

## Current Codebase State

### Già implementato (non toccare senza motivo)

```
apps/api/src/
  domain/entities/
    User.ts                  ← user con llmPreferences
    Project.ts               ← project con ownerUserId + presetId
    Session.ts               ← refresh token session
    Conversation.ts          ← messages, MessageMetadata, backgroundTasks
    LlmCatalog.ts            ← provider/model catalog
    LlmPromptConfig.ts       ← prePromptTemplate per progetto
    StyleTag.ts              ← catalog statico 82 tag + VALID_TAG_IDS + MAX_TAGS_PER_CATEGORY
    UserStyleProfile.ts      ← profilo stilistico utente (10 categorie tag + brandBio)
    ProjectMoodboard.ts      ← moodboard per-progetto (override stile + brief progetto)
    ProjectPreset.ts         ← catalog statico 9 preset con outputSpec + systemPromptModule
    ProjectAsset.ts          ← asset upload con source user_upload/platform_generated
    PreviewSnapshot.ts       ← versioning artefatti per risposta assistant
    ExportRecord.ts          ← ZIP export record con TTL
    GenerationWorkspace.ts   ← workspace di generazione per pipeline
    ExecutionLog.ts          ← log esecuzione con TTL 90gg
    SiteDeployment.ts        ← Level 3 publish deployment
    WysiwygEditSession.ts    ← sessioni Edit Light WYSIWYG

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
    sectionContextExtractor.ts ← section-aware token optimization (40-60% riduzione)
    focusedPrompt.ts         ← focused-mode system prompt addendum
    llmPatchMerger.ts        ← 4 merge strategies per focused edit

  presentation/http/routes/
    authRoutes.ts            ← register / login / refresh
    projectRoutes.ts         ← CRUD + sandbox middleware + DELETE + duplicate + moodboard
    conversationRoutes.ts    ← CRUD messaggi + background tasks
    llmRoutes.ts             ← chat-preview + stream + prompt-config + catalog
    previewSnapshotRoutes.ts ← snapshot CRUD + activate + capture
    wysiwygRoutes.ts         ← WYSIWYG edit sessions (create/resume, autosave, commit)
    userProfileRoutes.ts     ← GET /v1/style-tags (public) + GET|PUT /v1/users/me/profile
    publishRoutes.ts         ← Level 3 path-based publish (/p/{publishId})
    assetRoutes.ts           ← upload/list/delete/download asset con double sandbox
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
    StorageFactory.ts        ← seleziona adapter da env STORAGE_DRIVER

  infra/capture/
    PuppeteerCaptureService.ts ← Chromium screenshot JPG/PDF

packages/contracts/src/
  auth.ts / conversation.ts / llm.ts   ← Zod schemas condivisi
  preview.ts                           ← PreviewSnapshot schemas
  wysiwyg.ts                           ← WysiwygEditSession schemas + DTO
  userProfile.ts                       ← updateUserStyleProfileSchema + UserStyleProfileDto
  moodboard.ts                         ← updateProjectMoodboardSchema + ProjectMoodboardDto

apps/web/app/
  login / register / dashboard / workspace/[projectId]
  onboarding/                          ← wizard 3-step (TagPicker, skip flows, redirect)

apps/web/components/
  TagPicker.tsx                        ← multi-select tag grid per categoria
  ProjectCard.tsx                      ← card progetto con thumbnail + menu ⋮ (apri/duplica/elimina)
  TipsPanel.tsx                        ← sidebar collassabile con suggerimenti
  GuideBanner.tsx                      ← banner onboarding con video guide
  NotificationPanel.tsx                ← Chrome-download style notification panel

apps/web/lib/
  api.ts                               ← tutte le funzioni API helper
  notifications.tsx                    ← NotificationsProvider + useNotifications()
```

⚠️ **Route ordering in app.ts**: `createUserProfileRoutes()` DEVE essere registrata PRIMA di `createProjectRoutes()` — il router di projectRoutes ha un `router.use(authMiddleware)` globale che blocca `/v1/style-tags` (rotta pubblica) se viene prima.

### Da costruire (in ordine di priorità)

| Milestone | Componente | Dipendenze |
|---|---|---|
| M0.5 | Focused Asset Control (`focusContext`, inspect preview, code selection) | ✅ DONE |
| M1 | `contextStats` nel LLM response | nessuna |
| M1 | `Job` entity + `MongoJobRepository` | nessuna |
| M1 | `POST /generate` stub + `GET /jobs/:id` | Job entity |
| M2 | `PrepromptProfile` entity + CRUD | nessuna |
| M2 | `LayerComposer` (Nunjucks + JSONata) | PrepromptProfile |
| M2 | `PrepromptEngine.process()` | LayerComposer |
| M3 | BullMQ setup + `QueueService` | Redis in docker-compose |
| M3 | `GenerationWorker` | BullMQ + PrepromptEngine |
| M3 | `GET /jobs/:id/logs` SSE | GenerationWorker |
| M4a | `ExportRecord` schema + `ExportProjectZip` use-case | M3 (dist/) |
| M4a | `POST /export/zip` + `GET /download/:token` (signed JWT) | ExportProjectZip |
| M4a | Post-processor: separa CSS/JS inline, identifica placeholder asset | ExportProjectZip |
| M4b | nginx service in `docker-compose.yml` + `nginx/nginx.conf` + template vhost | nessuna |
| M4b | `NginxController` (dockerode, reload via socket) | nginx in Docker |
| M4b | `SubdomainAllocation` schema + `SiteDeployment` schema | nessuna |
| M4b | `SubdomainGenerator` (wordlist adj×nouns×N, unicità) | SubdomainAllocation |
| M4b | `PublishProject` use-case (type: random) + `DeployWorker` | NginxController + schemas |
| M4b | `SubdomainCleanupWorker` (BullMQ repeat 1h, rimuove expired) | DeployWorker |
| M4b | `POST /projects/:id/publish` + `GET /deployments/:id` | PublishProject |
| M4c | `GET /subdomains/check` (unicità + blacklist + formato) | SubdomainAllocation |
| M4c | `PublishProject` use-case esteso (type: reserved, quota check) | M4b |
| M4c | `DELETE /deployments/:id` (rilascio subdomain + cleanup nginx) | M4b |
| M5 | `CreditService` + `CreditTransaction` | Job entity |

---

## Implementation Boundaries

- **Architecture:** Clean Architecture — flusso obbligatorio `presentation → application → domain`, `infra → domain`
- **Contracts:** ogni input da HTTP va validato con schema Zod in `packages/contracts/`
- **Isolation:** ogni operazione mutabile deve passare per `authMiddleware` + `sandboxMiddleware`
- **Secrets:** nessun secret hardcoded — solo `process.env.*` via `apps/api/src/config.ts`
- **Queue:** i worker non chiamano mai direttamente HTTP routes — usano use-cases del domain
- **LLM providers:** aggiungere un nuovo provider = aggiungere un `default<Name>Catalog.ts`, aggiornare `GetLlmCatalog`, `SeedLlmCatalog`, `index.ts`, `seed-llm.ts`, e `.env.example`. Vedere `defaultOpenRouterCatalog.ts` come esempio.

## Do Not Do

- Non bypassare `authMiddleware` in route protette
- Non accedere a MongoDB direttamente dalle route (usare repository)
- Non mescolare logica di dominio negli adapter infra
- Non creare stato globale per il contesto tenant
- Non hardcodare segreti nel codice sorgente
- Non avviare job senza verificare crediti disponibili (da M5 in poi)

## CRITICAL: Docker Stack Safety (leggere prima di qualsiasi comando docker)

Esistono DUE stack compose con storage MongoDB DIVERSO:

- `docker-compose.yml` (dev) → bind mount `./data/mongodb` → database vuoto separato
- `docker-compose.deploy.yml` (deploy/test) → named volume `site-builder_mongodb_data` → dati reali

**Regole assolute:**

1. Prima di qualsiasi `docker compose` verificare quale stack è attivo: `docker ps --format '{{.Names}}'`
2. Per aggiornare env senza toccare MongoDB/Redis usare SEMPRE `--no-deps`:
   - Deploy stack: `docker compose -f docker-compose.deploy.yml up -d --no-deps api`
   - Dev stack: `docker compose up -d --no-deps api`
3. MAI usare `docker compose up -d api` senza `--no-deps` — ricrea tutte le dipendenze.
4. MAI mischiare il dev compose sul deploy stack e viceversa.
5. `npm run docker:test` / `docker:test:nocache` ricostriscono il deploy stack — NON eseguirli senza conferma esplicita dell'utente.

## LLM Provider Config — Solo Runtime, Nessun Seed Necessario

Con `LLM_CATALOG_SOURCE=env` (default attivo) il catalogo provider/modelli è letto da env a runtime.
Non serve `seed-llm.ts` salvo switch esplicito a `LLM_CATALOG_SOURCE=mongo`.
Per modificare token limit o API key: editare `.env.docker` + `docker compose -f docker-compose.deploy.yml up -d --no-deps api`.

---

## Pattern da seguire per nuovi moduli

### Nuovo entity (es. Job)

```
domain/entities/Job.ts                    ← interfaccia TypeScript pura
domain/repositories/JobRepository.ts     ← interfaccia repository
infra/repositories/MongoJobRepository.ts ← implementazione Mongoose
application/use-cases/CreateJob.ts       ← use case
presentation/http/routes/jobRoutes.ts    ← route HTTP
packages/contracts/src/job.ts            ← schema Zod
```

### Nuovo worker BullMQ

```
application/workers/GenerationWorker.ts  ← logica worker (usa domain + infra)
application/services/QueueService.ts     ← inizializzazione BullMQ
```

I worker devono:

1. Aggiornare `Job.status` ad ogni cambio stato
2. Emettere eventi SSE via `JobEventEmitter`
3. Addebitare crediti prima di ogni stage
4. Gestire timeout con SIGTERM + SIGKILL
5. Scrivere log strutturati (pino)

---

## Seed Requirements

Il seed script (`npm run seed`) deve rimanere idempotente e creare:

- Un utente owner di default
- Un progetto di default per quell'utente
- Da M2: almeno 2 profili preprompt default (`landing-page-standard`, `mini-site-portfolio`)
- Da M5: saldo crediti iniziale per l'utente seed (es. 50 crediti)
