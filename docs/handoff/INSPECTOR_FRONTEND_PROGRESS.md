# Session Inspector — frontend progress

STATUS: DONE. Three collapsible blocks (Vibe / Zero Effort / Generation) built and wired into the
workspace Prompt view, layer-split logic tested against §6.5, tsc clean on apps/web, apps/api
suite unchanged at 695 (no backend touched).

## DONE
- Read docs/specs/SESSION_INSPECTOR_SPEC.md end to end before writing anything.
- Read the two backend endpoints and DTOs: apps/api/src/presentation/http/routes/workSessionRoutes.ts,
  ListWorkSessionSummaries.ts, GetWorkSessionDetail.ts, and their e2e test (fixture data was the
  ground truth for how `stages`, `entryMode`, and per-stage journal rows actually behave — the
  summary's `stages` array is sourced from PipelineRun.stages only, NOT from vibe_classify/
  vibe_prefill journal rows, so it cannot be used to decide block visibility; see DECISIONS).
- New API client: apps/web/lib/api/workSessions.ts (`listWorkSessions`, `getWorkSessionDetail`),
  re-exported from apps/web/lib/api/index.ts. Imports DTOs from `@andy-code-cat/contracts` only —
  nothing re-declared.
- New components, all under apps/web/components/workspace/inspector/:
  - `pfLayerSplit.ts` (+ `__tests__/pfLayerSplit.test.ts`, 8 tests) — pure PF_LAYER marker
    splitter. Returns layer segments AND the gap text between/around them, so the full
    segmentation reconstructs the original prompt exactly (§6.5's "nothing dropped").
  - `sessionSelectors.ts` (+ `__tests__/sessionSelectors.test.ts`, 10 tests) — pure derivations
    over WorkSessionDetailDto: which journal row belongs to which block, per-block cost sums,
    which blocks a session actually produced.
  - `SessionInspectorPanel.tsx` — the container. Fetches the session list on mount (no bodies),
    picks the newest session, fetches its detail once any block is open (Generation starts open,
    so that fetch fires as part of mounting), renders only the blocks the session produced.
  - `InspectorBlock.tsx` — shared collapsible header+body (controlled open state, cost subtitle,
    optional badge — used for the TRUNCATED marker).
  - `VibeBlock.tsx`, `ZeroEffortBlock.tsx`, `GenerationBlock.tsx` — one per spec §3.
  - `PfLayerAccordion.tsx` — renders a system prompt's layers as an accordion, byte-exact slices
    only (no recomposition).
  - `RawTextBlock.tsx`, `JournalMeta.tsx`, `formatters.ts` — small shared presentation pieces
    (collapsible raw-text viewer; endpoint/tokens/duration/cost/finishReason row; byte/field
    formatting).
- Wired into apps/web/app/workspace/[projectId]/page.tsx: `PromptCanvas` now renders
  `<SessionInspectorPanel projectId={projectId} />` as its primary content. See DECISIONS for what
  else changed in that file.
- i18n: added `workspace.inspector.*` (loading/empty/vibeTitle/zeroEffortTitle/generationTitle/
  truncated/noGeneration/noActivity) and `workspace.ui.promptPanelCurrentTurnTitle` to both
  apps/web/i18n/en.json and it.json. Validated both as parseable JSON after editing.
- Investigated the "assistant reply missing from sent-history panel" defect (spec §4). Conclusion:
  already fixed in the current tree, not by this session — see DECISIONS for the evidence. No
  change made; flagged for the user to confirm agreement with that read.
- Did not attempt the "large code block fragments into many accordions" defect — unreproduced per
  the task, out of scope, not investigated further.

## NEXT
Nothing outstanding for the spec as written. If picked up again:
- Consider whether the panel should let a user browse OLDER sessions, not just the newest one —
  deliberately out of scope here (see DECISIONS: "single latest session" for why).
- The Generation block cannot show "the artifact" (spec §3's last item) — see DECISIONS. If a
  route/DTO is added later that exposes `preview_snapshots.metadata.promptExecutionId` for a given
  promptExecutionLogId, GenerationBlock is the place to consume it.

## DECISIONS
- **Single latest session, not a session browser.** WorkSessionSummaryDto/DetailDto give no
  "how many sessions" UX guidance, and the spec's acceptance criteria (§6) all talk about "the"
  three blocks for one project state, not plural sessions. Mirrors `session-export.js`'s own
  default (most-recently-created session when nothing else is specified). Documented directly in
  SessionInspectorPanel.tsx's docblock.
- **Block visibility waits for the detail fetch, not the list summary.** The list's `stages` field
  is sourced only from PipelineRun.stages entries and — confirmed against the e2e fixture — does
  NOT include "vibe_classify" or "vibe_prefill" even when a vibe intake and a zero-effort proposal
  both exist for that session. So `stages`/`entryMode` cannot reliably answer "does this session
  have a Vibe block" before the fetch. Generation starts open (spec §1), so its fetch fires
  immediately on mount; while it's in flight only Generation renders, in a "loading" state (never
  an empty claim) using `summary.truncated` for its badge, which needs no fetch. Once detail
  resolves, `blocksPresent()` decides Vibe/Zero Effort/Generation from the real arrays
  (`vibeIntakes.length`, `zeroEffortFormProposals.length || canonicalBrief`, a `generate`-stage
  log) and only those render — §5.1's "never an empty placeholder" holds once ground truth is
  known, and the brief loading state before that isn't a placeholder lying about content.
- **Per-block cost sums with the same rule as the summary total, not a stricter one.**
  `ListWorkSessionSummaries.totalCostEur` sums `tx.totalEur` over every row with no status filter.
  `costForLog` in sessionSelectors.ts matches that exactly (no `status === "settled"` filter) so
  that Vibe-cost + Zero-Effort-cost + Generation-cost sums to `summary.totalCostEur` (spec §6.7)
  rather than silently drifting from it over a voided row.
- **`GenerationBlock` has no artifact preview.** Spec §2's table lists "the artifact via
  preview_snapshots.metadata.promptExecutionId" as a Generation-block source, but
  WorkSessionDetailDto (frozen, per the task) carries no preview-snapshot reference at all — only
  vibeIntakes/zeroEffortFormProposals/pipelineRuns/promptExecutionLogs/costTransactions. Per the
  task's explicit instruction ("if you find yourself needing a new field, stop and report"), this
  was NOT worked around (no new field invented, no cross-endpoint guess). The workspace canvas
  right next to this panel already shows the current artifact, so nothing is actually missing for
  the user — just flagging that this one spec line has no DTO support today.
- **The Prompt view's whole content was replaced with SessionInspectorPanel, not just prepended.**
  The old dry-run "preview of the next request" (`getLlmPromptPreview` / `promptPreview` /
  `loadingPromptPreview` / the auto-fetch-on-tab-open effect / the "↻ Reload" button) was removed
  from apps/web/app/workspace/[projectId]/page.tsx entirely. Reason: that effect fetched a full
  prompt body (`effectiveSystemPrompt`) automatically the moment the Prompt tab opened, which
  directly violates spec §6.8 ("opening the page fetches no prompt bodies"); there is no way to
  keep that feature and satisfy that acceptance criterion at the same time, so it went.
- **The existing `lastSentTrace`/`PromptLayersView`/`PromptTranscriptView` rendering for the
  *live* conversation was kept**, relabeled "Current turn — full conversation sent", rendered
  below the three blocks when a `lastSentTrace` exists. Reason: this reads from
  `activeConv.messages[...].metadata.promptingTrace` — already-loaded client state, not a network
  call — and it renders the full multi-turn `messagesSentToLlm` array (every user/assistant turn
  actually sent for the current conversation), which `PromptExecutionLogDetailDto` cannot provide
  (it carries one `renderedUserPrompt` string per journal row, not a turn-by-turn array). Removing
  it would have been a real feature loss with no replacement, and it costs nothing extra per
  §6.8 since it needs no additional fetch.
- **"Assistant reply missing from sent-history panel" (spec §4) — investigated, not re-fixed.**
  The component in question is `PromptTranscriptView` (its own header literally says "CRONOLOGIA
  INVIATA" = sent history). Its current code (`message.role === "assistant" ? labels.assistant :
  labels.user`) already renders assistant turns correctly, and the comment directly above its call
  site in page.tsx ("I16: every non-system message in the trace (user AND assistant history
  turns)... were being dropped from this view before") describes exactly this defect as already
  fixed. `git log` traces that fix to commit bf3fb10 ("fix(workspace): fold the sent-conversation
  history in the prompt panel", 2026-08-26) and the I16 snapshot-selection refinement, both
  already in this branch's history. No other "sent history" component exists in the codebase
  (grepped for CRONOLOGIA/sent-history/historySent across apps/web). Left unchanged rather than
  making a speculative edit to already-correct code; flagged here in case the spec's diagnosis
  predates that fix and the user wants it re-verified against a live repro.
- Styling matches the existing dark Prompt-tab aesthetic (inline styles, same palette as
  PromptLayersView/PromptTranscriptView: `#0b1220`/`#0c1523` backgrounds, `#7dd3fc` accent,
  `#94a3b8`/`#6b7280` text) rather than the Tailwind/shadcn components used elsewhere on the page
  (e.g. RequestInsightDialog), for visual consistency with the panel it lives in.
- Attachment downloads use `getPublicAssetUrl` (no-auth, direct `<a href>`) rather than
  `getAssetDownloadUrl` (requires an authenticated fetch, not a plain link) — simpler and correct
  for a read-only inspector.
- Layer labels in `pfLayerSplit.ts` are humanized from the marker's `key` (e.g. "base-constraints"
  -> "Base Constraints") rather than imported from `PROMPT_LAYER_DESCRIPTORS`, which lives in
  apps/api and isn't exposed to the client. Cosmetic only — span/content, the actually-verified
  bytes, come straight from the marker-delimited slice, not from this label.
- No apps/web component-render test infra exists yet (`apps/web/vitest.config.ts` runs
  `environment: "node"`, no jsdom/RTL, no `.test.tsx` precedent anywhere in the repo) — did not
  add one. `pfLayerSplit.ts` and `sessionSelectors.ts` carry the logic that needs proving and are
  both plain `.ts`, testable exactly like the existing `promptTranscriptSegments.test.ts`.

## VERIFY

`cd apps/web && npx tsc --noEmit -p tsconfig.json` — exit 0, no output.

`cd apps/web && npx vitest run` tail:
```
 Test Files  9 passed (9)
      Tests  49 passed (49)
```
(49 = prior 31 + 18 new: 8 in pfLayerSplit.test.ts, 10 in sessionSelectors.test.ts.)

`cd apps/api && npx vitest run` tail:
```
 Test Files  91 passed (91)
      Tests  695 passed (695)
   Start at  22:34:07
   Duration  9.97s (transform 14.60s, setup 0ms, import 24.44s, tests 68.36s, environment 15ms)
```
(695 = same baseline as INSPECTOR_BACKEND_PROGRESS.md — no apps/api files touched by this task.)
