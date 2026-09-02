# Session Resume — prompt certification & pipeline parallelisation

**Read this first if you are picking up cold.** It exists because the session that produced this work
may end before the work does. Everything below was established by reading code or running things, not
by assumption; where a number appears, it came from a measurement.

Branch: `feat/parallel-section-generation`, off `develop`. Nothing pushed — see §6.

---

## 1. What this is all about, in one paragraph

A ten-section slide deck generated with GLM-5.3 took **10m 29s**, stopped at **exactly 32,768
completion tokens** (a power of two, so a provider cap and not a model finishing), and was journalled
as **`succeeded`** while the deck was visibly incomplete. Investigating why produced two threads:
**(a)** split one long generation into a planned per-section fan-out, and **(b)** first make the
pipeline record what it actually does, because (a) cannot be judged against the product until (b)
exists. Thread (b) is the current work.

---

## 2. Findings that cost real effort — do not re-derive these

| Finding | Evidence |
|---|---|
| The failing run: 32,768 completion tokens, 629,546 ms, `status: succeeded`, 13,938 prompt tokens | `prompt_execution_logs` doc `f51ee098-161f-4c46-9244-fc018cf9fab7` on the local Mongo |
| Its 47,021-char system prompt, by layer | A 7,667 · L 370 · B 1,532 · S 5,251 · C 11,915 · D 3,262 · E 12,274 · **P 4,750** · = 47,021 |
| Layer P spends 4,750 chars on output-budget policy and the run still hit the cap | prose asks for brevity, structure enforces it |
| **The prompt inspector cannot lie on `generate`** | `promptTraceParity.ts:15` throws unless the system message on the wire is byte-identical to what the inspector shows, layer spans included. Runs at `llmRoutes.ts:606` and `:1081` |
| `enable_thinking:false` is honoured by SiliconFlow, ignored by OpenRouter | `chatRequestAdapter.ts` — every OpenRouter measurement is the fan-out *without* the reasoning split |
| Fan-out measured live | Gemini-3.7-Flash 72.6s / 7-of-7 criteria / **18% cheaper** than the monolith; GLM-5.3 @16k 257s / 0 truncations / 3 sections lost to a 120s per-section ceiling; GLM-5.3 @8k was **worse than 16k** because truncation triggered retries |
| Raising the per-section budget does NOT backfire | 16k beat 8k on every axis including cost. An earlier claim to the contrary was wrong and is corrected in the spec |
| The confirmed 19-field intake is already persisted | `buildCanonicalGenerationBrief.ts:39` and `:152` write `sourceFields: { ...input }` into `canonicalBrief` |
| `PipelineRun.stages[]` is already an execution order referencing what ran | `PipelineStageExecutionRef` carries `promptExecutionId` |
| **The artifact exists in three places, and one is a live second authority** | `preview_snapshots.artifacts`; `conversations[].metadata.generatedArtifacts` written at `page.tsx:2384` and **read at `:1901` (what the preview shows) and `:2146` (what is sent as the next generation's base)**; `metadata.rawResponse` at `:2379` |

The last row is the only live correctness defect found. It is WP1.

---

## 3. Documents, in reading order

1. `docs/specs/WORK_SESSION_TRACING_SPEC.md` — the design, the 13-call-site audit, and §3 which
   corrects the first version of its own session model
2. `docs/specs/SESSION_TRACING_EXECUTION_PLAN.md` — six work packages, binding rules, ownership map,
   dependency graph, file-collision matrix, four waves
3. `docs/specs/PARALLEL_SECTION_GENERATION_SPEC.md` — the fan-out; §9ter states plainly that it is
   **not reachable from the product**, and every measured number in §9bis must be read with that
   caveat

---

## 4. Where the work stands

### Landed on the branch

| Commit | What |
|---|---|
| `dac2b10` `dda7506` `29a8d71` | fan-out MVP: `plan` stage, bounded pool, retry/placeholder, live probe, dry-run mode. **Reachable only from `fanout-probe.ts` — a bench, not a feature** |
| `6a862f4` | `VibeClassify` + `VibePrefill` journal their calls; `PromptExecutionLog` gains `workSessionId`, `pipelineRunId`, `pipelineStage`, `endpoint`, `rawResponse`, `finishReason`, `reasoningTrace` |
| `e1a7d0b` `08fbc13` | `WorkSession` as a certificate (no mode payload), `VibeIntake`, `ZeroEffortFormProposal`, `workSessionId` on `PipelineRun` |
| `e2f569e` | **WP4a**: `OpenWorkSession`, `workSessionMiddleware`, `req.workSession`, session opened and echoed by the vibecore routes |

Suite at the last full run: **646 passing**, tsc clean.

### In flight — four Sonnet agents, spawned in parallel, no shared files

| Agent | Package | Owns | Progress file |
|---|---|---|---|
| A | WP4b didactic | `AskDidacticQuestion.ts`, `GenerateDidacticKnowledge.ts`, `didacticRoutes.ts` | `docs/handoff/WP4B_DIDACTIC_PROGRESS.md` |
| B | WP4b enrichment | `ImageAnalyzer.ts`, `DocumentBriefExtractor.ts`, `AssetEnrichmentPipeline.ts` | `docs/handoff/WP4B_ENRICHMENT_PROGRESS.md` |
| C | WP4b image gen | `generateImageWithSiliconFlow.ts`, `GenerateProjectImage.ts` + its route | `docs/handoff/WP4B_IMAGEGEN_PROGRESS.md` |
| D | WP4c correlation | `llmRoutes.ts` | `docs/handoff/WP4C_GENERATE_CORRELATION_PROGRESS.md` |

Each was told to keep its progress file current and to leave changes **uncommitted** in the working
tree. **If a progress file exists, read it before touching that package** — it records decisions a
fresh agent cannot re-derive cheaply.

All four copy one pattern: `VibeClassify.ts` lines 164-180 (optional repo param), 259-292 (pending
write awaited **before** dispatch), 300-310 (failure completion), 366-385 (success completion), with
`vibeJournalling.test.ts` as the test shape.

### Not started

- **WP1** — the artifact SSOT violation. Deliberately unassigned: it edits the same workspace page
  WP5 will rewrite. Four commits in order, and the field must not be deleted first
- **WP2** — cost as one referential record keyed by `promptExecutionId`, carrying its rate snapshot
- **WP3** — Mongo repositories for `VibeIntake` and `ZeroEffortFormProposal` (entities exist; nothing
  persists them)
- **WP5** — the prompt tab becomes a session inspector, per-mode accordions
- **WP6** — the replay harness. **This is the point of everything else**: replay a recorded session
  with a layer removed or a stage skipped, and measure cost, time and quality

---

## 5. Resuming

**To resume an agent:** `SendMessage` to its name with what you want next; a send resumes it from its
own transcript. If the agents are gone, their progress files are the handoff — read the file, then
re-spawn with the same brief plus "the progress file records what is already done; continue from
NEXT".

**To verify the tree is sane after any interruption:**

```
cd apps/api && npx tsc -p tsconfig.json --noEmit && npx vitest run
git status --short
```

Expect 646+ passing. Uncommitted changes under the agents' owned files are expected; anything else is
a surprise and should be examined before committing.

**The one ordering that is not negotiable:** WP4a before anything that records a session id, and
WP2's contract before anything records cost. Both are shape definitions — an agent writing against a
shape that later changes produces two shapes silently, which is the defect this programme exists to
remove.

---

## 6. Open blockers, none of them code

- **Nothing is pushed.** `git push` cannot run from the agent shell: Git Credential Manager wants an
  interactive/browser prompt, `gh` is not installed, and there is no `GITHUB_TOKEN`. The user must
  push. Also pending from earlier: `fix/model-selection-ssot-consolidation`,
  `docs/gitflow-template-hardening`
- **SiliconFlow returns 402 insufficient balance.** It is the only provider that honours
  `enable_thinking:false`, so the reasoning-split half of the fan-out result is still unmeasured
- **Docker was down** at last check (`docker exec` could not reach the daemon). The stack is needed
  for any real end-to-end run
- **`.env.docker` holds `OPEN_ROUTER_API_KEY`** (note the underscore spelling) — that is how the live
  probes ran

---

## 7. The question all of this is for

Whether the layered prompt carries redundancy that costs money and biases the artifact without
improving it — and whether splitting the pipeline into smaller focused contexts is cheaper, faster
and better. WP6 answers it. It cannot be trusted before the journal is complete, because replaying a
session whose history has gaps measures the gaps.
