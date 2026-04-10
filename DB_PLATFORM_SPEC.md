# Andy Code Cat — Schema MongoDB Multi-tenant e Architettura Piattaforma

---

## 1. Principi del Schema Multi-tenant

- **Tenant = User**: ogni utente è il proprio tenant. I dati sono isolati per `ownerId`.
- **Shared namespace per slug**: i sottodomini sono globali → `slug` univoco nel collection `sites` (non per utente)
- **Collaborazione**: un progetto ha un `ownerId` e un array `collaborators[]`
- **Audit trail**: ogni operazione significativa (deploy, publish, modifica visibilità) è loggata

---

## 2. Collections MongoDB

### 2.1 `users`

```typescript
interface User {
  _id: ObjectId;
  
  // Identità
  email: string;                    // unique index
  emailVerified: boolean;
  passwordHash?: string;            // null se solo SSO
  
  // SSO
  ssoProviders: Array<{
    provider: 'google' | 'github';
    providerId: string;
    accessToken?: string;           // cifrato a riposo
    refreshToken?: string;
  }>;
  
  // Profilo
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
  
  // Crediti e piano
  billing: {
    plan: 'free' | 'pro' | 'agency';
    planRenewsAt?: Date;
    credits: number;                // crediti correnti
    creditsLifetime: number;        // totale crediti mai avuti (analytics)
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  };
  
  // Sicurezza
  security: {
    lastLoginAt?: Date;
    lastLoginIp?: string;
    failedLoginAttempts: number;
    lockedUntil?: Date;
    passwordResetToken?: string;
    passwordResetExpires?: Date;
    emailVerificationToken?: string;
  };
  
  // Impostazioni
  settings: {
    defaultProvider?: string;      // provider AI preferito
    defaultModel?: string;
    notificationsEmail: boolean;
    timezone: string;
  };
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;                 // soft delete
}

// Indici
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
  
  // Ownership e collaborazione
  ownerId: ObjectId;               // ref users
  collaborators: Array<{
    userId: ObjectId;              // ref users
    email: string;                 // denormalizzato per display rapido
    canEdit: boolean;              // toggle semplice
    invitedAt: Date;
    acceptedAt?: Date;
    inviteToken?: string;          // token per accettare invito via email
  }>;
  
  // Identità progetto
  name: string;
  description?: string;
  type: 'landing_page' | 'mini_site' | 'portfolio' | 'ecommerce';
  lang: string;                    // 'it' | 'en' | ecc.
  
  // Input originale (wizard)
  wizard: {
    originalPrompt: string;
    refinedPrompt?: string;        // dopo step 5 (eventuale correzione utente)
    themeId?: string;              // ref temi libreria
    themeOverride?: ThemeOverride;
    attachments: WizardAttachment[];
    briefGenerated?: string;       // testo brief mostrato nello step 5
    briefAcceptedAt?: Date;
  };
  
  // Configurazione AI
  aiConfig: {
    provider: string;
    model: string;
    prepromptProfileId: ObjectId;
    prepromptProfileVersion: string;
    maxAutoRefinementLoops: number; // configurabile, default 3
    qualityCheckEnabled: boolean;
    openCodeConfigOverride?: object;
  };
  
  // Pubblicazione
  site: {
    // Nome temporaneo generato alla creazione
    tempSlug: string;              // es. "velvet-phoenix-42"
    
    // Nome scelto dall'utente alla pubblicazione
    publishedSlug?: string;        // es. "pizzeria-napoli" — unique globale
    
    // Dominio personalizzato
    customDomain?: string;
    customDomainVerifiedAt?: Date;
    customDomainSslAt?: Date;
    
    // Visibilità
    visibility: 'private' | 'password' | 'public';
    passwordHash?: string;         // bcrypt, solo se visibility = 'password'
    
    // URL finali
    internalUrl: string;           // https://tempSlug.Andy Code Cat.io (sempre attivo)
    publicUrl?: string;            // https://publishedSlug.Andy Code Cat.io (dopo publish)
    customUrl?: string;            // https://customDomain (se configurato)
    
    publishedAt?: Date;
    unpublishedAt?: Date;
    isPublished: boolean;
  };
  
  // Git locale (Gitea)
  git: {
    repoId?: number;               // Gitea repo ID
    localPath: string;             // /data/repos/{projectId}/
    defaultBranch: string;
    currentIteration: number;
  };
  
  // Stato operativo
  status: 'draft' | 'generating' | 'generated' | 'deploying' | 'live' | 'paused_credits' | 'error';
  currentJobId?: string;
  lastError?: string;
  
  // Metriche crediti
  credits: {
    totalConsumed: number;
    lastJobConsumed: number;
    breakdown: CreditBreakdown[];  // per audit
  };
  
  // Badge pubblicazione
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
  extractedText?: string;         // per PDF/DOC (estratto al momento dell'upload)
  aiDescription?: string;         // per immagini (descrizione LLM)
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
  ownerId: ObjectId;               // denormalizzato per query veloci
  
  type: 'generation' | 'refinement' | 'deploy' | 'image_gen' | 
        'quality_check' | 'export_zip' | 'ssl_provision';
  
  input: {
    prompt?: string;
    resolvedPrompt?: string;       // dopo preprompt engine
    prepromptProfileId?: ObjectId;
    prepromptProfileVersion?: string;
    attachmentPaths?: string[];
    parentJobId?: string;
    iterationNumber: number;
    
    // Solo per refinement
    refinementPrompt?: string;
    targetFiles?: string[];
    
    // Debug
    debugInfo?: PrepromptDebugInfo;
  };
  
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'stalled' | 'cancelled';
  progress: number;                // 0-100
  progressLabel?: string;          // "Generazione HTML..." per la UI
  
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
  
  // Config nginx generata
  nginx: {
    configContent: string;         // testo nginx.conf generato
    configPath: string;            // /etc/nginx/sites-available/pf-{slug}.conf
    serverName: string;
    rootPath: string;
    sslCertPath?: string;
    sslKeyPath?: string;
    sslProvider: 'letsencrypt' | 'custom' | 'none';
    sslExpiresAt?: Date;
  };
  
  // Visibilità al momento del deploy
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
  
  // Chi ha deployato (sistema automatico o API client di terze parti)
  deployedBy: 'system' | 'api_client';
  apiClientId?: ObjectId;
  
  // Notifiche
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
// Collection separata per garantire unicità globale slug in modo atomico
interface SiteSlug {
  _id: ObjectId;
  slug: string;                    // unique globale
  projectId: ObjectId;
  ownerId: ObjectId;
  type: 'temp' | 'published' | 'custom_domain';
  reservedAt: Date;
  releasedAt?: Date;               // quando il progetto viene eliminato
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
  
  amount: number;                  // positivo = accredito, negativo = addebito
  balanceBefore: number;
  balanceAfter: number;
  
  // Solo per addebiti job
  jobId?: ObjectId;
  projectId?: ObjectId;
  jobType?: string;
  
  // Solo per acquisti
  stripePaymentIntentId?: string;
  pricePaid?: number;              // in centesimi EUR
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

### 2.7 `preprompt_profiles` (già in SPEC.md, qui integrato)

```typescript
// Aggiunto rispetto a SPEC.md precedente:
interface PrepromptProfile {
  // ... (vedi SPEC.md §4.2)
  
  // Nuovo: visibilità per multi-tenant
  visibility: 'system' | 'private' | 'org_shared';
  ownerId?: ObjectId;              // null per profili system
  
  // Nuovo: statistiche uso
  stats: {
    timesUsed: number;
    avgQualityScore?: number;
    lastUsedAt?: Date;
  };
}
```

---

### 2.8 `api_clients` (per terze parti)

```typescript
interface ApiClient {
  _id: ObjectId;
  ownerId: ObjectId;
  
  name: string;
  description?: string;
  
  // Chiave API
  keyPrefix: string;               // "pf_live_" o "pf_test_"
  keyHash: string;                 // SHA-256 della chiave completa
  keyLastFour: string;             // per display "...ab3f"
  
  // Permessi
  scopes: Array<'generate' | 'deploy' | 'export' | 'read'>;
  
  // Rate limits specifici
  rateLimits: {
    generatePerHour: number;
    deployPerDay: number;
  };
  
  // Webhook di default per questo client
  webhookUrl?: string;
  webhookSecret?: string;
  
  isActive: boolean;
  lastUsedAt?: Date;
  createdAt: Date;
  revokedAt?: Date;
}
```

---

### 2.9 `themes` (libreria temi)

```typescript
interface Theme {
  _id: ObjectId;
  themeId: string;                 // es. "bold-dark"
  name: string;                    // es. "Midnight"
  category: 'minimal' | 'bold' | 'elegant' | 'playful' | 'dark' | 'corporate';
  
  previewImagePath: string;        // PNG 300×200
  
  cssVariables: Record<string, string>;   // CSS custom properties
  fontImports: string[];           // URL Google Fonts
  
  // File base per OpenCode
  cssTemplatePath: string;         // template CSS da iniettare nel prompt
  
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}
```

---

## 3. Architettura Servizi

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│  Next.js UI  │  Third-party API client  │  Email (notifiche)    │
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
│                    INFRASTRUTTURA                                 │
│  MongoDB 7   │  Redis 7   │  Gitea   │  nginx   │  MinIO (opt)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Credit System — Architettura Completa

### 4.1 Tabella Costi Operazioni

| Operazione | Crediti | Note |
|---|---|---|
| Generazione landing page (base) | 5 | senza allegati |
| + PDF allegato | +2 | estrazione + uso nel prompt |
| + ogni immagine allegata | +0.5 | descrizione vision LLM |
| + ogni iterazione quality check | +1.5 | Playwright + LLM verifica |
| + generazione immagini AI reali (Phase 2) | +1 per img | DALL-E/SDXL |
| Raffinamento (iterazione manuale) | 3 | prompt → OpenCode → deploy |
| Pubblicazione (primo deploy) | 1 | nginx + SSL |
| Re-deploy post-modifica | 0 | gratuito |
| Export ZIP | 0 | gratuito |

### 4.2 Stima Pre-Job

```typescript
function estimateJobCredits(input: JobEstimateInput): CreditEstimate {
  let credits = 5; // base
  const breakdown: string[] = ['Base generazione: 5 crediti'];

  if (input.hasPdf) {
    credits += 2;
    breakdown.push('+2 PDF allegato');
  }

  credits += input.imageCount * 0.5;
  if (input.imageCount > 0) {
    breakdown.push(`+${input.imageCount * 0.5} immagini (${input.imageCount}×0.5)`);
  }

  const loops = input.maxQualityLoops ?? 3;
  credits += loops * 1.5;
  breakdown.push(`+${loops * 1.5} verifica qualità (${loops} iterazioni×1.5)`);

  return {
    estimated: Math.ceil(credits),
    breakdown,
    confidence: 'approximate' // stima, non esatta
  };
}
```

### 4.3 Tracking Real-time

Ogni step del worker addebita crediti incrementalmente:

```typescript
// In GenerationWorker, dopo ogni step significativo:
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
  
  // SSE push al client se connesso
  sseManager.emit(userId.toString(), 'credits_updated', {
    credits: user.billing.credits - amount,
    charged: amount,
    description
  });
}
```

### 4.4 Gestione Pausa per Crediti Esauriti

```typescript
// InsufficientCreditsError catturata nel worker:
try {
  await chargeCredits(userId, jobId, projectId, 1.5, 'Quality check loop 2/3');
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    // Salva stato corrente
    await Job.updateOne({ _id: jobId }, {
      status: 'paused_credits',
      'opencode.checkpointDir': currentWorkspaceDir
    });
    await Project.updateOne({ _id: projectId }, { status: 'paused_credits' });
    
    // Notifica utente
    await notificationQueue.add('credits_exhausted', { userId, projectId, jobId });
    
    // NON fallire il job — sospenderlo
    return { paused: true };
  }
  throw err;
}
```

---

## 5. Quality Check Loop — Architettura

```typescript
// QualityCheckWorker
async function runQualityLoop(
  job: Job,
  project: Project,
  workspaceDir: string
): Promise<QualityResult> {
  
  const maxIterations = project.aiConfig.maxAutoRefinementLoops; // configurabile
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    
    // STEP 1: Playwright analisi
    const playwrightResult = await runPlaywrightCheck(workspaceDir);
    // Playwright serve il sito localmente su porta random, poi:
    // - Controlla che la pagina si carichi senza errori JS
    // - Screenshot mobile (375px) e desktop (1280px)
    // - Verifica che tutte le immagini siano caricate (no broken)
    // - Conta errori console
    
    // STEP 2: LLM verifica corrispondenza contenuto
    const llmResult = await runLlmVerification({
      originalBrief: project.wizard.briefGenerated,
      generatedHtml: await fs.readFile(`${workspaceDir}/dist/index.html`, 'utf8'),
      screenshotBase64: playwrightResult.desktopScreenshot
    });
    // LLM (modello leggero: Haiku) verifica:
    // - Il sito risponde all'obiettivo del brief?
    // - Le sezioni richieste ci sono tutte?
    // - Il tono è corretto?
    
    const score = calculateScore(playwrightResult, llmResult);
    
    // STEP 3: Valuta se serve correzione
    if (score >= QUALITY_THRESHOLD) {
      // Qualità accettabile — esci dal loop
      return { passed: true, score, iterationsRun: iteration };
    }
    
    if (iteration >= maxIterations) {
      // Limite raggiunto — mostra comunque il risultato
      return { passed: false, score, iterationsRun: iteration, issues: llmResult.issues };
    }
    
    // STEP 4: Auto-fix con OpenCode
    const fixPrompt = buildFixPrompt(playwrightResult.issues, llmResult.issues);
    await runOpenCode(workspaceDir, fixPrompt, 'Andy Code Cat-refiner');
    
    // Addebita crediti per questa iterazione
    await chargeCredits(userId, jobId, projectId, 1.5, `Quality check loop ${iteration}/${maxIterations}`);
    
    // Aggiorna progress UI
    await updateJobProgress(jobId, `Verifica qualità — iterazione ${iteration}/${maxIterations}`, 
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
  
  return `Correggi questi problemi nel sito in dist/:\n${issues}\n\nNon cambiare il design generale, solo correggi i problemi elencati.`;
}
```

---

## 6. Pubblicazione Nginx Multi-tenant

### 6.1 Struttura File Nginx

```
/etc/nginx/
├── nginx.conf                          # config principale (non toccare)
├── sites-available/
│   ├── Andy Code Cat-api.conf              # reverse proxy API
│   ├── pf-velvet-phoenix-42.conf       # temp slug (creato alla creazione progetto)
│   ├── pf-pizzeria-napoli.conf         # published slug (creato alla pubblicazione)
│   └── pf-custom-pizzerianapoli-it.conf # custom domain (creato alla verifica DNS)
└── sites-enabled/
    └── [symlink a sites-available]
```

### 6.2 Config per Sito Pubblico

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

    # SEO: robots noindex se non pubblico
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

### 6.3 Config per Sito Protetto da Password

```nginx
server {
    listen 443 ssl http2;
    server_name {slug}.Andy Code Cat.io;
    # ... ssl config ...

    root /var/www/Andy Code Cat/{projectId}/dist;

    # Endpoint auth gestito da API Andy Code Cat
    location /_pf_auth {
        proxy_pass http://localhost:3001/internal/site-auth/{slug};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Cookie $http_cookie;
    }

    # Tutti gli altri path: verifica cookie auth prima
    location / {
        auth_request /_pf_auth;
        error_page 401 = @pf_login;
        try_files $uri $uri/ $uri.html =404;
    }

    location @pf_login {
        return 302 /_pf_login?redirect=$request_uri;
    }

    # Pagina login servita da API
    location /_pf_login {
        proxy_pass http://localhost:3001/internal/site-login-page/{slug};
    }

    # Assets CSS/JS della pagina login (no auth)
    location /_pf_assets {
        proxy_pass http://localhost:3001/internal/assets;
    }
}
```

### 6.4 Wildcard SSL per *.Andy Code Cat.io

Per i subdomain non è necessario un certificato per ciascuno se si usa un wildcard:

```bash
# Setup una tantum (DNS challenge via Certbot + plugin DNS)
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d '*.Andy Code Cat.io' \
  -d 'Andy Code Cat.io' \
  --agree-tos \
  --email admin@Andy Code Cat.io

# Il certificato wildcard copre tutti *.Andy Code Cat.io automaticamente
# Nessun certbot per ogni nuovo subdomain!
```

Per custom domain (richiede certificato dedicato):

```bash
certbot --nginx \
  -d {customDomain} \
  --non-interactive \
  --agree-tos \
  --email admin@Andy Code Cat.io
```

---

## 7. Generazione Nome Temporaneo

```typescript
// Lista parole per generazione nome temp
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
    
    // Verifica univocità globale (tutti i progetti di tutti gli utenti)
    const exists = await SiteSlug.findOne({ slug });
    if (!exists) {
      await SiteSlug.create({ slug, type: 'temp', reservedAt: new Date() });
      return slug;
    }
    attempts++;
  }
  // Fallback con UUID troncato
  return `site-${nanoid(8)}`;
}
```

---

## 8. Piani e Limiti

| Feature | Free | Pro (€19/mo) | Agency (€49/mo) |
|---|---|---|---|
| Crediti iniziali | 50 | 500/mese | 2000/mese |
| Crediti acquistabili | ✅ | ✅ | ✅ |
| Progetti simultanei in gen. | 1 | 3 | 10 |
| Max iterazioni quality check | 2 | 5 | configurabile |
| Custom domain | ❌ | ✅ | ✅ |
| Password sito | ✅ | ✅ | ✅ |
| Collaboratori per progetto | 0 | 3 | illimitati |
| Export ZIP | ✅ | ✅ | ✅ |
| API access (terze parti) | ❌ | ✅ | ✅ |
| White-label (no Andy Code Cat branding) | ❌ | ❌ | ✅ |
| Supporto prioritario | ❌ | Email | Dedicato |
