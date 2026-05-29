# Artifact Media Orchestrator - Implementation Status Certification

> Date: 2026-05-29
> Branch observed: `fix/llm-provider-compat`
> Scope: current Artifact Media Orchestrator implementation, prompt/media contract hardening, stock-provider defaults, Docker-local human test readiness, and future development gap map.
> Primary specs: [`docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`](../specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md), [`docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md`](../specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md), [`docs/specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md`](../specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md)

---

## 1. Certification Summary

The current implementation is a working MVP for manifest-backed artifact media resolution:

- New LLM artifacts are expected to use `asset://media/<key>` placeholders plus `mediaManifest.requests[]`.
- The backend resolves referenced media through the configured stock-provider policy.
- Resolved files are persisted as `ProjectAsset` records and exposed through internal `/p/media/:assetId` URLs.
- Preview snapshots carry `metadata.mediaResolution` with trace IDs, asset IDs, media keys, and degraded status.
- Publish/export paths block unresolved `asset://media/*` placeholders before writing public files or ZIPs.
- Edit-mode keyed regeneration uses the persisted `MediaResolutionTrace` and is primary-provider-only: no fallback is allowed in this edit path.
- Full initial artifact generation may use configured fallback so the first artifact can still complete when the primary provider fails.

This is not yet the complete target architecture. The resolver registry, AI image-generation strategy resolver, project/user asset strategy resolvers, browser E2E coverage, and admin observability UI remain open.

---

## 2. Verified Runtime Defaults

Current stock media defaults are implemented in `apps/api/src/application/media/mediaProviderPolicy.ts` and consumed by `apps/api/src/infra/image/ImageServiceOrchestrator.ts` plus the stock regeneration use cases.

Effective default policy when DB `PlatformConfig.mediaProviderPolicy` is absent:

| Area | Current value |
| --- | --- |
| Primary stock provider | `pexels` |
| Fallback enabled | yes |
| Fallback providers | `pixabay`, `unsplash`, `loremflickr` |
| Final no-key fallback | `picsum`, only when allowed in provider order |
| Key lookup order | DB `ServiceApiKey` first, environment variable second |
| Env keys | `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY` |
| Storage adapter observed locally | `STORAGE_ADAPTER=minio` |

Local runtime check on 2026-05-29 found no DB override for `mediaProviderPolicy`, so the code default above is the effective local policy. The `.env.docker` file had the provider key variables set, without exposing secret values in logs.

Important behavior split:

- Initial artifact generation: fallback is allowed according to policy.
- Edit/keyed regeneration: fallback is explicitly disabled with `allowFallback: false`; provider failure should return an explicit error and must not create/apply a fallback asset.

---

## 3. What Is Implemented Now

### Contracts

| File | Purpose |
| --- | --- |
| `packages/contracts/src/mediaManifest.ts` | Shared schema for artifact media manifests and `ArtifactMediaRequest`. |
| `packages/contracts/src/mediaResolution.ts` | Snapshot/LLM handoff metadata for trace IDs, asset IDs, media keys, and degradation status. |
| `packages/contracts/src/notifications.ts` | Persistent notification DTO/contracts for user and superadmin notification flows. |
| `packages/contracts/src/preview.ts` | Preview snapshot schema now accepts media-resolution metadata. |
| `packages/contracts/src/admin.ts` | Platform config schema includes media-provider policy baseline. |

### Backend Application Layer

| File | Current role |
| --- | --- |
| `apps/api/src/application/media/ResolveArtifactMedia.ts` | Central orchestrator: validates manifest, resolves stock/auto media, persists assets, writes traces, replaces placeholders. |
| `apps/api/src/application/media/replaceMediaPlaceholders.ts` | Extracts/replaces placeholders; auto-annotates foreground/inline HTML owners with `data-media-key`. |
| `apps/api/src/application/media/validateMediaManifest.ts` | Validates manifest shape and placeholder/request alignment. |
| `apps/api/src/application/media/assertResolvedMediaPlaceholders.ts` | Guard used before activation/publish/export to block unresolved placeholders. |
| `apps/api/src/application/media/mediaProviderPolicy.ts` | Normalizes default and DB media-provider policy and builds provider order. |
| `apps/api/src/application/media/mediaNotifications.ts` | Emits persistent notifications for fallback/failure/block events. |
| `apps/api/src/application/use-cases/RegenerateStockProjectImage.ts` | Resolves/downloads stock media, persists as `ProjectAsset`, supports `allowFallback`. |
| `apps/api/src/application/use-cases/RegenerateMediaByKey.ts` | Edit-mode keyed regeneration from latest `MediaResolutionTrace`; uses no fallback. |
| `apps/api/src/application/use-cases/ResolveAndPersistHtmlImages.ts` | Legacy/provider-URL compatibility path retained for migration only. |
| `apps/api/src/application/use-cases/DownloadExternalImageAsProjectAsset.ts` | Downloads external image bytes and stores them through the project asset pipeline. |
| `apps/api/src/application/services/SystemNotifier.ts` | Application-level notification facade configured from composition roots. |

### Backend Domain / Infra

| File | Current role |
| --- | --- |
| `apps/api/src/domain/entities/MediaResolutionTrace.ts` | Audit entity for per-media-key resolution attempts. |
| `apps/api/src/domain/repositories/MediaResolutionTraceRepository.ts` | Domain repository interface. |
| `apps/api/src/infra/repositories/MongoMediaResolutionTraceRepository.ts` | Mongo repository implementation. |
| `apps/api/src/domain/entities/SystemNotification.ts` | Persistent notification entity for user/superadmin messages. |
| `apps/api/src/domain/repositories/SystemNotificationRepository.ts` | Domain repository interface. |
| `apps/api/src/infra/repositories/MongoSystemNotificationRepository.ts` | Mongo repository implementation. |
| `apps/api/src/infra/image/ImageServiceOrchestrator.ts` | Provider fallback chain: Pexels, Pixabay, Unsplash, LoremFlickr, Picsum. |
| `apps/api/src/infra/image/ExternalImageDownloader.ts` | Downloads provider-selected media before persistence. |

### API Routes

| File | Current role |
| --- | --- |
| `apps/api/src/presentation/http/routes/llmRoutes.ts` | Chat-preview and stream route call `ResolveArtifactMedia` before returning/saving artifacts. |
| `apps/api/src/presentation/http/routes/projectAssetRoutes.ts` | Existing stock/image asset endpoints plus keyed media regeneration route. |
| `apps/api/src/presentation/http/routes/previewSnapshotRoutes.ts` | Snapshot creation/activation preserves media-resolution metadata and blocks unresolved placeholders. |
| `apps/api/src/presentation/http/routes/publishRoutes.ts` | Publish guard blocks unresolved media before publication. |
| `apps/api/src/presentation/http/routes/exportRoutes.ts` | Layer 1 ZIP export guard blocks unresolved media before export record/ZIP creation. |
| `apps/api/src/presentation/http/routes/notificationRoutes.ts` | User/superadmin notification APIs. |
| `apps/api/src/presentation/http/routes/adminRoutes.ts` | Platform config/provider status surfaces include media policy/key availability. |

### Prompt / LLM Pipeline

| File | Current role |
| --- | --- |
| `apps/api/src/application/llm/llmMessageBuilder.ts` | Hardcoded platform policy requires placeholders, `mediaManifest`, `data-media-key`, and forbids direct provider URLs. |
| `apps/api/src/application/use-cases/GetLlmPromptConfig.ts` | Default editable prompt aligned with the hardcoded media contract and no longer teaches direct stock URLs. |
| `apps/api/src/application/llm/llmParser.ts` | Parses/normalizes structured LLM output including `mediaManifest`. |
| `apps/api/src/application/llm/chatRequestAdapter.ts` | Request adapter coverage for provider/catalog compatibility. |

### Frontend

| File | Current role |
| --- | --- |
| `apps/web/app/workspace/[projectId]/page.tsx` | Extracts `data-media-key` from selected DOM and calls keyed regeneration when available. |
| `apps/web/components/MediaInspectorPanel.tsx` | Existing media inspector remains the user-facing edit/regenerate surface. |
| `apps/web/lib/api/assets.ts` | Asset/media regeneration API client helpers. |
| `apps/web/lib/api/notifications.ts` | Backend notification polling/mark-read client. |
| `apps/web/lib/notifications.tsx` | Merges local task notifications and persisted backend notifications. |

---

## 4. What Is Testable Now

### Automated checks already exercised in this wave

- `npm run test -w apps/api -- src/application/llm/__tests__/liveProviderCatalog.test.ts src/application/use-cases/__tests__/GetEffectiveLlmCatalog.test.ts src/application/llm/__tests__/chatRequestAdapter.test.ts`
- Targeted media/prompt tests were run during implementation for parser, media replacement, orchestrator, prompt policy, snapshot guardrails, publish/export guardrails, and keyed regeneration.

### Docker-local readiness verified

Active local stack was verified as `docker-compose.deploy.yml`, not the dev compose file. App services were rebuilt and restarted without touching MongoDB, Redis, or MinIO:

```bash
docker compose -f docker-compose.deploy.yml build api web
docker compose -f docker-compose.deploy.yml up -d --no-deps api web
```

Smoke checks passed:

| Check | Result |
| --- | --- |
| `node tests/health-check.js` | `{"status":"ok","service":"api"}` |
| `http://localhost:8081` | HTTP 200 |
| `http://localhost` | HTTP 200 through nginx |
| API logs | `API listening on port 4000`, health check 200 |
| Web logs | Next.js ready on `http://localhost:8081` |

Manual test entry points:

- App via nginx: `http://localhost`
- Web direct: `http://localhost:8081`
- API health: `http://localhost:4000/health`
- MinIO console, if operator needs it: `http://localhost:9001`

### User-side E2E path that should be manually verified

1. Log in and open a project workspace.
2. Generate an artifact that needs at least one hero/background image.
3. Verify final preview artifacts contain `/p/media/:assetId`, not provider URLs and not unresolved `asset://media/*`.
4. Save/activate the snapshot.
5. Inspect a generated image/background.
6. Trigger stock regenerate from the media inspector.
7. If `data-media-key` exists, verify the keyed route is used and a new snapshot version is created.
8. Force/choose a failing primary provider and confirm edit-mode regeneration fails explicitly without fallback.
9. Publish/export the resolved snapshot; it should not call media providers.
10. Simulate unresolved `asset://media/*` and confirm publish/export fail with notification.

---

## 5. Not Implemented Yet / Open Criticalities

The following items are not complete and should not be assumed present by future agents.

| Priority | Gap | Impact | Starting files |
| --- | --- | --- | --- |
| P0 | Unsupported manifest strategies are not resolved | `image_generation`, `project_asset`, and `user_library` are valid contract values but do not have resolvers yet. If emitted today, placeholders can remain unresolved and generation may fail. | `ResolveArtifactMedia.ts`, `llmMessageBuilder.ts`, `ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md` GAP-1 |
| P0 | All-or-nothing media resolution | One provider/download/persistence failure can discard otherwise resolvable media. | `ResolveArtifactMedia.ts` GAP-2 |
| P0 | No full browser E2E | Backend tests cover pieces, but there is no Playwright test for prompt -> manifest -> resolved preview -> edit regenerate -> publish/export. | `tests/e2e/`, `TESTABLE_STEPS.md` Step 16e |
| P1 | Superadmin provider-policy UI missing | Backend schema/config exists, but the dashboard does not expose primary provider/fallback/Picsum controls. | `apps/web/app/admin/governance/page.tsx`, `apps/web/lib/api/admin.ts` |
| P1 | Policy shape is smaller than target spec | `imageGeneration`, `resolution.maxMediaRequestsPerArtifact`, notification toggles, and strict manifest controls are not fully modeled/enforced by policy. | `packages/contracts/src/admin.ts`, `mediaProviderPolicy.ts`, `ResolveArtifactMedia.ts` |
| P1 | Failed traces incomplete | Notifications/logs exist, but not every provider/download/persistence exception writes a failed `MediaResolutionTrace`. | `ResolveArtifactMedia.ts`, `RegenerateStockProjectImage.ts` |
| P1 | CSS background owner inference incomplete | Foreground/inline placeholders are auto-annotated; CSS background owners still depend on the LLM emitting `data-media-key` on the owning HTML element. | `replaceMediaPlaceholders.ts`, `llmMessageBuilder.ts` |
| P2 | `MediaResolverRegistry` absent | Current orchestrator calls stock regeneration directly, so strategy expansion has no registry seam yet. | new `MediaResolverRegistry.ts`, `StockImageResolver.ts`, `ImageGenerationResolver.ts`, `ProjectAssetResolver.ts`, `UserLibraryResolver.ts` |
| P2 | AI image-generation resolver missing | Existing image generation flow exists for selected edit targets, but not as a manifest strategy resolver. | `IMAGE_PROMPTING_PIPELINE_SPEC.md`, `MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md` |
| P2 | Project/user asset strategy resolvers missing | Uploaded assets are not yet selected automatically by manifest strategy. | `ProjectAsset` repository, future `ProjectAssetResolver`, future user library model |
| P2 | Admin notification dashboard missing | Backend admin notification API exists; filtered media failure/fallback UI does not. | `notificationRoutes.ts`, future admin page |
| P2 | Media inspector fallback/degraded indicator incomplete | Provider badge exists in the inspector surface, but last-result fallback/degraded state is not fully surfaced as a warning badge. | `MediaInspectorPanel.tsx` |
| P2 | Existing DB prompt configs not migrated | Hardcoded platform policy overrides stale editable prompts at runtime, but old saved prompt text may still display contradictory direct-image guidance in UI until edited/migrated. | `GetLlmPromptConfig.ts`, prompt config admin/project UI |

---

## 6. Recommended Next Implementation Order

1. Close P0 safety gaps: downgrade or constrain unsupported manifest strategies; switch resolution to partial/all-settled semantics with explicit failure traces.
2. Add browser Playwright E2E around the real user path before further UI expansion.
3. Add the superadmin media-provider policy card using existing platform-config APIs.
4. Enforce `maxMediaRequestsPerArtifact` and move strict/fallback notification flags into normalized policy.
5. Persist failed `MediaResolutionTrace` rows for every exception path.
6. Introduce `MediaResolverRegistry` and wrap current stock path as `StockImageResolver`.
7. Implement `project_asset` resolver first, because it reuses existing `ProjectAsset` and sandbox checks.
8. Implement `image_generation` resolver using the image prompting pipeline and cost ledger patterns.
9. Add hybrid strategy planner and review UI from `MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md`.
10. Add admin notification dashboard/provider health cards.

---

## 7. Future Development Anchors

Use these documents as the starting map:

- Short-term gap backlog: [`docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md`](../specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md)
- Target architecture: [`docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`](../specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md)
- Strategy roadmap: [`docs/specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md`](../specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md)
- Manual test runbook: [`docs/runbooks/TESTABLE_STEPS.md`](../runbooks/TESTABLE_STEPS.md) Step 16c-16e
- Agent navigation: [`docs/agents/CODE_AGENT_INDEX.md`](../agents/CODE_AGENT_INDEX.md) Artifact Media Orchestrator Continuation Notes
- Prompt safety ownership: [`docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md`](../agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md)

Rule of thumb for future agents: do not add frontend provider logic. Provider choice, fallback, API-key lookup, resolver dispatch, storage, trace, and notifications remain backend responsibilities under the project/user sandbox.
