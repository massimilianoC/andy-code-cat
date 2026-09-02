# WP4c — generate-stage journal correlation

1. STATUS: done

2. ASSIGNMENT: WP4c of docs/specs/SESSION_TRACING_EXECUTION_PLAN.md — stamp `workSessionId`,
   `pipelineRunId`, `pipelineStage`, and `endpoint` onto the `PromptExecutionLog` "pending" rows
   written by the `generate` stage (`/llm/chat-preview` and `/llm/chat-preview/stream`), so a
   journal row can be traced back to the Vibe request/work session that produced it.

3. FILES OWNED:
   - `apps/api/src/presentation/http/routes/llmRoutes.ts` — done (both handlers edited)
   - `apps/api/src/presentation/http/routes/__tests__/llmRoutesJournalCorrelation.e2e.test.ts` — done (new file, added)

4. DONE (verified):
   - Non-streaming handler (`POST /llm/chat-preview`): `const endpoint = ...` hoisted at
     **line 641**; `createPending({...})` call at **line 642** now includes `workSessionId`
     (line 647), `pipelineRunId` (648), `pipelineStage: "generate"` (649), `endpoint` (650); the
     `fetch(...)` call at line 666 now uses `fetch(endpoint, {...})`.
   - Streaming handler (`POST /llm/chat-preview/stream`): same shape — `const endpoint = ...`
     hoisted at **line 1122**; `createPending({...})` call right after includes the same four
     fields (`workSessionId` at 1128); the `sfRes = await fetch(...)` call (was ~line 1154, now
     ~1165 after the insert) uses `fetch(endpoint, {...})`.
   - No other lines in llmRoutes.ts touched. `ResolvePipelineModelLock` untouched.
   - New e2e test added and confirmed to (a) PASS with the fix, (b) FAIL without it — verified by
     temporarily reverting just the 4 new fields on the non-streaming handler, re-running the
     test (got `expected [] to have a length of 1 but got +0`), then restoring from a backup copy
     of llmRoutes.ts taken before the revert. The restored file is byte-identical to the fixed
     version (diff-checked via re-running the test, which passed again).
   - `npx tsc -p tsconfig.json --noEmit` — clean, no output.

5. NEXT: Nothing outstanding — task complete. If resuming for any reason, re-run
   `cd apps/api && npx tsc -p tsconfig.json --noEmit` and `npx vitest run` to reconfirm green
   before reporting.

6. DECISIONS:
   - Endpoint expression hoisted (identical in both handlers):
     `` `${context.providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions}` `` — i.e.
     `const endpoint = \`${context.providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions\`;`
     placed directly above each `createPending(...)` call, and both the `createPending` field and
     the `fetch(...)` call below it reference this same `const` (so the journal records the exact
     string that was called, not a re-derived guess, per the task's own instruction).
   - Wrote a new e2e test file (option allowed by the task) rather than extending an existing one,
     since no existing llmRoutes test drives `/chat-preview` (existing coverage only hits the
     dry-run `/prompt-preview` endpoint, which never calls a provider or writes a pending row).
   - Test strategy: create a REAL `PipelineRun` via the existing `/pipeline/launch-workspace`
     endpoint (exercises `ResolvePipelineModelLock` as a black box, per the "do not touch it"
     rule) and a real `work_sessions` document inserted directly into MongoMemoryServer, then
     drive `/llm/chat-preview` with both attached. Only `fetch` calls ending in
     `/chat/completions` are stubbed (to a deliberate 500, so the test doesn't need to fabricate a
     valid structured-artifact reply); every other fetch (catalog discovery/pricing probes) falls
     through to the real `fetch`, matching how the existing unmocked `llmPromptPreview.e2e.test.ts`
     already behaves in this environment. Assertions query `prompt_execution_logs` directly by
     `pipelineRunId` rather than relying on the (expected-to-fail) HTTP response body, since I11's
     pending write happens and is awaited before the provider call, regardless of that call's
     outcome. `process.env.SILICONFLOW_API_KEY` is set in the test file so `resolveAuthHeader()`
     doesn't block the request before reaching the pending write.

7. VERIFY (last observed, verbatim):
   - `npx tsc -p tsconfig.json --noEmit` → no output (clean). (Along the way, two files owned by
     other concurrent WPs on this shared branch — GenerateProjectImage.ts /
     imageGenerationJournalling.test.ts / projectAssetRoutes.ts — transiently showed unrelated
     type errors as those other agents edited them mid-flight; not touched by this WP, and gone
     by the final check.)
   - `npx vitest run` (full suite) → tail:
     ```
      Test Files  89 passed (89)
           Tests  678 passed (678)
        Start at  12:17:58
        Duration  12.67s (transform 24.91s, setup 0ms, import 30.61s, tests 80.28s, environment 23ms)
     ```
     678 > the 646 baseline the task cited because other concurrent WPs on this branch added
     tests too. No failures, no snapshot diffs reported by vitest.
   - Fail-without-fix check: temporarily stripped the 4 new fields from the non-streaming
     handler's `createPending` call only, re-ran just the new test —
     `AssertionError: expected [] to have a length of 1 but got +0` at the
     `db.collection("prompt_execution_logs").find({ pipelineRunId })` assertion — then restored
     the file from a pre-revert backup and re-ran to confirm it passes again. Confirms the test is
     load-bearing.
