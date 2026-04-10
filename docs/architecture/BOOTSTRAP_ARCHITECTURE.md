# Bootstrap Architecture

## Services

- **web**: Next.js 15 App Router — UI client
- **api**: Express + TypeScript — backend API (Clean Architecture)
- **mongodb**: database primario (porta host 27018)
- **redis**: cache + BullMQ queue (porta host 6380)
- **workspace**: container per OpenCode worker (da aggiungere in M3)

## Clean Architecture Map (API)

```
apps/api/src/
  domain/          ← entità pure TypeScript + interfacce repository (zero dipendenze esterne)
  application/     ← use-cases + orchestrazione (dipende solo da domain)
  infra/           ← Mongoose adapters + bcrypt + JWT (implementa interfacce domain)
  presentation/    ← Express routes + middleware (chiama application)
```

Flusso obbligatorio: `presentation → application → domain`, `infra → domain`

## What Is Built

### Domain entities (✅)

- `User` — con `llmPreferences.defaultProvider`
- `Project` — con `ownerUserId` per sandbox
- `Session` — refresh token (solo hash in DB)
- `Conversation` + `Message` + `MessageMetadata` + `BackgroundTask`
- `LlmCatalog` — provider/model registry
- `LlmPromptConfig` — prePromptTemplate per progetto
- `StyleTag` — catalog statico 82 tag, 10 categorie (identity, sector, audience, visual, palette, typography, layout, tone, reference, feature)
- `UserStyleProfile` — profilo stilistico utente con onboarding state
- `ProjectMoodboard` — override stilistico per progetto + brief + targetBusiness

### Application use-cases (✅)

- Auth: `RegisterUser`, `LoginUser`
- Projects: via routes dirette
- Conversations: `CreateConversation`, `AddMessage`, `GetConversation`, `GetConversations`, `LogBackgroundTask`
- LLM: `GetLlmCatalog`, `SeedLlmCatalog`, `GetLlmPromptConfig`, `SetLlmPromptConfig`
- Style profiling: `GetUserStyleProfile`, `UpdateUserStyleProfile`
- Moodboard: `GetProjectMoodboard`, `UpdateProjectMoodboard`
- Project ops: `DeleteProject`, `DuplicateProject`

### API routes (✅)

- `GET /health`
- `POST /v1/auth/register` · `POST /v1/auth/login`
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
- `GET /v1/style-tags` (public — no auth)
- `GET|PUT /v1/users/me/profile`
- `GET|PUT /v1/projects/:id/moodboard`

⚠️ **Route ordering**: `createUserProfileRoutes()` deve essere registrata PRIMA di `createProjectRoutes()` in `app.ts`. Il router di projectRoutes ha `router.use(authMiddleware)` che si applica a TUTTI i path che entrano nel router, incluso `/v1/style-tags` se fosse il primo a ricevere la richiesta.

### Frontend screens (✅)

- `/login` · `/register` (con redirect a /login?registered=1 dopo registrazione)
- `/dashboard` — ProjectCard grid + GuideBanner + TipsPanel + toast
- `/onboarding` — wizard 3-step con TagPicker (stili utente)
- `/workspace/[projectId]` — split-panel: chat + preview iframe

### Frontend components (✅)

- `TagPicker` — multi-select griglia tag per categoria
- `ProjectCard` — card con thumbnail colorata + menu ⋮ (Apri / Duplica / Elimina / Copia Prompt)
- `TipsPanel` — sidebar collassabile, suggerimenti, localStorage seen-tracking, badge non letti
- `GuideBanner` — banner con video guida, apre `VideoModal`
- `VideoModal` — modal YouTube embedded

### Storage adapters (✅)

- `IFileStorage` — port interface (upload / getSignedUrl / delete)
- `LocalFileStorage` — disk-based (DEV, `STORAGE_DRIVER=local`)
- `MinioFileStorage` — MinIO/S3 (PROD, `STORAGE_DRIVER=minio`)
- `StorageFactory` — seleziona adapter da env

### Layer 1 — Chat Preview (✅)

- Streaming SSE con eventi `thinking` / `answer` / `done`
- History injection (ultimi N turni, budget 6000 token)
- Artifact context injection (HTML/CSS/JS precedenti)
- Structured JSON response: `{ chat: { summary, bullets, nextActions }, artifacts: { html, css, js } }`
- `contextStats: { estimatedTokens, historyTurns, atCapacity }` (da aggiungere in M1)

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
- Development milestones: `docs/DEVELOPMENT_PLAN.md`

## LLM Catalog Bootstrap

- `LLM_CATALOG_SOURCE=env` (default) — catalog da codice, nessun seed richiesto
- `LLM_CATALOG_SOURCE=mongo` — catalog da collection `llm_providers`
- Seed: `npm run seed:llm` (idempotente)

### Provider registrati

| Provider | Auth | Nota |
|---|---|---|
| `siliconflow` | Bearer (`SILICONFLOW_API_KEY`) | Discovery filtra modelli image/video gen per ID |
| `lmstudio` | none | Modello locale, nessuna chiave richiesta |
| `openrouter` | Bearer (`OPENROUTER_API_KEY`) | Discovery filtra per `architecture.modality` → solo `->text`; modelli `:free` senza crediti |

`OPENROUTER_API_KEY` è opzionale: senza chiave il catalog espone i modelli free di default.
Con chiave vengono registrati anche i modelli paid e la discovery live restituisce l'intera libreria filtrata.

## Tenant Isolation Model (Double Sandbox)

1. **User sandbox**: JWT subject (`authMiddleware`)
2. **Project sandbox**: `x-project-id` header + `project.ownerUserId === jwt.sub` (`sandboxMiddleware`)

Entrambi i check sono obbligatori su ogni route mutabile.
In Layer 2, il workspace filesystem rispetta lo stesso modello:
`/data/workspaces/{jobId}/` è isolato per job, `/var/www/Andy Code Cat/{slug}/` per progetto.
