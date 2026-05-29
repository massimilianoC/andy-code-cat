# Artifact Media Orchestrator — Remaining Gaps

> Status: open gap backlog against `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`
> Date: 2026-05-29 (updated)
> Audience: code agents
> Purpose: each gap below is written to be picked up independently, with exact files, the change to make, and the acceptance check.

Scope: only the **stock MVP path** is in scope for now. Non-stock strategies (`image_generation`, `project_asset`, `user_library`) are on the roadmap in `docs/specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md` and must not be coded here until that spec is approved.

Legend — Effort: **S** ≤ half day · **M** ~1–2 days · **L** ≥ 2 days.

---

## Closed gaps (do not re-open)

| Gap | Closed | What was done |
| --- | --- | --- |
| Prompt precedence | 2026-05-29 | Media placeholder rules moved to non-editable budget-policy layer (`llmMessageBuilder.ts` + `systemPromptComposer.ts`), verified by `llmMessageBuilder.mediaPolicy.test.ts`. |
| GAP-1 — unsupported strategy hard-fails generation | 2026-05-29 | Non-stock strategies are now degraded to `stock` automatically with a `strategy_downgraded_to_stock` warning; generation continues instead of aborting. |
| GAP-2 — all-or-nothing resolution | 2026-05-29 | Each image is now resolved independently inside `Promise.all`; a failing image records a `media_resolution_failed` warning and a user notification, while successfully resolved images are applied. In non-strict mode the artifact is saved with unresolved placeholder(s) still in HTML/CSS (publish/export guardrail blocks publication until fixed via Edit mode). |
| GAP-3 — no superadmin UI for provider selection | 2026-05-29 | Added "Stock provider policy" card to `apps/web/app/admin/integrations/page.tsx`: primary provider select, fallback provider checkboxes, fallback enabled toggle, Picsum toggle. Reads from `GET /v1/admin/config`, writes via `PATCH /v1/admin/config`. |
| Schema `.strict()` rejection | 2026-05-29 | Removed `.strict()` from all four manifest schemas (`artifactMediaConstraintsSchema`, `artifactMediaContextSchema`, `artifactMediaRequestSchema`, `artifactMediaManifestSchema`). LLM extra fields are now silently stripped instead of failing validation. |
| `validateMediaManifest` throw on invalid input | 2026-05-29 | Changed to `warn + return undefined`; caller falls back gracefully to legacy resolver. |
| No try/catch in LLM routes | 2026-05-29 | Added try/catch around `resolveArtifactMedia.execute()` in both non-stream and stream chat-preview paths. Media resolution failure no longer aborts artifact delivery. |
| Parser drops `artifacts.mediaManifest` (MiniMax bug) | 2026-05-29 | `assembleResult` in `llmParser.ts` now rescues `parsed.artifacts.mediaManifest` as fallback when `parsed.mediaManifest` is absent at root. Covered by `llmParser.mediaManifest.test.ts` ("rescues mediaManifest placed inside artifacts"). |
| `data-media-key` without resolved image silently saved | 2026-05-29 | After full resolution (manifest + legacy), `ResolveArtifactMedia.execute()` now scans the final HTML for `data-media-key` elements whose image was never resolved, emits `media_resolution_failed` warnings and a persistent user notification for each. Covered by new test in `ResolveArtifactMedia.test.ts`. |
| Parser drops `mediaManifest` emitted as JSON STRING | 2026-05-29 | `coerceManifestCandidate()` in `llmParser.ts` now `JSON.parse`s a string-encoded manifest (root or inside `artifacts`) before zod validation. Closes the real MiniMax case. Covered by 2 new parser tests. |
| Metadata `degraded` not emitted when nothing resolved | 2026-05-29 | `buildMediaResolutionMetadata` no longer short-circuits to `undefined` when only warnings exist; emits `degraded:true` + affected `mediaKeys`. |
| `data-media-key` is now a deterministic resolution anchor | 2026-05-29 | The resolver resolves every manifest request referenced by an `asset://media` placeholder OR a `data-media-key` attribute. Keys without a placeholder are injected onto the annotated element: `src` for `<img>`, otherwise a scoped CSS rule `[data-media-key='<key>']{background-image:url(/p/media/:id)}`. Both conventions converge; no more "annotated empty element with no image". `injectMediaByDataKey` in `replaceMediaPlaceholders.ts`, covered by 2 new tests. |
| Media directives not archived in snapshot | 2026-05-29 | `mediaResolution.directives[]` added to the shared contract and built in `buildMediaResolutionMetadata`: per media `{ key, role, semanticQuery, status, provider, assetId, fallbackUsed }`. Full directives also remain in `media_resolution_traces` (with the complete `request`). The snapshot now carries an inspectable "requested vs produced" summary. |
| Published `app.css`/`app.js` 404 + MIME error | 2026-05-29 | Root cause: prompt told the model to use `app.js` but publish/export/workspace write `script.js`+`style.css`. Base-constraints prompt now mandates `script.js`/`style.css` and forbids other names. Regression test in `llmMessageBuilder.mediaPolicy.test.ts`. |
| Stuck opacity / fade (content invisible) | 2026-05-29 | "Visibility-without-JS" promoted to NON-EDITABLE platform rule with explicit forbidden patterns (AOS/WOW/ScrollReveal, Alpine `x-collapse`/`x-cloak`/`x-show` without plugin+fallback) and steer to native `<details>`/`<summary>`. No injected CSS net (per product decision). Regression test added. |
| Editor thumbnails for CSS background images | 2026-05-29 (verified) | No fix needed: the WYSIWYG scan already detects CSS backgrounds via `getComputedStyle().backgroundImage` and `MediaThumbnail` renders `<img src>` for `mediaType:"background"`. Confirmed working once the container runs current code. |

---

## Open gaps

### GAP-4 · `maxMediaRequestsPerArtifact` is not enforced

- **Severity:** medium · **Effort:** S
- **Where:** `apps/api/src/application/media/ResolveArtifactMedia.ts` (`resolveManifestRequests`, top of method)
- **Problem:** The manifest request count is never capped. An artifact with dozens of images is accepted in full. The prompt says "prefer quality over quantity" but does not hard-limit.
- **Fix:** at the start of `resolveManifestRequests`, if `manifest.requests.length > 20` (or a configurable constant), trim to the first 20 by priority and add a warning. No policy extension needed yet — a plain constant is sufficient for MVP.
- **Acceptance:** a manifest with 25 requests processes only the first 20; remaining keys stay as unresolved placeholders with a warning; existing tests still green.

### GAP-5 · Spec §11–§12 file/route map does not match the code

- **Severity:** low (documentation only) · **Effort:** S
- **Problem:** Spec §12 lists `mediaRoutes.ts`, `adminMediaPolicyRoutes.ts`, `infra/media/stock/*`, `MediaProviderPolicy.ts` as separate files. None exist. Actual implementation uses `projectAssetRoutes.ts` + platform-config + `application/media/*`. Sections §17/§18 are accurate; §11–§12 are not, which misleads future agents.
- **Fix:** add an "As-built implementation map" subsection to §12 of `ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md` listing the real files for each responsibility.
- **Acceptance:** a future agent reading §12 finds the correct file paths.

### GAP-6 · Failure traces not persisted (audit gap)

- **Severity:** low · **Effort:** S
- **Where:** `apps/api/src/application/media/ResolveArtifactMedia.ts` (catch block in the resolve map)
- **Problem:** When a provider fails, a notification + execution log is emitted but no `MediaResolutionTrace` row with `status:"failed"` is written. The trace history is therefore incomplete for failed resolutions.
- **Fix:** in the catch block, after calling `notifyMediaResolutionFailure`, also call `this.traceRepository?.createMany([{ ..., status:"failed", errorCode, errorMessage }])` if `traceRepository` is configured.
- **Acceptance:** a forced provider failure produces a `failed` trace row visible in the DB, plus existing happy-path tests still green.

### GAP-7 · Edit-mode notification channel inconsistency

- **Severity:** low · **Effort:** S
- **Where:** `apps/api/src/presentation/http/routes/projectAssetRoutes.ts` (`regenerate-stock` handler, calls `RegenerateStockProjectImage` without `suppressNotifications`) vs `RegenerateMediaByKey` which passes `suppressNotifications: true`.
- **Problem:** Legacy stock regenerate path emits persistent backend notifications on failure; media-key regenerate path suppresses them (client-only toast). The user gets inconsistent feedback depending on which code path runs.
- **Fix:** align both edit paths to the same policy. Recommended: persistent user notification on hard failure in both. In `RegenerateMediaByKey` remove `suppressNotifications: true`; or conversely suppress in both if client-side toast is preferred. Pick one and document.
- **Acceptance:** forcing a provider failure through both edit paths produces the same user-visible notification type.

---

## Missing E2E tests (browser-level, not yet implemented)

These are known gaps in test coverage. They do not block shipping but should be implemented before declaring the feature production-ready.

| Scenario | What to verify |
| --- | --- |
| Happy-path generation | Prompt → LLM returns manifest → artifact HTML has `/p/media/:id` URLs (not `asset://media/`) → snapshot activated |
| Partial failure | One provider call fails → other images resolve → snapshot saved with `degraded:true` → unresolved placeholder visible in preview → notification appears |
| Edit-mode regenerate by media-key | Click image with `data-media-key` → stock regenerate → new `/p/media/:id` URL applied → new snapshot version created |
| Edit-mode without media-key | Click image without `data-media-key` → legacy stock route called → image updated |
| Publish blocked | Snapshot with unresolved `asset://media/*` → publish fails with actionable error → notification created |
| Publish clean | Snapshot fully resolved → publish succeeds → published HTML has no `asset://media/*` |
| Admin provider switch | Change primary provider in Integration Hub → generate artifact → new provider is used |

Suggested tool: Playwright with provider mocked via `msw` or a lightweight HTTP interceptor so tests do not require live API keys.
