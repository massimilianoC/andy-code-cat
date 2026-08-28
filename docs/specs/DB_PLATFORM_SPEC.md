# Andy Code Cat — Multi-tenant MongoDB Schema and Platform Architecture

---

## 1. Multi-tenant Schema Principles

- **Tenant = User**: each user is their own tenant. Data is isolated by `ownerId`.
- **Shared slug namespace**: subdomains are global, so `slug` must be unique in the `sites` collection rather than unique per user.
- **Collaboration**: a project keeps an `ownerId` plus a `collaborators[]` array.
- **Audit trail**: every relevant action (deploy, publish, visibility changes) is logged.

---

## 2. MongoDB Collections

### 2.1 `users`

```typescript
interface User {
  _id: ObjectId;
  
  // Identity
  email: string;                    // unique index
  emailVerified: boolean;
  passwordHash?: string;            // null if SSO only
  
  // SSO
  ssoProviders: Array<{
    provider: 'google' | 'github';
    providerId: string;
    accessToken?: string;           // encrypted at rest
    refreshToken?: string;
  }>;
  
  // Profile
  profile: {
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    useCase?: 'personal' | 'agency' | 'testing';
  };
  
  // GDPR
  gdpr: {
    tosAcceptedAt: Date;
    privacyAcceptedAt: Date;
    marketingConsent: boolean;
    marketingConsentAt?: Date;
    dataImprovementConsent: boolean;
    cookieConsent: 'minimal' | 'full';
    cookieConsentAt: Date;
    deletionRequestedAt?: Date;
  };
  
  // Credits and plan
  billing: {
    plan: 'free' | 'pro' | 'agency';
    planRenewsAt?: Date;
    credits: number;                // current credits
    creditsLifetime: number;        // total credits ever granted (analytics)
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  };
  
  // Security
  security: {
    lastLoginAt?: Date;
    lastLoginIp?: string;
    failedLoginAttempts: number;
    lockedUntil?: Date;
    passwordResetToken?: string;
    passwordResetExpires?: Date;
    emailVerificationToken?: string;
  };
  
  // Settings
  settings: {
    defaultProvider?: string;      // preferred AI provider
    defaultModel?: string;
    notificationsEmail: boolean;
    timezone: string;
  };
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;                 // soft delete
}

// Indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ 'ssoProviders.providerId': 1 });
db.users.createIndex({ 'billing.stripeCustomerId': 1 });
db.users.createIndex({ deletedAt: 1 });
```

---

### 2.2 `projects`

```typescript
interface Project {
  _id: ObjectId;
  
  // Ownership and collaboration
  ownerId: ObjectId;               // ref users
  collaborators: Array<{
    userId: ObjectId;              // ref users
    email: string;                 // denormalized for quick display
    canEdit: boolean;              // simple toggle
    invitedAt: Date;
    acceptedAt?: Date;
    inviteToken?: string;          // token to accept the invite via email
  }>;
  
  // Project identity
  name: string;
  description?: string;
  type: 'landing_page' | 'mini_site' | 'portfolio' | 'ecommerce';
  lang: string;                    // 'it' | 'en' | etc.
  
  // Original input (wizard)
  wizard: {
    originalPrompt: string;
    refinedPrompt?: string;        // after step 5 (optional user correction)
    themeId?: string;              // ref theme library
    themeOverride?: ThemeOverride;
    attachments: WizardAttachment[];
    briefGenerated?: string;       // brief text shown in step 5
    briefAcceptedAt?: Date;
  };
  
  // AI configuration
  aiConfig: {
    provider: string;
    model: string;
    prepromptProfileId: ObjectId;
    prepromptProfileVersion: string;
    maxAutoRefinementLoops: number; // configurable, default 3
    qualityCheckEnabled: boolean;
    openCodeConfigOverride?: object;
  };
  
  // Publishing
  site: {
    // Temporary name generated at creation
    tempSlug: string;              // e.g. "velvet-phoenix-42"
    
    // Name chosen by the user at publication
    publishedSlug?: string;        // e.g. "pizzeria-napoli" — globally unique
    
    // Custom domain
    customDomain?: string;
    customDomainVerifiedAt?: Date;
    customDomainSslAt?: Date;
    
    // Visibility
    visibility: 'private' | 'password' | 'public';
    passwordHash?: string;         // bcrypt, only if visibility = 'password'
    
    // Final URLs
    internalUrl: string;           // https://tempSlug.Andy Code Cat.io (always active)
    publicUrl?: string;            // https://publishedSlug.Andy Code Cat.io (after publish)
    customUrl?: string;            // https://customDomain (if configured)
    
    publishedAt?: Date;
    unpublishedAt?: Date;
    isPublished: boolean;
  };
  
  // Local Git (Gitea)
  git: {
    repoId?: number;               // Gitea repo ID
    localPath: string;             // /data/repos/{projectId}/
    defaultBranch: string;
    currentIteration: number;
  };
  
  // Operational state
  status: 'draft' | 'generating' | 'generated' | 'deploying' | 'live' | 'paused_credits' | 'error';
  currentJobId?: string;
  lastError?: string;
  
  // Credit metrics
  credits: {
    totalConsumed: number;
    lastJobConsumed: number;
    breakdown: CreditBreakdown[];  // for audit
  };
  
  // Publication badges
  badges: Array<'published' | 'verified' | 'featured'>;
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

interface WizardAttachment {
  type: 'pdf' | 'doc' | 'image';
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  extractedText?: string;         // for PDF/DOC (extracted at upload time)
  aiDescription?: string;         // for images (LLM description)
}

interface ThemeOverride {
  primaryColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  mood?: string;
}

interface CreditBreakdown {
  jobId: ObjectId;
  jobType: string;
  creditsUsed: number;
  timestamp: Date;
  description: string;
}

// Indici
db.projects.createIndex({ ownerId: 1, deletedAt: 1 });
db.projects.createIndex({ 'collaborators.userId': 1 });
db.projects.createIndex({ 'site.tempSlug': 1 }, { unique: true });
db.projects.createIndex({ 'site.publishedSlug': 1 }, { unique: true, sparse: true });
db.projects.createIndex({ 'site.customDomain': 1 }, { sparse: true });
db.projects.createIndex({ status: 1 });
db.projects.createIndex({ createdAt: -1 });
```

---

### 2.3 `jobs`

```typescript
interface Job {
  _id: ObjectId;
  bullJobId: string;
  projectId: ObjectId;
  ownerId: ObjectId;               // denormalized for fast queries
  
  type: 'generation' | 'refinement' | 'deploy' | 'image_gen' | 
        'quality_check' | 'export_zip' | 'ssl_provision';
  
  input: {
    prompt?: string;
    resolvedPrompt?: string;       // after preprompt engine
    prepromptProfileId?: ObjectId;
    prepromptProfileVersion?: string;
    attachmentPaths?: string[];
    parentJobId?: string;
    iterationNumber: number;
    
    // Only for refinement
    refinementPrompt?: string;
    targetFiles?: string[];
    
    // Debug
    debugInfo?: PrepromptDebugInfo;
  };
  
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'stalled' | 'cancelled';
  progress: number;                // 0-100
  progressLabel?: string;          // "Generating HTML..." for the UI
  
  opencode?: {
    pid?: number;
    workingDir: string;
    sessionId?: string;
    logPath: string;
    exitCode?: number;
  };
  
  // Quality check loop
  qualityCheck?: {
    iterationsRun: number;
    maxIterations: number;
    playwrightScore?: number;
    llmVerificationPassed?: boolean;
    issues?: QualityIssue[];
    autoFixed: boolean;
  };
  
  output?: {
    outputDir: string;
    filesGenerated: string[];
    imagePlaceholders: ImagePlaceholder[];
    gitBranch: string;
    gitCommitHash?: string;
    manifestJson?: object;
    auditJson?: object;
  };
  
  // Tracking costi reali
  costs: {
    creditsCharged: number;
    tokensLlm: number;             // token LLM totali consumati
    tokensInput: number;
    tokensOutput: number;
    modelUsed: string;
    apiCallsCount: number;
    imageGenCount: number;
    playwrightRuns: number;
  };
  
  error?: {
    message: string;
    stack?: string;
    retryCount: number;
    lastRetryAt?: Date;
  };
  
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

interface QualityIssue {
  type: 'missing_image' | 'broken_link' | 'js_error' | 'content_mismatch' | 'mobile_layout';
  severity: 'error' | 'warning';
  description: string;
  autoFixApplied: boolean;
}

// Indici
db.jobs.createIndex({ projectId: 1, createdAt: -1 });
db.jobs.createIndex({ ownerId: 1, status: 1 });
db.jobs.createIndex({ bullJobId: 1 }, { unique: true });
db.jobs.createIndex({ status: 1, type: 1 });
```

---

### 2.4 `deployments`

```typescript
interface Deployment {
  _id: ObjectId;
  projectId: ObjectId;
  jobId: ObjectId;
  ownerId: ObjectId;
  
  // Generated nginx config
  nginx: {
    configContent: string;         // generated nginx.conf text
    configPath: string;            // /etc/nginx/sites-available/pf-{slug}.conf
    serverName: string;
    rootPath: string;
    sslCertPath?: string;
    sslKeyPath?: string;
    sslProvider: 'letsencrypt' | 'custom' | 'none';
    sslExpiresAt?: Date;
  };
  
  // Visibility at deploy time
  visibility: 'private' | 'password' | 'public';
  
  // Export
  export?: {
    zipPath?: string;
    zipUrl?: string;
    zipExpiresAt?: Date;
    zipSizeBytes?: number;
    nginxExportedAt?: Date;
  };
  
  // SSL provisioning
  ssl: {
    status: 'pending' | 'active' | 'failed' | 'expired';
    provisionedAt?: Date;
    failedAt?: Date;
    failReason?: string;
    retryScheduledAt?: Date;
  };
  
  publishedAt?: Date;
  unpublishedAt?: Date;
  isActive: boolean;
  
  // Who deployed (automatic system or third-party API client)
  deployedBy: 'system' | 'api_client';
  apiClientId?: ObjectId;
  
  // Notifications
  notificationSent: boolean;
  notificationSentAt?: Date;
  
  createdAt: Date;
}

// Indici
db.deployments.createIndex({ projectId: 1, isActive: 1 });
db.deployments.createIndex({ ownerId: 1, publishedAt: -1 });
```

---

### 2.5 `sites` (namespace globale slug)

```typescript
// Separate collection to guarantee atomic, globally unique slugs
interface SiteSlug {
  _id: ObjectId;
  slug: string;                    // globally unique
  projectId: ObjectId;
  ownerId: ObjectId;
  type: 'temp' | 'published' | 'custom_domain';
  reservedAt: Date;
  releasedAt?: Date;               // when the project is deleted
}

db.sites.createIndex({ slug: 1 }, { unique: true });
db.sites.createIndex({ projectId: 1 });
```

---

### 2.6 `credit_transactions`

```typescript
interface CreditTransaction {
  _id: ObjectId;
  userId: ObjectId;
  
  type: 'purchase' | 'subscription_grant' | 'signup_bonus' | 
        'job_charge' | 'refund' | 'manual_adjustment';
  
  amount: number;                  // positive = credit, negative = charge
  balanceBefore: number;
  balanceAfter: number;
  
  // Only for job charges
  jobId?: ObjectId;
  projectId?: ObjectId;
  jobType?: string;
  
  // Only for purchases
  stripePaymentIntentId?: string;
  pricePaid?: number;              // in EUR cents
  currency?: string;
  
  description: string;
  
  createdAt: Date;
}

// Indici
db.credit_transactions.createIndex({ userId: 1, createdAt: -1 });
db.credit_transactions.createIndex({ stripePaymentIntentId: 1 }, { sparse: true });
db.credit_transactions.createIndex({ jobId: 1 }, { sparse: true });
```

---

### 2.7 `preprompt_profiles` (already in SPEC.md, integrated here)

```typescript
// Added relative to the earlier SPEC.md:
interface PrepromptProfile {
  // ... (see SPEC.md §4.2)
  
  // New: multi-tenant visibility
  visibility: 'system' | 'private' | 'org_shared';
  ownerId?: ObjectId;              // null for system profiles
  
  // New: usage statistics
  stats: {
    timesUsed: number;
    avgQualityScore?: number;
    lastUsedAt?: Date;
  };
}
```

---

### 2.8 `api_clients` (for third parties)

```typescript
interface ApiClient {
  _id: ObjectId;
  ownerId: ObjectId;
  
  name: string;
  description?: string;
  
  // API key
  keyPrefix: string;               // "pf_live_" or "pf_test_"
  keyHash: string;                 // SHA-256 of the full key
  keyLastFour: string;             // for display "...ab3f"
  
  // Permissions
  scopes: Array<'generate' | 'deploy' | 'export' | 'read'>;
  
  // Specific rate limits
  rateLimits: {
    generatePerHour: number;
    deployPerDay: number;
  };
  
  // Default webhook for this client
  webhookUrl?: string;
  webhookSecret?: string;
  
  isActive: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
  revokedAt?: Date;
}
```

---

### 2.9 `themes` (theme library)

```typescript
interface Theme {
  _id: ObjectId;
  themeId: string;                 // e.g. "bold-dark"
  name: string;                    // e.g. "Midnight"
  category: 'minimal' | 'bold' | 'elegant' | 'playful' | 'dark' | 'corporate';
  
  previewImagePath: string;        // PNG 300×200
  
  cssVariables: Record<string, string>;   // CSS custom properties
  fontImports: string[];           // Google Fonts URLs
  
  // Base file for OpenCode
  cssTemplatePath: string;         // CSS template to inject into the prompt
  
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}
```

---

## 3. Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│  Next.js UI  │  Third-party API client  │  Email (notifications)    │
└──────┬──────────────────┬───────────────────────────────────────┘
       │ HTTPS            │ API Key
┌──────▼──────────────────▼───────────────────────────────────────┐
│                    FASTIFY API GATEWAY                            │
│  JWT/SSO Auth  │  API Key Auth  │  Rate Limiting  │  Validation  │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│                       CORE SERVICES                              │
│                                                                  │
│  AuthService     ProjectService    PrepromptEngine               │
│  BillingService  WizardService     ThemeService                  │
│  NotificationSvc DeployService     ExportService                 │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│               JOB ORCHESTRATOR (BullMQ + Redis)                  │
│  generation │ refinement │ deploy │ image-gen │ quality-check    │
│  ssl-provision │ export-zip │ notification                       │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│                       WORKER PROCESSES                           │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  GenerationWorker                                          │  │
│  │  PrepromptEngine → OpenCode CLI → PostProcessor            │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  QualityCheckWorker                                        │  │
│  │  Playwright → LLM Verifier → AutoFixer (OpenCode) → Loop  │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  DeployWorker                                              │  │
│  │  nginx config → nginx -t → reload → certbot SSL           │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ImageWorker                                               │  │
│  │  MVPMode: SVG placeholders │ Phase2: DALL-E/SDXL/Flux     │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  NotificationWorker                                        │  │
│  │  Email (Resend/Nodemailer) │ In-app (futura)              │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────┬──────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE                                 │
│  MongoDB 7   │  Redis 7   │  Gitea   │  nginx   │  MinIO (opt)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Credit System — Full Architecture

### 4.1 Operation Cost Table

| Operation | Credits | Notes |
|---|---|---|
| Landing page generation (base) | 5 | no attachments |
| + attached PDF | +2 | extraction + use in prompt |
| + each attached image | +0.5 | vision LLM description |
| + each quality-check iteration | +1.5 | Playwright + LLM verification |
| + real AI image generation (Phase 2) | +1 per image | DALL-E/SDXL |
| Refinement (manual iteration) | 3 | prompt → OpenCode → deploy |
| Publication (first deploy) | 1 | nginx + SSL |
| Re-deploy after edit | 0 | free |
| Export ZIP | 0 | free |

### 4.2 Pre-Job Estimate

```typescript
function estimateJobCredits(input: JobEstimateInput): CreditEstimate {
  let credits = 5; // base
  const breakdown: string[] = ['Base generation: 5 credits'];

  if (input.hasPdf) {
    credits += 2;
    breakdown.push('+2 attached PDF');
  }

  credits += input.imageCount * 0.5;
  if (input.imageCount > 0) {
    breakdown.push(`+${input.imageCount * 0.5} images (${input.imageCount}×0.5)`);
  }

  const loops = input.maxQualityLoops ?? 3;
  credits += loops * 1.5;
  breakdown.push(`+${loops * 1.5} quality check (${loops} iterations×1.5)`);

  return {
    estimated: Math.ceil(credits),
    breakdown,
    confidence: 'approximate' // estimate, not exact
  };
}
```

### 4.3 Real-Time Tracking

Every worker step charges credits incrementally:

```typescript
// In GenerationWorker, after each significant step:
async function chargeCredits(
  userId: ObjectId,
  jobId: ObjectId,
  projectId: ObjectId,
  amount: number,
  description: string
): Promise<void> {
  // Transazione atomica MongoDB
  const session = await mongoose.startSession();
  await session.withTransaction(async () => {
    const user = await User.findById(userId).session(session);
    
    if (user.billing.credits < amount) {
      throw new InsufficientCreditsError(user.billing.credits, amount);
    }
    
    await User.updateOne(
      { _id: userId },
      { $inc: { 'billing.credits': -amount } },
      { session }
    );
    
    await CreditTransaction.create([{
      userId,
      type: 'job_charge',
      amount: -amount,
      balanceBefore: user.billing.credits,
      balanceAfter: user.billing.credits - amount,
      jobId,
      projectId,
      description
    }], { session });
    
    await Project.updateOne(
      { _id: projectId },
      { $inc: { 'credits.totalConsumed': amount, 'credits.lastJobConsumed': amount } },
      { session }
    );
  });
  
  // SSE push to the client if connected
  sseManager.emit(userId.toString(), 'credits_updated', {
    credits: user.billing.credits - amount,
    charged: amount,
    description
  });
}
```

### 4.4 Pause Handling for Exhausted Credits

```typescript
// InsufficientCreditsError caught in the worker:
try {
  await chargeCredits(userId, jobId, projectId, 1.5, 'Quality check loop 2/3');
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    // Save current state
    await Job.updateOne({ _id: jobId }, {
      status: 'paused_credits',
      'opencode.checkpointDir': currentWorkspaceDir
    });
    await Project.updateOne({ _id: projectId }, { status: 'paused_credits' });
    
    // Notify user
    await notificationQueue.add('credits_exhausted', { userId, projectId, jobId });
    
    // Do NOT fail the job — suspend it
    return { paused: true };
  }
  throw err;
}
```

---

## 5. Quality Check Loop — Architecture

```typescript
// QualityCheckWorker
async function runQualityLoop(
  job: Job,
  project: Project,
  workspaceDir: string
): Promise<QualityResult> {
  
  const maxIterations = project.aiConfig.maxAutoRefinementLoops; // configurable
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    
    // STEP 1: Playwright analysis
    const playwrightResult = await runPlaywrightCheck(workspaceDir);
    // Playwright serves the site locally on a random port, then:
    // - Checks that the page loads without JS errors
    // - Mobile (375px) and desktop (1280px) screenshots
    // - Verifies that all images loaded (no broken links)
    // - Counts console errors
    
    // STEP 2: LLM verifies content match
    const llmResult = await runLlmVerification({
      originalBrief: project.wizard.briefGenerated,
      generatedHtml: await fs.readFile(`${workspaceDir}/dist/index.html`, 'utf8'),
      screenshotBase64: playwrightResult.desktopScreenshot
    });
    // LLM (lightweight model: Haiku) checks:
    // - Does the site meet the brief's objective?
    // - Are all requested sections present?
    // - Is the tone correct?
    
    const score = calculateScore(playwrightResult, llmResult);
    
    // STEP 3: Decide whether a fix is needed
    if (score >= QUALITY_THRESHOLD) {
      // Acceptable quality — exit the loop
      return { passed: true, score, iterationsRun: iteration };
    }
    
    if (iteration >= maxIterations) {
      // Limit reached — return the result anyway
      return { passed: false, score, iterationsRun: iteration, issues: llmResult.issues };
    }
    
    // STEP 4: Auto-fix with OpenCode
    const fixPrompt = buildFixPrompt(playwrightResult.issues, llmResult.issues);
    await runOpenCode(workspaceDir, fixPrompt, 'Andy Code Cat-refiner');
    
    // Charge credits for this iteration
    await chargeCredits(userId, jobId, projectId, 1.5, `Quality check loop ${iteration}/${maxIterations}`);
    
    // Update progress UI
    await updateJobProgress(jobId, `Quality check — iteration ${iteration}/${maxIterations}`, 
                            70 + (iteration / maxIterations * 20));
  }
}

const QUALITY_THRESHOLD = 75; // score 0-100

function buildFixPrompt(
  playwrightIssues: PlaywrightIssue[],
  llmIssues: LlmIssue[]
): string {
  const issues = [
    ...playwrightIssues.map(i => `- [${i.type}] ${i.description}`),
    ...llmIssues.map(i => `- [content] ${i.description}`)
  ].join('\n');
  
  return `Fix these problems in the site under dist/:\n${issues}\n\nDo not change the overall design, only fix the listed problems.`;
}
```

---

## 6. Multi-tenant Nginx Publication

### 6.1 Nginx File Structure

```
/etc/nginx/
├── nginx.conf                          # main config (do not touch)
├── sites-available/
│   ├── Andy Code Cat-api.conf              # API reverse proxy
│   ├── pf-velvet-phoenix-42.conf       # temp slug (created when the project is created)
│   ├── pf-pizzeria-napoli.conf         # published slug (created at publication)
│   └── pf-custom-pizzerianapoli-it.conf # custom domain (created at DNS verification)
└── sites-enabled/
    └── [symlink to sites-available]
```

### 6.2 Config for a Public Site

```nginx
# Auto-generated by Andy Code Cat DeployWorker
# Project: {projectId} | Slug: {slug} | Generated: {datetime}
# DO NOT EDIT MANUALLY

server {
    listen 80;
    server_name {slug}.Andy Code Cat.io;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name {slug}.Andy Code Cat.io;

    ssl_certificate     /etc/letsencrypt/live/{slug}.Andy Code Cat.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{slug}.Andy Code Cat.io/privkey.pem;

    root /var/www/Andy Code Cat/{projectId}/dist;
    index index.html;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    # Cache assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SEO: robots noindex if not public
    location = /robots.txt {
        return 200 "{robots_content}";
    }

    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
}
```

### 6.3 Config for a Password-Protected Site

```nginx
server {
    listen 443 ssl http2;
    server_name {slug}.Andy Code Cat.io;
    # ... ssl config ...

    root /var/www/Andy Code Cat/{projectId}/dist;

    # Auth endpoint handled by the Andy Code Cat API
    location /_pf_auth {
        proxy_pass http://localhost:3001/internal/site-auth/{slug};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Cookie $http_cookie;
    }

    # All other paths: verify the auth cookie first
    location / {
        auth_request /_pf_auth;
        error_page 401 = @pf_login;
        try_files $uri $uri/ $uri.html =404;
    }

    location @pf_login {
        return 302 /_pf_login?redirect=$request_uri;
    }

    # Login page served by the API
    location /_pf_login {
        proxy_pass http://localhost:3001/internal/site-login-page/{slug};
    }

    # Login page CSS/JS assets (no auth)
    location /_pf_assets {
        proxy_pass http://localhost:3001/internal/assets;
    }
}
```

### 6.4 Wildcard SSL for *.Andy Code Cat.io

For subdomains, a per-subdomain certificate isn't needed if you use a wildcard:

```bash
# One-time setup (DNS challenge via Certbot + DNS plugin)
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d '*.Andy Code Cat.io' \
  -d 'Andy Code Cat.io' \
  --agree-tos \
  --email admin@Andy Code Cat.io

# The wildcard certificate automatically covers all *.Andy Code Cat.io
# No certbot run needed for each new subdomain!
```

For a custom domain (requires a dedicated certificate):

```bash
certbot --nginx \
  -d {customDomain} \
  --non-interactive \
  --agree-tos \
  --email admin@Andy Code Cat.io
```

---

## 7. Temporary Name Generation

```typescript
// Word lists for temp-name generation
const ADJECTIVES = [
  'velvet', 'cosmic', 'amber', 'silver', 'golden', 'crystal',
  'neon', 'misty', 'wild', 'swift', 'bright', 'dark',
  'jade', 'ruby', 'cobalt', 'coral', 'indigo', 'ivory'
];

const ANIMALS = [
  'phoenix', 'dragon', 'falcon', 'otter', 'lynx', 'raven',
  'tiger', 'wolf', 'fox', 'hawk', 'bear', 'lion',
  'panther', 'cobra', 'eagle', 'crane', 'dolphin', 'whale'
];

async function generateUniqueTempSlug(): Promise<string> {
  let attempts = 0;
  while (attempts < 20) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const num = Math.floor(Math.random() * 99) + 1;
    const slug = `${adj}-${animal}-${num}`;
    
    // Verify global uniqueness (across all projects of all users)
    const exists = await SiteSlug.findOne({ slug });
    if (!exists) {
      await SiteSlug.create({ slug, type: 'temp', reservedAt: new Date() });
      return slug;
    }
    attempts++;
  }
  // Fallback with a truncated UUID
  return `site-${nanoid(8)}`;
}
```

---

## 8. Plans and Limits

| Feature | Free | Pro (€19/mo) | Agency (€49/mo) |
|---|---|---|---|
| Initial credits | 50 | 500/month | 2000/month |
| Purchasable credits | ✅ | ✅ | ✅ |
| Concurrent projects generating | 1 | 3 | 10 |
| Max quality-check iterations | 2 | 5 | configurable |
| Custom domain | ❌ | ✅ | ✅ |
| Site password | ✅ | ✅ | ✅ |
| Collaborators per project | 0 | 3 | unlimited |
| Export ZIP | ✅ | ✅ | ✅ |
| API access (third parties) | ❌ | ✅ | ✅ |
| White-label (no Andy Code Cat branding) | ❌ | ❌ | ✅ |
| Priority support | ❌ | Email | Dedicated |
