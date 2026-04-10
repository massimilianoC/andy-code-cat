# Andy Code Cat — Backend API Platform: Specifiche MVP

> **Versione:** 0.1-draft  
> **Scope:** Linee guida architetturali per agente di sviluppo  
> **Stack target:** Node.js (TypeScript) · MongoDB · BullMQ · OpenCode CLI · Gitea locale

---

## 1. Visione e Obiettivo

Andy Code Cat è un **backend API headless** che, dato un input testuale (prompt, PDF, immagine), genera automaticamente landing page e mini-siti web, li pubblica su sottodomini dedicati e gestisce il ciclo di vita dei progetti in modo completamente autonomo.

Il sistema è progettato come **piattaforma aperta**: la UI di Andy Code Cat è solo uno dei possibili client. Servizi di terze parti possono integrare il backend via API REST e gestire la propria UI, ricevendo come output:
- Una **configurazione nginx** pronta all'uso per puntare il proprio reverse proxy al sito generato
- Un **archivio ZIP scaricabile** con il pacchetto completo del sito (modalità sandboxed export)
- Un **endpoint di stato** per polling/webhook sul progresso della generazione

---

## 2. Principi Architetturali

- **API-first**: ogni funzionalità è esposta via REST; nessuna logica è accoppiata alla UI
- **Async by design**: la generazione è sempre asincrona via job queue; le API restituiscono immediatamente un `jobId`
- **Sandbox per progetto**: ogni progetto ha la propria working directory isolata, repo git locale e namespace MongoDB
- **Pre-prompt configurabile**: i layer di pre-prompting sono entità di prima classe, versionate e componibili
- **Zero lock-in sul modello AI**: OpenCode è configurato per usare il provider scelto dall'utente/progetto
- **Idempotenza**: ogni job può essere rieseguito senza effetti collaterali indesiderati

---

## 3. Componenti del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│   Andy Code Cat UI (React)  │  Third-party SaaS  │  CLI/Webhook  │
└──────────────┬──────────────────────┬─────────────────────-─┘
               │ REST API             │ REST API
┌──────────────▼──────────────────────▼────────────────────────┐
│                    API GATEWAY (Express/Fastify)               │
│   Auth (JWT/API Key)  │  Rate Limiting  │  Request Validation  │
└──────────────┬────────────────────────────────────────────────┘
               │
┌──────────────▼────────────────────────────────────────────────┐
│                    CORE SERVICES                               │
│                                                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │  Project Service │  │  Prompt Service  │  │  Auth Svc   │  │
│  │  (CRUD projects) │  │  (wrap + enrich) │  │             │  │
│  └────────┬─────────┘  └────────┬─────────┘  └─────────────┘  │
│           │                     │                              │
│  ┌────────▼─────────────────────▼────────────────────────────┐ │
│  │              JOB ORCHESTRATOR (BullMQ + Redis)             │ │
│  │   GenerationJob │ DeployJob │ ImageJob │ RefinementJob     │ │
│  └────────┬──────────────────────────────────────────────────┘ │
└───────────┼───────────────────────────────────────────────────┘
            │
┌───────────▼───────────────────────────────────────────────────┐
│                    WORKER LAYER                                │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  OpenCode Worker                                          │ │
│  │  - Spawn opencode CLI in working directory del progetto   │ │
│  │  - Passa prompt wrappato + contesto                       │ │
│  │  - Monitora output e file generati                        │ │
│  │  - Auto-approve permissions (--dangerously-skip-perms)    │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Deploy Worker                                            │ │
│  │  - Copia output in /var/www/{projectId}/                  │ │
│  │  - Genera nginx.conf per il sottodominio                  │ │
│  │  - Esegue nginx -t && nginx reload                        │ │
│  │  - Lancia certbot per SSL                                 │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Image Worker (MVP: placeholder → Phase 2: real gen)      │ │
│  │  - Scansiona cartella output per mock placeholder         │ │
│  │  - MVP: copia immagini placeholder SVG/PNG ottimizzate    │ │
│  │  - Phase 2: chiama API image gen (SDXL/DALL-E/Flux)       │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
            │
┌───────────▼───────────────────────────────────────────────────┐
│                    PERSISTENCE & INFRA                         │
│                                                               │
│  MongoDB (locale)     Gitea (locale)     Redis (BullMQ)       │
│  - projects           - repo per progetto  - job queue        │
│  - jobs               - versioning output  - cache            │
│  - preprompt configs  - branch per iter.                      │
│  - users/api-keys     - history diff                          │
│  - deployments                                                │
└───────────────────────────────────────────────────────────────┘
```

---

## 4. Modello Dati (MongoDB)

### 4.1 Collection: `projects`

```typescript
interface Project {
  _id: ObjectId;
  slug: string;                    // ID univoco URL-safe
  name: string;
  ownerId: ObjectId;               // utente o API client
  
  // Configurazione pubblicazione
  deployment: {
    mode: 'subdomain' | 'custom_domain' | 'zip_export' | 'nginx_config';
    subdomain?: string;            // es. "myclient.Andy Code Cat.io"
    customDomain?: string;         // es. "landing.myclient.com"
    baseDomain: string;            // dominio base del sistema
    nginxConfigPath?: string;      // path generato
    publishedUrl?: string;
    sslEnabled: boolean;
  };
  
  // Configurazione AI
  aiConfig: {
    provider: string;              // "anthropic" | "openai" | "ollama" | ...
    model: string;
    prepromptProfileId: ObjectId;  // riferimento a PrepromptProfile
    openCodeConfigOverride?: object; // override opencode.json per questo progetto
  };
  
  // Stato
  status: 'draft' | 'generating' | 'generated' | 'deploying' | 'live' | 'error';
  currentJobId?: string;
  
  // Repo Git locale
  gitRepo: {
    giteaRepoId?: number;
    localPath: string;             // /data/repos/{slug}/
    currentBranch: string;
  };
  
  // Iterazioni
  iterationCount: number;
  lastGeneratedAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.2 Collection: `preprompt_profiles`

```typescript
interface PrepromptProfile {
  _id: ObjectId;
  name: string;
  description: string;
  version: string;                 // semver es. "1.2.0"
  
  // Scope di applicazione
  scope: {
    type: 'global' | 'project' | 'agent_type' | 'output_type';
    projectId?: ObjectId;
    agentType?: 'landing_page' | 'mini_site' | 'portfolio' | 'ecommerce';
    outputType?: 'html_static' | 'react' | 'nextjs';
  };
  
  // Layer di wrapping (applicati in ordine)
  layers: PrepromptLayer[];
  
  // Configurazione OpenCode specifica
  openCodeConfig: {
    agentProfile?: string;         // nome agente opencode custom
    skills?: string[];             // skill files da iniettare
    claudeMdTemplate?: string;     // template CLAUDE.md da usare
    forbiddenTools?: string[];
    allowedTools?: string[];
  };
  
  // Configurazione struttura output attesa
  outputStructure: {
    expectedDirs: string[];        // ["dist/", "dist/assets/", "dist/images/"]
    entryPoint: string;            // "dist/index.html"
    imagePlaceholderPattern: string; // "<!-- IMAGE_PLACEHOLDER: {description} -->"
    imageDir: string;              // "dist/images/"
  };
  
  isActive: boolean;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface PrepromptLayer {
  order: number;
  name: string;
  type: 'system' | 'context' | 'constraint' | 'format' | 'persona';
  content: string;                 // template con variabili {{project.name}}, {{input.prompt}}, ecc.
  isOptional: boolean;
  condition?: string;              // espressione JSONata per applicazione condizionale
}
```

### 4.3 Collection: `jobs`

```typescript
interface Job {
  _id: ObjectId;
  bullJobId: string;               // ID del job in BullMQ
  projectId: ObjectId;
  type: 'generation' | 'deploy' | 'image_gen' | 'refinement' | 'export';
  
  input: {
    prompt?: string;
    attachments?: JobAttachment[];  // PDF, immagini caricate
    prepromptProfileId: ObjectId;
    resolvedPrompt?: string;        // prompt finale dopo wrapping (loggato per debug)
    parentJobId?: string;           // per job concatenati
  };
  
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'stalled';
  progress: number;                 // 0-100
  
  openCodeSession?: {
    pid?: number;
    workingDir: string;
    sessionId?: string;             // opencode session ID
    logPath: string;
  };
  
  output?: {
    outputDir: string;
    filesGenerated: string[];
    imagePlaceholders: ImagePlaceholder[];
    gitCommitHash?: string;
  };
  
  error?: {
    message: string;
    stack?: string;
    retryCount: number;
  };
  
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

interface ImagePlaceholder {
  path: string;                    // path relativo es. "images/hero.jpg"
  description: string;             // descrizione estratta dal placeholder
  dimensions: { width: number; height: number };
  generatedPath?: string;          // dopo image gen
  status: 'pending' | 'generating' | 'done' | 'failed';
}
```

### 4.4 Collection: `deployments`

```typescript
interface Deployment {
  _id: ObjectId;
  projectId: ObjectId;
  jobId: ObjectId;
  
  // Configurazione nginx generata
  nginxConfig: {
    content: string;               // contenuto del file nginx.conf generato
    serverName: string;
    rootPath: string;
    sslCertPath?: string;
    sslKeyPath?: string;
  };
  
  // Pacchetto esportabile
  exportPackage?: {
    zipPath: string;
    zipUrl: string;                // URL download temporaneo
    expiresAt: Date;
    size: number;
  };
  
  // Stato publish
  publishedAt?: Date;
  unpublishedAt?: Date;
  isActive: boolean;
  
  // Per audit/terze parti
  deployedBy: 'system' | 'api_client';
  apiClientId?: ObjectId;
  
  createdAt: Date;
}
```

---

## 5. API REST — Endpoints MVP

### 5.1 Autenticazione

```
POST   /api/v1/auth/register          # registrazione utente
POST   /api/v1/auth/login             # login → JWT
POST   /api/v1/auth/api-keys          # genera API key per terze parti
DELETE /api/v1/auth/api-keys/:keyId   # revoca API key
```

### 5.2 Progetti

```
GET    /api/v1/projects               # lista progetti (paginata)
POST   /api/v1/projects               # crea nuovo progetto
GET    /api/v1/projects/:slug         # dettaglio progetto
PATCH  /api/v1/projects/:slug         # aggiorna config progetto
DELETE /api/v1/projects/:slug         # elimina progetto e risorse

# Generazione (async)
POST   /api/v1/projects/:slug/generate
  Body: { prompt, attachments?, prepromptProfileId?, aiConfigOverride? }
  Response: { jobId, status: "queued", estimatedSeconds }

# Raffinamento (async) — continua dal risultato precedente
POST   /api/v1/projects/:slug/refine
  Body: { prompt, targetFiles? }
  Response: { jobId, status: "queued" }

# Export
GET    /api/v1/projects/:slug/export/zip        # scarica ZIP del progetto
GET    /api/v1/projects/:slug/export/nginx      # restituisce nginx.conf
GET    /api/v1/projects/:slug/export/dns-guide  # istruzioni record A/DNS
```

### 5.3 Jobs

```
GET    /api/v1/jobs/:jobId            # stato e dettaglio job
GET    /api/v1/jobs/:jobId/logs       # log streaming (SSE)
POST   /api/v1/jobs/:jobId/cancel     # cancella job in corso

# Webhook configuration (per terze parti)
POST   /api/v1/projects/:slug/webhooks
  Body: { url, events: ["job.completed", "job.failed", "deploy.live"] }
```

### 5.4 Pre-prompt Profiles

```
GET    /api/v1/preprompt-profiles             # lista profili
POST   /api/v1/preprompt-profiles             # crea profilo
GET    /api/v1/preprompt-profiles/:id         # dettaglio
PUT    /api/v1/preprompt-profiles/:id         # aggiorna (crea nuova versione)
DELETE /api/v1/preprompt-profiles/:id         # depreca profilo
GET    /api/v1/preprompt-profiles/:id/history # storico versioni
POST   /api/v1/preprompt-profiles/:id/test    # testa wrapping prompt senza eseguire
  Body: { samplePrompt, projectContext? }
  Response: { resolvedPrompt, layers: [{name, content}] }
```

### 5.5 Deploy

```
POST   /api/v1/projects/:slug/deploy          # pubblica su nginx
DELETE /api/v1/projects/:slug/deploy          # rimuovi da nginx
GET    /api/v1/projects/:slug/deploy/status   # stato pubblicazione
```

---

## 6. Flusso Operativo End-to-End

### 6.1 Generazione (Happy Path)

```
1. Client → POST /projects/:slug/generate { prompt, attachments? }
   └── API crea Job su MongoDB (status: waiting)
   └── Aggiunge job a BullMQ queue "generation"
   └── Restituisce { jobId } immediatamente

2. GenerationWorker (BullMQ) riceve il job
   ├── Recupera Project e PrepromptProfile da MongoDB
   ├── PREPROMPT ENGINE:
   │   ├── Estrae testo da PDF (se allegato) via pdfjs/pymupdf
   │   ├── Descrive immagini allegate via LLM vision
   │   ├── Applica layer in ordine: system → context → constraint → format
   │   ├── Sostituisce variabili template nel prompt
   │   ├── Salva resolvedPrompt nel Job (per debug e audit)
   │   └── Genera CLAUDE.md dal template del profilo
   │
   ├── GIT SETUP:
   │   ├── Clona/crea repo locale Gitea per il progetto
   │   ├── Crea branch "iteration-N" (N = iterationCount + 1)
   │   └── Prepara working directory /data/workspaces/{jobId}/
   │
   ├── OPENCODE EXECUTION:
   │   ├── Scrive opencode.json nella working dir con:
   │   │   - provider e model dal progetto
   │   │   - skills dedicate (landing-page, no-confirm, nginx-aware)
   │   │   - tool permissions auto-approve
   │   ├── Lancia: opencode run --model {provider}/{model}
   │   │         --agent {agentProfile} "{resolvedPrompt}"
   │   │         --dangerously-skip-permissions
   │   │   (oppure: opencode serve + opencode run --attach per sessioni multiple)
   │   ├── Monitora stdout/stderr → aggiorna Job.progress
   │   └── Timeout configurabile (default 10 min)
   │
   ├── POST-PROCESSING:
   │   ├── Verifica struttura cartelle vs outputStructure del profilo
   │   ├── Estrae ImagePlaceholder dalla cartella images/
   │   ├── Git commit + push su branch iteration-N
   │   ├── Aggiorna Job (status: completed, output)
   │   └── Aggiunge ImageJob alla queue "image-gen"
   │
   └── Emette webhook job.completed se configurato

3. ImageWorker riceve il job
   ├── MVP: copia immagini placeholder ottimizzate (SVG generati, stock images)
   ├── Phase 2: genera immagini reali via API configurata
   └── Git commit con immagini generate

4. Se deployment.mode == 'subdomain' o 'custom_domain':
   └── Aggiunge DeployJob alla queue "deploy"

5. DeployWorker:
   ├── Copia output in /var/www/{projectSlug}/
   ├── Genera nginx.conf da template Jinja2/Nunjucks
   ├── nginx -t (test config)
   ├── nginx reload
   ├── certbot --nginx -d {subdomain} --non-interactive
   ├── Salva Deployment su MongoDB
   └── Emette webhook deploy.live
```

### 6.2 Modalità Export (Terze Parti)

Dopo la generazione, una terza parte può:

```
# Opzione A: ricevere nginx.conf da usare sul proprio server
GET /api/v1/projects/:slug/export/nginx
→ Restituisce il file nginx.conf con server_name e root già configurati
  La terza parte imposta il record A del proprio DNS verso il nostro IP
  e usa questa config sul proprio nginx

# Opzione B: scaricare il sito come ZIP
GET /api/v1/projects/:slug/export/zip
→ Crea archivio ZIP della cartella /var/www/{slug}/
  Restituisce signed URL di download (valido 1h)
  La terza parte ospita il sito dove vuole
```

---

## 7. OpenCode — Configurazione e Skills

### 7.1 opencode.json per progetto (generato dinamicamente)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "{{project.aiConfig.provider}}/{{project.aiConfig.model}}",
  "provider": {
    "{{project.aiConfig.provider}}": {
      "apiKey": "{{resolvedApiKey}}"
    }
  },
  "agents": {
    "Andy Code Cat-builder": {
      "description": "Agente specializzato nella generazione di siti web statici",
      "prompt": "{{prepromptProfile.openCodeConfig.claudeMdTemplate}}",
      "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }
}
```

### 7.2 CLAUDE.md Template (iniettato via PrepromptProfile)

Il CLAUDE.md è il documento di "memoria" del progetto per OpenCode. Viene generato dal template del profilo e contiene:

```markdown
# Andy Code Cat Project: {{project.name}}

## Obiettivo
Genera un sito web statico nella cartella `dist/`.

## Struttura output richiesta
- dist/index.html          (entry point)
- dist/css/style.css       (tutti gli stili)
- dist/js/main.js          (JavaScript minimale)
- dist/images/             (placeholder immagini)
- dist/assets/             (font, icone, ecc.)

## Regole CRITICHE
1. NON chiedere conferme. Procedi sempre autonomamente.
2. Per ogni immagine usa un placeholder SVG con commento:
   <!-- IMAGE_PLACEHOLDER: {descrizione dell'immagine richiesta} -->
3. Il sito deve essere completamente auto-contenuto (no CDN esterni)
4. Usa CSS custom properties per il tema (colori, font)
5. Ottimizza per mobile-first (viewport meta, media queries)
6. Ogni pagina deve avere meta SEO basilari

## Contesto Progetto
{{project.context}}

## Prompt Utente (elaborato)
{{resolvedPrompt}}
```

### 7.3 Skills OpenCode Dedicati

File da inserire in `~/.config/opencode/skills/` o nella working dir:

**`no-confirm.md`** — previene richieste di conferma
```markdown
# No Confirmation Policy
Proceed with all file operations without asking for confirmation.
Never pause to ask "should I proceed?" or "is this correct?".
Complete the task fully and autonomously.
```

**`static-site-builder.md`** — guida la generazione
```markdown
# Static Site Builder Skill
When building static websites:
- Always generate self-contained HTML/CSS/JS
- Use CSS Grid and Flexbox for layouts
- Prefer vanilla JS, avoid heavy frameworks
- Images: use SVG placeholders with descriptive comments
- Include a manifest.json for PWA basics
- Test HTML validity mentally before writing
```

---

## 8. Pre-prompt Engine — Specifiche

### 8.1 Struttura Layer

Ogni PrepromptProfile applica layer in ordine. I layer sono template con variabili:

```
{{project.name}}          → nome progetto
{{project.type}}          → tipo (landing_page, mini_site, ecc.)
{{input.prompt}}          → prompt originale utente
{{input.attachments}}     → descrizione allegati estratti
{{deployment.domain}}     → dominio di destinazione
{{iteration.number}}      → numero iterazione
{{iteration.previousOutput}} → sommario output precedente (per refine)
```

### 8.2 Esempio Profilo: Landing Page Standard

```json
{
  "name": "Landing Page — Standard B2B",
  "version": "1.0.0",
  "scope": { "type": "agent_type", "agentType": "landing_page" },
  "layers": [
    {
      "order": 1,
      "name": "Persona",
      "type": "system",
      "content": "Sei un senior web designer con 15 anni di esperienza in landing page ad alta conversione. Il tuo output è sempre codice HTML/CSS/JS pulito, moderno e funzionante."
    },
    {
      "order": 2,
      "name": "Contesto Progetto",
      "type": "context",
      "content": "Stai lavorando al progetto '{{project.name}}'. Il sito sarà pubblicato su {{deployment.domain}}. Questa è l'iterazione numero {{iteration.number}}."
    },
    {
      "order": 3,
      "name": "Vincoli Output",
      "type": "constraint",
      "content": "VINCOLI ASSOLUTI:\n- Output solo nella cartella dist/\n- Nessun framework esterno (React, Vue, Angular)\n- Nessuna dipendenza CDN\n- Placeholder immagini con pattern: <!-- IMAGE_PLACEHOLDER: {descrizione} -->\n- Mobile-first responsive\n- HTML semantico e accessibile"
    },
    {
      "order": 4,
      "name": "Formato Output",
      "type": "format",
      "content": "Quando hai completato la generazione, crea un file dist/MANIFEST.json con:\n{\n  \"pages\": [lista file HTML],\n  \"images\": [lista placeholder trovati],\n  \"completedAt\": \"{{datetime}}\"\n}"
    },
    {
      "order": 5,
      "name": "Prompt Utente",
      "type": "context",
      "content": "RICHIESTA: {{input.prompt}}\n\n{{#if input.attachments}}CONTENUTO ALLEGATI:\n{{input.attachments}}{{/if}}"
    }
  ]
}
```

### 8.3 Versioning

Ogni modifica a un profilo crea una nuova versione (`semver`). I progetti referenziano sempre una versione specifica. Il downgrade è possibile scegliendo una versione precedente.

---

## 9. Deploy — Nginx Template

```nginx
# Auto-generated by Andy Code Cat — DO NOT EDIT MANUALLY
# Project: {{project.slug}} | Generated: {{datetime}}

server {
    listen 80;
    listen [::]:80;
    server_name {{deployment.serverName}};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {{deployment.serverName}};

    ssl_certificate     {{ssl.certPath}};
    ssl_certificate_key {{ssl.keyPath}};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    root {{deployment.rootPath}};
    index index.html;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json
               application/javascript text/xml application/xml;

    # Cache assets statici
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback (se necessario)
    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
}
```

---

## 10. Stack Tecnologico

### 10.1 Backend API

| Componente | Tecnologia | Note |
|---|---|---|
| Runtime | Node.js 22 LTS (TypeScript) | — |
| Framework | Fastify 4 | performance, schema validation nativa |
| Job Queue | BullMQ + Redis 7 | retry, priority, delayed jobs |
| ORM/ODM | Mongoose 8 | MongoDB schema + validation |
| Auth | JWT (access) + refresh token | API Key per client terze parti |
| Validation | Zod | schema condivisi API/internal |
| Logging | Pino | JSON structured logs |
| File ops | fs-extra, archiver (ZIP) | — |
| PDF parsing | pdf-parse / pdfjs-dist | estrazione testo da allegati |
| Template engine | Nunjucks | nginx config, CLAUDE.md |

### 10.2 Infrastruttura

| Componente | Tecnologia | Note |
|---|---|---|
| Database | MongoDB 7 (locale) | replica set singolo nodo per MVP |
| Cache/Queue | Redis 7 (locale) | BullMQ backend |
| Git server | Gitea (Docker) | repo privati per progetto |
| Web server | nginx | deploy siti + reverse proxy API |
| SSL | Certbot (Let's Encrypt) | wildcard *.Andy Code Cat.io |
| Containerizzazione | Docker Compose | tutti i servizi infra |
| Process manager | PM2 | API server e workers |

### 10.3 Frontend (UI Accessoria — fuori scope MVP backend)

| Componente | Tecnologia |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | Tailwind CSS + shadcn/ui |
| State | Zustand |
| API client | fetch + React Query |

---

## 11. Struttura Directory del Progetto

```
Andy Code Cat/
├── apps/
│   ├── api/                        # Backend API (questo documento)
│   │   ├── src/
│   │   │   ├── routes/             # Endpoint Fastify
│   │   │   ├── services/           # Business logic
│   │   │   │   ├── preprompt/      # Preprompt engine
│   │   │   │   ├── opencode/       # OpenCode runner
│   │   │   │   ├── deploy/         # Nginx deploy
│   │   │   │   └── git/            # Gitea integration
│   │   │   ├── workers/            # BullMQ workers
│   │   │   │   ├── generation.worker.ts
│   │   │   │   ├── deploy.worker.ts
│   │   │   │   └── image.worker.ts
│   │   │   ├── models/             # Mongoose models
│   │   │   ├── lib/                # Utilities condivise
│   │   │   └── config/             # Configurazione app
│   │   └── package.json
│   └── ui/                         # Frontend (scope separato)
│
├── data/
│   ├── workspaces/                 # Working dir per ogni job OpenCode
│   │   └── {jobId}/
│   │       ├── opencode.json
│   │       ├── CLAUDE.md
│   │       └── dist/               # Output generato
│   ├── repos/                      # Mirror locale repo Gitea
│   └── exports/                    # ZIP temporanei
│
├── config/
│   ├── preprompt-profiles/         # Profili default in JSON
│   │   ├── landing-page-b2b.json
│   │   ├── landing-page-startup.json
│   │   └── mini-site-portfolio.json
│   ├── nginx-templates/
│   │   └── site.conf.njk
│   └── opencode-skills/
│       ├── no-confirm.md
│       ├── static-site-builder.md
│       └── Andy Code Cat-agent.md
│
├── docker-compose.yml              # MongoDB, Redis, Gitea
├── nginx/
│   └── sites-enabled/             # Configurazioni generate
└── scripts/
    ├── setup.sh                    # Setup iniziale
    ├── seed-profiles.ts            # Seed preprompt profiles
    └── rotate-logs.sh
```

---

## 12. Sicurezza

- **API Key**: hash SHA-256 in MongoDB, mai in chiaro; prefisso `pf_live_` o `pf_test_`
- **Isolamento workspace**: ogni job gira in `/data/workspaces/{jobId}/` con permessi limitati
- **Rate limiting**: 10 req/min per endpoint generate/refine; configurabile per API client
- **Input sanitization**: prompt sanitizzato (lunghezza max 10.000 char, no script injection)
- **Nginx**: nessun reload senza `nginx -t` positivo; rollback automatico se test fallisce
- **Allegati**: scansione MIME type; dimensione max 10MB; tipi permessi: PDF, JPG, PNG, WebP
- **Signed URLs export**: JWT monouso con scadenza 1h per download ZIP

---

## 13. Variabili d'Ambiente

```bash
# App
NODE_ENV=production
PORT=3001
API_BASE_URL=https://api.Andy Code Cat.io

# MongoDB
MONGODB_URI=mongodb://localhost:27017/Andy Code Cat

# Redis
REDIS_URL=redis://localhost:6379

# Gitea
GITEA_BASE_URL=http://localhost:3000
GITEA_ADMIN_TOKEN=xxx

# Auth
JWT_SECRET=xxx
JWT_REFRESH_SECRET=xxx
API_KEY_SALT=xxx

# Deployment
NGINX_SITES_DIR=/etc/nginx/sites-enabled
WEBROOT_BASE=/var/www
BASE_DOMAIN=Andy Code Cat.io
CERTBOT_EMAIL=admin@Andy Code Cat.io

# OpenCode
OPENCODE_DEFAULT_MODEL=anthropic/claude-sonnet-4-6
OPENCODE_TIMEOUT_MS=600000

# Image Gen (Phase 2)
IMAGE_GEN_PROVIDER=disabled  # 'disabled' | 'dalle' | 'sdxl' | 'flux'
OPENAI_API_KEY=xxx  # se IMAGE_GEN_PROVIDER=dalle
SDXL_API_URL=http://localhost:7860  # se local

# Storage temporaneo export
EXPORT_BASE_URL=https://api.Andy Code Cat.io
EXPORT_EXPIRY_SECONDS=3600
```
