# Testable Steps

> Segui i milestone in ordine. Ogni step deve passare prima di procedere al successivo.
> Per il piano completo vedere [`docs/DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md).

---

## BASELINE — Layer 1 già funzionante (✅)

### Step 1 - Health

- `GET /health`
- Expected: `200 { status: "ok", service: "api" }`

### Step 2 - Register

- `POST /v1/auth/register` — body: email, password, firstName, lastName
- Expected: `201 { user, defaultProject }`

### Step 3 - Login

- `POST /v1/auth/login` — body: email, password
- Expected: `200 { accessToken, refreshToken, projects }`

### Step 4 - List Projects

- `GET /v1/projects` — headers: `Authorization: Bearer TOKEN`
- Expected: lista progetti dell'utente autenticato

### Step 5 - Create Project

- `POST /v1/projects` — body: `{ "name": "Test Project" }`
- Expected: `201 { project }`

### Step 6 - Sandbox Check

- `POST /v1/projects/:projectId/sessions` — headers: `x-project-id: PROJECT_ID`
- Expected: `201` se utente è owner, `403` altrimenti

### Step 7 - Seed

- `npm run seed`
- Expected: user `owner@Andy Code Cat.local` + default project creati (idempotente)

### Step 8 - LLM Catalog

- `GET /v1/llm/providers`
- Expected: `200 { source: "env", providers: [...] }`

### Step 9 - LLM Catalog Mongo Seed (opzionale)

- Precondition: `LLM_CATALOG_SOURCE=mongo`
- `npm run seed:llm`
- Expected: upsert idempotente in collection `llm_providers`

### Step 10 - Chat Preview

- `POST /v1/projects/:id/llm/chat-preview`
- body: `{ message: "Crea una landing page per un'agenzia SEO" }`
- Expected: `200 { reply, structured: { chat, artifacts } }`

### Step 11 - Chat Preview Streaming

- `POST /v1/projects/:id/llm/chat-preview/stream`
- Expected: SSE events `thinking` → `answer` → `done`
- Verifica: `done.result.structured.artifacts` contiene `html/css/js`

---

## M0.5 — Focused Asset Control

### Step 12 - Preview Inspect Toggle

- Aprire Workspace con artifacts presenti
- Attivare toggle `Inspect`
- Expected: hover su iframe evidenzia il nodo sotto il mouse; click seleziona il nodo

### Step 13 - Selected Element Metadata

- Con elemento selezionato cliccare `Copia JSON metadati`
- Expected: payload contiene almeno `stableNodeId`, `selector`, `tag`, `classes`

### Step 14 - Focus Context In Prompt

- Cliccare `Usa in prompt` e inviare messaggio tipo "ottimizza questo blocco"
- Expected: request backend include `focusContext.mode = "preview-element"`
- Expected: tracing `messagesSentToLlm` contiene il blocco focus

### Step 15 - Code Selection Focus

- Nelle tab `HTML/CSS/JS`, selezionare un range e inviare prompt
- Expected: request include `focusContext.mode = "code-selection"` + `startLine/endLine`

### Step 16 - Snapshot History

- Inviare 3 prompt consecutivi con modifiche
- Expected: 3 snapshot ordinati per timestamp navigabili da combo box history
- Expected: restore snapshot precedente disponibile

---

## M1 — Context Bridge

### Step 17 - contextStats.atCapacity

- Eseguire 6+ scambi in una conversazione con messaggi lunghi
- Expected: `contextStats.atCapacity === true` nella response

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
- Expected: almeno 2 profili default (`landing-page-standard`, `mini-site-portfolio`)

### Step 21 - Preprompt Test Preview

- `POST /v1/preprompt-profiles/landing-page-standard/test`
- body: `{ prompt: "Landing page per agenzia SEO SpeedRank", projectId: "..." }`
- Expected: `200 { resolvedPrompt, resolvedClaudeMd, resolvedOpenCodeJson, tokenEstimate }`
- Verifica: `resolvedPrompt` non è vuoto e contiene il testo del prompt

### Step 22 - Layer Condizionale

- Creare profilo con layer condizionale `condition: "input.hasPdf == true"`
- Test con `hasPdf: false` → layer NON incluso
- Test con `hasPdf: true` → layer incluso

---

## M3 — GenerationWorker

### Step 23 - BullMQ Queue

- `POST /generate` con Redis disponibile
- Verifica Redis: `EXISTS bull:generation:*`

### Step 24 - Workspace Setup

- Expected: `/data/workspaces/{jobId}/` creata con `opencode.json`, `CLAUDE.md`, `skills/`

### Step 25 - SSE Log Stream

- `GET /v1/jobs/:jobId/logs` (SSE)
- Expected: stream di log da OpenCode stdout
- Verifica: timeout SIGTERM funzionante se OpenCode si blocca

### Step 26 - Generation Completed

- Attendere `job.status === "completed"`
- Expected: `/data/workspaces/{jobId}/dist/index.html` esiste
- Expected: git log mostra commit `iteration-1`

---

## M4 — DeployWorker

### Step 27 - Deploy Job

- `POST /v1/projects/:id/deploy`
- Expected: `202 { deployJobId }`

### Step 28 - Nginx Config

- Expected: `/etc/nginx/sites-available/{slug}.conf` creato
- Verifica: `nginx -t` → OK

### Step 29 - Site Live

- `GET /v1/projects/:id/deployment`
- Expected: `{ status: "live", url: "http://slug.Andy Code Cat.local" }`
- Verifica: `curl http://slug.Andy Code Cat.local` → HTML del sito

### Step 30 - Export ZIP

- `GET /v1/projects/:id/export/zip`
- Expected: ZIP scaricabile con `index.html` dentro

---

## M5 — Credit System

### Step 31 - Insufficient Credits

- Seed user con 0 crediti
- `POST /generate` → `402 { error: "insufficient_credits", required: 6.5, balance: 0 }`

### Step 32 - Credits Deducted

- Seed user con 20 crediti
- Completare una generazione + deploy
- `GET /v1/profile/credits` → balance ridotto (6.5 crediti: 0.5 preprompt + 5 gen + 1 deploy)

### Step 33 - SSE Credits Event

- Durante il job, listener SSE riceve `{ type: "credits_charged", amount: N, balance: M }`
