# Zero Effort — Media Evolution, Visual Feedback and Asynchronous Generation

> Status: operational proposal  
> Date: 2026-04-22  
> Scope: Zero Effort mode + cross-mode media management generalisation + async jobs with notifications + auto-publish preview and deeplink landing  
> Audience: maintainers, implementation agents, operators

---

## 1. Context and motivation

Zero Effort mode already exists, with a 3-step wizard, prompt optimisation and SSE generation.
It has, however, four structural weaknesses:

1. **No visual feedback during generation**: the SSE flow is active but the UI does not show the thinking/answer stream the way the workspace does. Prompt optimisation does not even have a token counter.

2. **No media upload**: unlike the workspace (GodMode), there is no way to upload images, logos or visual material into the project before generation. This impoverishes the prompt and stops the system from knowing where to place real images.

3. **No asynchronous handling**: generation is synchronous (SSE with a 20-minute timeout). If the user closes the tab, the work is lost. There is no "come back later" mechanism and no notifications by email or Telegram.

4. **No automatic publication of the result**: when generation finishes, the site is not immediately reachable through a public link. The user has to open the workspace manually and enable publication. That breaks the zero-effort loop: generate → shareable link → iterate.

This document analyses each gap, establishes what is feasible, defines the implementation waves and proposes the unified architecture.

---

## 2. Current-state analysis

### 2.1 What already exists (strengths)

| Component | Status |
|---|---|
| SSE streaming in zero-effort (`streamLlmChatPreview`) | Active — `genStreamTokens` already tracked in state |
| Streaming variant of optimisation (`/llm/optimize-prompt/stream`) | Backend endpoint already implemented |
| Asset upload (`POST /v1/projects/:projectId/assets`) | Complete, with quota, MIME check and storage adapter |
| `ProjectAsset` entity with `styleRole`, `descriptionText`, `useInProject` | Present — the `descriptionText` field is already free-form |
| `systemPromptComposer` with layers A–E | Extensible without breaking changes |
| `ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md` | Plan already written — Layer F is already envisaged |
| Local storage adapter + MinIO | Ready |
| Frontend notification system (`useNotifications`) | React context already global |
| MongoDB as the only datastore | Consistent — no Redis required |

### 2.2 What is missing (gaps)

| Gap | Impact |
|---|---|
| The zero-effort UI does not show the thinking/answer stream | Poor experience during generation |
| Optimisation without streaming and without a token counter | Opaque wait |
| No media upload step in the wizard | Prompt with no real visual references |
| `ProjectAsset` has no semantic `usageHint` field | No way to say "logo → header/footer" |
| No public URL for assets | Not injectable into the LLM prompt as a reference |
| No Layer F (media context block) in the system prompt | The LLM does not know the images exist |
| No DB-backed job to track generation | No "come back later" |
| No email sender (Nodemailer or equivalent) | Completion notification impossible |
| No Telegram bot | Alternative notification missing |
| No automatic publication when generation ends | The generated site is not shareable straight away — the user has to enter the workspace and publish by hand |
| No deeplink landing page | The link sent by email goes straight to the workspace, not to a clean preview with guided choices |

---

## 3. What is feasible and what is not

### Feasible with low–medium impact

| Feature | Notes |
|---|---|
| Visual streaming in zero-effort | Frontend only — reuse components already present in the workspace |
| Optimisation with streaming + token counter | `/llm/optimize-prompt/stream` already exists; the UI wiring is missing |
| Step 4 drag-and-drop upload | New frontend + reuse of the existing upload endpoint |
| `usageHint` field on `ProjectAsset` | Additive addition to the entity + Mongo — no destructive migration |
| Layer F in the system prompt | Additive — an empty layer has no effect |
| Signed public URLs for assets | New endpoint with a short-lived signed JWT — safe |
| Cross-mode generalisation of media context | Layer F added once in `composeSystemPrompt` |
| MongoDB-backed job tracking (async job) | Simple new collection — no dependency on Redis or Bull |
| Frontend polling + "come back later" | Simple pattern — polling on `/v1/jobs/:jobId` |
| Email via Nodemailer + SMTP config | Simple dependency, configurable via env |
| Auto-publish on completion (UUID path) | Reuses `PublishProject`, already spec'd in `UX_REVIEW_AND_PUBLISH_SPEC.md` — adds `source` and `ttlDays` |
| Deeplink page `/preview/[publishId]` | New public Next.js route, no new backend dependency |

### Feasible with medium-high impact (Wave 4+)

| Feature | Note |
|---|---|
| Telegram bot | Requires `node-telegram-bot-api` + a bot token + webhook or polling — separable |
| Per-user notification preferences | Additional `UserNotificationPrefs` schema |
| Separate model selection for async runs | Could use a slower, cheaper model overnight |

### Not feasible, or not recommended now

| Feature | Rationale |
|---|---|
| Permanently public URLs for assets | Conflicts with the double sandbox and tenant isolation — use a signed token |
| Inline base64 images in the prompt | Explosive token cost for high-resolution images |
| External queue (BullMQ/Redis) | Excessive infrastructure complexity — a MongoDB job is enough for the MVP |
| Bidirectional WebSocket for job status | The existing SSE is sufficient; adding WS would mean an infrastructure upgrade |

---

## 4. Proposed architecture

### 4.1 `usageHint` field on `ProjectAsset`

Additive addition to the existing entity:

```typescript
// apps/api/src/domain/entities/ProjectAsset.ts
usageHint?: string;
// e.g. "brand logo — place in header and footer"
// e.g. "main hero photo — above-the-fold section"
// e.g. "product image — gallery and product card"
```

The field is free-form, but the system suggests a value at upload time through auto-classification (already available behind `MEDIA_AUTO_CLASSIFY_UPLOADS`) or through explicit user input.

### 4.2 Public URLs with a JWT signature (short-lived)

New endpoint:

```
GET /v1/projects/:projectId/assets/:assetId/signed-url
```

Returns:

```json
{
  "url": "https://app.example.com/public/assets/:assetId?token=<jwt>",
  "expiresAt": "2026-04-22T13:00:00Z"
}
```

The JWT is signed with `ASSET_SIGNING_SECRET` (env), lasts 2 hours (configurable) and carries `{ assetId, projectId, userId }`.

Public endpoint (no auth header):

```
GET /public/assets/:assetId?token=<jwt>
```

It verifies the JWT and serves the file. No Bearer authentication required — the token is the authentication.

Security: is the token single-use per IP? Not for the MVP. The short expiry is the main guardrail.

### 4.3 Layer F — Media Context Block in the system prompt

New additive layer in `composeSystemPrompt`:

```typescript
// apps/api/src/application/llm/systemPromptComposer.ts
export function composeSystemPrompt(opts: {
  // ... existing
  mediaContextBlock?: string; // NEW Layer F
}): string {
  return [
    buildBaseConstraintsLayer(),
    opts.presetLayer ?? buildPresetLayer(opts.presetId),
    opts.styleBlock ?? "",
    opts.prePromptTemplate ?? "",
    opts.governanceSystemPrompt ?? "",
    opts.mediaContextBlock ?? "",  // inserted after governance, before budget
    opts.outputBudgetPolicy ?? "",
    opts.requestSystemPrompt ?? "",
  ]
    .filter(Boolean)
    .join(LAYER_SEPARATOR)
    .trim();
}
```

The block is built by:

```typescript
// apps/api/src/application/llm/mediaContextBuilder.ts
export function buildMediaContextBlock(assets: ProjectAsset[], baseUrl: string): string {
  const usable = assets.filter(a => a.usageHint && a.useInProject);
  if (usable.length === 0) return "";
  
  const lines = usable.map(a =>
    `- **${a.label ?? a.originalName}** → ${a.usageHint}\n  URL: ${baseUrl}/public/assets/${a.id}?token=SIGNED`
  );
  
  return [
    "## Project media and visual assets",
    "",
    "The following assets are available and must be integrated into the generated site using their respective URLs:",
    "",
    ...lines,
    "",
    "Use the URLs above as the `src` of `<img>` and `<video>` tags, as CSS backgrounds, and so on. Do not invent generic placeholders when a real asset is available.",
  ].join("\n");
}
```

This layer is resolved in `llmRoutes.ts` (`resolveContext()`) by loading the project's assets before composing the system prompt. It affects every LLM call — zero-effort, workspace, optimisation.

### 4.4 Async Job — MongoDB collection

New `async_jobs` collection:

```typescript
interface AsyncJob {
  id: string;
  projectId: string;
  userId: string;
  type: "zero_effort_generation" | "workspace_generation";
  status: "queued" | "running" | "done" | "failed";
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  resultConversationId?: string;
  resultSnapshotId?: string;
  errorMessage?: string;
  notificationSent: boolean;
  notificationChannels: Array<"email" | "telegram">;
  userEmail?: string;
  telegramChatId?: string;
}
```

Endpoints:

```
POST /v1/projects/:projectId/jobs          → creates the job, returns { jobId }
GET  /v1/projects/:projectId/jobs/:jobId   → status polling
```

The job is updated by the worker (today's `setTimeout` evolves into a function calling `updateJobStatus(jobId, patch)`).

### 4.5 Auto-publish on completion — "Zero Effort Preview"

When generation ends (snapshot created in MongoDB), the backend automatically publishes to the UUID path already defined in `UX_REVIEW_AND_PUBLISH_SPEC.md` (`/p/{publishId}`).

#### Extending the `SiteDeployment` entity

```typescript
// additive extra field
source: "user_initiated" | "zero_effort_auto";
ttlDays?: number;          // null = permanent, 7 = auto-preview TTL
expiresAt?: Date;          // computed from createdAt + ttlDays
```

A `zero_effort_auto` deployment has a 7-day TTL (configurable via `ZERO_EFFORT_PREVIEW_TTL_DAYS`). On expiry the cleanup removes it like any other temporary deployment.

#### Extending the `AsyncJob` entity

```typescript
resultPublishUrl?: string;    // e.g. "https://app.example.com/p/a1b2c3d4"
resultPublishId?: string;     // e.g. "a1b2c3d4" — used to build the deeplink
resultDeploymentId?: string;  // ref to SiteDeployment
```

#### Backend sequence on completion

```
[GenerationCompleted]
  → createSnapshot() → snapshotId
  → PublishProject.execute({
        type: "random",         // UUID path — no nginx needed
        type: "random",         // path UUID — no nginx necessario
        source: "zero_effort_auto",
        ttlDays: 7
    })
  → SiteDeployment.status = "live", url = "/p/{publishId}"
  → updateJobStatus("done", {
        resultConversationId,
        resultSnapshotId,
        resultPublishUrl: absoluteUrl("/p/{publishId}"),
        resultPublishId
    })
  → EmailNotifier.send({ to: userEmail, previewUrl: resultPublishUrl, ... })
```

#### Behaviour if publication fails

Publication is best-effort: if it fails, the job is still marked `done` with `resultPublishUrl: null`. The email then carries the direct workspace link instead of the preview. The failure is logged in `ExecutionLogger` but does not block the notification.

---

### 4.6 Deeplink page — `/preview/[publishId]`

New public Next.js route (no auth required to view):

```
apps/web/app/preview/[publishId]/page.tsx
```

#### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  🐱 Andy Code Cat                           [Sign in / Sign up]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  The site for [Brand Name] is ready                              │
│  Generated automatically with Zero Effort · Preview valid 7 days │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │              IFRAME — generated site                       │  │
│  │              (desktop viewport, interactive)               │  │
│  │                                                            │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  What do you want to do?                                         │
│                                                                  │
│  [ Edit in GodMode ]        [ Publish on your own domain ]       │
│                                                                  │
│  Share preview: [https://app.../p/a1b2c3d4]      [Copy link]     │
└──────────────────────────────────────────────────────────────────┘
```

#### CTA behaviour

| Action | Authenticated user | Unauthenticated user |
|---|---|---|
| "Edit in GodMode" | Redirect to `/workspace/{projectId}?conv={convId}` | Redirect to `/login?next=/preview/{publishId}` |
| "Publish on your own domain" | Opens the publish modal (subdomain or custom domain) | Redirect to `/login?next=/preview/{publishId}` |
| Iframe preview | Always visible — no auth | Always visible — no auth |
| "Copy link" | Always available | Always available |

After login, `?next=` restores the preview page with the CTAs now clickable.

#### Data loaded by the preview page

```typescript
// SSR: GET /v1/public/previews/:publishId
// Public endpoint (no auth) returning:
{
  projectName: string;
  brandName: string;
  generatedAt: string;
  expiresAt: string;
  previewUrl: string;           // URL for the iframe = /p/{publishId}
  projectId: string;            // used to build the workspace link (auth-gated)
  conversationId: string;       // used to deep-link to the right conversation
  isExpired: boolean;
}
```

If `isExpired: true`, the page shows a "Preview expired" message with a CTA to open the workspace.

#### Note on GodMode and a future tutorial

When the user reaches GodMode from this preview page (via `?from=zero_effort_preview`), a contextual UI/UX tutorial layer could be shown in future ("Welcome to GodMode — here is how to edit the site"). That is a separate concern, to be built as a React layer in the workspace, with no architectural change to the backend.

---

### 4.7 Email notifications carrying the preview URL

```typescript
// apps/api/src/infra/notifications/EmailNotifier.ts
// Uses Nodemailer with an SMTP transport configurable via env:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
```

MVP email template (plain text + simple HTML):

```
Subject: Your site "[Brand Name]" is ready on Andy Code Cat

The site has been generated successfully.

View the preview:
→ {previewUrl}      ← /p/{publishId} link, visible directly without logging in

The preview will stay available for 7 days.

From the preview page you can:
• Edit the site in GodMode
• Publish it on your own domain or a custom link

The Andy Code Cat team
```

The `{previewUrl}` link points at `https://app.example.com/preview/{publishId}` (the deeplink landing page), not at the iframe directly. That guarantees the user sees the CTAs rather than a bare iframe.

---

## 5. Zero Effort wizard — new Step 4 (visual media)

### Position in the flow

```
Step 1: Identity (brand, site type, goal)
Step 2: Target & data (audience, contacts)
Step 3: Visual style (attributes, tone, CTA)
Step 4: Media (NEW — upload images, assign usage)           ← INSERTED HERE
Step 5: Generation (was Step 4 — brief, optimisation, stream)
```

### Step 4 UX

```
┌─────────────────────────────────────────────────────────────┐
│  Add visual elements to your project                        │
│                                                             │
│  Upload a logo, a hero photo, product images or any other   │
│  visual material. The system places them automatically in   │
│  the generated site.                                        │
│                                                             │
│  ┌───────────────────────────────────────────┐              │
│  │  Drop files here, or click to upload      │              │
│  │  PNG, JPG, SVG, WebP — max 20 MB each     │              │
│  └───────────────────────────────────────────┘              │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [thumbnail]  logo-brand.svg                          × │ │
│  │              Describe its use:                         │ │
│  │              [Brand logo              ]                │ │
│  │              Suggestion: header, footer                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [thumbnail]  hero-photo.jpg                          × │ │
│  │              Describe its use:                         │ │
│  │              [Main hero photo         ]                │ │
│  │              Suggestion: hero section, above the fold  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  [Skip this step]          [Next →]                         │
└─────────────────────────────────────────────────────────────┘
```

### Auto-suggestion logic for `usageHint`

Once the upload finishes, the frontend proposes a pre-filled hint based on the file name and MIME type:

| Rule (file name) | Suggested hint |
|---|---|
| contains "logo" | Brand logo — header and footer |
| contains "hero" / "banner" / "cover" | Main image — hero section |
| contains "prodotto" / "product" / "item" | Product image |
| contains "bg" / "background" | Decorative background |
| generic SVG | Icon or decorative element |
| default | Project visual element |

The user can freely edit the suggested text.

### Step 4 data flow

1. User uploads a file → `POST /v1/projects/:projectId/assets` → asset saved
2. User enters a hint → `PATCH /v1/projects/:projectId/assets/:assetId` with `{ usageHint, useInProject: true }`
3. At generation time, `buildMediaContextBlock()` reads the assets that have `usageHint && useInProject`
4. For each asset a signed URL is generated and included (valid for the duration of the generation session + buffer)

---

## 6. Streaming visual feedback in Zero Effort

### Current problem

The `page.tsx` component under `/launch/[projectId]` calls `streamLlmChatPreview()` and updates `genStreamTokens`, but does not display the text stream (thinking + answer) during the `generating` phase.

### Fix — Wave 1

Add, in the "review/generating" area, the same streaming UI already present in the workspace:

```tsx
// New state for the "generating" phase
const [thinkingText, setThinkingText] = useState("");
const [draftAnswer, setDraftAnswer] = useState("");

// In the existing SSE callback, add:
case "thinking": setThinkingText(prev => prev + event.delta); break;
case "answer":   setDraftAnswer(prev => prev + event.delta); break;
```

UI to add:

```tsx
{genPhase === "generating" && (
  <div className="space-y-3">
    {thinkingText && (
      <div className="rounded-md border border-border/50 bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Reasoning in progress…</p>
        <p className="text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap">
          {thinkingText}
        </p>
      </div>
    )}
    {draftAnswer && (
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
        <p className="text-xs font-medium text-primary mb-1">Generating HTML…</p>
        <p className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-foreground/80">
          {draftAnswer.slice(-800)}
        </p>
      </div>
    )}
    <p className="text-xs text-muted-foreground text-right">
      {genStreamTokens} tokens generated
    </p>
  </div>
)}
```

### Fix — optimisation with streaming

Replace the `optimizePrompt()` call with `streamOptimizePrompt()` (the `/llm/optimize-prompt/stream` endpoint already exists) so the optimised text appears as it arrives, with a token counter.

---

## 7. Asynchronous handling — "come back later"

### Proposed flow

```
User clicks "Generate"
  → Frontend: POST /v1/projects/:projectId/jobs { type: "zero_effort_generation", ... }
  → Backend: creates an AsyncJob with status "queued", returns { jobId }
  → Backend: starts generation in the background (today's setTimeout 50ms pattern, but with DB tracking)
  → Frontend: shows a "Generation started" banner

The user can:
  A) Stay on the page → normal SSE stream (experience unchanged)
  B) Close the tab → the job continues in the background

If the user closes the tab and comes back:
  → Frontend: GET /v1/projects/:projectId/jobs/:jobId (polling every 5s)
  → When status = "done": show the "Open in GodMode" link

When the job completes (backend):
  → updateJobStatus("done", { resultConversationId, resultSnapshotId })
  → If notificationChannels includes "email": EmailNotifier.send(...)
  → If notificationChannels includes "telegram": TelegramNotifier.send(...)
```

### "Come back later" UX

```
┌─────────────────────────────────────────────────────────────┐
│  Generation started                                         │
│                                                             │
│  Your site is being generated. You can:                     │
│  • Stay here and follow the progress in real time           │
│  • Close this window and come back later                    │
│                                                             │
│  We will let you know when it is ready.                     │
│                                                             │
│  Notify me via:  [✓] Email (user@example.com)               │
│                  [ ] Telegram (configure →)                 │
│                                                             │
│  [Close and come back later]   [Follow live]                │
└─────────────────────────────────────────────────────────────┘
```

### Persistence of the generated result

Generation already produces a `conversationId` and a `snapshotId`, both already saved in MongoDB. The job record stores them as `resultConversationId` and `resultSnapshotId`. The user can reopen the workspace at any time, even after closing the browser.

---

## 8. Cross-mode generalisation of media management

### Principle

Layer F (the media context block) is built **once** in `resolveContext()` (already used by every LLM route) and injected into **all** calls:

- Zero Effort generation
- Zero Effort prompt optimisation  
- Workspace chat-preview stream
- Focused edit (quando `useInProject` asset esistono)
- Focused edit (when `useInProject` assets exist)
### Asset manager in the workspace (GodMode)

Added to the sidebar or the asset panel:

- An editable `usageHint` field per asset (text input, saved via PATCH)
- A `useInProject` toggle to include or exclude the asset from Layer F
- An "Active in prompt" badge when `useInProject: true && usageHint`

### "Media in the prompt" section (debug/visibility)

In the workspace debug panel (already available via `/llm/prompt-preview`), add a section that shows Layer F rendered exactly as it is injected into the system prompt.

---

## 9. Wave plan

### Wave 1 — Visual feedback (2–3 days)

**No regression possible — frontend-additive only.**

Files involved:

- `apps/web/app/launch/[projectId]/page.tsx` — add `thinkingText` and `draftAnswer` state, plus the stream UI
- `apps/web/lib/api/llm.ts` — wire up `streamOptimizePrompt` (the endpoint already exists)

Deliverables:

- Thinking + answer stream visible during zero-effort generation
- Optimisation with incoming text and a token counter
- No backend change

---

### Wave 2 — Media upload step + Layer F (5–7 days)

**Medium impact — backend additive, no breaking change.**

Backend files:

- `apps/api/src/domain/entities/ProjectAsset.ts` — add `usageHint?: string`
- `apps/api/src/infra/db/mongo/MongoProjectAssetRepository.ts` — persist `usageHint`
- `apps/api/src/application/llm/mediaContextBuilder.ts` — **new file**, `buildMediaContextBlock()`
- `apps/api/src/application/llm/systemPromptComposer.ts` — additive Layer F
- `apps/api/src/presentation/http/routes/llmRoutes.ts` — load assets in `resolveContext()`
- `apps/api/src/presentation/http/routes/projectAssetRoutes.ts` — new `/signed-url` endpoint
- `apps/api/src/infra/security/AssetSignedUrlService.ts` — **new file**, JWT signing

Frontend files:

- `apps/web/app/launch/[projectId]/page.tsx` — new Step4Content, generation step moved to Step 5
- `apps/web/lib/api/assets.ts` — upload, patch usageHint and get signed-url functions
- `apps/web/components/launch/MediaUploadStep.tsx` — **new component**, drag-drop + usage input

Deliverables:

- Step 4 working, with upload, hint and thumbnail preview
- Assets with `usageHint` and `useInProject: true` injected into the prompt
- Signed URLs working and reachable by the LLM
- Layer F on every LLM call

---

### Wave 3 — Workspace generalisation (3–4 days)

**Low impact — additive UI on the existing asset panel.**

Files involved:

- `apps/web/app/workspace/[projectId]/page.tsx` — add the usageHint field to the asset panel
- `apps/web/components/workspace/` — update the asset list UI
- No backend change (Layer F is already active from Wave 2)

Deliverables:

- The workspace shows and allows editing of `usageHint` for each asset
- "Active in prompt" badge visible
- Layer F section in the prompt debug panel

---

### Wave 4 — Async job + auto-publish + email notifications (7–9 days)

**Medium impact — new MongoDB collection, PublishProject extension, new Nodemailer dependency.**

Backend files:

- `apps/api/src/domain/entities/AsyncJob.ts` — **new** (includes `resultPublishUrl`, `resultPublishId`)
- `apps/api/src/infra/db/mongo/MongoAsyncJobRepository.ts` — **new**
- `apps/api/src/presentation/http/routes/asyncJobRoutes.ts` — **new** (`POST /v1/projects/:id/jobs`, `GET /v1/projects/:id/jobs/:jobId`)
- `apps/api/src/infra/notifications/EmailNotifier.ts` — **new** (Nodemailer + preview URL template)
- `apps/api/src/application/use-cases/LaunchZeroEffortProject.ts` — job tracking + auto-publish integration
- `apps/api/src/domain/entities/SiteDeployment.ts` — add `source`, `ttlDays`, `expiresAt` (additive)
- `apps/api/src/application/use-cases/PublishProject.ts` — handle `source: "zero_effort_auto"` + TTL
- `apps/api/src/presentation/http/routes/publicRoutes.ts` — **new** `GET /v1/public/previews/:publishId` (no auth)

Frontend files:

- `apps/web/app/launch/[projectId]/page.tsx` — "come back later" banner, polling, notification preference
- `apps/web/app/preview/[publishId]/page.tsx` — **new route**, deeplink landing (public SSR)
- `apps/web/lib/api/jobs.ts` — **new** polling client

New dependencies:

- `nodemailer` (backend)
- ENV: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ZERO_EFFORT_PREVIEW_TTL_DAYS` (default: 7)

Deliverables:

- Generation started → job tracked in the DB
- On completion: site auto-published to the UUID path (`/p/{publishId}`)
- Preview URL included in the notification email
- Public deeplink page `/preview/{publishId}` with iframe + guided CTAs
- The user can close the tab and come back — the site is already published
- Frontend polling every 5s with automatic refresh

---

### Wave 5 — Telegram (optional, 3–4 days)

**Low impact — extra dependency, no regression.**

Backend files:

- `apps/api/src/infra/notifications/TelegramNotifier.ts` — **new**
- ENV: `TELEGRAM_BOT_TOKEN`

UX:

- User settings: enter a Telegram Chat ID (or link the bot via deep link)
- Notification on completion with a direct link

---

## 10. Risk and regression analysis

| Wave | Regression risk | Mitigation |
|---|---|---|
| Wave 1 | None | Extra React state only, no API change |
| Wave 2 — Layer F | Low | Layer F is an empty string when no asset has a usageHint — behaviour identical to today |
| Wave 2 — Step 4 | None | Extra step — the generation step shifts but does not change |
| Wave 2 — signed URL | Low | Isolated new endpoint — does not touch existing endpoints |
| Wave 3 | None | Additive UI |
| Wave 4 — job tracking | Medium | The synchronous SSE path must keep working alongside the async path |
| Wave 4 — auto-publish | Low | Best-effort: on failure the job is still `done` and the email carries the workspace link instead of the preview |
| Wave 4 — SiteDeployment | Low | `source`, `ttlDays` and `expiresAt` are additive — existing deployments default to `source: "user_initiated"` |
| Wave 4 — preview page | None | New route, touches neither the workspace nor the dashboard |
| Wave 4 — email | Low | If SMTP is not configured the email is silently skipped (no crash) |
| Wave 5 | None | Optional dependency, best-effort notification |

### General rule

Every added layer is **additive and opt-in**:

- Layer F: active only when assets with `usageHint && useInProject` exist
- Async job: active only when the user clicks "close and come back later"
- Auto-publish: best-effort, never blocking for generation
- Email: sent only when SMTP is configured AND the user selected the channel
- Step 4: skippable via "Skip this step"
- Preview page: public and lightweight — no impact on the workspace or the login flow

---

## 11. Overall estimate

| Wave | Estimated days | External dependencies |
|---|---|---|
| Wave 1 | 2–3 | None |
| Wave 2 | 5–7 | None (JWT already available via jose/jsonwebtoken) |
| Wave 3 | 3–4 | None |
| Wave 4 | 7–9 | Nodemailer + SMTP account + a stable `PublishProject` use case (already spec'd) |
| Wave 5 | 3–4 | Telegram Bot API token |
| **Total (Waves 1–4)** | **17–23 days** | SMTP account + `PublishProject` completed |

Waves 1 and 2 are independent and can run in parallel (frontend vs backend). Wave 3 depends on Wave 2. Wave 4 depends on Wave 2 (stable Layer F) and on the `PublishProject` use case existing (already spec'd in `UX_REVIEW_AND_PUBLISH_SPEC.md`, to be completed if not yet implemented).

---

## 12. Relationship to existing specs

| Existing spec | Relationship to this document |
|---|---|
| `ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md` | Layer F is the implementation of the "media context block" described in that spec. This document applies it concretely to zero-effort mode and generalises it across modes. |
| `MULTIMODE_UX_MVP_EXECUTION_SPEC.md` | The media step 4 is an additive extension of the already-planned zero-effort wizard — no conflict. |
| `IMAGE_PROMPTING_PIPELINE_SPEC.md` | Complementary — that spec covers AI image generation. This one covers using user-uploaded images as context. |
| `PREPROMPT_ENGINE_SPEC.md` | Layer F slots into the preprompt engine chain — compatible. |
| `UX_REVIEW_AND_PUBLISH_SPEC.md` | Auto-publish (Wave 4) reuses the `PublishProject` use case and the `/p/{publishId}` UUID path already spec'd there. It extends `SiteDeployment` with `source` and `ttlDays` additively. The deeplink page `/preview/[publishId]` is a new Next.js route wrapping the UUID-path iframe with guided CTAs. |
| `EXPORT_AND_PUBLISH_SPEC.md` | The random subdomain system (M4b) is the future target. For the MVP the UUID path is used (implementable without nginx). The `SubdomainAllocation` structure remains for permanent publication on a custom subdomain. |

---

## 13. Operational recommendation

**Recommended sequence:**

1. Start with Wave 1 (2–3 days) — immediate visibility for the user at no risk.
2. Run Wave 2 backend and Wave 2 frontend in parallel — separate teams or agents.
3. Wave 3 once Wave 2 is complete — minimal effort.
4. Wave 4 planned after Wave 2/3 stabilise; needs a decision on the SMTP provider.
5. Wave 5 optional — decide based on user feedback on Wave 4.

**What not to do:**

- Do not implement the async job (Wave 4) before Layer F (Wave 2) is stable — job tracking is pointless while the prompt is not yet enriched correctly.
- Do not make asset URLs permanently public — always use the signed URL pattern.
- Do not force the user through Step 4 — skipping must always be possible.
- Do not use the nginx subdomain (M4b) for auto-publish in Wave 4 — the UUID path is enough and needs no extra infrastructure. Nginx remains the target for permanent custom publication (future M4b).
- Do not point the email straight at the `/p/{publishId}` iframe — always use `/preview/{publishId}` as the deeplink, so the user sees the guided CTAs and not a bare site with no context.
- Do not block generation when auto-publish fails — always treat it as best-effort.

---

> Document created: 2026-04-22  
> Updated: 2026-04-22 — added the auto-publish section, deeplink landing page, and integration with PublishProject and SiteDeployment  
> Update this document if the architectural decisions change around the job store, URL strategy, publish TTL or the wizard step structure.
