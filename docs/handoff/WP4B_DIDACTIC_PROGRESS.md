# WP4b — Didactic prompt-execution journalling

1. STATUS: done

2. ASSIGNMENT: WP4b of docs/specs/SESSION_TRACING_EXECUTION_PLAN.md — make the two didactic
   LLM call sites (`AskDidacticQuestion`, `GenerateDidacticKnowledge`) write a
   `PromptExecutionLog` journal row (pending-before-dispatch, then succeeded/failed), copying the
   pattern already shipped in `VibeClassify.ts` / `VibePrefill.ts`.

3. FILES OWNED:
   - apps/api/src/application/use-cases/AskDidacticQuestion.ts — edited, done
   - apps/api/src/application/use-cases/GenerateDidacticKnowledge.ts — edited, done
   - apps/api/src/presentation/http/routes/didacticRoutes.ts — edited, done
   - apps/api/src/application/use-cases/__tests__/didacticJournalling.test.ts — written, done, 10/10 passing

4. DONE:
   - `AskDidacticQuestion`: optional last ctor param `promptExecutionLogRepository`; `TASK_KEY =
     "didactic_ask"`. Only `streamTokens()` is instrumented (the only call site actually wired to
     the route — `execute()` is dead code, never called anywhere in the repo, left untouched).
     Pending row awaited before `fetch`; whole body wrapped in try/catch — success completes with
     `rawResponse: fullAnswer` (pre-render), `finishReason` captured from the SSE `finish_reason`
     field (newly captured, wasn't tracked before); catch marks `failed` and rethrows unchanged.
   - `GenerateDidacticKnowledge.execute()`: optional last ctor param
     `promptExecutionLogRepository`; `TASK_KEY = "didactic_knowledge_generate"`, pipelineStage
     `"didactic_knowledge"`. Pending row awaited before `fetch`. Journal completed "succeeded"
     right after the raw reply is read (before `parseDidacticJson`), using a `journalResolved`
     flag so a later JSON-parse failure doesn't double-complete the row as failed — a parse
     failure is an app-side problem, not a provider failure. Also filled in the pre-existing
     `sourceRef: { promptExecutionLogId: undefined }` placeholder at
     apps/api/src/application/use-cases/GenerateDidacticKnowledge.ts:311 with the real
     `pendingLogId`.
   - `didacticRoutes.ts`: wired `new MongoPromptExecutionLogRepository()` once per router, passed
     to both use-case constructors, and threaded `req.workSession?.id` into both call inputs.
   - tsc: clean (see VERIFY). Full test run not yet executed — do that next.

5. NEXT: Nothing outstanding for WP4b. Both verification commands are clean (see VERIFY). If
   resumed, just double-check `git status` still shows only the 4 owned files changed under this
   WP before reporting/handing off (other files appearing modified belong to concurrent WPs in
   the same working tree, e.g. WP4a image-generation journalling — see DECISIONS).

6. DECISIONS:
   - Did NOT instrument `AskDidacticQuestion.execute()` — grepped the whole repo, it has zero
     callers (only `streamTokens` + `persist` are used, from didacticRoutes.ts). Instrumenting
     dead code would be scope creep with no observable effect and extra risk.
   - Added `finishReason` capture to the SSE parsing loop in `streamTokens` (previously discarded)
     — needed to satisfy the required `finishReason` field on `complete()`; this is additive, not
     a behavior change to the existing return value.
   - Computed a real `costEstimate` via `estimateCost()` (same call shape as `VibeClassify`/
     `VibePrefill`) instead of leaving it undefined, since the field is explicitly listed in the
     task's required `complete()` call shape.
   - `inputPrompt` for `GenerateDidacticKnowledge` uses the rendered `user` prompt (sliced to
     2000) since there is no separate free-text "question" for this call — `AskDidacticQuestion`
     uses `question` directly.
   - Filled the `sourceRef.promptExecutionLogId` placeholder in `GenerateDidacticKnowledge`
     because it already existed as `undefined` in the code (clearly scaffolded for this), and
     wiring it needs zero signature changes.

7. VERIFY (last observed, verbatim):
   ```
   $ cd apps/api && npx tsc -p tsconfig.json --noEmit; echo "EXIT_CODE=$?"
   EXIT_CODE=0
   ```
   ```
   $ cd apps/api && npx vitest run
   ...
    Test Files  89 passed (89)
         Tests  678 passed (678)
      Start at  12:17:43
      Duration  10.43s (...)
   ```
   Note: mid-session, `tsc` twice showed a transient error in a file NOT owned by this WP
   (`AssetEnrichmentPipeline.ts`, then `llmRoutesJournalCorrelation.e2e.test.ts`), and one full
   `vitest run` showed 6 failures all inside `imageGenerationJournalling.test.ts` /
   `GenerateProjectImage.ts`. All three are concurrent-agent work-in-progress in the same working
   tree (confirmed via `git status` — those files are modified/untracked but not touched by this
   WP). A rerun of each moments later was clean, and the final full suite run above is 678/678
   green with 89/89 files passing.
