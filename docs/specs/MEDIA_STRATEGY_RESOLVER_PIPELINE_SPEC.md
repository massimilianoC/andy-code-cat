# Media Strategy Resolver Pipeline Spec

> Status: Proposed extension plan
> Date: 2026-05-29
> Scope: frontend-selectable media strategies, LLM strategy planning, structured JSON outputs, media resolver expansion, admin observability, and browser E2E coverage
> Related specs: `ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`, `IMAGE_PROMPTING_PIPELINE_SPEC.md`, `DOCUMENT_CONTEXT_LAYER_SPEC.md`, `ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md`
> Current baseline before this roadmap: `docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md`

---

## 1. Purpose

The current artifact media orchestrator solves the first critical problem: generated artifacts should use `asset://media/<key>` placeholders, the backend should resolve those placeholders into persisted `ProjectAsset` records, and publish/export should never leak unresolved media.

This spec defines the next evolution: users and operators should be able to choose a media strategy from the frontend, and the backend should run a strategy-specific resolver pipeline that produces structured JSON plans before resolving media.

The goal is to support four selectable media paths:

1. Stock search and provider fallback
2. AI image generation
3. Project/user library reuse
4. Hybrid context planner

Each path has its own prompt template, JSON output contract, resolver implementation, traceability model, and frontend control surface.

---

## 2. Current Gap Recap

These are the known gaps that must stay visible until resolved.

| Gap | Current impact | Target resolution |
| --- | --- | --- |
| Missing browser E2E | Backend tests cover the pieces, but no Playwright test drives prompt -> manifest -> resolved snapshot -> edit regenerate -> publish/export. | Add Playwright E2E with provider mocking and visual assertions. |
| CSS background owner inference | For `background-image` placeholders, the system does not infer which HTML element owns the media if the LLM omits `data-media-key`. | Add prompt guard first, then optional backend CSS selector-to-HTML inference. |
| Missing `image_generation` resolver | Manifest strategy exists in contracts but returns unsupported behavior. | Add strategy-specific AI image generation resolver. |
| Missing `project_asset` resolver | Manifest strategy exists but cannot select existing project/user uploads. | Add asset matching from `ProjectAsset` and `AssetEnrichmentTrace`. |
| Missing `user_library` resolver | Manifest strategy exists but cannot use a user's reusable asset library. | Add user-scoped asset catalog resolver with sandbox checks. |
| Incomplete failure traces | Notifications/logs exist, but failed `MediaResolutionTrace` rows are not persisted for every exception path. | Persist failed traces before rethrowing provider/persistence/unsupported errors. |
| Missing admin notification dashboard | Admin notification API exists, but no admin UI for filtering media failures/fallbacks/export blocks. | Add admin UI with filters by domain, project, event type, provider, status. |

---

## 3. Product Vision

Media generation should not be a single hidden backend decision. The user should be able to express intent at a high level:

- Use stock images when I need fast realistic visuals.
- Generate new AI images when brand style needs coherence.
- Use my uploaded assets when I already provided logos, products, people, or references.
- Let the system inspect context and mix the best sources.

The UI should expose this as a compact strategy control, not as a complicated settings page.

Recommended frontend control:

```text
Media strategy
[ Auto Mix ] [ Stock ] [ AI Generate ] [ Project Assets ]

Advanced:
- Preserve brand/style coherence: on/off
- Prefer uploaded assets: on/off
- Allow stock fallback: on/off
- Allow AI generation fallback: on/off
- Require user review before applying media: on/off
```

The selected strategy becomes part of the generation request and the artifact media manifest pipeline.

---

## 4. Strategy Modes

### 4.1 `stock_search`

Use when the user wants fast realistic imagery, low cost, and provider fallback.

Inputs:

- project/user sandbox
- `mediaManifest.requests[]`
- `PlatformConfig.mediaProviderPolicy.stockImage`
- provider keys from `ServiceApiKey` or env
- optional moodboard/style context

Expected planner JSON:

```json
{
  "strategy": "stock_search",
  "version": "media-strategy-plan-v1",
  "placements": [
    {
      "mediaKey": "hero-main",
      "role": "hero",
      "kind": "background",
      "semanticQuery": "modern architecture studio with daylight and warm materials",
      "alt": "Modern architecture studio with daylight and warm materials",
      "dimensions": { "width": 1600, "height": 900 },
      "providerPolicy": {
        "useConfiguredPrimary": true,
        "allowFallback": true,
        "allowPicsumFallback": false
      },
      "styleConsistencyGroup": "site-primary-visuals"
    }
  ]
}
```

Resolver:

- call `RegenerateStockProjectImage` or a stock-specific resolver service
- resolve provider order through `mediaProviderPolicy`
- read provider keys from DB first, env second
- persist binary as `ProjectAsset`
- replace placeholder with `/p/media/:assetId`
- persist `MediaResolutionTrace`

Edit policy:

- edit-mode regenerate must pass `allowFallback: false`
- full initial generation may use configured fallback

---

### 4.2 `ai_generation`

Use when the visual style must be coherent, custom, or unavailable from stock.

Inputs:

- user/project style profile
- moodboard
- active preset
- selected section or artifact context
- image-generation provider/model policy
- optional reference assets and `AssetEnrichmentTrace`

Expected planner JSON:

```json
{
  "strategy": "ai_generation",
  "version": "media-strategy-plan-v1",
  "styleBrief": {
    "styleName": "warm editorial technology",
    "paletteHints": ["charcoal", "soft amber", "muted teal"],
    "compositionRules": ["wide hero crop", "clear subject space on the left", "no visible text"],
    "negativeGuidance": ["no watermarks", "no distorted hands", "no fake logos"]
  },
  "placements": [
    {
      "mediaKey": "hero-main",
      "kind": "background",
      "role": "hero",
      "generationPrompt": "Wide editorial photograph of a modern creative technology studio, warm indirect light, charcoal and muted teal palette, premium SaaS brand mood, clean negative space on the left, no text, no logos.",
      "negativePrompt": "watermark, text, logo, distorted people, blurry, low quality",
      "alt": "Creative technology studio with warm editorial lighting",
      "dimensions": { "width": 1600, "height": 900 },
      "styleConsistencyGroup": "site-primary-visuals",
      "referenceAssetIds": ["asset-logo-1", "asset-mood-2"]
    }
  ]
}
```

Resolver:

- call an image generation use case, not stock search
- persist generated file as `ProjectAsset`
- store prompt bundle, model, seed if available, cost, latency, and provider metadata
- replace placeholder with `/p/media/:assetId`
- persist `MediaResolutionTrace` with `providerKind = "image_generation"`

Required future contracts:

- extend `ArtifactMediaRequest` with optional generation fields already hinted by `generationPrompt`
- add image-generation provider policy to `PlatformConfig`
- add cost tracking through existing cost ledger patterns

---

### 4.3 `project_asset`

Use when the user uploaded assets that should appear in the generated site, such as logos, products, team photos, screenshots, documents, or brand visuals.

Inputs:

- `ProjectAsset` records scoped by project and user
- `AssetEnrichmentTrace` if available
- asset flags: `useInProject`, `styleRole`, labels, descriptions, MIME type, dimensions
- selected strategy preferences from frontend

Expected planner JSON:

```json
{
  "strategy": "project_asset",
  "version": "media-strategy-plan-v1",
  "contextInventory": {
    "availableAssets": [
      {
        "assetId": "asset-logo-1",
        "kind": "image_svg",
        "styleRole": "logo",
        "summary": "Primary brand logo, dark text on transparent background",
        "recommendedUses": ["header-logo", "footer-logo"]
      },
      {
        "assetId": "asset-product-1",
        "kind": "image_raster",
        "styleRole": "product",
        "summary": "Product dashboard screenshot with analytics cards",
        "recommendedUses": ["hero-product-shot", "feature-card"]
      }
    ]
  },
  "placements": [
    {
      "mediaKey": "brand-logo",
      "kind": "logo",
      "role": "logo",
      "selectedAssetId": "asset-logo-1",
      "selectionReason": "Only approved logo asset and matches header/footer usage",
      "fit": "contain",
      "cropPolicy": "none",
      "alt": "Company logo"
    }
  ],
  "missingSlots": [
    {
      "mediaKey": "hero-background",
      "reason": "No uploaded hero/background image matches the required wide crop"
    }
  ]
}
```

Resolver:

- verify project/user sandbox for every selected asset
- produce stable public/internal media URL via existing `/p/media/:assetId` serving path or a project-asset serving adapter
- no provider call unless fallback is explicitly allowed
- persist `MediaResolutionTrace` with `providerKind = "project_asset"`

Guardrail:

- never let the LLM choose an asset ID that the user cannot access
- resolver must validate all selected IDs against repository ownership

---

### 4.4 `hybrid_context`

Use when the system should inspect the available context first and decide the best source for each media slot.

This is the highest-value mode for Zero Effort and complex projects.

Inputs:

- raw user prompt
- preset and project metadata
- moodboard and user style profile
- uploaded assets and enrichment traces
- document summaries and visual metadata
- existing project media history
- provider policy and cost policy

Expected planner JSON:

```json
{
  "strategy": "hybrid_context",
  "version": "media-strategy-plan-v1",
  "contextAssessment": {
    "brandCompleteness": "partial",
    "visualStyleConfidence": 0.78,
    "hasUsableLogo": true,
    "hasUsableProductImages": true,
    "hasUsableHeroImages": false,
    "recommendedOverallStyle": "premium SaaS dashboard with warm editorial accents"
  },
  "placements": [
    {
      "mediaKey": "brand-logo",
      "chosenStrategy": "project_asset",
      "selectedAssetId": "asset-logo-1",
      "reason": "User uploaded a clear approved logo"
    },
    {
      "mediaKey": "hero-main",
      "chosenStrategy": "ai_generation",
      "generationPrompt": "Wide premium SaaS workspace scene inspired by the uploaded logo colors, warm editorial lighting, no visible text, no fake logos",
      "referenceAssetIds": ["asset-logo-1", "asset-style-2"],
      "reason": "No uploaded wide hero image exists, but brand/style references are available"
    },
    {
      "mediaKey": "feature-card-analytics",
      "chosenStrategy": "project_asset",
      "selectedAssetId": "asset-product-1",
      "reason": "Uploaded product screenshot matches analytics feature card"
    },
    {
      "mediaKey": "section-background",
      "chosenStrategy": "stock_search",
      "semanticQuery": "abstract warm gradient office texture premium software",
      "reason": "Decorative supporting background does not require custom generation"
    }
  ],
  "reviewRequired": true,
  "userReviewSummary": "Use uploaded logo and product screenshot, generate one coherent hero image, use stock only for secondary background texture."
}
```

Resolver:

- split placements by `chosenStrategy`
- call strategy-specific resolvers
- keep one unified `MediaResolutionTrace` record per placement
- persist planner JSON as a new `MediaStrategyPlan` record or inside trace metadata
- optionally require user approval before applying media when `reviewRequired = true`

---

## 5. Frontend Strategy Selector

Recommended UI surface in workspace and Zero Effort:

```text
Media strategy
[Auto Mix] [Stock] [AI Generate] [Project Assets]

Details shown per strategy:
Auto Mix       Analyze uploads, documents, style, and provider policy; choose per slot.
Stock          Fast provider-backed photos with configured fallback.
AI Generate    Custom coherent visuals from a structured style brief.
Project Assets Reuse uploaded logos, product shots, screenshots, and brand media.
```

Advanced options:

| Option | Applies to | Default |
| --- | --- | --- |
| Preserve style coherence | all | on |
| Prefer uploaded assets | auto mix, project assets | on |
| Allow stock fallback | initial generation | on |
| Allow AI fallback | auto mix | off until implemented |
| Require review before applying media | auto mix, project assets | on for Zero Effort, off for direct workspace generation |
| Strict missing media failure | all | on for publish/export |

Frontend request extension:

```typescript
interface MediaStrategyPreferences {
  mode: "hybrid_context" | "stock_search" | "ai_generation" | "project_asset";
  preserveStyleCoherence: boolean;
  preferUploadedAssets: boolean;
  allowStockFallback: boolean;
  allowAiGenerationFallback: boolean;
  requireReviewBeforeApply: boolean;
}
```

These preferences should be sent with chat-preview/generation requests and stored on preview snapshot metadata for traceability.

---

## 6. Backend Pipeline

### 6.1 Proposed services

```text
MediaStrategyPlanner
  input: project context, user prompt, media manifest, strategy preferences
  output: MediaStrategyPlan JSON

MediaStrategyPlanValidator
  validates planner JSON against strategy-specific Zod schemas

MediaPlacementResolver
  dispatches each placement to the correct resolver

StockMediaResolver
  wraps current RegenerateStockProjectImage path

GeneratedImageMediaResolver
  wraps future AI image generation path

ProjectAssetMediaResolver
  resolves approved project/user assets without provider calls

HybridMediaResolver
  orchestrates mixed strategy placements
```

### 6.2 Flow

```text
LLM chat output
  -> structured artifacts + mediaManifest
  -> MediaStrategyPlanner if preferences require strategy planning
  -> MediaStrategyPlanValidator
  -> MediaPlacementResolver
  -> ProjectAsset persistence or lookup
  -> replace asset://media/<key> with /p/media/:assetId
  -> MediaResolutionTrace per media key
  -> PreviewSnapshot.metadata.mediaResolution
```

### 6.3 Prompt ownership

The strategy prompts must follow the same ownership model already established for artifact media:

- hardcoded platform contract: JSON schema, safety, sandbox, no direct provider URLs
- editable project prompt: brand/product/user preferences
- governance prompt: operator policy and allowed source mix
- strategy prompt: one template per strategy
- model adapter prompt: provider-specific format hints only

No editable prompt is allowed to override sandbox checks, ownership checks, or direct-provider-URL prohibition.

---

## 7. Structured Contracts

### 7.1 Shared top-level plan

```typescript
type MediaStrategyMode =
  | "stock_search"
  | "ai_generation"
  | "project_asset"
  | "user_library"
  | "hybrid_context";

interface MediaStrategyPlan {
  version: "media-strategy-plan-v1";
  strategy: MediaStrategyMode;
  contextAssessment?: {
    brandCompleteness?: "none" | "partial" | "strong";
    visualStyleConfidence?: number;
    recommendedOverallStyle?: string;
    missingInputs?: string[];
  };
  placements: MediaPlacementPlan[];
  missingSlots?: MediaMissingSlot[];
  reviewRequired?: boolean;
  userReviewSummary?: string;
}
```

### 7.2 Placement plan

```typescript
interface MediaPlacementPlan {
  mediaKey: string;
  kind: "image" | "background" | "logo" | "icon" | "avatar" | "decorative";
  role: "hero" | "section" | "card" | "gallery" | "testimonial" | "avatar" | "background" | "logo" | "icon" | "decorative";
  chosenStrategy: MediaStrategyMode;
  alt: string;
  reason: string;
  dimensions?: { width: number; height: number };
  styleConsistencyGroup?: string;

  semanticQuery?: string;
  generationPrompt?: string;
  negativePrompt?: string;
  selectedAssetId?: string;
  referenceAssetIds?: string[];
  fit?: "cover" | "contain" | "auto";
  cropPolicy?: "none" | "safe-center" | "smart-crop";
}
```

### 7.3 Failure trace requirement

Every resolver exception path must persist a failed trace before returning an error:

```typescript
interface FailedMediaResolutionTraceInput {
  mediaKey: string;
  strategy: MediaStrategyMode;
  status: "failed";
  failureStage: "planning" | "validation" | "provider_resolution" | "download" | "persistence" | "asset_lookup" | "placeholder_replacement";
  errorMessage: string;
  attemptedProviders?: ImageResolutionAttempt[];
  selectedAssetId?: string;
}
```

---

## 8. Default Strategy Planner Prompts

Each selectable strategy should have a default planner prompt. These prompts produce JSON only; they do not resolve media directly and must not emit provider URLs. The backend validates every JSON output before any resolver runs.

### 8.1 Stock planner prompt

```text
You are the Stock Media Strategy Planner.

Input contains project context, mediaManifest.requests[], provider policy, and optional style context.
Return exactly one JSON object matching MediaStrategyPlan version media-strategy-plan-v1.

For each mediaManifest request:
- choose chosenStrategy = "stock_search"
- write a semanticQuery optimized for stock search, not provider API syntax
- preserve alt text and requested dimensions when present
- group visually related placements with styleConsistencyGroup
- set providerPolicy.useConfiguredPrimary = true
- set providerPolicy.allowFallback from the caller preference

Never emit pexels.com, pixabay.com, unsplash.com, loremflickr.com, picsum.photos, or any direct image URL.
Do not invent asset IDs.
```

### 8.2 AI image generation planner prompt

```text
You are the AI Image Generation Strategy Planner.

Input contains project context, moodboard, style profile, selected section context, mediaManifest.requests[], and optional reference asset summaries.
Return exactly one JSON object matching MediaStrategyPlan version media-strategy-plan-v1.

For each mediaManifest request:
- choose chosenStrategy = "ai_generation"
- write a generationPrompt suitable for an image model
- write negativePrompt when it improves quality or safety
- keep all placements visually coherent through styleConsistencyGroup
- use referenceAssetIds only from the supplied allowed asset list
- avoid text, fake logos, watermarks, distorted people, and brand-inconsistent visuals unless explicitly requested

Never emit direct provider image URLs.
Never choose an asset ID outside the supplied allowed list.
```

### 8.3 Project asset planner prompt

```text
You are the Project Asset Media Strategy Planner.

Input contains mediaManifest.requests[], project assets, asset labels, usage hints, styleRole, useInProject flags, and AssetEnrichmentTrace summaries.
Return exactly one JSON object matching MediaStrategyPlan version media-strategy-plan-v1.

For each mediaManifest request:
- choose chosenStrategy = "project_asset" when a supplied asset clearly fits the slot
- select selectedAssetId only from the supplied allowed project asset list
- explain selectionReason using the asset metadata and enrichment summary
- include missingSlots for media keys that cannot be satisfied by existing assets
- prefer assets marked useInProject and assets with matching styleRole or suggestedWebUse

Do not request stock or AI generation in this planner. If an asset is missing, report it in missingSlots.
Never invent asset IDs.
```

### 8.4 Hybrid context planner prompt

```text
You are the Hybrid Media Context Planner.

Input contains user prompt, preset, moodboard, user style profile, mediaManifest.requests[], project/user assets, AssetEnrichmentTrace summaries, provider policy, and strategy preferences.
Return exactly one JSON object matching MediaStrategyPlan version media-strategy-plan-v1.

First assess the context:
- brandCompleteness
- visualStyleConfidence
- usable logos/products/people/screenshots/backgrounds
- missing visual slots
- recommendedOverallStyle

Then decide one chosenStrategy per media key:
- project_asset when an uploaded asset is a strong semantic and layout match
- ai_generation when style coherence or missing custom hero visuals matter
- stock_search for fast realistic support imagery or decorative secondary media
- user_library only when the supplied allowed user-library assets include a clear match

Set reviewRequired = true when the plan mixes sources, uses user assets in prominent slots, or has confidence below 0.75.
Never emit direct provider URLs.
Never invent asset IDs.
```

---

## 9. Implementation Waves

### Wave A - Documentation and UI contract

- Add this spec to docs index.
- Add frontend strategy selector design to workspace and Zero Effort specs.
- Add shared `MediaStrategyPreferences` and `MediaStrategyPlan` contracts.

### Wave B - Planner MVP

- Implement `MediaStrategyPlanner` for `stock_search` and `project_asset` only.
- Add prompt templates with structured JSON output.
- Validate plan with Zod.
- Store plan metadata in media resolution traces.

### Wave C - Project asset resolver

- Implement `ProjectAssetMediaResolver`.
- Use `AssetEnrichmentTrace` for ranking.
- Validate double sandbox ownership for every selected asset.
- Add tests for unauthorized asset IDs.

### Wave D - AI generation resolver

- Implement `GeneratedImageMediaResolver`.
- Reuse image prompt context/prompt optimizer work from `IMAGE_PROMPTING_PIPELINE_SPEC.md`.
- Store generation prompt bundle and provider metadata.
- Add cost tracking.

### Wave E - Hybrid planner

- Implement `hybrid_context` planner that analyzes uploaded assets, documents, style profile, moodboard, and missing slots.
- Support review-required output before applying media.
- Add UI review panel for proposed placements.

### Wave F - Failure traces and admin dashboard

- Persist failed `MediaResolutionTrace` records for every exception path.
- Add admin notification dashboard with filters.
- Add provider/pipeline health cards.

### Wave G - Browser E2E

- Add Playwright test for full user path:
  1. set strategy mode
  2. generate artifact
  3. verify resolved `/p/media/:assetId`
  4. verify `data-media-key`
  5. save/activate snapshot
  6. regenerate selected media
  7. verify edit explicit failure without fallback when primary provider fails
  8. publish/export resolved snapshot
  9. verify unresolved snapshot block notification

---

## 10. Acceptance Criteria

The feature is complete when:

- frontend exposes a media strategy control in workspace generation and Zero Effort
- selected strategy is sent to backend and stored in snapshot/trace metadata
- all four strategies have validated JSON planner contracts
- `stock_search` uses configured provider policy and fallback
- `ai_generation` generates and persists new media through provider-specific image models
- `project_asset` and `user_library` reuse existing assets only after sandbox validation
- `hybrid_context` can choose a source per media slot and explain why
- failed planning/provider/download/persistence/asset lookup paths create failed traces
- admin can inspect media notifications and failures in a dashboard
- Playwright E2E covers the full browser path

---

## 11. Non-goals

- Do not expose raw provider URLs in generated artifacts.
- Do not let the LLM choose assets without backend ownership validation.
- Do not use base64 image payloads in prompt context.
- Do not add a new storage system for media strategy assets.
- Do not bypass the existing project/user sandbox model.
