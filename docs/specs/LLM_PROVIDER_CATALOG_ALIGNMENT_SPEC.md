# LLM Provider Compatibility And Catalog Alignment Summary Spec

Status: implementation summary for the current `fix/llm-provider-compat` worktree scope.

This document is a compact, review-oriented summary of the LLM provider work introduced during the current compatibility and single-source-of-truth effort.

It exists for two purposes:

1. give another coding agent a precise change map without re-reading the entire chat history;
2. distinguish the provider/catalog/picker work from unrelated files that may already be modified in the branch or worktree.

---

## 1. Goal Of This Change Set

The effort addressed four coupled problems:

1. provider compatibility failures on OpenRouter and selected SiliconFlow models;
2. drift between user-facing provider/model lists and superadmin registry lists;
3. stale static model identifiers and parameter mismatches that caused runtime failures;
4. duplicated provider/model selection UI with inconsistent filtering behavior.

The final target was:

- keep runtime requests regression-safe;
- centralize provider/model discovery behind one backend source of truth;
- expose the maximum provider-visible model catalog without over-hiding entries;
- give admin and workspace surfaces the same reusable provider/model picker.

---

## 2. Final Behavior Introduced

### 2.1 Provider request compatibility

The request path now preserves provider-specific safety instead of sending a generic OpenAI-compatible body to every model family.

Introduced behavior:

- reasoning and thinking parameters are only sent where the adapter explicitly allows them;
- OpenRouter and SiliconFlow runtime paths no longer depend on stale static IDs only;
- runtime request payload construction is centralized in a provider-aware adapter.

Primary files:

- `apps/api/src/application/llm/chatRequestAdapter.ts`
- `apps/api/src/application/llm/__tests__/chatRequestAdapter.test.ts`

### 2.2 Single backend source of truth for provider catalogs

The backend no longer has separate catalog behavior for workspace UI vs admin registry.

Final state:

- `GetLlmCatalog` now returns the effective hydrated catalog for all API consumers;
- live `/models` hydration is applied centrally, not route-by-route;
- `activeProvider` is derived from the same hydrated catalog object;
- admin registry and workspace provider list both read the same backend truth.

Primary files:

- `apps/api/src/application/use-cases/GetLlmCatalog.ts`
- `apps/api/src/application/use-cases/GetEffectiveLlmCatalog.ts`
- `apps/api/src/application/use-cases/__tests__/GetEffectiveLlmCatalog.test.ts`
- `apps/api/src/application/llm/liveProviderCatalog.ts`
- `apps/api/src/application/llm/__tests__/liveProviderCatalog.test.ts`
- `apps/api/src/presentation/http/routes/llmRoutes.ts`
- `apps/api/src/presentation/http/routes/adminRoutes.ts`
- `apps/api/src/presentation/http/routes/vibecoreRoutes.ts`
- `apps/api/src/presentation/http/routes/projectAssetRoutes.ts`

### 2.3 Broader provider model visibility

The provider catalog now prefers visibility over aggressive exclusion.

Final state:

- provider-exposed models are no longer hidden just because they are not fully characterized in advance;
- capability inference is used to classify models where possible;
- non-chat models can remain visible and be labeled rather than silently removed;
- price and capability metadata continue to be attached where available.

Primary files:

- `apps/api/src/application/llm/liveProviderCatalog.ts`
- `apps/api/src/application/llm/defaultOpenRouterCatalog.ts`
- `apps/api/src/application/llm/defaultSiliconFlowCatalog.ts`

### 2.4 Admin/user catalog alignment in the UI

The frontend now uses the same catalog semantics in admin and workspace surfaces.

Final state:

- task settings no longer rely on a separate hardcoded provider/model default set;
- admin normalization resolves task settings against the live registry instead of a filtered parallel list;
- provider/model selection is shared via one reusable component.

Primary files:

- `apps/web/lib/api/admin.ts`
- `apps/web/lib/adminLlmCatalog.ts`
- `apps/web/app/admin/zero-effort/page.tsx`
- `apps/web/app/admin/governance/page.tsx`
- `apps/web/app/admin/models/page.tsx`
- `apps/web/app/workspace/[projectId]/page.tsx`
- `apps/web/components/admin/PromptTaskSettingsCard.tsx`
- `apps/web/components/llm/ProviderModelPicker.tsx`

### 2.5 Reusable provider/model picker

The duplicated native `<select>` controls were replaced by a compact searchable picker.

Final state:

- fast partial-match search by provider/model/family/capability text;
- grouping by family/vendor;
- inline badges such as `CHAT`, `VISION`, `IMAGE`, `EMBED`, `DEFAULT`, `FREE`;
- same component reused across workspace and superadmin surfaces.

Primary file:

- `apps/web/components/llm/ProviderModelPicker.tsx`

---

## 3. Runtime Selection Implications

This change set intentionally moved the system to one effective catalog path.

That means:

- runtime model resolution in `llmRoutes.ts` now sees the same hydrated catalog used by the UI;
- admin registry and workspace selection no longer drift because of route-local discovery logic;
- dead local discovery code in `llmRoutes.ts` was removed to avoid future divergence.

Important consequence:

- the old design compromise of “live discovery for UI, static catalog for runtime only” is no longer the final state;
- the current final state is “live-hydrated catalog for all API consumers, with provider-aware request adaptation to remain safe at call time”.

---

## 4. Live Validation Already Performed

The following validations were completed against the current implementation:

### 4.1 Focused automated checks

- `npm run test -w apps/api -- src/application/llm/__tests__/liveProviderCatalog.test.ts src/application/use-cases/__tests__/GetEffectiveLlmCatalog.test.ts`
- `npm run build -w apps/api`
- `npm run build -w apps/web`

### 4.2 Local Docker deploy-stack rebuild and live smoke tests

Stack detected as active:

- `docker-compose.deploy.yml`

Rebuild command used:

- `docker compose -f docker-compose.deploy.yml up -d --build --no-deps api web`

Live endpoint checks performed:

- `/v1/llm/providers`
- `/v1/admin/llm-registry`

Live smoke-test result at time of writing:

- `source = mongo`
- `activeProvider = lmstudio`
- provider/model parity confirmed between workspace catalog route and admin registry route
- live counts:
  - `lmstudio = 13`
  - `openrouter = 361`
  - `siliconflow = 76`

Observed capability distribution snapshot:

- `lmstudio`: chat 11, embeddings 2, vision 1
- `openrouter`: chat 361, vision 168
- `siliconflow`: chat 62, embeddings 5, image_generation 9, vision 9

---

## 5. Known Residual Risks

These are the main things another agent should explicitly review:

1. OpenRouter capability inference is intentionally broad and currently marks all discovered OpenRouter models as `chat`, with `vision` added where inferred. This is acceptable for visibility, but badge semantics may still need refinement.
2. The new picker improves consistency, but its usability with very large model lists should still be reviewed manually in the browser.
3. The current implementation does not yet adopt provider-native OpenRouter `response_format: { type: "json_schema" }` structured outputs. Parsing/repair remains the cross-provider baseline.

---

## 6. Files Touched In This Provider/Catalog Scope

This list is the intended review perimeter for the current LLM provider alignment work.

### 6.1 Backend core

- `apps/api/src/application/llm/chatRequestAdapter.ts`
- `apps/api/src/application/llm/liveProviderCatalog.ts`
- `apps/api/src/application/llm/defaultOpenRouterCatalog.ts`
- `apps/api/src/application/llm/defaultSiliconFlowCatalog.ts`
- `apps/api/src/application/use-cases/GetLlmCatalog.ts`
- `apps/api/src/application/use-cases/GetEffectiveLlmCatalog.ts`
- `apps/api/src/presentation/http/routes/llmRoutes.ts`
- `apps/api/src/presentation/http/routes/adminRoutes.ts`
- `apps/api/src/presentation/http/routes/vibecoreRoutes.ts`
- `apps/api/src/presentation/http/routes/projectAssetRoutes.ts`

### 6.2 Backend task-routing alignment

- `apps/api/src/application/use-cases/OptimizeUserPrompt.ts`
- `apps/api/src/application/use-cases/DraftProjectTemplate.ts`
- `apps/api/src/application/use-cases/VibeClassify.ts`
- `apps/api/src/application/use-cases/VibePrefill.ts`
- `apps/api/src/application/prompting/OptimizeImagePrompt.ts`
- `apps/api/src/application/prompting/SuggestProjectImageIdea.ts`

These files matter because they previously pinned provider/model resolution behavior separately and now need to remain coherent with the unified catalog behavior.

All six task-routing use-cases above now build their provider request through the shared
`chatRequestAdapter.ts` (`buildChatCompletionRequestBody`), so provider-aware request safety
is applied at every chat-completions call site, not only in `llmRoutes.ts`.

#### Additional model-selection entry points (vision / document enrichment)

These also resolve provider/model from the unified `GetLlmCatalog`, but intentionally do **not**
route through `chatRequestAdapter.ts`: they are vision/multimodal calls where reasoning/thinking
gating does not apply, and they do not carry a `provider` field through the documents layer.

- `apps/api/src/application/documents/enrichment/AssetEnrichmentPipeline.ts`
- `apps/api/src/application/documents/image/ImageAnalyzer.ts`
- `apps/api/src/application/documents/enrichment/DocumentBriefExtractor.ts`

### 6.3 Frontend core

- `apps/web/components/llm/ProviderModelPicker.tsx`
- `apps/web/components/admin/PromptTaskSettingsCard.tsx`
- `apps/web/app/workspace/[projectId]/page.tsx`
- `apps/web/app/admin/models/page.tsx`
- `apps/web/app/admin/zero-effort/page.tsx`
- `apps/web/app/admin/governance/page.tsx`
- `apps/web/lib/api/admin.ts`
- `apps/web/lib/adminLlmCatalog.ts`

### 6.4 Tests

- `apps/api/src/application/llm/__tests__/chatRequestAdapter.test.ts`
- `apps/api/src/application/llm/__tests__/liveProviderCatalog.test.ts`
- `apps/api/src/application/use-cases/__tests__/GetEffectiveLlmCatalog.test.ts`

### 6.5 Documentation updated or to update with this effort

- `docs/specs/LLM_PROVIDER_CATALOG_ALIGNMENT_SPEC.md` (this document)
- `docs/INDEX.md`

---

## 7. Scope Exclusions

The current worktree also contains other modified files not driven by this provider/catalog alignment effort, especially around media ingestion, image persistence, stock connectors, and older spec archive changes.

Those files should not be treated as part of this review unless a reviewer explicitly wants to audit the broader branch.

Examples of adjacent but out-of-scope worktree areas:

- `apps/api/src/infra/image/*`
- `apps/web/components/MediaInspectorPanel.tsx`
- `apps/web/lib/api/assets.ts`
- `packages/contracts/src/assets.ts`
- `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`
- `docs/specs/IMAGE_FETCH_PERSISTENCE_REFACTOR_PROPOSAL.md`

---

## 8. Manual Review Checklist For A Second Agent

The reviewing agent should confirm all of the following:

1. `GetLlmCatalog` is now the single effective catalog source and no route-local model discovery logic remains in `llmRoutes.ts`.
2. `/v1/llm/providers` and `/v1/admin/llm-registry` remain structurally aligned.
3. runtime request safety still depends on `chatRequestAdapter.ts`, not on provider filtering alone.
4. the picker component is the only provider/model selection primitive needed for current admin/workspace surfaces.
5. the document’s touched-file list matches the actual provider/catalog work and does not confuse unrelated image/media refactor files with this scope.

---

## 9. Recommended Next Steps

After review, the most natural follow-up items are:

1. refine capability labeling for large OpenRouter catalogs;
2. optionally add OpenRouter native structured outputs as an opt-in fast path for supported models;
3. update the legacy OpenRouter guide to match the final implementation instead of the earlier filtered-discovery design.
