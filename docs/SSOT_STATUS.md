# SSOT — Consolidated Status

**What this is:** the single entry point for the "single source of truth" programme that ran from
July to August 2026 across model routing, prompt composition and artifact versioning. It replaces
a stack of progress trackers and analyses that no longer agree with the code (listed in §6).

**Verified against:** working tree at `local/test-strict-chain` (`dec8f42`), which is
`origin/develop` (`0a70045`, release `2026.08.28.2`) plus four commits, three of which were already
cherry-picked into `origin/develop`. `origin/main` (`6686ba4`) carries the same release, so
**everything described here is live in production**, not sitting on a branch.
**Date:** 2026-08-31.

> Note for whoever reads git next: the *local* `develop` ref in this clone is 55 commits stale
> (it still points at PR #75). Compare against `origin/develop`, not `develop`.

---

## 1. The verdict, in one paragraph

The programme did **not** fail, and it is further along than the documentation admits. Three of the
four things it set out to make single are genuinely single today, enforced in code and covered by
passing tests: there is one launch entry point, one prompt composer for real generation traffic, and
one artifact write path with server-verified writes. What it did **not** finish is the fourth: model
selection is single *for the main generation path* but not for the platform. Three differently
shaped selection cascades still exist side by side, and three smaller LLM features still carry their
own private copy with a hardcoded fallback model. Separately, the durable record of each execution
was built but never joined to the run that caused it, so the audit trail is complete in the logs and
incomplete in the database. The loss of coherence the owner reported is real, but it is now mostly a
**documentation** problem: the increment numbering (`I18`–`I20`) that the tracker says remains is
defined in no document at all, and three separate specs still describe themselves as the "active
authority" for work that shipped weeks ago.

**Plain answer to "is this actually working coherently?"** — Yes for the thing that mattered most:
a model you pick is the model that runs, or the request is refused; nothing silently substitutes a
different one. No for the promise that every decision has one home: the platform's smaller LLM
features were never brought in, and nobody wrote down that they were left out.

---

## 2. What the system actually does today

### Choosing which model runs

Four distinct pieces of code decide this, not one:

| # | Who decides | When it applies | Where it lives |
|---|---|---|---|
| 1 | **The frozen run lock** | The first generation of a launched project | `ResolvePipelineModelLock` |
| 2 | **The composer cascade** | Every later chat turn, focused edit, and the Didactic mode | `catalogModels.ts` |
| 3 | **The vibe / optimizer cascades** | Intake classification, brief prefill, explicit "optimise prompt" | `modelSelection.ts` |
| 4 | **Three private copies** | Image-prompt help, image-idea suggestion, template drafting | one per file |

The lock (1) is the real achievement. Pressing launch freezes the chosen provider and model onto a
`PipelineRun` record; when the generation is dispatched the lock is re-checked against the live
catalogue, and if the model has since been switched off the request is **refused with a 409** and a
notification is saved to the user's inbox. It never falls back to a different model. The lock is
deliberately **single-use** — it certifies the one generation whose brief it attests, after which the
model picker in the workspace governs every later turn. That was an explicit owner decision on
2026-08-26; before it, a run pinned its model for the whole conversation and silently ignored the
picker.

(2) is where all subsequent traffic goes. Since 2026-08-28 it also refuses a model the operator has
switched off, instead of quietly answering with a different one — that closed the last hole where the
admin console governed what the UI offered but not what the API accepted.

(3) and (4) are the leftovers. (3) is at least shared and characterisation-tested; (4) is three
hand-copied cascades that each fall back to a hardcoded `MiniMaxAI/MiniMax-M3` if nothing resolves.

### Composing the prompt that is actually sent

This one **is** single, for the traffic that matters. `ResolvePromptExecution` is the only caller of
the layer composer, and all three generation endpoints (`prompt-preview`, `chat-preview`,
`chat-preview/stream`) go through it. What is composed is what is sent, and the layer breakdown is
traced to stdout keyed by run id so one generation can be read as one story.

The exception is the same as above: the smaller LLM features (prefill, classify, optimiser, didactic
Q&A, image prompting, template drafting) build their own messages and call the provider directly.
They are not part of the layer system and never were — but no document says so, which is why it keeps
being rediscovered.

### Writing a new version of the artifact

Single, and the strictest of the three. The browser has exactly one function that writes a version;
the server has exactly one use case behind it; both the normal save route and the WYSIWYG session
commit funnel into that same use case. Every write must declare the content hash of the version it
was built on, and the server refuses a stale base with `409 ARTIFACT_BASE_STALE` naming the current
version — so two editors cannot silently overwrite each other. Deleting a version re-links its
children so the chain never breaks, and a write that changes nothing creates no version at all.

### Launching a project

Single. One HTTP route (`POST /pipeline/launch-workspace`) creates the run, freezes the lock and
attaches the canonical brief. The wizard's brief preview is a separate, side-effect-free endpoint
that writes nothing — previously reviewing the brief created a conversation and a workspace as a side
effect, so every abandoned wizard left rubbish behind.

### Rollback levers

There are none, by design. `PIPELINE_RUN_ENABLED` and `NEXT_PUBLIC_PIPELINE_RUN_UI` were removed on
2026-08-28; rollback is a code revert and redeploy. This is correct and matches AGENTS.md Rule Zero —
the flags are gone from the tracked source, and only survive in untracked `debug/` snapshot copies.

---

## 3. What is genuinely done

- One launch entry point, server-owned, with the frozen model lock and canonical brief.
- Strict dispatch: a locked model that is no longer available blocks; it is never substituted.
- The block is persisted as a notification, so it is still visible after a refresh.
- One prompt composer for all real generation traffic, with a per-run stdout trace of every layer.
- One canonical brief builder — the two-brief-builder divergence is gone.
- A durable prompt-execution journal written *before* the provider call, with idempotency keys, so a
  crash or a client retry cannot lose the record or double-bill.
- The operator's catalogue decisions are authoritative on every dispatch path, and survive both
  live provider discovery and a catalogue reseed.
- One artifact write path, with content hashes, declared bases, server-side stale-base refusal,
  no-op suppression, chain-derived version numbering, and child re-linking on delete.
- The Prompt tab resolves the trace of the **selected** version, not always the newest one.

All of the above is covered by unit tests that pass today (§7).

---

## 4. What is genuinely still open

In priority order. This is a short list on purpose — everything that was on the old lists and is
actually finished has been removed rather than marked done.

**1. Three LLM features still choose their own model, with a hardcoded fallback.**
`OptimizeImagePrompt`, `SuggestProjectImageIdea` and `DraftProjectTemplate` each carry a private
cascade ending in a hardcoded `MiniMaxAI/MiniMax-M3`. They do not consult the run lock and they do
not use the shared catalogue check, so an operator switching a model off does not govern them. This
is the largest remaining gap in "one place decides which model runs", and it is the same class of bug
the whole programme was started to fix. Either route them through `resolveComposerCascade`, or write
down explicitly that they are out of scope and why.

**2. The execution journal is not joined to the run.**
`PromptExecutionLog` has no `pipelineRunId`, no snapshot id and no cost-record id. The programme
document explicitly required all of them. Today the only thing tying a run, its prompt, its snapshot
and its cost together is the stdout trace — which means the question "what did this cost and what did
it send?" is answerable while the container logs are still around, and not afterwards. Adding the
field is small; not having it undermines the transparency the programme was for.

**3. Documentation authority is unresolved.**
`I18`, `I19` and `I20` — the increments the tracker says remain — are defined in **no document**. The
tracker points at a "resume authority" that numbers its work `U0`–`U5` and never mentions them. Two
analyses and one programme document still label themselves "active authority" / "no implementation is
implied" for work that shipped. This document is the fix for that; §6 says which files to retire.

**4. Dead legacy code from the cutover was never removed.**
The workspace page still contains the `sessionStorage` / `autoPrompt` handoff reader, although
nothing anywhere writes it — the legacy launch path it belonged to is gone. The `I8` shadow-mode
divergence instrumentation is also still wired into three production use cases. Neither is harmful;
both are exactly the "legacy call-site removal" that `I20` was supposed to be, and leaving them makes
the code read as if two paths still exist.

**5. Two artifact rules were deliberately left open, and should stay visible.**
`AL-019` — unsaved editor content is preferred over the active version when a generation is sent, so
what feeds the model can be text that was never saved as a version. `AL-027` — the cost record does
not share the execution id. Both were cut from the execution plan on purpose. They are not
forgotten; they are decisions.

Not on this list, because they are separate from this programme: the three admin model-console UI
items and the wildcard-publish media routing issue in `docs/project/KNOWN_ISSUES.md`. Item 1 of that
file (activation state not reflected in the UI) was **fixed** on `origin/develop` after the file was
written and can be struck.

---

## 5. Where the coherence was actually lost

Worth recording, because it will happen again otherwise:

- **Two numbering systems for one programme.** The specs numbered work `U0`–`U5`; the tracker
  numbered it `I0`–`I20`; the artifact effort numbered rules `AL-001`–`AL-047` and its batches
  `A1`/`C1`. Only the `AL-` numbers are defined in the document that uses them.
- **Analyses that were never re-labelled after being implemented.** A document that says "no
  implementation is implied by this document" reads as open work forever unless someone changes it.
- **Progress trackers as the resume point.** `SSOT_REFACTOR_PROGRESS.md` was the file agents were
  told to read first, and it is the file that drifted furthest from the code.
- **"Done" declared per call site, not per rule.** `I10` and `I14` were called done when the main
  path converged, while four other resolvers stayed untouched and undocumented.

---

## 6. Documents this supersedes

**Retire (a `superseded by` pointer has been added to each; deletion or archiving is the owner's
call, not an agent's):**

| Document | Why |
|---|---|
| `docs/SSOT_REFACTOR_PROGRESS.md` | The "resume here" tracker. Its remaining work (`I18`–`I20`) is defined nowhere; §4 above replaces it. |
| `docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md` | The `U0`–`U5` programme. `U0`–`U5` are executed except the journal linkage in §4.2. Still labelled "priorità immediata". |
| `docs/specs/PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md` | Diagnosis of a problem that has since been fixed. Still labelled "active remediation plan". |
| `docs/specs/VIBE_TO_GODMODE_MODEL_SSOT_REGRESSION_ANALYSIS_2026-08-18.md` | Same, for the Kimi→MiniMax→DeepSeek substitution regression. That regression cannot recur on the locked path. |
| `docs/specs/ARTIFACT_LIFECYCLE_EXECUTION_PLAN.md` | Batch plan whose batches all landed. Its conformance table is duplicated, and better maintained, in the spec itself. |
| `docs/specs/PROMPT_LAYER_SSOT_EXECUTION_PLAN.md` | Already self-labelled historical; kept pointing at a document this one now replaces. |

**Keep — still authoritative:**

| Document | Role |
|---|---|
| `docs/specs/ARTIFACT_LIFECYCLE_SPEC.md` | **Binding.** The `AL-NNN` rules and their conformance table. Correct as of 2026-08-27, with one nit: its `AL-028` row says the Prompt tab still resolves the latest execution; it resolves by selected snapshot since `I16`. |
| `docs/specs/PROMPT_LAYER_SSOT_SPEC.md` | The layer registry and composition contract — what Layers A–S *are*. Unaffected by this programme. |
| `docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md` | `PP-NNN` layer ownership rules for parallel agents. Current. |
| `docs/specs/GUIDED_MODE_PREFILL_SPEC.md` | Still the reference for the prefill domain and its fields; its handoff/fallback sections are already marked superseded. |

**Already correctly labelled historical — no action needed:**
`MULTIMODE_UX_MVP_EXECUTION_SPEC.md`, `DASHBOARD_LOVABLE_CHAT_SPEC.md`,
`MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md`, `PROMPT_LAYER_RESTRUCTURE_PLAN.md`,
`PROMPT_LAYER_COMPACTION_SPEC.md` (deferred with evidence),
`docs/project/WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md` (deferred).

**Stale status lines a human should correct in place (not edited by this pass):**

- `docs/project/ROADMAP.md:154` — says "I0-I15 landed … I16-I20 remain". `I16`/`I17` landed in PR #75.
- `docs/DEVELOPMENT_PLAN.md:81`, `:227`–`:229` — names the three retired documents as current authority.
- `docs/agents/CODE_AGENT_INDEX.md:8`–`:10` — same, in the agent reading order. This is the one that
  matters most, because it is what every agent reads first.

---

## 7. Evidence

All paths relative to the repository root. Line numbers as of `dec8f42`.

### Model selection

- Shared pure resolver, two cascade shapes: `apps/api/src/application/llm/modelSelection.ts:84`
  (`vibe-cascade` at `:123`, `optimizer-cascade` at `:227`).
- Third, capability-aware cascade: `apps/api/src/application/llm/catalogModels.ts:95`. Its own header
  comment records the divergence: *"Four of the seven live resolution call sites had adopted
  `resolveModelSelection()`; the one serving 100% of generation traffic had not"*
  (`catalogModels.ts:8`).
- Callers of `resolveModelSelection`: `ResolvePipelineModelLock.ts:99`, `OptimizeUserPrompt.ts:511`,
  `VibeClassify.ts:211`, `VibePrefill.ts:647`, plus the shadow observer
  (`modelSelectionShadow.ts:27`).
- Callers of `resolveComposerCascade`: `ResolvePromptExecution.ts:272`,
  `apps/api/src/presentation/http/routes/didacticRoutes.ts:51`.
- The lock: `ResolvePipelineModelLock.ts:159` (`dispatch()`), re-validation against the live catalogue
  at `:197`–`:199`, block at `:219`–`:238`. Immutability enforced in the domain entity:
  `apps/api/src/domain/entities/PipelineRun.ts:75` — *"modelLock is immutable once set"*.
- Lock applied at the generation call site: `ResolvePromptExecution.ts:223`–`:267`; 409 on an
  unavailable locked model at `:252` and `:261`. Single-use semantics documented at `:217`–`:221`.
- Lock applied at the optimiser call site: `OptimizeUserPrompt.ts:454`–`:479`.
- Catalogue authority on the unlocked path (operator's switch governs the API, not just the UI):
  `ResolvePromptExecution.ts:296`–`:310`, refusing with `MODEL_NOT_AVAILABLE`.
- **Open — private cascades with a hardcoded fallback:**
  `apps/api/src/application/prompting/OptimizeImagePrompt.ts:17` and `:141`–`:175`;
  `apps/api/src/application/prompting/SuggestProjectImageIdea.ts:15` and `:151`–`:183`;
  `apps/api/src/application/use-cases/DraftProjectTemplate.ts:17` and `:127`–`:140`.

### Prompt composition

- Sole composer call: `apps/api/src/application/llm/systemPromptComposer.ts:132` is called from
  exactly one place, `ResolvePromptExecution.ts:392`.
- Sole composer consumers: `apps/api/src/presentation/http/routes/llmRoutes.ts:520`, `:580`, `:1054`.
- Per-run layer trace: `ResolvePromptExecution.ts:413`; trace contract in
  `apps/api/src/application/services/PipelineTrace.ts:15`–`:25`.
- **Not composed through the layer system** (each builds its own messages and calls the provider):
  `OptimizeUserPrompt.ts:597` and `:695`, `VibeClassify.ts:249`, `VibePrefill.ts:731`,
  `AskDidacticQuestion.ts:69` and `:128`, `GenerateDidacticKnowledge.ts:137`,
  `DraftProjectTemplate.ts:153`, `OptimizeImagePrompt.ts:197`, `SuggestProjectImageIdea.ts:205`.

### Artifact write path

- Sole browser write function: `apps/web/app/workspace/[projectId]/page.tsx:913`
  (`commitArtifactVersion`), the only caller of `createPreviewSnapshot` at `:918`. Its four callers:
  `:1213`, `:1605`, `:1793`, `:2424`.
- Sole server use case: `apps/api/src/application/use-cases/CreatePreviewSnapshot.ts`. Content hash at
  `:84`; base verification and `409 ARTIFACT_BASE_STALE` at `:132`–`:171`.
- Both HTTP entrances construct that same use case:
  `presentation/http/routes/previewSnapshotRoutes.ts:59` and `wysiwygRoutes.ts:28` (via
  `CommitWysiwygSession.ts:37`, `:46`, which forwards the declared base).
- Chain integrity on delete: `DeletePreviewSnapshot.ts:24` → `relinkChildren`
  (`domain/repositories/PreviewSnapshotRepository.ts:43`,
  `infra/repositories/MongoPreviewSnapshotRepository.ts:161`).
- Execution id stored on a version (`AL-026`): `apps/web/app/workspace/[projectId]/page.tsx:2455`,
  produced at `llmRoutes.ts:913` / `:1532`.

### Launch path

- The only launch route: `presentation/http/routes/pipelineRoutes.ts:162`; its header at `:152`–`:156`
  states it is the only one and that rollback is a revert, not a runtime path.
- Side-effect-free brief preview: `pipelineRoutes.ts:230`, rationale at `:216`–`:227`.
- Run creation and brief attachment: `LaunchWorkspacePipeline.ts:55` and `:92`.

### Flags removed

- `grep` for `PIPELINE_RUN_ENABLED` / `NEXT_PUBLIC_PIPELINE_RUN_UI` across tracked source returns only
  `AGENTS.md:55` (citing the flag as the cautionary example that produced Rule Zero) and one
  historical comment at `apps/web/app/workspace/[projectId]/page.tsx` / `launch/[projectId]/page.tsx:891`.
  All other hits are inside untracked `debug/codex-*` snapshot directories.

### Open items

- Journal not joined to the run: `apps/api/src/domain/entities/PromptExecutionLog.ts:20`–`:59` — no
  `pipelineRunId`, `snapshotId` or cost-record id. `grep -r pipelineRunId apps/api/src` matches no
  entity, repository or infra file. Contrast with the requirement in
  `docs/specs/SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md` §3, last line.
- Dead legacy handoff: read at `apps/web/app/workspace/[projectId]/page.tsx:283` and `:645`–`:670`;
  `grep -r "pipeline_handoff_" apps/web` returns only those two read sites — nothing writes it.
- `I8` shadow instrumentation still wired: `VibeClassify.ts:15`, `VibePrefill.ts:15`,
  `OptimizeUserPrompt.ts:28` → `application/llm/modelSelectionShadow.ts`.
- `AL-019` hole: `apps/web/app/workspace/[projectId]/page.tsx:2143` — `editorHtml || editorCss ||
  editorJs` is preferred over `activeBaselineSnapshot?.artifacts`.
- `AL-027`: `grep` for `promptExecutionId` under `apps/api/src/application/cost` and
  `domain/entities/CostTransaction.ts` returns nothing.
- `I18`–`I20` undefined: `grep -rn "I18\|I19\|I20" docs` returns only i18n filenames plus
  `docs/SSOT_REFACTOR_PROGRESS.md:57`–`:64` and `docs/project/ROADMAP.md:154`. No document defines
  them.

### Tests run on 2026-08-31 (all passing)

```
cd apps/api && npx vitest run \
  src/application/use-cases/__tests__/ResolvePromptExecution.strictDispatch.test.ts \
  src/application/use-cases/__tests__/ResolvePipelineModelLock.test.ts \
  src/application/llm/__tests__/catalogModels.test.ts \
  src/application/llm/__tests__/modelSelection.characterization.test.ts \
  src/domain/entities/__tests__/PipelineRun.test.ts
→ 5 files, 106 tests passed

cd apps/api && npx vitest run \
  src/application/use-cases/__tests__/PreviewSnapshotMediaResolution.test.ts \
  src/application/use-cases/__tests__/CommitWysiwygSession.test.ts \
  src/application/use-cases/__tests__/modelGovernance.intent.test.ts \
  src/application/use-cases/__tests__/LaunchWorkspacePipeline.test.ts \
  src/application/use-cases/__tests__/OptimizeUserPrompt.test.ts
→ 5 files, 49 tests passed
```

The intent tests are worth reading by name — they state the guarantee in the owner's own terms:
*"a model the user picked is used, or the request is refused"* and *"only an operator decides whether
a model may be used"* (`modelGovernance.intent.test.ts:124`, `:195`).

---

## 8. How to check this yourself

```bash
git fetch origin
git log --oneline -5 origin/main origin/develop     # both at release 2026.08.28.2
grep -rn "resolveModelSelection(\|resolveComposerCascade(" apps --include=*.ts | grep -v __tests__
grep -rn "chat/completions" apps/api/src --include=*.ts | grep -v __tests__   # every provider call
grep -rn "commitArtifactVersion\|new CreatePreviewSnapshot" apps --include=*.ts --include=*.tsx
```

The second and third commands are the honest test of "is this one place or not": the first should
converge, the third should show one browser function and one server use case. It does. The middle one
shows the fifteen direct provider calls that are the subject of §4.1.
