# Andy Code Cat — Automated Workflows: Specification

> **Scope:** Full definition of the platform’s automated workflows  
> **Reference:** aligned with `SPEC.md`, `docs/project/ROADMAP.md`, and `PREPROMPT_ENGINE_SPEC.md`  
> **Notation:** pseudocode and ASCII diagrams are used to describe the flows

---

## Workflow Index

| ID | Name | Trigger | Phase |
|---|---|---|---|
| WF-01 | First Generation | `POST /generate` | MVP |
| WF-02 | Refinement | `POST /refine` | MVP |
| WF-03 | Auto-Deploy Post-Gen | WF-01/02 completion | MVP |
| WF-04 | Image Placeholder MVP | Post-generation | MVP |
| WF-05 | ZIP Export | `GET /export/zip` | MVP |
| WF-06 | Export Nginx Config | `GET /export/nginx` | MVP |
| WF-07 | Real Image Generation | Post WF-04 | Phase 2 |
| WF-08 | Post-generation Audit | After each generation | Phase 2 |
| WF-09 | Iteration Rollback | `POST /iterations/:n/restore` | Phase 2 |
| WF-10 | Webhook Delivery | On every job status change | MVP |

---

## WF-01 — First Generation

**Trigger:** `POST /api/v1/projects/:slug/generate`  
**Preconditions:** the project exists and there is no active job already running for it  
**Output:** generated website in `dist/`, git commit, and optional deploy

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
  ├─ Check no active job for this project → 409 if one is already running
  ├─ Resolve PrepromptProfile:
  │    prepromptProfileId in body → use it
  │    otherwise → use project.aiConfig.prepromptProfileId
  │    otherwise → use the system's default profile
  │
  ├─ Save Attachment files (PDF/images) → /data/uploads/{jobId}/
  ├─ Create Job document (MongoDB):
  │    { type: 'generation', status: 'waiting', projectId, input: {...} }
  │
  ├─ Add to BullMQ queue 'generation' (priority: normal)
  │
  └─→ Response 202: { jobId, status: 'queued', pollUrl: '/jobs/{jobId}' }

──────────────────────────────────────────────────── (asynchronous from here on)

GENERATION WORKER (BullMQ)
  │
  ├─ [STATUS: active] Update Job in MongoDB
  ├─ Update Project.status = 'generating'
  │
  ├─ PREPROMPT ENGINE (see PREPROMPT_ENGINE_SPEC.md §3)
  │   ├─ InputProcessor: extract PDF text, describe images
  │   ├─ ContextBuilder: assemble TemplateContext
  │   ├─ LayerComposer: apply the profile's layers → resolvedPrompt
  │   ├─ ClaudeMdGenerator: generate CLAUDE.md
  │   └─ OpenCodeConfigGenerator: generate opencode.json
  │
  ├─ WORKSPACE SETUP
  │   ├─ mkdir /data/workspaces/{jobId}/
  │   ├─ Write opencode.json
  │   ├─ Write CLAUDE.md
  │   ├─ Write AGENTS.md (copied from config/opencode-skills/AGENTS.md)
  │   └─ mkdir .Andy Code Cat/skills/ + copy skill files
  │
  ├─ GIT SETUP
  │   ├─ If first iteration: git init + remote → the project's Gitea repo
  │   ├─ If a later iteration: git clone the existing repo
  │   └─ git checkout -b iteration-{N}
  │
  ├─ OPENCODE EXECUTION
  │   ├─ Spawn process:
  │   │   opencode run
  │   │     --model {provider}/{model}
  │   │     --agent Andy Code Cat-builder
  │   │     --dangerously-skip-permissions
  │   │     "{resolvedPrompt}"
  │   │   cwd: /data/workspaces/{jobId}/
  │   │   env: { provider API key, ... }
  │   │
  │   ├─ Monitor stdout/stderr:
  │   │   ├─ Every line → append to the job log file
  │   │   ├─ Every line → emit an SSE event (if a client is connected)
  │   │   ├─ Update Job.progress every 10s (heuristic: file count in dist/)
  │   │   └─ Timeout: OPENCODE_TIMEOUT_MS (default 600s)
  │   │
  │   ├─ On exit code 0 → continue
  │   └─ On exit code != 0 or timeout → FAIL HANDLING (see §Error Handling)
  │
  ├─ POST-PROCESSING
  │   ├─ Verify dist/index.html exists → fail the job if missing
  │   ├─ Verify dist/MANIFEST.json exists:
  │   │   ├─ Exists → parse and validate
  │   │   └─ Doesn't exist → generate a minimal MANIFEST.json from the filesystem
  │   ├─ Extract ImagePlaceholder[] from:
  │   │   ├─ MANIFEST.json if present
  │   │   └─ Scanning the HTML for IMAGE_PLACEHOLDER comments
  │   ├─ Copy dist/ → /var/www/{slug}/ (staging, not yet live)
  │   │
  │   ├─ GIT COMMIT
  │   │   ├─ git add dist/
  │   │   ├─ git commit -m "iteration-{N}: {first 100 chars of user prompt}"
  │   │   └─ git push origin iteration-{N}
  │   │
  │   └─ Update Job:
  │       { status: 'completed', output: { outputDir, filesGenerated, imagePlaceholders, gitCommitHash } }
  │
  ├─ Update Project: { status: 'generated', iterationCount: N, lastGeneratedAt }
  │
  ├─ Enqueue IMAGE_GEN job (queue 'image-gen', priority: low)
  │
  ├─ If project.deployment.mode in ['subdomain', 'custom_domain']:
  │   └─ Enqueue DEPLOY job (queue 'deploy', priority: normal)
  │
  └─ Emit Webhook: job.completed (see WF-10)
```

### WF-01 Error Handling

```
OpenCode timeout (>600s):
  ├─ SIGTERM to the process
  ├─ Wait a 5s grace period
  ├─ SIGKILL if still alive
  ├─ Check whether dist/ has partial output:
  │   ├─ dist/index.html exists → mark the job as 'partial', continue with what's there
  │   └─ dist/index.html missing → retry (max 2 times, with exponential backoff)
  └─ After 3 failed attempts → job.status = 'failed', notify via webhook

OpenCode exit code != 0:
  └─ Same handling as the timeout

dist/index.html missing after completion:
  ├─ Detailed log of the dist/ contents
  ├─ Save the output to git anyway (branch 'iteration-{N}-partial')
  └─ Job failed with a descriptive error

Provider API error (401, 429, 500):
  ├─ 401 → job.status = 'failed', message: "Invalid API key for {provider}"
  ├─ 429 → retry after a backoff (1min, 5min, 15min)
  └─ 500 → retry after 30s (max 3 attempts)
```

---

## WF-02 — Refinement

**Trigger:** `POST /api/v1/projects/:slug/refine`  
**Preconditions:** at least one completed generation for the project  
**Difference from WF-01:** uses `Andy Code Cat-refiner`, has context from the previous iteration

```
[Identical to WF-01 up to OPENCODE EXECUTION, with these differences:]

GIT SETUP (different):
  ├─ git clone the project repo into /data/workspaces/{jobId}/
  ├─ git checkout iteration-{N-1} (last completed iteration)
  ├─ Copy the current dist/ state into the working dir
  └─ git checkout -b iteration-{N}

CONTEXT BUILDING (different):
  ├─ iteration.isFirstGeneration = false
  ├─ iteration.previousManifest = read the current dist/MANIFEST.json
  ├─ iteration.changesRequested = body.prompt
  └─ 'refine-standard' profile layers applied (not 'landing-page-standard')

OPENCODE (different):
  └─ --agent Andy Code Cat-refiner (not Andy Code Cat-builder)

POST-PROCESSING (identical to WF-01)
```

---

## WF-03 — Auto-Deploy Post-Generation

**Trigger:** automatic at the end of WF-01 or WF-02 (if deployment.mode != 'zip_export')  
**Preconditions:** output in /var/www/{slug}/ (staged by WF-01)

```
DEPLOY WORKER (BullMQ queue 'deploy')
  │
  ├─ Load the Project and the latest Deployment (if any)
  │
  ├─ NGINX CONFIG GENERATION
  │   ├─ Render the nginx template (Nunjucks) with:
  │   │   ├─ server_name: {slug}.Andy Code Cat.io (or a custom domain)
  │   │   ├─ root: /var/www/{slug}/
  │   │   └─ ssl: certificate paths (if they already exist)
  │   └─ Save to /etc/nginx/sites-available/Andy Code Cat-{slug}.conf
  │
  ├─ NGINX TEST
  │   ├─ Run: nginx -t
  │   ├─ Exit 0 → continue
  │   └─ Exit != 0 → ROLLBACK:
  │       ├─ Remove the just-written config
  │       ├─ Restore the previous config (if one existed)
  │       ├─ nginx -t + nginx reload (for safety)
  │       └─ Deploy job failed
  │
  ├─ SYMLINK SITES-ENABLED (if it doesn't exist)
  │   └─ ln -s sites-available/Andy Code Cat-{slug}.conf sites-enabled/
  │
  ├─ NGINX RELOAD
  │   └─ nginx reload (graceful, zero-downtime)
  │
  ├─ SSL — CERTBOT
  │   ├─ Check whether a certificate already exists for this domain
  │   ├─ Exists and is valid → skip
  │   ├─ Exists and is expiring soon (<30 days) → certbot renew
  │   └─ Doesn't exist → certbot --nginx -d {domain} --non-interactive --agree-tos
  │       ├─ Success → nginx reload with SSL active
  │       └─ Fails (e.g. DNS not yet propagated):
  │           ├─ The site stays live over HTTP
  │           └─ Schedule an SSL retry in 15 minutes (BullMQ delayed job)
  │
  ├─ HEALTH CHECK
  │   ├─ HTTP GET https://{domain}/
  │   ├─ 200 → deploy completed
  │   └─ Not 200 → log a warning, the deployment is still saved
  │
  ├─ Save the Deployment to MongoDB:
  │   { nginxConfig, publishedAt, isActive: true }
  ├─ Update Project.status = 'live', deployment.publishedUrl
  │
  └─ Emit Webhook: deploy.live
```

---

## WF-04 — Image Placeholder MVP

**Trigger:** automatic after WF-01/02 (always, regardless of IMAGE_GEN_PROVIDER)  
**MVP goal:** replace placeholders with optimized placeholder SVGs, not real images

```
IMAGE WORKER — MVP MODE (IMAGE_GEN_PROVIDER = 'disabled')
  │
  ├─ Read Job.output.imagePlaceholders[]
  │
  ├─ For each placeholder:
  │   ├─ Determine the image type from the filename:
  │   │   ├─ hero-* → 1200x600 landscape placeholder
  │   │   ├─ icon-* → 80x80 square placeholder
  │   │   ├─ team-* / person-* → 400x400 square placeholder
  │   │   ├─ feature-* → 600x400 landscape placeholder
  │   │   └─ default → 800x450 landscape placeholder
  │   │
  │   ├─ Generate the placeholder SVG:
  │   │   ├─ Background: neutral color consistent with the project's primaryColor
  │   │   ├─ Central icon: emoji/SVG path contextual to the type
  │   │   ├─ Text: short description (max 40 chars from the placeholder description)
  │   │   └─ Dimensions: correct for the type
  │   │
  │   ├─ Save the SVG to dist/images/{filename} (with a .svg extension, or convert to PNG via sharp)
  │   └─ Update the src in the HTML if needed (e.g. .jpg → .svg)
  │
  ├─ Generate dist/IMAGE_PROMPTS.json (calls Andy Code Cat-image-prompt-gen via OpenCode)
  │   └─ This file is ready for Phase 2 (real image gen)
  │
  ├─ Git commit: "iteration-{N}: add image placeholders"
  │
  └─ If a deploy is already scheduled: trigger a re-deploy to include the images
```

**Generated Placeholder SVG Structure:**

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

## WF-05 — ZIP Export

**Trigger:** `GET /api/v1/projects/:slug/export/zip`  
**Type:** synchronous (direct response) for files < 50MB, asynchronous for files > 50MB

```
EXPORT ZIP HANDLER
  │
  ├─ Verify the project exists and has at least one completed generation
  ├─ Verify authorization (owner or an API client with export permission)
  │
  ├─ Check cache: is there a recent ZIP export (<1h)?
  │   ├─ Yes → return the existing signed URL
  │   └─ No → generate a new ZIP
  │
  ├─ ZIP GENERATION
  │   ├─ Source: /var/www/{slug}/ (deployed output)
  │   ├─ Include: everything (HTML, CSS, JS, images, assets)
  │   ├─ Exclude: AUDIT.json, temporary files (.DS_Store, etc.)
  │   ├─ Add at the ZIP root:
  │   │   ├─ README.md (deploy instructions, file structure)
  │   │   └─ nginx-sample.conf (sample nginx config for self-hosting)
  │   └─ Save to /data/exports/{slug}-{timestamp}.zip
  │
  ├─ Generate a signed URL:
  │   └─ JWT: { path: '/data/exports/...zip', exp: now + 3600 }
  │       → /api/v1/download/{token}
  │
  ├─ Save Deployment.exportPackage to MongoDB
  │
  └─ Response: { downloadUrl, expiresAt, sizeBytes, filename }

DOWNLOAD ENDPOINT: GET /api/v1/download/:token
  ├─ Verify and decode the JWT
  ├─ Verify the file exists
  ├─ Content-Disposition: attachment; filename="{slug}-site.zip"
  └─ Stream the file → client
```

---

## WF-06 — Export Nginx Config

**Trigger:** `GET /api/v1/projects/:slug/export/nginx`  
**Type:** synchronous, direct response

```
NGINX EXPORT HANDLER
  │
  ├─ Verify the project exists and has at least one generation
  ├─ Load the latest Deployment from MongoDB (if any)
  │
  ├─ Generate nginx.conf (if not already on the Deployment):
  │   └─ Render the template (see SPEC.md §9) with:
  │       ├─ server_name: {deployment.domain}
  │       ├─ root: /var/www/{slug}/ → replaced with a path chosen by the client
  │       └─ Note in the file: "# Replace /var/www/{slug}/ with your webroot"
  │
  ├─ Also generate dns-instructions.md:
  │   ├─ Instructions for the A record (points to the Andy Code Cat server IP)
  │   ├─ Instructions for the CNAME record (alternative)
  │   └─ Certbot instructions for SSL on the client's server
  │
  └─ Response:
      Content-Type: text/plain
      Content-Disposition: attachment; filename="nginx-{slug}.conf"
      Body: [nginx.conf content]
```

**Exported nginx.conf — variables to replace, clearly commented:**

```nginx
# Andy Code Cat Export — nginx.conf for {project.name}
# 
# INSTRUCTIONS:
# 1. Replace WEBROOT with the path where you extracted the ZIP file
# 2. Replace YOURDOMAIN with your domain
# 3. Run: sudo certbot --nginx -d YOURDOMAIN
# 4. Run: sudo nginx -t && sudo systemctl reload nginx
#
# DNS: Create an A record for YOURDOMAIN pointing to {serverIp}

server {
    listen 80;
    server_name YOURDOMAIN;      # <-- replace
    root WEBROOT;                # <-- replace with the extracted ZIP's path
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

## WF-07 — Real Image Generation (Phase 2)

**Trigger:** IMAGE_GEN_PROVIDER != 'disabled', automatic after WF-04  
**Replaces:** WF-04 for the image-generation part

```
IMAGE WORKER — REAL MODE
  │
  ├─ Read dist/IMAGE_PROMPTS.json (generated by WF-04)
  ├─ Read the configured provider: DALL-E | SDXL | Flux
  │
  ├─ For each prompt in IMAGE_PROMPTS.json:
  │   │
  │   ├─ Call ImageProvider.generate():
  │   │   ├─ DALL-E: POST https://api.openai.com/v1/images/generations
  │   │   │   { model: "dall-e-3", prompt: ..., size: "1792x1024", quality: "standard" }
  │   │   ├─ SDXL local: POST http://localhost:7860/sdapi/v1/txt2img
  │   │   │   { prompt: ..., negative_prompt: ..., width: ..., height: ..., steps: 30 }
  │   │   └─ Flux API: ... (provider-specific endpoint)
  │   │
  │   ├─ On success:
  │   │   ├─ Optimize the image with sharp: resize + compress
  │   │   ├─ Save to dist/images/{filename}.jpg (or .webp)
  │   │   ├─ Update placeholder.status = 'done'
  │   │   └─ Update the HTML: replace the SVG placeholder with the real image
  │   │
  │   └─ On error:
  │       ├─ Detailed error log
  │       ├─ Increment placeholder.retryCount
  │       ├─ If retryCount < 2 → re-queue with backoff
  │       └─ If retryCount >= 2 → keep the SVG placeholder, status = 'failed'
  │
  ├─ Git commit: "iteration-{N}: add AI-generated images"
  └─ Trigger a re-deploy (WF-03)
```

---

## WF-08 — Post-generation Audit (Phase 2)

**Trigger:** automatic after WF-01/02, in parallel with WF-04  
**Goal:** verify output quality without blocking the flow

```
AUDIT WORKER
  │
  ├─ Spawn OpenCode with the Andy Code Cat-auditor agent:
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
  ├─ Save the AUDIT to the Job output
  ├─ If issues with severity 'error' > 0:
  │   ├─ Log a warning (does not block the deploy)
  │   └─ Include it in the webhook payload
  └─ If score < 60: flag the project for manual review
```

---

## WF-09 — Iteration Rollback (Phase 2)

**Trigger:** `POST /api/v1/projects/:slug/iterations/:n/restore`

```
ROLLBACK HANDLER
  │
  ├─ Verify iteration N exists in the Gitea repo
  ├─ Verify iteration N completed correctly
  │
  ├─ Git: checkout the iteration-{N} branch
  ├─ Copy dist/ → /var/www/{slug}/ (overwrites the current iteration)
  ├─ Nginx reload (no config change, just static files)
  │
  ├─ Update Project.iterationCount = N (not N+1, to avoid confusion)
  ├─ Create a new Deployment with the note: "rollback to iteration-{N}"
  │
  └─ Response: { success: true, restoredIteration: N, liveUrl: "..." }
```

---

## WF-10 — Webhook Delivery

**Trigger:** every relevant status change  
**Recipients:** webhook URLs configured for the project

```
WEBHOOK EVENTS:
  job.queued      → job created and queued
  job.started     → a worker picked up the job
  job.progress    → progress update (every 20%)
  job.completed   → generation completed successfully
  job.failed      → generation failed
  deploy.started  → deploy worker started
  deploy.live     → site published and reachable
  deploy.failed   → deploy failed
  export.ready    → ZIP ready for download

STANDARD PAYLOAD:
  {
    "event": "job.completed",
    "timestamp": "2025-01-15T10:30:00Z",
    "projectSlug": "myclient-landing",
    "jobId": "...",
    "data": {
      // depends on the event
      "status": "completed",
      "outputUrl": "https://myclient-landing.Andy Code Cat.io",
      "iterationNumber": 1,
      "imagePlaceholders": 5,
      "gitCommit": "abc123"
    },
    "signature": "hmac-sha256:{secret}"  // for authenticity verification
  }

DELIVERY:
  ├─ POST to the webhook URL with the JSON payload
  ├─ Timeout: 10s
  ├─ Retry: 3 attempts with exponential backoff (1min, 5min, 15min)
  ├─ Considered a success: HTTP 2xx
  └─ Log every delivery (success and failure) in MongoDB
```

---

## State Transition Table

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
  ├─→ [deploy fail]   → generated (returns to the pre-deploy state)
  │
live
  ├─→ [POST /refine]  → generating
  ├─→ [DELETE /deploy] → generated
  │
error
  └─→ [POST /generate] → generating (manual retry)
```

### Job.status

```
waiting → active → completed
                 ↘ failed (→ retry → waiting, max 3)
         ↘ stalled (worker died, BullMQ auto-recovery)
```

---

## Concurrency and Locking

### Rule: one active job per project

```typescript
// In the API handler, before creating the job:
const activeJob = await Job.findOne({
  projectId: project._id,
  status: { $in: ['waiting', 'active'] }
});

if (activeJob) {
  throw new ConflictError(
    `A job is already running for this project: ${activeJob._id}`,
    { activeJobId: activeJob._id, status: activeJob.status }
  );
}
```

### Workspace Isolation

Every job has its own `/data/workspaces/{jobId}/` directory — no sharing between concurrent jobs of the same project.

### Deploy Lock

The deploy worker acquires a Redis lock before modifying nginx:

```typescript
const lock = await redisClient.set(
  `deploy-lock:${project.slug}`,
  jobId,
  'EX', 60,   // 60 seconds max
  'NX'         // only if it doesn't already exist
);

if (!lock) {
  // A deploy is already in progress for this project, retry in 5s
  throw new Error('Deploy lock not acquired');
}
```

---

## Worker Configuration

```typescript
// apps/api/src/workers/index.ts

// Generation Worker
const generationWorker = new Worker('generation', generationProcessor, {
  connection: redisClient,
  concurrency: 3,          // max 3 parallel generations
  limiter: {
    max: 10,               // max 10 jobs every
    duration: 60000        // 60 seconds
  }
});

// Deploy Worker  
const deployWorker = new Worker('deploy', deployProcessor, {
  connection: redisClient,
  concurrency: 2           // max 2 parallel deploys (nginx reload is fast)
});

// Image Worker
const imageWorker = new Worker('image-gen', imageProcessor, {
  connection: redisClient,
  concurrency: 5           // can be more parallel (I/O bound)
});

// Retry configuration for all workers
const defaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 60000            // 1 minute base
  },
  removeOnComplete: {
    age: 7 * 24 * 3600,    // keep completed jobs for 7 days
    count: 100
  },
  removeOnFail: {
    age: 30 * 24 * 3600    // keep failed jobs for 30 days
  }
};
```

---

## Monitoring and Observability

### Structured Log for Every Step

```typescript
// Every worker logs in this format (Pino):
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

### Metrics to Collect (for a future dashboard)

| Metric | Description |
|---|---|
| `generation.duration_ms` | Total generation duration |
| `generation.opencode_duration_ms` | OpenCode CLI time only |
| `generation.files_count` | Files generated in dist/ |
| `generation.placeholder_count` | Image placeholders found |
| `deploy.duration_ms` | Nginx deploy duration |
| `deploy.ssl_new` | New SSL certificate issued |
| `job.retry_count` | Number of retries for failed jobs |
| `preprompt.tokens_estimated` | Estimated tokens for the resolved prompt |
