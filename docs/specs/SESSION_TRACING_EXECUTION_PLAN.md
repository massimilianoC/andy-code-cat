# Session Tracing — Execution Plan

**Audience: implementing agents.** Each work package below is a self-contained assignment. The
constraints are not advisory.

Companion documents, both required reading before starting any package:
- `WORK_SESSION_TRACING_SPEC.md` — the design, the audit, and the review that cut one of its own proposals
- `AGENTS.md` — Rule Zero and the architecture boundaries

Branch: `feat/parallel-section-generation`. Gitflow applies (`docs/guides/GITFLOW_RELEASE_POLICY.md`).

---

## Status, 2026-09-02

| Package | State |
|---|---|
| WP1 artifact SSOT violation | **open** — the only live correctness defect left |
| WP2 cost as one referential record | **open** — a `workSessionId` correlation field was added, the restructure was not |
| WP3 intake objects | **done** — repositories built and wired |
| WP4a session lifecycle | **done**, plus the one-intent-one-session fix found in coherence review |
| WP4b silent call sites | **done** — four parallel agents |
| WP4c generate correlation | **done** |
| WP5 session inspector | **open** |
| WP6 replay harness | **open** — blocked on a real run confirming the certificate |

## Reported from use — to fold into the packages above, not to fix ad hoc

Three things observed while running the product. Each belongs inside a package that is already
planned; fixing them separately would mean fixing them twice.

**The project cost in the header lags by one refresh.** It shows the total as of the previous load
rather than the last elaboration. This belongs to **WP2**: once cost is one referential record keyed
by `promptExecutionId`, the header aggregates on `workSessionId` instead of recomputing a total at
page load, and the staleness disappears as a consequence rather than as a patch.

**Cost should be inspectable per step, not only as a total.** The data already supports it — every
journal row carries its own `costEstimate` and every cost row now carries `workSessionId`. What is
missing is the surface, which is **WP5**. Designing a separate cost panel would produce a second
place that answers the same question the inspector will answer.

**The prompt panel breaks when rendering a large code block.** Described more precisely on a second
report: the panel groups code into a collapsible accordion, and certain tags inside the code split
one block into many accordions. Still not reproduced — the display component has not been located,
and guessing at a rendering defect produces a fix for the wrong thing. **WP5**, once seen.

**The assistant's reply is missing from the sent-history panel.** Partly diagnosed: the reply IS
included in what is sent to the model — `page.tsx:2132-2137` maps assistant turns into the history,
compacted to `chatStructured.summary` plus its bullets, or the raw content when no structured reply
exists. So the payload is right and the panel is not showing what the payload contains. The defect is
in the display, not in what was sent, which narrows it usefully. **WP5**.

**Measured, not assumed:** artifact generation is genuinely faster today — 45–167s against 316–630s
in the preceding week — but that is the model, not this work. `kimi-k2.7-code` sustains 372 tok/s
where GLM-5.3 managed 52. The tracing work only adds database writes to the hot path, and the fan-out
that would actually shorten it is still unreachable from the product. What did change is that
`finishReason` is now recorded: it is `-` on every run before 2026-09-02 and `stop` on every run
after.

## 0. The rules that bind every package

These override convenience, deadline and personal judgment. An agent that cannot satisfy one of
these stops and reports rather than working around it.

1. **Enter the existing flow; do not build beside it.** If your work is only reachable from a script
   or a test, it is not done. The prior fan-out work is the cautionary example: it measured 8.7×
   against a real provider and was still, correctly, called a parallel flow because nothing in the
   product could reach it.
2. **One fact, one owner.** Before adding a field, find who already owns that fact. Section 1 lists
   the current owners. If the fact has an owner, reference it by id.
3. **Never delete a write before removing every read.** Order is: guarantee the replacement path →
   remove reads → remove writes → remove the field. Four commits, not one.
4. **Tracing must never fail a generation.** Every journal write is `.catch()`-guarded and every
   call site keeps working with the repository absent. There is a test for this
   (`vibeJournalling.test.ts`); yours needs one too.
5. **No new collection without a named unowned fact.** State it in the PR description. "Symmetry
   with the other modes" is not one.
6. **Every package ships with tests that fail without it.** A test that passes against `main` is
   testing nothing.
7. **Do not touch `ResolvePipelineModelLock.dispatch():181-193`.** The lock-exhaustion rule is
   hardened against a real incident (2026-08-26). Changing it is its own spec, not a side effect.

---

## 1. Who owns what, today

The map. Consult it before adding anything.

| Fact | Owner | Notes |
|---|---|---|
| session identity (user, org, mode, time) | `work_sessions` | new; entity exists, nothing opens one yet |
| what the user gave the Vibe tool | **unowned** → `VibeIntake` (WP3) | today only an HTTP body |
| what the prefill proposed vs what the user submitted | **unowned** → `ZeroEffortFormProposal` (WP3) | the confirmed side is already owned, see below |
| the confirmed 19-field intake | `PipelineRun.canonicalBrief.sourceFields` | `buildCanonicalGenerationBrief.ts:39`, `:152` |
| the brief text | `PipelineRun.canonicalBrief.content` | content-hashed; the model lock depends on it |
| execution order of a generation | `PipelineRun.stages[]` | each entry already points at its `promptExecutionId` |
| which model a generation was locked to | `PipelineRun.modelLock` | |
| one LLM call: prompts, raw reply, tokens, endpoint | `prompt_execution_logs` | |
| cost of one call | **split three ways** → fix in WP2 | `cost_transactions`, `PromptExecutionLog.costEstimate`, `Conversation.metadata.costEstimate` |
| the artifact | **split two ways, one is live** → fix in WP1 | `preview_snapshots.artifacts` and `conversations[].metadata.generatedArtifacts` |
| conversation turns | `conversations` | |

---

## WP1 — Close the artifact SSOT violation

**Severity: highest. Do this first.** It is the only package that fixes a live correctness problem
rather than adding visibility.

`conversations[].metadata.generatedArtifacts` is not a dead history copy. It is read as a live
source in two decision paths in `apps/web/app/workspace/[projectId]/page.tsx`:

- `:1901` — `selectedBackendSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts`
  decides **what the preview panel displays**;
- `:2146` — the same fallback decides **what is sent back to the server as the current artifact** for
  the next generation.

So the artifact has two live sources, and the conversation copy feeds the next generation's input.
That is the violation: not a stale duplicate, a second authority.

**Required sequence — four commits, in this order:**

1. Establish why the fallback exists. Find the window where `preview_snapshots` has no row but the
   UI must render — almost certainly the first generation, before the snapshot write lands. Fix
   *that*, so a snapshot always exists before render. Do not proceed until this is proven with a
   test.
2. Remove the read at `:1901` and `:2146`. `activeBaselineSnapshot?.artifacts` becomes the only
   source. Add a regression test asserting the preview renders from the snapshot alone.
3. Remove the write at `page.tsx:2384`.
4. Remove `generatedArtifacts` from `MessageMetadata` (`Conversation.ts`).

**Forbidden:** deleting the field first and repairing what breaks. **Acceptance:** grep for
`generatedArtifacts` returns nothing outside git history; a fresh Zero Effort generation renders and
a follow-up turn sends the right base artifact; snapshot count unchanged.

`metadata.rawResponse` is a separate question — it is history, not a second authority. Leave it, and
see the note in WP2.

---

## WP2 — Cost becomes one referential object

Cost is currently written in three shapes: a `cost_transactions` row, an embedded
`PromptExecutionLog.costEstimate`, and an embedded `Conversation.metadata.costEstimate`. Reconstructing
what a session cost means joining three shapes and hoping they agree.

**Target:** one cost record per LLM execution, addressed by `promptExecutionId`, with a single DTO
that every reader uses.

1. Define `ExecutionCostRecord` in `packages/contracts` — the one shape: `promptExecutionId`,
   `workSessionId`, `pipelineRunId`, provider, model, `units` (prompt/completion/total tokens,
   images, video seconds), `rates` snapshot, `providerCostUsd`, the derived EUR breakdown, and
   `computedAt`. It carries its rate snapshot so a historical cost stays reproducible after the rates
   change.
2. `CostTransactionService.record()` writes it, keyed by `promptExecutionId`. Every call site that
   records cost already passes through this service — do not add a second writer.
3. `PromptExecutionLog.costEstimate` becomes derived-on-read from the record, not stored. Follow rule
   3: add the record and the read path, migrate readers, then stop writing the embedded copy.
4. `Conversation.metadata.costEstimate` is display state for a rendered message. Keep it, but it must
   be recognisably a projection: document it as such and never read it for aggregation.

**Acceptance:** a single query by `workSessionId` returns every cost of that session with no joins
across shapes; `GetProjectAiAnalytics` and the admin cost views return identical numbers to before —
prove it with a fixture, not by inspection.

---

## WP3 — The two justified intake objects

Repositories and wiring for the entities already defined in `domain/entities/`.

- `VibeIntake` — `MongoVibeIntakeRepository`, collection `vibe_intakes`. Written by the vibecore
  route at the moment the request arrives, **before** classify dispatches, so a request that dies
  early still leaves a record. Append the produced `promptExecutionLogIds` as the stages complete.
- `ZeroEffortFormProposal` — `MongoZeroEffortFormProposalRepository`, collection
  `zero_effort_form_proposals`. Written when `VibePrefill` returns, holding the proposal; `editedFields`
  is filled with `diffFormFields()` when the guided launch is submitted, comparing against the
  confirmed intake that `canonicalBrief.sourceFields` already stores.

**Forbidden:** storing the confirmed intake here. It is owned by `canonicalBrief.sourceFields`.

---

## WP4 — Session lifecycle and inheritance

1. `OpenWorkSession` use case: called by the three entry routes, returns the id.
2. Request-scoped propagation. The codebase already carries `req.auth!.userId` and
   `req.sandbox!.projectId` from middleware; `workSessionId` joins them by the same mechanism. A tool
   receives it inside the call it is already being given.
   **Forbidden:** adding `workSessionId` as a constructor dependency to thirteen use cases.
3. Complete the silent call sites, each writing a journal row with `workSessionId`, `pipelineRunId`,
   `pipelineStage` and `endpoint`, following the pattern already in `VibeClassify.ts:266-290`:
   `AskDidacticQuestion`, `GenerateDidacticKnowledge`, `ImageAnalyzer`,
   `generateImageWithSiliconFlow`, `DocumentBriefExtractor`.
4. `generate` writes `pipelineRunId` on its journal row — the value already arrives in the request
   body as `body.pipelineRunId` and is simply not recorded.

**Acceptance:** one real Zero Effort run from the UI produces rows in `work_sessions`,
`vibe_intakes`, `zero_effort_form_proposals`, `pipeline_runs`, `prompt_execution_logs` and
`cost_transactions`, **all carrying the same `workSessionId`**, and every LLM call in that run has a
non-null `endpoint`.

---

## WP5 — The session inspector, front-end

**Consolidated into `SESSION_INSPECTOR_SPEC.md` — implement from there.** What follows is the
original sketch, kept for the reasoning behind it.

The prompt tab in the project session becomes a work-session inspector. Modular and reusable,
because the blocks shown depend on how the session was entered.

- Three collapsible accordion blocks: **Vibe**, **Zero Effort**, **Project**. A session shows only
  the blocks its `entryMode` produced.
- Each block lists its executions in order, compact by default: stage, model, endpoint, duration,
  tokens, cost, `finishReason`. Expanding one reveals the rendered system prompt, the rendered user
  prompt, the raw reply and the reasoning trace.
- A truncated call (`finishReason === "length"`) is marked as such in the collapsed row. That is the
  failure this whole programme exists to make visible; it must not require expanding to see.
- Reuse the existing prompt-layer rendering: the layer spans are already certified against the wire
  by `assertPromptTraceParity`, so the inspector shows verified bytes, not a reconstruction.

**Forbidden:** a new API shape per block. One endpoint returns the session with its runs and rows;
the components select from it.

---

## WP6 — Reconstruction harness

The point of all the above: replay a recorded session with parts removed, and measure.

A script that takes a `workSessionId`, rebuilds every request from the journal, and re-dispatches it
with a declared variation — a prompt layer omitted, a stage skipped, a different model, the fan-out
substituted for the monolith. It reports, against the original: cost, wall clock, `finishReason`
distribution, and the produced artifact for comparison.

This is where the open question gets answered: whether the layered prompt carries redundancy that
costs money and biases the artifact without improving it. That question is currently unanswerable,
which is the entire reason for WP1–WP4.

**Acceptance:** replaying a session unchanged reproduces its call sequence — same stages, same order,
same prompts byte for byte. If the replay cannot reproduce the original, the journal is incomplete
and the gap is a WP4 defect, not a harness defect.

---

## Sequencing, and what may actually run in parallel

Parallelism between agents is decided by **file collisions**, not by logical independence. Two
packages that never touch the same file can run concurrently even if one conceptually depends on the
other's ideas; two that edit the same file cannot, however unrelated they sound.

### Dependency graph

```
WP4a  session lifecycle + request context ──┬──> WP4b  silent call sites
                                            ├──> WP4c  generate records pipelineRunId
                                            └──> WP3   intake repositories
WP2   cost record ──────────────────────────────> (WP4b reads it when recording cost)
WP1   artifact SSOT fix ───────────────────────> WP5  session inspector
WP4b + WP4c + WP3 + WP5 ───────────────────────> WP6  replay harness
```

### File-collision matrix

| Package | Files it owns | Collides with |
|---|---|---|
| WP1 | `apps/web/app/workspace/[projectId]/page.tsx`, `Conversation.ts` | **WP5** (same page file) |
| WP2 | `packages/contracts/cost*`, `CostTransactionService.ts`, `PromptExecutionLog.ts` | WP4b lightly (both touch call sites) |
| WP3 | `infra/repositories/MongoVibeIntake*`, `MongoZeroEffortForm*`, `vibecoreRoutes.ts` | **WP4a** (same route file) |
| WP4a | `http/types.ts`, new middleware, `OpenWorkSession.ts`, entry routes | **WP3** (same route file) |
| WP4b | the five silent use cases, one file each | none |
| WP4c | `llmRoutes.ts` | none |
| WP5 | `apps/web` inspector components, one read endpoint | **WP1** |
| WP6 | `apps/api/src/scripts/` | none |

### Practical schedule

**Wave 1 — three agents concurrently, no collisions:**
- Agent A: **WP4a** (session lifecycle and context) — unblocks the most
- Agent B: **WP2** (cost record) — contracts-first, so later packages compile against it
- Agent C: **WP1** (artifact SSOT fix) — front-end only, isolated from both

**Wave 2 — after WP4a lands, four agents concurrently:**
- **WP4b** splits cleanly into five independent assignments, one call site each, no shared file
- **WP4c** (`llmRoutes.ts`), **WP3** (route file, now free of WP4a)

**Wave 3:** WP5 (needs WP1 merged and WP4 producing data).
**Wave 4:** WP6.

### The one ordering that is not negotiable

WP4a before everything that records a session id, and WP2's contract before anything records cost.
Both are shape definitions: agents writing against a shape that then changes will silently produce
two shapes, which is the failure this whole programme exists to remove.

### Why the certification pipeline goes first

WP6 is the experiment that decides whether parallelising the pipeline lowers cost and time without
losing quality. It cannot be trusted before the journal is complete: replaying a session whose
history has gaps measures the gaps. So the order is not preference — the certification work
(WP4, WP3, WP2) is a **precondition for the parallelisation results to mean anything**.

WP1 is scheduled early for a different reason: it is a live correctness defect, and it edits the same
front-end file WP5 will rewrite.
