# WP4b — Enrichment slice progress

1. STATUS: done

2. ASSIGNMENT: WP4b of docs/specs/SESSION_TRACING_EXECUTION_PLAN.md — make the document/image
   enrichment LLM calls (ImageAnalyzer, DocumentBriefExtractor) write prompt-execution journal
   rows, pending-before-dispatch, per docs/specs/WORK_SESSION_TRACING_SPEC.md §2/§3.

3. FILES OWNED:
   - apps/api/src/application/documents/image/ImageAnalyzer.ts — done
   - apps/api/src/application/documents/enrichment/DocumentBriefExtractor.ts — done
   - apps/api/src/application/documents/enrichment/AssetEnrichmentPipeline.ts — done
   - apps/api/src/application/documents/__tests__/enrichmentJournalling.test.ts — done (new file)

4. DONE:
   - ImageAnalyzer.ts `analyzeImage()`: writes pending row before `fetch`, completes
     succeeded/failed after, in one try/catch (pendingLogId nullable, every journal call
     `.catch()`-guarded). New required input field `provider: string`; new optional
     `promptExecutionLogRepository?`, `projectId?`, `userId?`, `workSessionId?`,
     `pipelineRunId?`, `assetId?`. taskKey `enrich_image`, pipelineStage `image_analysis`.
   - DocumentBriefExtractor.ts: same pattern added to BOTH `extractDocumentBrief()` (taskKey
     `enrich_document`) and `extractDatasetAppendix()` (taskKey `enrich_dataset_appendix`);
     both use pipelineStage `document_brief`. Shared helpers `createPendingJournalRow` /
     `completeJournalRow` + new exported type `DocumentJournalContext` (requires `provider`,
     optional repo/projectId/userId/workSessionId/pipelineRunId/assetId) added to the file.
   - AssetEnrichmentPipeline.ts: added `workSessionId?`/`pipelineRunId?` to `EnrichmentInput`;
     added private `journalContextFor(input, providerKey)` building a `DocumentJournalContext`;
     wired it into the 3 call sites (extractDocumentBrief, extractDatasetAppendix, analyzeImage).
     Removed the now-dead `persistPromptExecutionLog` private method and its 4 call sites, and
     the now-unused `buildDocumentBriefPrompt`/`buildDatasetAppendixPrompt` imports and the
     `briefPrompt`/`datasetAppendixPrompt` locals that only fed those removed calls.
     Cost ledger path (`recordEnrichmentCost` → `CostTransactionService`) untouched.
   - tsc clean, vitest: new test file 15/15 passing; full suite 667 passed/1 failed (668 total,
     up from the 646 baseline — other concurrent WPs in this tree added tests too). The 1
     failure is `llmRoutesJournalCorrelation.e2e.test.ts`, explicitly labeled "WP4c" in its
     describe block — not one of my owned files, pre-existing/in-progress from a concurrent
     agent (confirmed via `git status`: untracked file, plus unrelated dirty files
     generateImageWithSiliconFlow.ts / AskDidacticQuestion.ts / GenerateDidacticKnowledge.ts /
     GenerateProjectImage.ts / didacticRoutes.ts / llmRoutes.ts already modified by someone else
     before I started). Not touched, not in scope.

5. NEXT: nothing pending for WP4b. If resuming: re-run
   `cd apps/api && npx tsc -p tsconfig.json --noEmit` and
   `cd apps/api && npx vitest run src/application/documents/__tests__/enrichmentJournalling.test.ts`
   to reconfirm, then check whether the WP4c e2e test failure has since been fixed by its owner.

6. DECISIONS:
   - **What AssetEnrichmentPipeline already journalled before I touched it**: `enrich_document`
     and `enrich_dataset_appendix` ALREADY had journal rows, written via a private
     `persistPromptExecutionLog()` helper calling `repo.create()` — but only AFTER the provider
     fetch resolved (both success and catch branches called it post-hoc), violating the
     pending-before-dispatch rule. Fields it carried: taskKey, projectId, userId,
     conversationId, provider, model, inputPrompt (full, unsliced), contextMeta{assetIds,
     usedMoodboard:false, usedUserProfile:false}, usage, a manually-built costEstimate, status,
     errorMessage, durationMs. It never had: workSessionId, pipelineRunId, pipelineStage,
     endpoint, renderedSystemPrompt/renderedUserPrompt, finishReason, rawResponse. `enrich_image`
     (vision call) had **no journal row at all** — only its cost was recorded via
     `recordEnrichmentCost`/`CostTransactionService`. So: for document brief + dataset appendix I
     ENRICHED existing rows (moved creation to pending-before-dispatch, added the missing
     fields) — I did not add a second row. For image analysis I ADDED a new row from nothing.
   - Skipped `costEstimate` on the `complete()` payload for all three calls — the task's NOTE
     scoped the "per-call detail" to add as exactly "endpoint, rawResponse, finishReason,
     workSessionId, pipelineRunId" (no costEstimate), and `costEstimate` is optional on
     `PromptExecutionCompletion`, so this isn't a spec gap, just a scope-minimization call to
     avoid duplicating cost-math (estimateCost/getSiliconFlowPrice) inside two more files. The
     cost ledger (CostTransactionService) is unaffected either way.
   - Used one try/catch per LLM call (pending id computed once, single success completion at the
     end, single failure completion in `catch`) rather than mirroring VibeClassify's per-branch
     completion calls — functionally identical, less duplicated code, and matches that these
     functions already throw on every failure path (no in-place "skipped" degrade).
   - Added `provider: string` as a new required input field (ImageAnalysisInput) / required
     field on `DocumentJournalContext` — needed because the provider catalog key wasn't
     previously threaded into these functions but the journal's `provider` column is required.
     Verified via grep that AssetEnrichmentPipeline.ts is the only caller of `analyzeImage`,
     `extractDocumentBrief`, and `extractDatasetAppendix` in the repo, so this is safe.

7. VERIFY (verbatim, last run):
   - `cd apps/api && npx tsc -p tsconfig.json --noEmit` → no output (clean, exit 0).
   - `cd apps/api && npx vitest run` tail:
     ```
      Test Files  1 failed | 87 passed (88)
           Tests  1 failed | 667 passed (668)
        Start at  12:15:42
        Duration  10.49s (transform 20.05s, setup 0ms, import 28.16s, tests 66.56s, environment 19ms)
     ```
     Failure: `src/presentation/http/routes/__tests__/llmRoutesJournalCorrelation.e2e.test.ts`
     ("WP4c" describe block) — `expected [] to have a length of 1 but got +0` — not my file.
   - `cd apps/api && npx vitest run src/application/documents/__tests__/enrichmentJournalling.test.ts`:
     ```
      Test Files  1 passed (1)
           Tests  15 passed (15)
     ```
