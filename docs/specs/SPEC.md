# Andy Code Cat — Backend API Platform: MVP Specification

> **Version:** 0.1-draft  
> **Scope:** Architectural guidance for development agents and maintainers  
> **Target stack:** Node.js (TypeScript) · MongoDB · BullMQ · OpenCode CLI · local Gitea

---

## 1. Vision and Goal

Andy Code Cat is a **headless backend API** that takes textual or file-based input (prompt, PDF, image), automatically generates landing pages and mini-sites, publishes them under dedicated subdomains, and manages the project lifecycle end to end.

The system is designed as an **open platform**: the Andy Code Cat UI is only one possible client. Third-party services can integrate with the backend through REST APIs and use their own UI while receiving:

- a ready-to-use **nginx configuration** for reverse-proxy routing
- a downloadable **ZIP archive** containing the full site package
- a **status endpoint** for polling or webhook-based progress tracking

---

## 2. Architectural Principles

- **API-first**: every capability is exposed over REST; no business logic is tightly coupled to the UI
- **Async by design**: generation runs through job queues and APIs return a `jobId` immediately
- **Per-project sandboxing**: each project gets its own isolated workspace, local git repository, and MongoDB namespace boundary
- **Configurable pre-prompting**: prompt layers are first-class, versioned, and composable
- **No AI model lock-in**: OpenCode can use the provider selected by the user or project
- **Idempotence**: each job can be retried without unwanted side effects

---

## 3. System Components

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
│  │  - Spawn the opencode CLI in the project's working dir    │ │
│  │  - Pass the wrapped prompt + context                      │ │
│  │  - Monitor output and generated files                     │ │
│  │  - Auto-approve permissions (--dangerously-skip-perms)    │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Deploy Worker                                            │ │
│  │  - Copy output to /var/www/{projectId}/                   │ │
│  │  - Generate nginx.conf for the subdomain                  │ │
│  │  - Run nginx -t && nginx reload                           │ │
│  │  - Run certbot for SSL                                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Image Worker (MVP: placeholder → Phase 2: real gen)      │ │
│  │  - Scan the output folder for mock placeholders           │ │
│  │  - MVP: copy optimized placeholder SVG/PNG images         │ │
│  │  - Phase 2: call an image gen API (SDXL/DALL-E/Flux)      │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
            │
┌───────────▼───────────────────────────────────────────────────┐
│                    PERSISTENCE & INFRA                         │
│                                                               │
│  MongoDB (local)      Gitea (local)      Redis (BullMQ)       │
│  - projects           - repo per project   - job queue        │
│  - jobs               - output versioning  - cache            │
│  - preprompt configs  - branch per iter.                      │
│  - users/api-keys     - history diff                          │
│  - deployments                                                │
└───────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model (MongoDB)

### 4.1 Collection: `projects`

```typescript
interface Project {
  _id: ObjectId;
  slug: string;                    // unique URL-safe ID
  name: string;
  ownerId: ObjectId;               // user or API client
  
  // Publishing configuration
  deployment: {
    mode: 'subdomain' | 'custom_domain' | 'zip_export' | 'nginx_config';
    subdomain?: string;            // e.g. "myclient.Andy Code Cat.io"
    customDomain?: string;         // e.g. "landing.myclient.com"
    baseDomain: string;            // system's base domain
    nginxConfigPath?: string;      // generated path
    publishedUrl?: string;
    sslEnabled: boolean;
  };
  
  // AI configuration
  aiConfig: {
    provider: string;              // "anthropic" | "openai" | "ollama" | ...
    model: string;
    prepromptProfileId: ObjectId;  // reference to PrepromptProfile
    openCodeConfigOverride?: object; // opencode.json override for this project
  };
  
  // State
  status: 'draft' | 'generating' | 'generated' | 'deploying' | 'live' | 'error';
  currentJobId?: string;
  
  // Local Git repo
  gitRepo: {
    giteaRepoId?: number;
    localPath: string;             // /data/repos/{slug}/
    currentBranch: string;
  };
  
  // Iterations
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
  version: string;                 // semver e.g. "1.2.0"
  
  // Application scope
  scope: {
    type: 'global' | 'project' | 'agent_type' | 'output_type';
    projectId?: ObjectId;
    agentType?: 'landing_page' | 'mini_site' | 'portfolio' | 'ecommerce';
    outputType?: 'html_static' | 'react' | 'nextjs';
  };
  
  // Wrapping layers (applied in order)
  layers: PrepromptLayer[];
  
  // OpenCode-specific configuration
  openCodeConfig: {
    agentProfile?: string;         // custom opencode agent name
    skills?: string[];             // skill files to inject
    claudeMdTemplate?: string;     // CLAUDE.md template to use
    forbiddenTools?: string[];
    allowedTools?: string[];
  };
  
  // Expected output structure configuration
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
  content: string;                 // template with variables {{project.name}}, {{input.prompt}}, etc.
  isOptional: boolean;
  condition?: string;              // JSONata expression for conditional application
}
```

### 4.3 Collection: `jobs`

```typescript
interface Job {
  _id: ObjectId;
  bullJobId: string;               // BullMQ job ID
  projectId: ObjectId;
  type: 'generation' | 'deploy' | 'image_gen' | 'refinement' | 'export';
  
  input: {
    prompt?: string;
    attachments?: JobAttachment[];  // uploaded PDFs, images
    prepromptProfileId: ObjectId;
    resolvedPrompt?: string;        // final prompt after wrapping (logged for debugging)
    parentJobId?: string;           // for chained jobs
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
  path: string;                    // relative path, e.g. "images/hero.jpg"
  description: string;             // description extracted from the placeholder
  dimensions: { width: number; height: number };
  generatedPath?: string;          // after image gen
  status: 'pending' | 'generating' | 'done' | 'failed';
}
```

### 4.4 Collection: `deployments`

```typescript
interface Deployment {
  _id: ObjectId;
  projectId: ObjectId;
  jobId: ObjectId;
  
  // Generated nginx configuration
  nginxConfig: {
    content: string;               // content of the generated nginx.conf file
    serverName: string;
    rootPath: string;
    sslCertPath?: string;
    sslKeyPath?: string;
  };
  
  // Exportable package
  exportPackage?: {
    zipPath: string;
    zipUrl: string;                // temporary download URL
    expiresAt: Date;
    size: number;
  };
  
  // Publish state
  publishedAt?: Date;
  unpublishedAt?: Date;
  isActive: boolean;
  
  // For audit/third parties
  deployedBy: 'system' | 'api_client';
  apiClientId?: ObjectId;
  
  createdAt: Date;
}
```

---

## 5. REST API — MVP Endpoints

### 5.1 Authentication

```
POST   /api/v1/auth/register          # user registration
POST   /api/v1/auth/login             # login → JWT
POST   /api/v1/auth/api-keys          # generate an API key for third parties
DELETE /api/v1/auth/api-keys/:keyId   # revoke an API key
```

### 5.2 Projects

```
GET    /api/v1/projects               # list projects (paginated)
POST   /api/v1/projects               # create a new project
GET    /api/v1/projects/:slug         # project detail
PATCH  /api/v1/projects/:slug         # update project config
DELETE /api/v1/projects/:slug         # delete project and resources

# Generation (async)
POST   /api/v1/projects/:slug/generate
  Body: { prompt, attachments?, prepromptProfileId?, aiConfigOverride? }
  Response: { jobId, status: "queued", estimatedSeconds }

# Refinement (async) — continues from the previous result
POST   /api/v1/projects/:slug/refine
  Body: { prompt, targetFiles? }
  Response: { jobId, status: "queued" }

# Export
GET    /api/v1/projects/:slug/export/zip        # download the project's ZIP
GET    /api/v1/projects/:slug/export/nginx      # returns the nginx.conf
GET    /api/v1/projects/:slug/export/dns-guide  # A/DNS record instructions
```

### 5.3 Jobs

```
GET    /api/v1/jobs/:jobId            # job status and detail
GET    /api/v1/jobs/:jobId/logs       # log streaming (SSE)
POST   /api/v1/jobs/:jobId/cancel     # cancel an in-progress job

# Webhook configuration (for third parties)
POST   /api/v1/projects/:slug/webhooks
  Body: { url, events: ["job.completed", "job.failed", "deploy.live"] }
```

### 5.4 Pre-prompt Profiles

```
GET    /api/v1/preprompt-profiles             # list profiles
POST   /api/v1/preprompt-profiles             # create a profile
GET    /api/v1/preprompt-profiles/:id         # detail
PUT    /api/v1/preprompt-profiles/:id         # update (creates a new version)
DELETE /api/v1/preprompt-profiles/:id         # deprecate a profile
GET    /api/v1/preprompt-profiles/:id/history # version history
POST   /api/v1/preprompt-profiles/:id/test    # test the prompt wrapping without executing
  Body: { samplePrompt, projectContext? }
  Response: { resolvedPrompt, layers: [{name, content}] }
```

### 5.5 Deploy

```
POST   /api/v1/projects/:slug/deploy          # publish to nginx
DELETE /api/v1/projects/:slug/deploy          # remove from nginx
GET    /api/v1/projects/:slug/deploy/status   # publish status
```

---

## 6. End-to-End Operational Flow

### 6.1 Generation (Happy Path)

```
1. Client → POST /projects/:slug/generate { prompt, attachments? }
   └── API creates a Job in MongoDB (status: waiting)
   └── Adds the job to the "generation" BullMQ queue
   └── Returns { jobId } immediately

2. GenerationWorker (BullMQ) receives the job
   ├── Fetches the Project and PrepromptProfile from MongoDB
   ├── PREPROMPT ENGINE:
   │   ├── Extracts text from the PDF (if attached) via pdfjs/pymupdf
   │   ├── Describes attached images via LLM vision
   │   ├── Applies layers in order: system → context → constraint → format
   │   ├── Substitutes template variables in the prompt
   │   ├── Saves resolvedPrompt on the Job (for debugging and audit)
   │   └── Generates CLAUDE.md from the profile's template
   │
   ├── GIT SETUP:
   │   ├── Clones/creates the local Gitea repo for the project
   │   ├── Creates branch "iteration-N" (N = iterationCount + 1)
   │   └── Prepares the working directory /data/workspaces/{jobId}/
   │
   ├── OPENCODE EXECUTION:
   │   ├── Writes opencode.json in the working dir with:
   │   │   - provider and model from the project
   │   │   - dedicated skills (landing-page, no-confirm, nginx-aware)
   │   │   - auto-approve tool permissions
   │   ├── Runs: opencode run --model {provider}/{model}
   │   │         --agent {agentProfile} "{resolvedPrompt}"
   │   │         --dangerously-skip-permissions
   │   │   (or: opencode serve + opencode run --attach for multiple sessions)
   │   ├── Monitors stdout/stderr → updates Job.progress
   │   └── Configurable timeout (default 10 min)
   │
   ├── POST-PROCESSING:
   │   ├── Verifies the folder structure against the profile's outputStructure
   │   ├── Extracts ImagePlaceholder entries from the images/ folder
   │   ├── Git commit + push on branch iteration-N
   │   ├── Updates the Job (status: completed, output)
   │   └── Adds an ImageJob to the "image-gen" queue
   │
   └── Emits the job.completed webhook if configured

3. ImageWorker receives the job
   ├── MVP: copies optimized placeholder images (generated SVGs, stock images)
   ├── Phase 2: generates real images via the configured API
   └── Git commit with the generated images

4. If deployment.mode == 'subdomain' or 'custom_domain':
   └── Adds a DeployJob to the "deploy" queue

5. DeployWorker:
   ├── Copies the output to /var/www/{projectSlug}/
   ├── Generates nginx.conf from the Jinja2/Nunjucks template
   ├── nginx -t (test config)
   ├── nginx reload
   ├── certbot --nginx -d {subdomain} --non-interactive
   ├── Saves the Deployment in MongoDB
   └── Emits the deploy.live webhook
```

### 6.2 Export Mode (Third Parties)

After generation, a third party can:

```
# Option A: receive an nginx.conf to use on their own server
GET /api/v1/projects/:slug/export/nginx
→ Returns the nginx.conf file with server_name and root already configured
  The third party points their DNS A record at our IP
  and uses this config on their own nginx

# Option B: download the site as a ZIP
GET /api/v1/projects/:slug/export/zip
→ Creates a ZIP archive of the /var/www/{slug}/ folder
  Returns a signed download URL (valid for 1h)
  The third party hosts the site wherever they want
```

---

## 7. OpenCode — Configuration and Skills

### 7.1 Per-project opencode.json (dynamically generated)

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
      "description": "Agent specialized in generating static websites",
      "prompt": "{{prepromptProfile.openCodeConfig.claudeMdTemplate}}",
      "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    }
  }
}
```

### 7.2 CLAUDE.md Template (injected via PrepromptProfile)

CLAUDE.md is the project's "memory" document for OpenCode. It is generated from the profile's template and contains:

```markdown
# Andy Code Cat Project: {{project.name}}

## Goal
Generate a static website in the `dist/` folder.

## Required Output Structure
- dist/index.html          (entry point)
- dist/css/style.css       (all styles)
- dist/js/main.js          (minimal JavaScript)
- dist/images/             (image placeholders)
- dist/assets/             (fonts, icons, etc.)

## CRITICAL Rules
1. Do NOT ask for confirmation. Always proceed autonomously.
2. For every image, use an SVG placeholder with a comment:
   <!-- IMAGE_PLACEHOLDER: {description of the requested image} -->
3. The site must be fully self-contained (no external CDNs)
4. Use CSS custom properties for the theme (colors, fonts)
5. Optimize for mobile-first (viewport meta, media queries)
6. Every page must have basic SEO meta tags

## Project Context
{{project.context}}

## User Prompt (processed)
{{resolvedPrompt}}
```

### 7.3 Dedicated OpenCode Skills

Files to place in `~/.config/opencode/skills/` or in the working dir:

**`no-confirm.md`** — prevents confirmation requests

```markdown
# No Confirmation Policy
Proceed with all file operations without asking for confirmation.
Never pause to ask "should I proceed?" or "is this correct?".
Complete the task fully and autonomously.
```

**`static-site-builder.md`** — guides the generation

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

## 8. Pre-prompt Engine — Specification

### 8.1 Layer Structure

Every PrepromptProfile applies layers in order. Layers are templates with variables:

```
{{project.name}}          → project name
{{project.type}}          → type (landing_page, mini_site, etc.)
{{input.prompt}}          → original user prompt
{{input.attachments}}     → description of extracted attachments
{{deployment.domain}}     → target domain
{{iteration.number}}      → iteration number
{{iteration.previousOutput}} → summary of the previous output (for refine)
```

### 8.2 Example Profile: Standard Landing Page

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
      "content": "You are a senior web designer with 15 years of experience in high-conversion landing pages. Your output is always clean, modern, working HTML/CSS/JS code."
    },
    {
      "order": 2,
      "name": "Project Context",
      "type": "context",
      "content": "You are working on the project '{{project.name}}'. The site will be published at {{deployment.domain}}. This is iteration number {{iteration.number}}."
    },
    {
      "order": 3,
      "name": "Output Constraints",
      "type": "constraint",
      "content": "ABSOLUTE CONSTRAINTS:\n- Output only in the dist/ folder\n- No external frameworks (React, Vue, Angular)\n- No CDN dependencies\n- Image placeholders with the pattern: <!-- IMAGE_PLACEHOLDER: {description} -->\n- Mobile-first responsive\n- Semantic, accessible HTML"
    },
    {
      "order": 4,
      "name": "Output Format",
      "type": "format",
      "content": "When you have completed the generation, create a dist/MANIFEST.json file with:\n{\n  \"pages\": [list of HTML files],\n  \"images\": [list of placeholders found],\n  \"completedAt\": \"{{datetime}}\"\n}"
    },
    {
      "order": 5,
      "name": "User Prompt",
      "type": "context",
      "content": "REQUEST: {{input.prompt}}\n\n{{#if input.attachments}}ATTACHMENT CONTENT:\n{{input.attachments}}{{/if}}"
    }
  ]
}
```

### 8.3 Versioning

Every change to a profile creates a new version (`semver`). Projects always reference a specific version. Downgrading is possible by choosing a previous version.

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

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback (if needed)
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

## 10. Technology Stack

### 10.1 Backend API

| Component | Technology | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS (TypeScript) | — |
| Framework | Fastify 4 | performance, native schema validation |
| Job Queue | BullMQ + Redis 7 | retry, priority, delayed jobs |
| ORM/ODM | Mongoose 8 | MongoDB schema + validation |
| Auth | JWT (access) + refresh token | API Key for third-party clients |
| Validation | Zod | shared API/internal schemas |
| Logging | Pino | JSON structured logs |
| File ops | fs-extra, archiver (ZIP) | — |
| PDF parsing | pdf-parse / pdfjs-dist | text extraction from attachments |
| Template engine | Nunjucks | nginx config, CLAUDE.md |

### 10.2 Infrastructure

| Component | Technology | Notes |
|---|---|---|
| Database | MongoDB 7 (local) | single-node replica set for MVP |
| Cache/Queue | Redis 7 (local) | BullMQ backend |
| Git server | Gitea (Docker) | private per-project repos |
| Web server | nginx | site deploy + API reverse proxy |
| SSL | Certbot (Let's Encrypt) | wildcard *.Andy Code Cat.io |
| Containerization | Docker Compose | all infra services |
| Process manager | PM2 | API server and workers |

### 10.3 Frontend (Ancillary UI — out of the backend MVP scope)

| Component | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | Tailwind CSS + shadcn/ui |
| State | Zustand |
| API client | fetch + React Query |

---

## 11. Project Directory Structure

```
Andy Code Cat/
├── apps/
│   ├── api/                        # Backend API (this document)
│   │   ├── src/
│   │   │   ├── routes/             # Fastify endpoints
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
│   │   │   ├── lib/                # Shared utilities
│   │   │   └── config/             # App configuration
│   │   └── package.json
│   └── ui/                         # Frontend (separate scope)
│
├── data/
│   ├── workspaces/                 # Working dir for each OpenCode job
│   │   └── {jobId}/
│   │       ├── opencode.json
│   │       ├── CLAUDE.md
│   │       └── dist/               # Generated output
│   ├── repos/                      # Local mirror of the Gitea repo
│   └── exports/                    # Temporary ZIPs
│
├── config/
│   ├── preprompt-profiles/         # Default profiles in JSON
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
│   └── sites-enabled/             # Generated configurations
└── scripts/
    ├── setup.sh                    # Initial setup
    ├── seed-profiles.ts            # Seed preprompt profiles
    └── rotate-logs.sh
```

---

## 12. Security

- **API Key**: SHA-256 hash in MongoDB, never in plaintext; prefix `pf_live_` or `pf_test_`
- **Workspace isolation**: each job runs in `/data/workspaces/{jobId}/` with restricted permissions
- **Rate limiting**: 10 req/min per generate/refine endpoint; configurable per API client
- **Input sanitization**: prompt sanitized (max length 10,000 chars, no script injection)
- **Nginx**: no reload without a passing `nginx -t`; automatic rollback if the test fails
- **Attachments**: MIME type scanning; max size 10MB; allowed types: PDF, JPG, PNG, WebP
- **Signed export URLs**: single-use JWT with a 1h expiry for ZIP downloads

---

## 13. Environment Variables

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
OPENAI_API_KEY=xxx  # if IMAGE_GEN_PROVIDER=dalle
SDXL_API_URL=http://localhost:7860  # if local

# Temporary export storage
EXPORT_BASE_URL=https://api.Andy Code Cat.io
EXPORT_EXPIRY_SECONDS=3600
```
