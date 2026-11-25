# Image Fetch Persistence Refactor Proposal

> ⚠️ DEPRECATED / HISTORICAL (2026-05-29): original Wave-1 analysis. The active implementation
> target is **`docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`**, which supersedes this proposal.
> For current behavior + gap backlog see the orchestrator spec and
> `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md`. Kept only as historical context.

> Status: DEPRECATED — historical Wave-1 analysis (superseded by ARTIFACT_MEDIA_ORCHESTRATOR_SPEC)  
> Date: 2026-05-29  
> Scope: stock/placeholder images resolved via external services, asset persistence, regeneration in Edit mode, fallback observability  
> Out of scope: immediate changes to application code

> Implementation note, 2026-05-29: Wave 1/2/4 foundations have been implemented in code. The active backend path now supports traced provider resolution, backend download, persisted `platform_generated` assets, LLM HTML replacement with internal `/p/media/:assetId` URLs, provider status, and Edit-mode stock regeneration through the existing media inspector. Persistent backend notification storage remains a follow-up; current implementation logs fallback/persistence failures through `ExecutionLogger` and surfaces manual Edit-mode errors through the existing frontend notification panel.

---

## 1. Summary

Image handling today uses two distinct families of flows:

1. stock/placeholder images generated in the HTML by the LLM and resolved by `resolveImagesInHtml()`;
2. AI-generated images from the `POST /v1/projects/:projectId/assets/generate-image` endpoint.

The second flow is already correctly oriented toward persistence: it creates a `platform_generated` asset, applies a placeholder, saves the final file, and updates the snapshot once generation is ready.

The first flow is the critical point: it resolves external URLs such as Pexels, Pixabay, Unsplash, LoremFlickr, or Picsum and leaves them in the HTML as remote URLs. This creates instability, poor governability, and non-reproducible results, especially when the fallback reaches LoremFlickr.

The recommended direction is to:

- treat every stock image resolved from a provider as a project asset;
- download it backend-side into local/MinIO storage;
- replace the remote URL in the HTML with the internal asset URL;
- make the fallback configurable and observable;
- notify errors and degraded fallbacks in the notification system and the superadmin dashboard;
- add an explicit regeneration/new-proposal action for images in Edit mode, without automatically regenerating on every refresh.

---

## 2. Verified Current State

### 2.1 Stock/placeholder providers

Main files:

- `apps/api/src/application/llm/imageUrlRewriter.ts`
- `apps/api/src/infra/image/ImageServiceOrchestrator.ts`
- `apps/api/src/infra/image/PexelsConnector.ts`
- `apps/api/src/infra/image/PixabayConnector.ts`
- `apps/api/src/infra/image/UnsplashConnector.ts`
- `apps/api/src/infra/image/LoremFlickrConnector.ts`
- `apps/api/src/domain/entities/ServiceApiKey.ts`
- `apps/api/src/infra/repositories/MongoServiceApiKeyRepository.ts`

`resolveImagesInHtml(html, keyRepo?)` intercepts only:

- `https://loremflickr.com/{width}/{height}/{keyword}`
- `https://picsum.photos/seed/{keyword}/{width}/{height}`

For each placeholder it extracts keyword and dimensions, then calls `resolveImage()`.

`resolveImage()` uses a fixed chain:

1. Pexels, if a key exists;
2. Pixabay, if a key exists and it is not a video;
3. Unsplash, if a key exists and it is not a video;
4. LoremFlickr, always available for photos;
5. Picsum, as a last, deterministic non-semantic resort.

Keys are resolved in order:

1. `ServiceApiKeyRepository.findActiveByService()`, when passed;
2. env vars `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`;
3. no-key provider.

### 2.2 HTML prompt

`apps/api/src/application/use-cases/GetLlmPromptConfig.ts` already contains rules indicating LoremFlickr as the semantic source and Picsum as the deterministic fallback. The reference to `source.unsplash.com` is explicitly forbidden because it is deprecated.

This setting, however, still pushes the LLM to produce external placeholder URLs. Even though the backend rewrites them, the final result remains an external URL rather than a local asset.

### 2.3 Existing asset persistence

The existing asset framework is already adequate:

- `ProjectAsset` supports `source: "platform_generated"`;
- `SavePlatformAsset` saves the buffer to storage and creates an asset record;
- `StorageFactory` selects local/MinIO;
- `projectAssetRoutes` exposes upload, listing, download, URL reference, and generate-image;
- `getPublicAssetUrl(assetId)` on the web side allows an internal media URL to be used.

So there is no need to introduce a parallel media system.

### 2.4 AI image generation

`GenerateProjectImage`:

- immediately creates an SVG placeholder asset;
- saves `generationStatus: "queued"`;
- generates asynchronously via SiliconFlow when available;
- on local fallback saves an SVG placeholder;
- on error sets `generationStatus: "failed"`;
- emits `ExecutionLogger` with `image_generation_completed` or `image_generation_failed`;
- the frontend uses `useNotifications()` to show progress, errors, and completion.

This flow is consistent with the persistence goal. It should be reused as the conceptual model for stock images too.

### 2.5 Notifications

The frontend already has:

- `apps/web/lib/notifications.tsx`
- `apps/web/components/NotificationPanel.tsx`
- `useNotifications()` in the workspace

Today notifications are client-local: there is no persistent server → UI channel yet for operational events such as provider fallback or stock-image resolution errors.

The backend has `ExecutionLogger`, but no persistent notification engine readable from the top-right panel.

---

## 3. Critical Issues

### 3.1 Ungovernable fallback

The provider chain is hardcoded. The superadmin can save keys, but there is no real operational control over:

- default stock provider;
- fallback enabled/disabled;
- `fail-fast` vs `fallback` behavior;
- fallback severity;
- mandatory notification when degrading to LoremFlickr or Picsum.

Result: in production it is possible to end up on LoremFlickr without the operator knowing.

### 3.2 Silent fallback

Connectors return `null` on non-200 and `resolveImage()` catches the errors without propagating details. `imageUrlRewriter` at most writes `console.info` or `console.warn`.

There is no structured trace with:

- attempted providers;
- failure reason;
- final provider used;
- whether the result is degraded;
- correlation with projectId/userId/snapshot/conversation.

### 3.3 Visual inconsistency on every refresh

LoremFlickr produces semantic URLs but not a stable image. A URL such as:

```text
https://loremflickr.com/1200/600/office
```

can return different images on successive refreshes.

If the HTML still contains a LoremFlickr URL, the preview and the published site are not reproducible.

### 3.4 No local acquisition for stock images

`resolveImagesInHtml()` replaces placeholders with a provider URL, but does not download the file and does not create a `ProjectAsset`.

Consequences:

- the CDN or external provider can change or break the URL;
- license/attribution is not tracked as asset metadata;
- there is no history of proposed images;
- it is not easy to revert to a previous image;
- the project archive does not grow richer.

### 3.5 Edit mode without full explicit regeneration

The workspace already has media selection in Edit mode and AI generation via the media panel, but lacks a control specific to the image for:

- requesting "download another image from the active stock provider";
- seeing which stock provider is active;
- saving the new image as an asset;
- applying it to only the selected element without regenerating the whole page.

The earlier spec `docs/archive/specs/IMAGE_PICKER_SPEC.deprecated.md` described part of this direction, but was deprecated because persistence must be the default, not just a manual "save" action.

---

## 4. Proposed Decisions

### 4.1 No persistent external stock URL in the final HTML

Every image resolved from a stock provider must become an internal asset.

Rule:

```text
Provider URL -> controlled backend fetch -> SavePlatformAsset -> HTML uses /p/media/:assetId or equivalent asset URL
```

Exception allowed only for an explicit degraded error in development, never as silent behavior in production.

### 4.2 Configurable provider policy

Introduce a runtime policy, managed by the superadmin:

```ts
interface ImageProviderPolicy {
  defaultProvider: "pexels" | "pixabay" | "unsplash" | "loremflickr" | "picsum";
  fallbackMode: "disabled" | "notify" | "silent";
  fallbackProviders: string[];
  failOnProviderError: boolean;
  persistResolvedImages: boolean;
  notifyOnFallback: boolean;
  notifyOnPersistenceFailure: boolean;
}
```

Recommended default for production:

```text
defaultProvider = pexels
fallbackMode = notify
fallbackProviders = pixabay, unsplash
failOnProviderError = true if no fallback is configured
persistResolvedImages = true
notifyOnFallback = true
notifyOnPersistenceFailure = true
```

LoremFlickr and Picsum must be explicit fallbacks, not hidden ones.

### 4.3 Fail-fast preferred when unconfigured

If the configured provider has no valid key or fails:

- if fallback is disabled: explicit error;
- if fallback is enabled: use the fallback but create an `image_provider_fallback` event;
- if it reaches LoremFlickr/Picsum: event with at least `warning` severity.

This satisfies the requirement: a visible error is better than an undeclared fallback.

### 4.4 Persistence as part of the resolver

`resolveImagesInHtml()` should evolve into an application use case, rather than remain a stateless string-rewriting function.

Proposed new use case:

```text
ResolveAndPersistHtmlImages
```

Input:

```ts
{
  projectId: string;
  userId: string;
  html: string;
  sourceContext: {
    conversationId?: string;
    snapshotId?: string;
    route: "chat-preview" | "stream" | "edit-regenerate" | "publish";
  };
}
```

Output:

```ts
{
  html: string;
  assets: ProjectAsset[];
  events: ImageResolutionEvent[];
}
```

Responsibilities:

1. extract relevant placeholders and external stock URLs;
2. resolve provider according to policy;
3. download the chosen image;
4. validate MIME, size, host, and timeout;
5. save with `SavePlatformAsset`;
6. update `ProjectAsset.generationMetadata`;
7. replace the HTML with the internal URL;
8. emit logs/notifications on fallback or errors.

### 4.5 Asset metadata for stock images

Extend `AssetGenerationMetadata` or use `providerResponse` in a structured way:

```ts
generationMetadata: {
  provider: "pexels",
  model: "stock-search",
  requestedAt,
  completedAt,
  finishReason: "stock-image-persisted",
  sourceUrl: "https://images.pexels.com/...",
  width,
  height,
  outputMimeType: "image/jpeg",
  providerResponse: {
    query: "office",
    attribution: "Pexels - Author Name",
    fallbackUsed: false,
    attemptedProviders: [
      { provider: "pexels", status: "success" }
    ],
    licenseHint: "provider-attribution"
  }
}
```

For a fallback:

```ts
providerResponse: {
  query: "office",
  fallbackUsed: true,
  fallbackFrom: "pexels",
  fallbackTo: "pixabay",
  attemptedProviders: [
    { provider: "pexels", status: "failed", reason: "401" },
    { provider: "pixabay", status: "success" }
  ]
}
```

### 4.6 Regeneration in Edit mode

In Edit mode, for each selected image:

- show a "Regenerate stock image" micro-action;
- use the active stock provider configured by the superadmin;
- show the active provider in the popup/panel, e.g. `Active stock provider: Pexels`;
- send query, dimensions, and current asset to the backend;
- the backend downloads and saves a new image as a new asset;
- the frontend applies the new internal URL to the element;
- the snapshot is saved with `finishReason: "stock-image-regenerated"` metadata.

Regeneration must not change the image on every refresh. It must only happen on user command or an explicit pipeline.

---

## 5. Target Architecture

### 5.1 Backend

Recommended new/modified components:

```text
apps/api/src/domain/entities/
  ImageProviderPolicy.ts
  SystemNotification.ts

apps/api/src/domain/repositories/
  ImageProviderPolicyRepository.ts
  SystemNotificationRepository.ts

apps/api/src/application/use-cases/
  ResolveAndPersistHtmlImages.ts
  RegenerateStockProjectImage.ts
  DownloadExternalImageAsProjectAsset.ts
  EmitSystemNotification.ts

apps/api/src/infra/image/
  ImageProviderRegistry.ts
  ImageProviderPolicyResolver.ts
  ExternalImageDownloader.ts

apps/api/src/presentation/http/routes/
  projectImageRoutes.ts
  notificationRoutes.ts
```

Architectural notes:

- routes must not access MongoDB directly;
- every mutating operation must go through JWT + project sandbox;
- the external download is infrastructure, but the persistence and policy decision stays in the application layer;
- `SavePlatformAsset` must be reused, not duplicated.

### 5.2 Proposed API

#### Internal resolution/persistence

Not necessarily a public endpoint. To be used from `llmRoutes`.

```ts
ResolveAndPersistHtmlImages.execute({
  projectId,
  userId,
  html,
  sourceContext
})
```

#### Stock image regeneration

```http
POST /v1/projects/:projectId/images/regenerate-stock
```

Body:

```json
{
  "query": "modern office",
  "width": 1200,
  "height": 600,
  "targetSelector": "[data-pf-id='hero-img']",
  "currentAssetId": "optional",
  "provider": "default"
}
```

Response:

```json
{
  "asset": { "...": "ProjectAssetDto" },
  "assetUrl": "/p/media/<assetId>",
  "provider": "pexels",
  "fallbackUsed": false,
  "attribution": "Pexels - Author"
}
```

#### Provider status/config for the UI

```http
GET /v1/projects/:projectId/images/provider-status
```

Response:

```json
{
  "activeProvider": "pexels",
  "fallbackMode": "notify",
  "fallbackProviders": ["pixabay", "unsplash"],
  "persistenceEnabled": true
}
```

#### System notifications

```http
GET /v1/notifications
PATCH /v1/notifications/:id/read
```

For superadmin:

```http
GET /v1/admin/notifications?severity=warning&domain=image
```

### 5.3 Frontend

Components/areas:

- workspace image generation popup/panel: shows active stock provider;
- Edit mode image overlay: regenerate-stock button;
- `NotificationPanel`: integrates persistent backend notifications in addition to client-local ones;
- superadmin dashboard: card or tab for image provider events.

UI rules to respect:

- use `Button`, `Input`, `Label`, `Card`, `Badge`, `Dialog`;
- use `lucide-react` icons;
- no raw `<button>`, `<input>`, `<label>` in new components;
- no inline style in new code.

---

## 6. External Download Security

Image download must be backend-only and controlled.

Minimum controls:

- `https://` only;
- block `file:`, `data:`, `ftp:`, private IPs, and localhost;
- host allowlist for supported providers;
- 10-second timeout;
- max size from `UPLOAD_MAX_SIZE_BYTES` or a lower limit for stock images;
- allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, optionally `image/gif`;
- minimal content sniffing, do not trust the header alone;
- limited redirects, re-checked against the allowlist;
- no API key logging.

---

## 7. Observability and Notifications

### 7.1 ExecutionLogger events

New event types:

```text
image_provider_resolution_started
image_provider_resolution_completed
image_provider_resolution_failed
image_provider_fallback_used
image_provider_persistence_failed
stock_image_regenerated
```

Required metadata:

```ts
{
  projectId,
  assetId,
  query,
  requestedProvider,
  finalProvider,
  fallbackUsed,
  attemptedProviders,
  sourceContext,
  latencyMs,
  error
}
```

### 7.2 Persistent SystemNotification

Proposed entity:

```ts
interface SystemNotification {
  id: string;
  userId?: string;
  projectId?: string;
  audience: "user" | "superadmin" | "both";
  domain: "image" | "llm" | "export" | "publish" | "system";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  status: "unread" | "read";
  sourceEventType: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  readAt?: Date;
}
```

Rules:

- fallback to LoremFlickr/Picsum in production: `warning`;
- configured provider fails with no fallback: `error`;
- failed download/persistence: `error`;
- fallback to secondary configured provider: `warning` or `info` depending on policy.

### 7.3 Notification panel UX

In the top-right panel:

- show image provider errors;
- show the fallback used with the final provider;
- link the asset/project when available;
- keep client-local notifications for in-progress tasks;
- add light polling or a refresh endpoint for persistent notifications.

---

## 8. Consolidated Document Status

### 8.1 Active spec

This is the active source for:

- stock/placeholder providers;
- default/fallback policy;
- fail-fast vs fallback-notify;
- backend fetch and local persistence;
- notifications on fallback/errors;
- stock regeneration in Edit mode;
- integration with project media assets.

### 8.2 Deprecated and archived specs

| Archived document | Reason |
|---|---|
| `docs/archive/specs/IMAGE_PICKER_SPEC.deprecated.md` | Treated persistence as a manual action following the URL proposal. The new policy requires backend persistence by default. |
| `docs/archive/specs/EXTERNAL_API_KEYS_PLATFORM_SPEC.deprecated.md` | Mixed general API key management with a permissive image fallback. Kept as historical context for BYOK/crypto ideas, but no longer governs the image pipeline. |

### 8.3 Still-valid complementary spec

`docs/specs/IMAGE_PROMPTING_PIPELINE_SPEC.md` remains valid only for AI model-generated images: prompt enrichment, optimizer, trace, and visual coherence. It does not govern stock providers such as Pexels/Pixabay/Unsplash/LoremFlickr.

---

## 9. Implementation Plan

### Wave 0 - Decision consolidation and regression tests

Goal: no runtime change, preparation only.

- Approve this proposal.
- Keep the legacy deprecated specs archived.
- Add unit tests around `imageUrlRewriter` to capture current behavior.
- Define the desired production policy: fail-fast or fallback-notify.

### Wave 1 - Provider policy and fallback tracing

Goal: make the problem visible without yet changing the final HTML.

- Introduce `ImageProviderPolicyResolver`.
- Replace the hardcoded chain with a provider order coming from policy.
- Have `resolveImage()` return a full trace, not just a URL.
- Emit `ExecutionLogger` for fallbacks and failures.
- If fallback is disabled, propagate an explicit error.

### Wave 2 - Stock image download and persistence

Goal: eliminate external stock URLs from the persisted result.

- Create `ExternalImageDownloader`.
- Create `DownloadExternalImageAsProjectAsset`.
- Create `ResolveAndPersistHtmlImages`.
- Replace calls to `resolveImagesInHtml()` in `llmRoutes` with the new use case.
- Save attribution/sourceUrl in the asset metadata.
- Replace HTML with the internal asset URL.

### Wave 3 - Persistent notifications

Goal: notify the user and the superadmin.

- Introduce `SystemNotification` and its repository.
- Create the `EmitSystemNotification` use case.
- Add a notification read endpoint.
- Integrate `NotificationPanel` with backend notifications.
- Add a superadmin filter for the `image` domain.

### Wave 4 - Stock regeneration in Edit mode

Goal: manual control over the selected image.

- Add the `POST /v1/projects/:projectId/images/regenerate-stock` endpoint.
- Add the web API client.
- Add the overlay button in Edit mode.
- Show the active provider in the media popup/panel.
- Apply the new asset to the DOM and save the snapshot.
- Add a history of generated assets in the media library.

### Wave 5 - Superadmin provider governance

Goal: full configuration from the dashboard.

- UI for default/fallback stock provider.
- Fallback mode toggle.
- Key status and provider test.
- View of recent errors/fallbacks.
- Document the operational procedure in a runbook.

---

## 10. Minimum Tests

Backend:

- `resolveImage` respects the configured provider order.
- fallback disabled produces an error.
- fallback notify produces an event + result.
- the downloader blocks disallowed hosts and non-HTTPS URLs.
- a Pexels/Pixabay image is saved as `platform_generated`.
- the final HTML does not contain `loremflickr.com`, `picsum.photos`, `pexels.com`, `pixabay.com`, `unsplash.com` when persistence is active.
- double sandbox on stock regeneration.

Frontend:

- the media panel shows the active provider.
- regenerating the selected image creates a running/done/error notification.
- a fallback error appears in the `NotificationPanel`.
- the Edit mode snapshot uses the internal asset URL.

Smoke test:

- new project with a valid Pexels key: placeholder -> internal asset.
- invalid Pexels key + Pixabay fallback: warning notification, internal Pixabay asset.
- fallback disabled + invalid key: visible error, no silent LoremFlickr.
- preview/published site refresh: same image, because the internal URL is persisted.

---

## 11. Risks and Open Choices

1. Provider quota and cost  
   Persisting images at generation time consumes provider calls immediately. Rate limiting and controlled retry are needed.

2. Licenses and attribution  
   Each provider has different rules. Saving attribution in the metadata and making it queryable is necessary.

3. Storage growth  
   Each regeneration enriches the archive. A future cleanup policy or quota for `platform_generated` assets is needed.

4. Migration of existing content  
   Snapshots already saved with external URLs will remain unstable until a backfill command is introduced.

5. Persistent notifications  
   The notification panel is client-local today. Backend integration must be designed without breaking already-working export/publish/image generation.

6. "Active" provider  
   The current `ServiceApiKey` entity has `isDefault`, but not a complete fallback policy. It can evolve without replacing the collection right away.

---

## 12. Final Recommendation

The priority is not to add another provider, but to change the contract of the stock image flow:

```text
generation/resolution produces persistent assets, not random remote URLs
```

The recommended sequence is:

1. provider policy + fallback trace;
2. mandatory persistence of resolved images;
3. persistent notifications for fallbacks/errors;
4. manual regeneration in Edit mode;
5. superadmin dashboard for full governance.

This reduces LoremFlickr's inconsistency, makes errors visible, preserves the image history, and uses the already-present asset framework instead of introducing a parallel system.
