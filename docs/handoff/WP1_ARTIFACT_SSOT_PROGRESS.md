# WP1 — Artifact SSOT violation — progress checkpoint

## STATUS
In progress.

## STEP (1-4, which are done)
- Step 1: DONE (committed)
- Step 2: not started
- Step 3: not started
- Step 4: not started

## DONE
Step 1 — established why `latestAssistant?.metadata?.generatedArtifacts` was needed as a fallback
at all: `handleSend` in `apps/web/app/workspace/[projectId]/page.tsx` used to push the freshly
saved assistant message into `activeConv` state immediately after `addMessage()` resolved, and
only afterwards (via a separate awaited `commitArtifactVersion` + `listPreviewSnapshots` round
trip) committed the PreviewSnapshot and updated `previewSnapshots`/`selectedBackendSnapshotId`.
Any render in that gap — most visibly a conversation's very first generation, when
`previewSnapshots` is still empty so `selectedBackendSnapshot`/`activeBaselineSnapshot` both
resolve to `null` — had a "latest assistant message" with no snapshot backing it yet. That gap is
exactly what the `generatedArtifacts` live fallback existed to paper over.

Fix: `handleSend` no longer pushes the assistant message into `activeConv` until the snapshot
commit (or the decision that this turn produces no snapshot) has already settled. A new
top-level, non-exported helper `buildAssistantMessageForConv(message, snapshot)` (defined just
above `WorkspacePageContent`, ~line 179) stamps `snapshotId`/`mediaResolution` onto the message
when a snapshot was committed; a new closure `addAssistantMessageToConv` inside `handleSend` is
now the *only* place that pushes into `activeConv.messages`. All three exit paths (snapshot
committed, snapshot commit failed/stale-base, no snapshot applies this turn) go through it.

`buildAssistantMessageForConv` is deliberately NOT exported — Next.js's generated route typing
(`.next/types/app/workspace/[projectId]/page.ts`) fails `tsc` if a page module exports anything
App Router doesn't recognize (verified by trying it: TS2344 "Property ... is incompatible with
index signature").

Regression test: `apps/web/app/workspace/[projectId]/__tests__/artifactSsotOrdering.test.ts`.
It cannot import page.tsx (this vitest workspace runs `environment: "node"` with no React/JSX
vite plugin configured — importing page.tsx throws "Failed to parse source for import analysis
... make sure to not set jsx to preserve"; fixing that means editing `vitest.config.ts`, which is
outside WP1's owned files). So it reads the real page.tsx source at test time and asserts the
ordering invariant directly on it (string positions of the relevant statements, scoped to
`handleSend`'s body so the unrelated `runOptimizeAsync` flow's own local `assistantSaved` doesn't
false-positive the checks). 4 assertions, all passing; they fail if the reorder is reverted.

Commit: step 1 only, on top of `dda7506`.

## NEXT
Step 2 (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md WP1, second commit): remove the
`?? latestAssistant?.metadata?.generatedArtifacts` fallback at the two decision points —
`selectedBackendSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts` (was
:1901, now shifted further down by step 1's insertions — re-grep) and
`activeBaselineSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts` (was :2146).
Leave `selectedBackendSnapshot?.artifacts` / `activeBaselineSnapshot?.artifacts` as the sole
source at each site. Add a regression test asserting the preview renders from the snapshot alone
(same source-text-assertion approach as step 1's test, given the same import constraint). Also
remove the now-dead `assistantSnapshots` local (~line 1824 pre-edit, filters
`m.metadata?.generatedArtifacts` and is never read anywhere else — confirmed via grep). Command
to re-locate the two sites after step 1's edits:
`grep -n "generatedArtifacts" "apps/web/app/workspace/[projectId]/page.tsx"`.

## DECISIONS
- Ownership is read literally: only `page.tsx`, `Conversation.ts`, and new test files are
  touched. `apps/web/lib/api/conversations.ts` and `packages/contracts/src/conversation.ts` both
  still declare `generatedArtifacts?:` on their DTO/zod types and are NOT touched by this work —
  see REPORT contradiction note for what this means for the plan's "grep returns nothing" bar.
- `RequestInsightDialog`/`RequestMetaInfo` (page.tsx ~4800-5000, after step 1's line shifts) read
  `metadata.generatedArtifacts` to show historical html/css/js byte counts in a debug dialog.
  This is neither of the two named decision paths (:1901 / :2146) and the task's required
  sequence names only those two reads for step 2 — left alone for now, revisit only if it stops
  compiling once the field is removed from the frontend `MessageDto` type (it won't, since that
  type lives in a file outside WP1's ownership and step 4 only touches the backend
  `Conversation.ts` entity).
- Chose to keep the reorder minimal: `buildAssistantMessageForConv` and
  `addAssistantMessageToConv` are the only new pieces of structure; no other behavior in
  `handleSend` changed.

## VERIFY
```
cd apps/web && npx tsc --noEmit -p tsconfig.json
cd apps/web && npx vitest run
cd apps/api && npx vitest run
```
All three green after step 1 (web: 26/26 tests across 5 files; api: 695/695 across 91 files,
baseline was 687 — the excess is pre-existing, unrelated to this change).
