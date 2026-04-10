# Andy Code Cat — Workflow Automatici: Specifiche

> **Scope:** Definizione completa di tutti i workflow automatici del sistema  
> **Riferimento:** si integra con SPEC.md §6, ROADMAP.md, PREPROMPT_ENGINE_SPEC.md  
> **Notazione:** usa pseudocodice + diagrammi ASCII per descrivere i flussi

---

## Indice Workflow

| ID | Nome | Trigger | Fase |
|---|---|---|---|
| WF-01 | First Generation | `POST /generate` | MVP |
| WF-02 | Refinement | `POST /refine` | MVP |
| WF-03 | Auto-Deploy Post-Gen | Completamento WF-01/02 | MVP |
| WF-04 | Image Placeholder MVP | Post generazione | MVP |
| WF-05 | Export ZIP | `GET /export/zip` | MVP |
| WF-06 | Export Nginx Config | `GET /export/nginx` | MVP |
| WF-07 | Image Generation Reale | Post WF-04 | Phase 2 |
| WF-08 | Audit Post-Gen | Post ogni generazione | Phase 2 |
| WF-09 | Rollback Iterazione | `POST /iterations/:n/restore` | Phase 2 |
| WF-10 | Webhook Delivery | Ogni cambio status job | MVP |

---

## WF-01 — First Generation

**Trigger:** `POST /api/v1/projects/:slug/generate`  
**Precondizioni:** progetto esistente, nessun job `active` in corso per il progetto  
**Output:** sito web in dist/, git commit, deploy (se configurato)

```
CLIENT
  │
  ├─→ POST /projects/:slug/generate
  │     body: { prompt, attachments?, prepromptProfileId?, aiConfigOverride? }
  │
API HANDLER
  │
  ├─ Validate request (Zod schema)
  ├─ Load Project from MongoDB
  ├─ Check no active job for this project → 409 se già in corso
  ├─ Resolve PrepromptProfile:
  │    prepromptProfileId in body → usa quello
  │    altrimenti → usa project.aiConfig.prepromptProfileId
  │    altrimenti → usa profilo default del sistema
  │
  ├─ Save Attachment files (PDF/immagini) → /data/uploads/{jobId}/
  ├─ Create Job document (MongoDB):
  │    { type: 'generation', status: 'waiting', projectId, input: {...} }
  │
  ├─ Add to BullMQ queue 'generation' (priority: normal)
  │
  └─→ Response 202: { jobId, status: 'queued', pollUrl: '/jobs/{jobId}' }

──────────────────────────────────────────────────── (asincrono da qui)

GENERATION WORKER (BullMQ)
  │
  ├─ [STATUS: active] Update Job in MongoDB
  ├─ Update Project.status = 'generating'
  │
  ├─ PREPROMPT ENGINE (vedi PREPROMPT_ENGINE_SPEC.md §3)
  │   ├─ InputProcessor: estrai testo PDF, descrivi immagini
  │   ├─ ContextBuilder: assembla TemplateContext
  │   ├─ LayerComposer: applica layer profilo → resolvedPrompt
  │   ├─ ClaudeMdGenerator: genera CLAUDE.md
  │   └─ OpenCodeConfigGenerator: genera opencode.json
  │
  ├─ WORKSPACE SETUP
  │   ├─ mkdir /data/workspaces/{jobId}/
  │   ├─ Write opencode.json
  │   ├─ Write CLAUDE.md
  │   ├─ Write AGENTS.md (copia da config/opencode-skills/AGENTS.md)
  │   └─ mkdir .Andy Code Cat/skills/ + copia skill files
  │
  ├─ GIT SETUP
  │   ├─ Se prima iterazione: git init + remote → Gitea repo del progetto
  │   ├─ Se iterazione successiva: git clone repo esistente
  │   └─ git checkout -b iteration-{N}
  │
  ├─ OPENCODE EXECUTION
  │   ├─ Spawn processo:
  │   │   opencode run
  │   │     --model {provider}/{model}
  │   │     --agent Andy Code Cat-builder
  │   │     --dangerously-skip-permissions
  │   │     "{resolvedPrompt}"
  │   │   cwd: /data/workspaces/{jobId}/
  │   │   env: { provider API key, ... }
  │   │
  │   ├─ Monitor stdout/stderr:
  │   │   ├─ Ogni riga → append a job log file
  │   │   ├─ Ogni riga → emit SSE event (se client connesso)
  │   │   ├─ Aggiorna Job.progress ogni 10s (heuristic: file count in dist/)
  │   │   └─ Timeout: OPENCODE_TIMEOUT_MS (default 600s)
  │   │
  │   ├─ Su exit code 0 → continua
  │   └─ Su exit code != 0 o timeout → FAIL HANDLING (vedi §Error Handling)
  │
  ├─ POST-PROCESSING
  │   ├─ Verifica dist/index.html esiste → fallisce job se mancante
  │   ├─ Verifica dist/MANIFEST.json esiste:
  │   │   ├─ Esiste → parse e valida
  │   │   └─ Non esiste → genera MANIFEST.json minimale dal filesystem
  │   ├─ Estrai ImagePlaceholder[] da:
  │   │   ├─ MANIFEST.json se presente
  │   │   └─ Scan HTML per commenti IMAGE_PLACEHOLDER
  │   ├─ Copia dist/ → /var/www/{slug}/ (staging, non ancora live)
  │   │
  │   ├─ GIT COMMIT
  │   │   ├─ git add dist/
  │   │   ├─ git commit -m "iteration-{N}: {first 100 chars of user prompt}"
  │   │   └─ git push origin iteration-{N}
  │   │
  │   └─ Aggiorna Job:
  │       { status: 'completed', output: { outputDir, filesGenerated, imagePlaceholders, gitCommitHash } }
  │
  ├─ Aggiorna Project: { status: 'generated', iterationCount: N, lastGeneratedAt }
  │
  ├─ Enqueue IMAGE_GEN job (queue 'image-gen', priority: low)
  │
  ├─ Se project.deployment.mode in ['subdomain', 'custom_domain']:
  │   └─ Enqueue DEPLOY job (queue 'deploy', priority: normal)
  │
  └─ Emit Webhook: job.completed (vedi WF-10)
```

### WF-01 Error Handling

```
OpenCode timeout (>600s):
  ├─ SIGTERM al processo
  ├─ Attendi 5s grace period
  ├─ SIGKILL se ancora vivo
  ├─ Controlla se dist/ ha output parziale:
  │   ├─ dist/index.html esiste → marca job come 'partial', continua con quello che c'è
  │   └─ dist/index.html mancante → retry (max 2 volte con backoff esponenziale)
  └─ Dopo 3 tentativi falliti → job.status = 'failed', notify via webhook

OpenCode exit code != 0:
  └─ Stesso handling del timeout

dist/index.html mancante dopo completamento:
  ├─ Log dettagliato del contenuto dist/
  ├─ Salva comunque output in git (branch 'iteration-{N}-partial')
  └─ Job failed con errore descrittivo

Provider API error (401, 429, 500):
  ├─ 401 → job.status = 'failed', messaggio: "API key non valida per {provider}"
  ├─ 429 → retry dopo backoff (1min, 5min, 15min)
  └─ 500 → retry dopo 30s (max 3 tentativi)
```

---

## WF-02 — Refinement

**Trigger:** `POST /api/v1/projects/:slug/refine`  
**Precondizioni:** almeno una generazione completata per il progetto  
**Differenza da WF-01:** usa `Andy Code Cat-refiner`, ha contesto iterazione precedente

```
[Identico a WF-01 fino a OPENCODE EXECUTION, con queste differenze:]

GIT SETUP (differente):
  ├─ git clone repo progetto in /data/workspaces/{jobId}/
  ├─ git checkout iteration-{N-1} (ultima iterazione completata)
  ├─ Copia stato attuale dist/ nella working dir
  └─ git checkout -b iteration-{N}

CONTEXT BUILDING (differente):
  ├─ iteration.isFirstGeneration = false
  ├─ iteration.previousManifest = leggi dist/MANIFEST.json attuale
  ├─ iteration.changesRequested = body.prompt
  └─ layer profilo 'refine-standard' applicati (non 'landing-page-standard')

OPENCODE (differente):
  └─ --agent Andy Code Cat-refiner (non Andy Code Cat-builder)

POST-PROCESSING (identico a WF-01)
```

---

## WF-03 — Auto-Deploy Post-Generazione

**Trigger:** automatico alla fine di WF-01 o WF-02 (se deployment.mode != 'zip_export')  
**Precondizioni:** output in /var/www/{slug}/ (staging copiato da WF-01)

```
DEPLOY WORKER (BullMQ queue 'deploy')
  │
  ├─ Load Project e ultimo Deployment (se esiste)
  │
  ├─ NGINX CONFIG GENERATION
  │   ├─ Renderizza template nginx (Nunjucks) con:
  │   │   ├─ server_name: {slug}.Andy Code Cat.io (o custom domain)
  │   │   ├─ root: /var/www/{slug}/
  │   │   └─ ssl: paths certificati (se già esistenti)
  │   └─ Salva in /etc/nginx/sites-available/Andy Code Cat-{slug}.conf
  │
  ├─ NGINX TEST
  │   ├─ Esegui: nginx -t
  │   ├─ Exit 0 → continua
  │   └─ Exit != 0 → ROLLBACK:
  │       ├─ Rimuovi config appena scritta
  │       ├─ Ripristina config precedente (se esisteva)
  │       ├─ nginx -t + nginx reload (per sicurezza)
  │       └─ Deploy job failed
  │
  ├─ SYMLINK SITES-ENABLED (se non esiste)
  │   └─ ln -s sites-available/Andy Code Cat-{slug}.conf sites-enabled/
  │
  ├─ NGINX RELOAD
  │   └─ nginx reload (graceful, zero-downtime)
  │
  ├─ SSL — CERTBOT
  │   ├─ Controlla se certificato esiste già per questo domain
  │   ├─ Esiste ed è valido → skip
  │   ├─ Esiste ed è in scadenza (<30gg) → certbot renew
  │   └─ Non esiste → certbot --nginx -d {domain} --non-interactive --agree-tos
  │       ├─ Successo → nginx reload con SSL attivo
  │       └─ Fallisce (es. DNS non ancora propagato):
  │           ├─ Sito rimane live su HTTP
  │           └─ Schedula retry SSL dopo 15 minuti (BullMQ delayed job)
  │
  ├─ HEALTH CHECK
  │   ├─ HTTP GET https://{domain}/
  │   ├─ 200 → deploy completato
  │   └─ Non 200 → log warning, deployment comunque salvato
  │
  ├─ Salva Deployment MongoDB:
  │   { nginxConfig, publishedAt, isActive: true }
  ├─ Aggiorna Project.status = 'live', deployment.publishedUrl
  │
  └─ Emit Webhook: deploy.live
```

---

## WF-04 — Image Placeholder MVP

**Trigger:** automatico dopo WF-01/02 (sempre, indipendentemente da IMAGE_GEN_PROVIDER)  
**Obiettivo MVP:** sostituire placeholder con SVG ottimizzati placeholder, non immagini reali

```
IMAGE WORKER — MVP MODE (IMAGE_GEN_PROVIDER = 'disabled')
  │
  ├─ Leggi Job.output.imagePlaceholders[]
  │
  ├─ Per ogni placeholder:
  │   ├─ Determina tipo immagine dal nome file:
  │   │   ├─ hero-* → placeholder 1200x600 landscape
  │   │   ├─ icon-* → placeholder 80x80 square
  │   │   ├─ team-* / person-* → placeholder 400x400 square
  │   │   ├─ feature-* → placeholder 600x400 landscape
  │   │   └─ default → placeholder 800x450 landscape
  │   │
  │   ├─ Genera SVG placeholder:
  │   │   ├─ Background: colore neutro coerente con primaryColor del progetto
  │   │   ├─ Icona centrale: emoji/SVG path contestuale al tipo
  │   │   ├─ Testo: breve descrizione (max 40 char da placeholder description)
  │   │   └─ Dimensioni: corrette per il tipo
  │   │
  │   ├─ Salva SVG in dist/images/{filename} (con estensione .svg o converti in PNG via sharp)
  │   └─ Aggiorna il src nel HTML se necessario (e.g. .jpg → .svg)
  │
  ├─ Genera dist/IMAGE_PROMPTS.json (chiama Andy Code Cat-image-prompt-gen via OpenCode)
  │   └─ Questo file è pronto per Phase 2 (image gen reale)
  │
  ├─ Git commit: "iteration-{N}: add image placeholders"
  │
  └─ Se deploy già schedulato: triggera re-deploy per includere le immagini
```

**Struttura SVG Placeholder Generato:**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <rect width="100%" height="100%" fill="{bgColor}"/>
  <rect x="10" y="10" width="{w-20}" height="{h-20}" 
        fill="none" stroke="{borderColor}" stroke-width="2" stroke-dasharray="8,4" rx="8"/>
  <text x="50%" y="45%" text-anchor="middle" font-family="system-ui" 
        font-size="{fontSize}" fill="{textColor}" opacity="0.6">
    {emoji}
  </text>
  <text x="50%" y="60%" text-anchor="middle" font-family="system-ui" 
        font-size="14" fill="{textColor}" opacity="0.5">
    {shortDescription}
  </text>
  <text x="50%" y="72%" text-anchor="middle" font-family="system-ui" 
        font-size="11" fill="{textColor}" opacity="0.35">
    {w}×{h}
  </text>
</svg>
```

---

## WF-05 — Export ZIP

**Trigger:** `GET /api/v1/projects/:slug/export/zip`  
**Tipo:** sincrono (risposta diretta) per file < 50MB, asincrono per file > 50MB

```
EXPORT ZIP HANDLER
  │
  ├─ Verifica progetto esiste e ha almeno una generazione completata
  ├─ Verifica autorizzazione (owner o API client con permesso export)
  │
  ├─ Controlla cache: esiste un export ZIP recente (<1h)?
  │   ├─ Sì → restituisci signed URL esistente
  │   └─ No → genera nuovo ZIP
  │
  ├─ ZIP GENERATION
  │   ├─ Source: /var/www/{slug}/ (output deployato)
  │   ├─ Include: tutto (HTML, CSS, JS, images, assets)
  │   ├─ Escludi: AUDIT.json, file temporanei (.DS_Store, ecc.)
  │   ├─ Aggiungi in root ZIP:
  │   │   ├─ README.md (istruzioni deploy, struttura file)
  │   │   └─ nginx-sample.conf (config nginx campione per self-hosting)
  │   └─ Salva in /data/exports/{slug}-{timestamp}.zip
  │
  ├─ Genera signed URL:
  │   └─ JWT: { path: '/data/exports/...zip', exp: now + 3600 }
  │       → /api/v1/download/{token}
  │
  ├─ Salva Deployment.exportPackage in MongoDB
  │
  └─ Response: { downloadUrl, expiresAt, sizeBytes, filename }

DOWNLOAD ENDPOINT: GET /api/v1/download/:token
  ├─ Verifica e decodifica JWT
  ├─ Verifica file esiste
  ├─ Content-Disposition: attachment; filename="{slug}-site.zip"
  └─ Stream file → client
```

---

## WF-06 — Export Nginx Config

**Trigger:** `GET /api/v1/projects/:slug/export/nginx`  
**Tipo:** sincrono, risposta diretta

```
NGINX EXPORT HANDLER
  │
  ├─ Verifica progetto esiste e ha almeno una generazione
  ├─ Load ultimo Deployment da MongoDB (se esiste)
  │
  ├─ Genera nginx.conf (se non già in Deployment):
  │   └─ Renderizza template (vedi SPEC.md §9) con:
  │       ├─ server_name: {deployment.domain}
  │       ├─ root: /var/www/{slug}/ → sostituito con path scelto dal client
  │       └─ Nota nel file: "# Sostituisci /var/www/{slug}/ con il tuo webroot"
  │
  ├─ Genera anche dns-instructions.md:
  │   ├─ Istruzioni per record A (punta a IP del server Andy Code Cat)
  │   ├─ Istruzioni per record CNAME (alternativa)
  │   └─ Istruzioni certbot per SSL sul server cliente
  │
  └─ Response:
      Content-Type: text/plain
      Content-Disposition: attachment; filename="nginx-{slug}.conf"
      Body: [contenuto nginx.conf]
```

**nginx.conf esportato — variabili da sostituire chiaramente commentate:**

```nginx
# Andy Code Cat Export — nginx.conf per {project.name}
# 
# ISTRUZIONI:
# 1. Sostituisci WEBROOT con il path dove hai estratto il file ZIP
# 2. Sostituisci YOURDOMAIN con il tuo dominio
# 3. Esegui: sudo certbot --nginx -d YOURDOMAIN
# 4. Esegui: sudo nginx -t && sudo systemctl reload nginx
#
# DNS: Crea un record A per YOURDOMAIN che punta a {serverIp}

server {
    listen 80;
    server_name YOURDOMAIN;      # <-- sostituisci
    root WEBROOT;                # <-- sostituisci con path ZIP estratto
    index index.html;
    
    location / {
        try_files $uri $uri/ $uri.html =404;
    }
    
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

---

## WF-07 — Image Generation Reale (Phase 2)

**Trigger:** IMAGE_GEN_PROVIDER != 'disabled', automatico dopo WF-04  
**Sostituisce:** WF-04 per la parte di generazione immagini

```
IMAGE WORKER — REAL MODE
  │
  ├─ Leggi dist/IMAGE_PROMPTS.json (generato da WF-04)
  ├─ Leggi provider configurato: DALL-E | SDXL | Flux
  │
  ├─ Per ogni prompt in IMAGE_PROMPTS.json:
  │   │
  │   ├─ Call ImageProvider.generate():
  │   │   ├─ DALL-E: POST https://api.openai.com/v1/images/generations
  │   │   │   { model: "dall-e-3", prompt: ..., size: "1792x1024", quality: "standard" }
  │   │   ├─ SDXL local: POST http://localhost:7860/sdapi/v1/txt2img
  │   │   │   { prompt: ..., negative_prompt: ..., width: ..., height: ..., steps: 30 }
  │   │   └─ Flux API: ... (endpoint specifico per provider)
  │   │
  │   ├─ On success:
  │   │   ├─ Ottimizza immagine con sharp: resize + compress
  │   │   ├─ Salva in dist/images/{filename}.jpg (o .webp)
  │   │   ├─ Aggiorna placeholder.status = 'done'
  │   │   └─ Aggiorna HTML: sostituisci SVG placeholder con immagine reale
  │   │
  │   └─ On error:
  │       ├─ Log errore dettagliato
  │       ├─ Incrementa placeholder.retryCount
  │       ├─ Se retryCount < 2 → re-queue con backoff
  │       └─ Se retryCount >= 2 → mantieni SVG placeholder, status = 'failed'
  │
  ├─ Git commit: "iteration-{N}: add AI-generated images"
  └─ Trigger re-deploy (WF-03)
```

---

## WF-08 — Audit Post-Generazione (Phase 2)

**Trigger:** automatico dopo WF-01/02, in parallelo a WF-04  
**Obiettivo:** verifica qualità output senza bloccare il flusso

```
AUDIT WORKER
  │
  ├─ Spawn OpenCode con agente Andy Code Cat-auditor:
  │   opencode run --agent Andy Code Cat-auditor
  │     "Audit the site in dist/ and write dist/AUDIT.json"
  │
  ├─ Parse dist/AUDIT.json:
  │   {
  │     "issues": [
  │       { "severity": "error|warning|info", "file": "...", "message": "..." }
  │     ],
  │     "score": 85,
  │     "checks": {
  │       "htmlValid": true,
  │       "cssLinked": true,
  │       "imagesHaveAlt": false,
  │       "metaTagsPresent": true,
  │       "manifestPresent": true
  │     }
  │   }
  │
  ├─ Salva AUDIT nel Job output
  ├─ Se issues con severity 'error' > 0:
  │   ├─ Log warning (non blocca il deploy)
  │   └─ Includi nel webhook payload
  └─ Se score < 60: flag progetto per revisione manuale
```

---

## WF-09 — Rollback Iterazione (Phase 2)

**Trigger:** `POST /api/v1/projects/:slug/iterations/:n/restore`

```
ROLLBACK HANDLER
  │
  ├─ Verifica iterazione N esiste nel repo Gitea
  ├─ Verifica iterazione N completata correttamente
  │
  ├─ Git: checkout iteration-{N} branch
  ├─ Copia dist/ → /var/www/{slug}/ (sovrascrive iterazione corrente)
  ├─ Nginx reload (nessun cambio config, solo file statici)
  │
  ├─ Aggiorna Project.iterationCount = N (non N+1 per evitare confusione)
  ├─ Crea nuovo Deployment con note: "rollback to iteration-{N}"
  │
  └─ Response: { success: true, restoredIteration: N, liveUrl: "..." }
```

---

## WF-10 — Webhook Delivery

**Trigger:** ogni cambio di status rilevante  
**Destinatari:** webhook URL configurati per il progetto

```
WEBHOOK EVENTS:
  job.queued      → job creato e in coda
  job.started     → worker ha preso il job
  job.progress    → aggiornamento progress (ogni 20%)
  job.completed   → generazione completata con successo
  job.failed      → generazione fallita
  deploy.started  → deploy worker partito
  deploy.live     → sito pubblicato e raggiungibile
  deploy.failed   → deploy fallito
  export.ready    → ZIP pronto per download

PAYLOAD STANDARD:
  {
    "event": "job.completed",
    "timestamp": "2025-01-15T10:30:00Z",
    "projectSlug": "myclient-landing",
    "jobId": "...",
    "data": {
      // dipende dall'evento
      "status": "completed",
      "outputUrl": "https://myclient-landing.Andy Code Cat.io",
      "iterationNumber": 1,
      "imagePlaceholders": 5,
      "gitCommit": "abc123"
    },
    "signature": "hmac-sha256:{secret}"  // per verifica autenticità
  }

DELIVERY:
  ├─ POST al webhook URL con payload JSON
  ├─ Timeout: 10s
  ├─ Retry: 3 tentativi con backoff esponenziale (1min, 5min, 15min)
  ├─ Considera success: HTTP 2xx
  └─ Log tutti i delivery (successo e fallimento) in MongoDB
```

---

## Tabella Transizioni di Stato

### Project.status

```
draft
  │
  ├─→ [POST /generate] → generating
  │
generating
  ├─→ [job completed] → generated
  ├─→ [job failed]    → error
  │
generated
  ├─→ [auto-deploy]   → deploying
  ├─→ [POST /refine]  → generating
  │
deploying
  ├─→ [deploy ok]     → live
  ├─→ [deploy fail]   → generated (ritorna a stato pre-deploy)
  │
live
  ├─→ [POST /refine]  → generating
  ├─→ [DELETE /deploy] → generated
  │
error
  └─→ [POST /generate] → generating (retry manuale)
```

### Job.status

```
waiting → active → completed
                 ↘ failed (→ retry → waiting, max 3)
         ↘ stalled (worker morto, auto-recovery BullMQ)
```

---

## Concorrenza e Lock

### Regola: un job attivo per progetto

```typescript
// Nell'API handler, prima di creare il job:
const activeJob = await Job.findOne({
  projectId: project._id,
  status: { $in: ['waiting', 'active'] }
});

if (activeJob) {
  throw new ConflictError(
    `Job già in corso per questo progetto: ${activeJob._id}`,
    { activeJobId: activeJob._id, status: activeJob.status }
  );
}
```

### Workspace Isolation

Ogni job ha la propria directory `/data/workspaces/{jobId}/` — nessuna condivisione tra job concorrenti dello stesso progetto.

### Deploy Lock

Il deploy worker acquisisce un lock Redis prima di modificare nginx:

```typescript
const lock = await redisClient.set(
  `deploy-lock:${project.slug}`,
  jobId,
  'EX', 60,   // 60 secondi max
  'NX'         // solo se non esiste già
);

if (!lock) {
  // Deploy già in corso per questo progetto, retry tra 5s
  throw new Error('Deploy lock not acquired');
}
```

---

## Configurazione Workers

```typescript
// apps/api/src/workers/index.ts

// Generation Worker
const generationWorker = new Worker('generation', generationProcessor, {
  connection: redisClient,
  concurrency: 3,          // max 3 generazioni parallele
  limiter: {
    max: 10,               // max 10 job ogni
    duration: 60000        // 60 secondi
  }
});

// Deploy Worker  
const deployWorker = new Worker('deploy', deployProcessor, {
  connection: redisClient,
  concurrency: 2           // max 2 deploy paralleli (nginx reload è veloce)
});

// Image Worker
const imageWorker = new Worker('image-gen', imageProcessor, {
  connection: redisClient,
  concurrency: 5           // può essere più parallelo (I/O bound)
});

// Configurazione retry per tutti i worker
const defaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60000            // 1 minuto base
  },
  removeOnComplete: {
    age: 7 * 24 * 3600,    // mantieni completed jobs per 7 giorni
    count: 100
  },
  removeOnFail: {
    age: 30 * 24 * 3600    // mantieni failed jobs per 30 giorni
  }
};
```

---

## Monitoring e Observability

### Log strutturato per ogni step

```typescript
// Ogni worker loga con questo formato (Pino):
logger.info({
  workflow: 'WF-01',
  step: 'opencode-execution',
  jobId: job.id,
  projectSlug: project.slug,
  provider: project.aiConfig.provider,
  model: project.aiConfig.model,
  durationMs: elapsed,
  filesGenerated: fileCount
}, 'OpenCode execution completed');
```

### Metriche da raccogliere (per future dashboard)

| Metrica | Descrizione |
|---|---|
| `generation.duration_ms` | Durata totale generazione |
| `generation.opencode_duration_ms` | Solo tempo OpenCode CLI |
| `generation.files_count` | File generati in dist/ |
| `generation.placeholder_count` | Placeholder immagine trovati |
| `deploy.duration_ms` | Durata deploy nginx |
| `deploy.ssl_new` | Nuovo certificato SSL emesso |
| `job.retry_count` | Numero retry per job falliti |
| `preprompt.tokens_estimated` | Token stimati per prompt risolto |
