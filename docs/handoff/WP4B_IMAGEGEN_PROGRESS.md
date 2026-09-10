# WP4b — image-generation journalling

1. STATUS: done

2. ASSIGNMENT: WP4b of docs/specs/SESSION_TRACING_EXECUTION_PLAN.md — make
   `GenerateProjectImage`'s SiliconFlow image call write a prompt-execution journal row
   (pending-before-dispatch, then completed succeeded/failed), same pattern as `VibeClassify`.

3. FILES OWNED (all done):
   - apps/api/src/application/media/generateImageWithSiliconFlow.ts — done
   - apps/api/src/application/use-cases/GenerateProjectImage.ts — done
   - apps/api/src/presentation/http/routes/projectAssetRoutes.ts — the route that constructs
     `GenerateProjectImage` (found via grep `new GenerateProjectImage(`); wiring lines only
     (constructor call + `workSessionId: req.workSession?.id` in the execute() call) — done
   - apps/api/src/application/use-cases/__tests__/imageGenerationJournalling.test.ts (new) — done

4. DONE (verified):
   - `resolveSiliconFlowImageEndpoint()` exported from generateImageWithSiliconFlow.ts (shared by
     both the fetch call and GenerateProjectImage's pre-dispatch pending write).
   - `sanitizeProviderResponse()` now emits an `image: "[base64 image payload omitted...]"` marker
     instead of silently dropping `b64_json`.
   - `GenerateProjectImage` constructor takes optional last param
     `promptExecutionLogRepository?: PromptExecutionLogRepository`; input gained
     `workSessionId?`/`pipelineRunId?`.
   - Pending row awaited before `generateImageWithSiliconFlow()` dispatch (siliconflow branch
     only — the placeholder/"system" fallback branch is not a paid provider call, so it is not
     journalled). `complete()` called on success (status "succeeded", durationMs, costEstimate,
     rawResponse) and on failure (outer catch — status "failed", durationMs, errorMessage). Every
     journal call is `.catch(() => undefined)`-guarded; pendingLogId is `string | null`.
   - Route wiring passes `promptExecutionLogRepository` (already constructed in that file) as the
     new last constructor arg, and `workSessionId: req.workSession?.id` in the execute() call.
   - New test file: 6 tests, all passing. Manually confirmed 4 of them (order, endpoint/prompt/ids,
     succeeded+sanitized rawResponse, failed completion) FAIL without the implementation change —
     verified by temporarily overwriting the two source files with their pre-change (HEAD) content,
     running just this test file, observing 4/6 red, then restoring the edited files from a
     scratchpad backup. The other 2 tests (no repo wired / repo throws) pass either way by design —
     they assert generation still succeeds untraced, which was already true.
   - Full suite: 652 passed (up from the pre-existing 646), tsc clean.

5. NEXT: nothing outstanding for WP4b. If continuing the broader execution plan, move to the next
   work package in docs/specs/SESSION_TRACING_EXECUTION_PLAN.md.

6. DECISIONS:
   - Base64 handling: `sanitizeProviderResponse` (generateImageWithSiliconFlow.ts) already stripped
     `b64_json` before this change but did so silently; it now replaces it with the string marker
     `"[base64 image payload omitted — asset bytes live in project asset storage]"` on the `image`
     field so the journal row can show that an image existed without ever carrying its bytes. The
     journal's `rawResponse` is `JSON.stringify(liveResult.providerResponse ?? {})` — the same
     already-sanitized object also used for the asset's own `generationMetadata.providerResponse`,
     so there is exactly one place base64 stripping happens, not two.
   - Fields left undefined rather than invented: `finishReason` on the *journal* completion is not
     set for image calls (the `PromptExecutionCompletion` type's `finishReason` is chat-shaped —
     `stop`/`length`/etc — and `/images/generations` has no equivalent; SiliconFlowImageGenerationResult's
     own `finishReason: "completed"` is a different, asset-metadata-only field, not reused here).
     `usage` (prompt/completion/total tokens) is also left undefined on the journal completion:
     SiliconFlow's image endpoint typically returns no `usage` block, and `costEstimate` already
     carries the true cost via `providerCostUsd`/flat-rate — inventing zero-token usage would be a
     lie about what the provider reported.
   - Journalling only wraps the real SiliconFlow branch, not the local-placeholder-SVG fallback
     branch — the fallback never calls a paid provider, so there is nothing to journal there.
   - `taskKey` for these rows is `"generate_project_image"` (module-level const in
     GenerateProjectImage.ts); `pipelineStage` is `"image_generation"` per the task spec.
   - `contextMeta` is passed as `{ usedMoodboard: false, usedUserProfile: false }` — same
     conservative default VibeClassify uses; GenerateProjectImage's moodboard/profile enrichment
     result isn't threaded out to the setTimeout closure scope, so this is honest rather than
     fabricated (todo for a future pass, not required by WP4b).

7. VERIFY (verbatim tail, last run of both commands after restoring the implementation — this repo
   has other agents editing didactic/enrichment files concurrently, which is why the file/test
   counts differ between runs below; none of those files are owned by this work package):

```
$ cd apps/api && npx tsc -p tsconfig.json --noEmit
(no output — clean, exit 0)

$ cd apps/api && npx vitest run
...
 Test Files  89 passed (89)
      Tests  678 passed (678)
   Start at  12:18:01
   Duration  11.89s (transform 23.06s, setup 0ms, import 38.15s, tests 75.58s, environment 17ms)
```

(Earlier in the same session, before other agents' concurrent commits landed, the same suite showed
86 files / 652 tests passing — the baseline 646 plus this WP4b's 6 new tests. Either snapshot is a
valid green baseline for THIS work package.)
