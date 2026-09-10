# Parallel Section Generation — Spec

**Status: MVP built and measured against live models; not yet wired into a route.**
On `feat/parallel-section-generation`. Measurements are from the local deploy stack, run `f51ee098`,
2026-09-01.

| Increment | State |
|---|---|
| 0 — `finishReason` + reasoning persisted | **built** (`PromptExecutionLog`, `llmRoutes`) |
| 1 — `plan` stage | **built** as `sectionPlan.ts` + `GenerateSectionedArtifact` |
| 2 — lock inheritance for fan-out children | **not started** — see §3.1, needs a decision |
| 3 — bounded-pool fan-out | **built** (`boundedPool.ts`) |
| 4 — retry loop, time ceiling, placeholders | **built** |
| 5 — drop Layer D from children | **built** in the new path; the monolith is untouched |

What is *not* done: none of this is reachable from the HTTP routes yet. `GenerateSectionedArtifact`
takes a resolved model and a dispatcher port, so wiring it to `llmRoutes` and the `PipelineRun`
journal is the next step — and that step is where §3.1 has to be answered.

Validation status: §8 is checked on every test run against a simulated truncating provider
(`GenerateSectionedArtifact.acceptance.test.ts`), and five live runs are recorded in §9bis.

**Read §9ter first.** None of the fan-out is reachable from the product — the only caller is the
probe script, and the new code touches no SSOT component. The live numbers measure the mechanism,
not an integrated feature.

---

## 0. The proposal under review

> Spezzare layer, compiti e contesto per fare chiamate parallele: uno swarm di chiamate piccole
> e atomiche, una per sezione, con budget espliciti (500–1500 caratteri), un awaiter che raccoglie
> tutti i risultati, e un prompt finale compatto.

Most of this survives review. Three parts do not, and one dependency should be rejected. This
document separates them before any code is written.

---

## 1. The evidence

`prompt_execution_logs` → `f51ee098`, preset `slideshow`, `zai-org/GLM-5.3` on siliconflow:

| field | value |
|---|---|
| `completionTokens` | **32,768** — exactly 2¹⁵, against a requested ceiling of 64,000 |
| `durationMs` | **629,546** (10m 29s) |
| `status` | **`succeeded`** — while the deck was visibly incomplete |
| `promptTokens` | 13,938 (system prompt alone: 47,021 chars) |
| `finishReason` | **field does not exist on the document** |

Two facts follow, and they set the whole design:

1. **Input was never the constraint.** 13,938 tokens in, against a 200k-class context window. The
   bottleneck is output budget, consumed by reasoning before the first character of HTML.
2. **We cannot currently tell truncation from success.** `finish_reason` is parsed in flight
   (`llmRoutes.ts:1276-1279`) and never persisted; `reasoning_content` is forwarded to the client
   over SSE and never accumulated server-side (`llmRoutes.ts:1267-1274`). A truncated deck is
   recorded as `succeeded`.

---

## 2. What already exists

The fan-out does not need a new engine. It needs one existing stage split.

| Capability | Where | State |
|---|---|---|
| Multi-stage pipeline | `packages/contracts/src/pipelineRun.ts:51-57` — `vibe_classify \| vibe_prefill \| brief_build \| optimize \| generate \| focused_edit` | live |
| Per-stage journal | `PipelineRun.stages: PipelineStageExecutionRef[]`, statuses incl. `failed` | live |
| Distilled context handoff | `PipelineRun.canonicalBrief` (content-hashed) | live |
| Stage append | `MongoPipelineRunRepository.appendStage:83-94` — uses `$push` | **atomic; safe under parallel dispatch** |
| Truncation salvage | `llmParser.ts` — 5 repair strategies | live (but silent) |

The reasoning/execution split the proposal asks for is already the backbone: `vibe_classify`,
`vibe_prefill` and `brief_build` *are* reasoning over context. The defect is that `generate` then
re-does it from scratch against a 47k-char system prompt instead of executing a decided plan.
**There is not a missing reasoning stage — there is one too many, in the stage that must emit 32k
of HTML.**

---

## 3. Three blockers the proposal has to answer

### 3.1 The model lock is consumed by the first stage (hard blocker)

`ResolvePipelineModelLock.dispatch():181-193`:

```
if (run.stages.length > 0) → { lockApplies: false }
```

This is deliberate and incident-hardened: the comment records 2026-08-26, when three consecutive
turns dispatched `kat-coder-pro-v2.5` while the selector said otherwise. But it assumes
**one generation = one dispatch**. A fan-out breaks that assumption twice:

- the first child to append consumes the lock, and every sibling runs **unlocked**;
- worse, N children reading concurrently all observe `stages.length === 0` and each believes it is
  the first.

**Required decision:** a fan-out is still *one* generation. The lock is consumed once by the parent
(`plan`); children carry `source: "pipeline-run-lock"` and inherit `run.modelLock.effective`
verbatim rather than re-resolving. `dispatch()` must distinguish "a new user turn" from "a child of
an already-dispatched generation". This touches the incident-hardened path and is the single
riskiest edit in the plan.

### 3.2 Fan-out multiplies input cost (design constraint, not a blocker)

If every parallel call carries today's context, 13,938 prompt tokens × 10 sections = **139k input
tokens** against 13,938 today. Fan-out is only affordable if the shared context is distilled *first*:
design tokens + one section's slice, targeting ~1–2k per call. Compaction is therefore not
decoration — it is what pays for the parallelism.

### 3.3 Provider concurrency (bounded, not unbounded)

A 10-way burst will draw 429s, which the route already surfaces as `LLM_PROVIDER_RATE_LIMIT`
(`llmRoutes.ts:1190`). Use a bounded pool (3–4 in flight), not a bare `Promise.all`. Wall clock still
wins by an order of magnitude.

Note also `MongoPipelineRunRepository.setStatus:96-110` is read-modify-write and **is** racy — unlike
`appendStage`. Children must not drive run-level status transitions.

---

## 4. Caveman — rejected as a dependency, kept as an idea

<https://github.com/juliusbrussee/caveman>

| Claim | Applicability here |
|---|---|
| Proxy: −33% provider input tokens | **Licensed BSL-1.1** — not open source; embedding it in a commercial product is a legal decision, not a technical one |
| Skill: −65% output tokens | Its own "honest number warning" states it shrinks *output* only, **not input or reasoning**, and adds ~1–1.5k input per turn |
| Compressors target JSON, logs, code, diffs | Our 47k system prompt is **prose instruction**, not a payload type it handles |
| "Terse output" | Actively harmful for artifact generation — HTML must be complete, not terse. Useful only for plan/reasoning stages |

Verdict: **take the principle — compact the handoff between stages — and implement it with the
`canonicalBrief` envelope we already own.** Do not add the dependency. Our bottleneck is output and
reasoning tokens, which is precisely what its own documentation says it does not reduce.

---

## 5. What must NOT be parallelised

The proposal suggests fanning out `vibe_prefill` too. The evidence says no:

- prefill's measured output is ~2k tokens against a 32k ceiling — it is nowhere near any cap;
- its 19 fields are **interdependent by design** — `VibePrefill.ts:28-49` documents that the
  expressive fields are written last on purpose, and that the budget must cover reasoning *plus*
  the whole brief. Splitting per field destroys that ordering and multiplies input cost;
- the run that failed was `generate` at 32,768 tokens, not prefill.

**Fan out where the evidence points.** Prefill stays one call.

---

## 6. Design

```
plan          reasoning ON   ~6-8k out    1 call    → outline JSON + shared design tokens
generate[i]   reasoning OFF  ~3-4k out    N calls   → one section each, bounded pool (3-4)
assemble      —              —            local     → deterministic validation
```

- `plan` output: N sections, each `{ title, contentBrief, mediaIntent, charBudget }`, plus the
  design tokens every child must reuse verbatim. Reuse `vibe_prefill`'s hardened JSON parsing.
- `generate[i]` input: design tokens + section *i* only. Not the 47k prompt.

### 6.1 Where the 47k actually goes, and what a child needs

Measured on run `f51ee098` by splitting `renderedSystemPrompt` on its own `PF_LAYER` markers:

| Layer | key | chars | needed by a child? |
|---|---|---|---|
| A | base-constraints | 7,667 | yes, trimmed |
| L | output-language | 370 | yes |
| B | preset-format | 1,532 | yes |
| S | template-skills | 5,251 | probably |
| C | style-context | 11,915 | **no** — replaced by the plan's design tokens |
| D | document-context | 3,262 | **no** — see below |
| E | preprompt-template | 12,274 | **no** — collapses into the plan |
| P | output-budget-policy | 4,750 | **no** — replaced by one line: this section's `charBudget` |
| | **total** | **47,021** | target per child: **~10k** |

Two findings worth stating plainly:

**The attachment is re-injected after prefill already digested it.** `ResolvePromptExecution.ts:177-200`
builds Layer D from the project's attachments on *every* generation, independent of the fact that
`vibe_prefill` already extracted a brief from those same attachments. The distilled brief and its
source both travel in the prompt. Layer D is only 3,262 chars here, so this is not the cause of the
32,768-token failure — but in the fan-out it would be paid N times, and the plan already carries
what it says. **Children read the plan, not the attachments.**

**We already spend 4,750 chars telling the model about its output budget** (Layer P), and the run
still terminated at exactly 2¹⁵. That is the empirical case against solving this with more prompt
instruction: an output-budget policy nearly 5k characters long did not produce a bounded output.
Structure bounds output; prose asks nicely.

### 6.2 Context is split by competence, not copied

The layer stack is composed once and handed whole to whatever call is being made. That is the
underlying defect, and it is larger than the fan-out: **every layer is paid for by every call,
including the calls that have no use for it.**

Each layer answers a different question, so each belongs to whichever stage actually asks it:

| Competence | Layer | Who needs it |
|---|---|---|
| What may be emitted at all | A base-constraints | plan (trimmed) + every child |
| Output language | L output-language | every child — it writes the prose |
| Format of the deliverable | B preset-format | plan; children get only their slice |
| Domain know-how | S template-skills | plan; a child gets the part its section uses |
| Brand and visual identity | C style-context | **plan only** — it emerges as design tokens |
| What the source documents said | D document-context | **plan only** — it emerges as contentBriefs |
| How to phrase the request | E preprompt-template | **plan only** — it is consumed producing the plan |
| How long the output may be | P output-budget-policy | **nobody** — replaced by each section's `charBudget` |

The rule this generalises to, and the reason it matters beyond one preset:

> **Context that an earlier stage has already distilled is not re-injected downstream. The
> distillate is the carrier.**

`vibe_prefill` reads the attachments and produces a brief; `plan` reads the brief and produces
sections and tokens; a child reads one section. At each hop the previous stage's *input* is dropped
and only its *output* travels. Today every hop carries everything, which is why a 10,408-char user
prompt arrives escorted by 47,021 chars of system prompt.

**Project mode is where this compounds.** Zero Effort pays the duplication once, on a single
generation. A project conversation pays it on every turn: Layer C and Layer D are rebuilt and
re-sent for turn after turn, describing brand and documents that have not changed since turn one and
whose consequences are already visible in the artifact being edited. The same rule applies to
`focused_edit`, which needs the patch target and the design tokens — not the moodboard that produced
them.

This is the part of the redesign that is not about slideshows. The fan-out is what makes it
observable; the split is what makes it worth doing.
- `enable_thinking: false` on children — **requires** adding GLM-5.x to the allowlist in
  `chatRequestAdapter.ts:131-145`, which today lists only the GLM *vision* variants. Without this,
  "no reasoning" is prompt-only and unreliable on a hybrid model.
- awaiter: `allSettled` over the bounded pool; a failed section does not abort its siblings.
- retry: max 2 per section, with the **concrete** parse/validation error in the correction prompt,
  and the captured (possibly truncated) reasoning trace as context. Then placeholder, run continues.

Coherence risk — N independently generated sections drifting visually — is mitigated only by the
design tokens being decided once in `plan` and passed verbatim. That is why they belong in the plan
and not in the children.

---

## 7. Increments

| # | Scope | Risk |
|---|---|---|
| 0 | Persist `finishReason`; accumulate `reasoning_content`; `finish_reason: "length"` marks the stage `failed`, not `completed` | low — additive, needed in every scenario |
| 1 | Add `plan` to the stage enum; implement the plan call behind the flag | low — additive enum |
| 2 | Lock-inheritance for fan-out children (§3.1) | **high — incident-hardened path** |
| 3 | Bounded-pool fan-out of `generate` + awaiter | medium |
| 4 | Per-section retry loop with concrete errors (§6), time ceiling and placeholder degradation (§8.1) | medium |
| 5 | Drop Layer D from child composition; children read the plan (§6.1) | low |

Increment 0 ships on its own merit regardless of whether the rest is ever built.

---

## 8. Observable acceptance

Measured against the recorded baseline (`f51ee098`: 629,546 ms, 32,768 completion tokens,
`succeeded`-while-truncated), for the same 10-section `slideshow` brief:

1. no single call exceeds 8,000 completion tokens;
2. **zero** stages recorded with `finish_reason: "length"`;
3. wall clock **< 2 minutes** (from 10m 29s);
4. all 10 sections present, and the artifact parses **without** any `llmParser` repair strategy
   firing;
5. total input tokens across the fan-out **< 40k** (guards §3.2 — the failure mode of this design
   is paying 139k in prompt to save output);
6. a deliberately truncated section is recorded `failed`, retried, and visible as such — never
   `succeeded`;
7. **first section visible to the user in < 20s**, and every later section rendered as it lands —
   no section waits for its siblings;
8. no child call contains Layer D document context (§6.1): the plan is the only carrier of what the
   attachments said.

Criteria are deterministic and structural. None of them is "the model reports it is done".

### 8.1 Guaranteed result, bounded time

The loop is goal-based, and both bounds are hard:

- **time**: a section that has not returned within its budget is cancelled and retried once; the run
  has a total wall-clock ceiling after which remaining sections degrade to placeholders rather than
  extending the run;
- **result**: the run always terminates with N sections. A section that fails twice ships as a
  labelled placeholder — a deck with 9 real sections and 1 marked gap is a result; a deck that
  silently stops at section 6 and reports success is what we have today.

"Guaranteed" here means the outcome is *always* defined and *always* honest about which parts
degraded — not that every section always succeeds.

---

## 9. Native replacement, not a flagged alternative

The fan-out **replaces** the monolithic `generate`. It does not sit beside it behind a flag.

A flag would mean shipping two implementations of the same behaviour and keeping both alive — which
is what Rule Zero (`AGENTS.md`) exists to forbid, and it is also how the model-selection cascade came
to exist in three copies in the first place. Every branch we keep "just in case" is a branch that
drifts, and the second path is the one nobody tests.

Isolation comes from the branch: all work lands on `feat/parallel-section-generation`, off `develop`,
and does not merge until acceptance §8 is met on the local stack. Until then the old path is exactly
where it is, on `develop`, untouched — that is what git already gives us, without a runtime
construct we would then have to remove.

## 9ter. Integration status — read this before believing any number above

**None of the fan-out is reachable from the product.** The only thing that constructs
`GenerateSectionedArtifact` is `src/scripts/fanout-probe.ts:169`. Verified by grep, and the absence
is total:

| SSOT component | References from the new code |
|---|---|
| `ResolvePromptExecution` (prompt composition, layers) | **0** |
| `resolveComposerCascade` (model resolution) | **0** |
| `PromptExecutionLogRepository` (audit + cost journal) | **0** |
| `ResolvePipelineModelLock` (model lock, stage journal) | **0** |
| `CostTransactionService` (cost ledger) | **0** |
| `systemPromptLayers` (Layers A–P) | **0** |
| `PlatformConfig` (per-task budgets) | **0** |

So the measured runs exercised a **parallel flow**, not the product: the probe passes a model id from
an env var instead of resolving one, writes no journal entry and no cost transaction, appends no
pipeline stage, and composes its own prompt instead of the layer stack. The numbers are real — real
HTTP, real tokens, real money — but they measure the *mechanism*, not an integrated feature.

Two pieces **are** wired into the live path, and are the exception:

- `PromptExecutionLog.finishReason` / `reasoningTrace`, written from `llmRoutes.ts` on the real chat
  and streaming handlers;
- `chatRequestAdapter`'s `enableThinking` and the GLM-5.x allowlist entry, in the shared adapter every
  route already uses.

Wiring the rest means routing it through `ResolvePromptExecution` for composition, the cascade for
the model, and the journal for cost — and answering §3.1 first.

## 9bis. Measured, 2026-09-01

Five runs of `npm run fanout:probe -w apps/api` against the same ten-section brief, via OpenRouter
(SiliconFlow returns `402 insufficient balance`). Baseline is run `f51ee098`.

Cost uses this repo's own flat-rate formula — `(totalTokens / 1000) * textEurPer1kTokens` with the
default rate 0.005 (`CostTransactionService.ts:143` and `:71`). It reproduces the baseline's recorded
`costEstimate.amount` of €0.23353 exactly, which is why it is used here.

| run | model | section budget | calls | prompt tok | completion tok | truncated | degraded | wall | cost | vs baseline |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline | GLM-5.3 | monolith, 64k asked | 1 | 13,938 | 32,768 | **the whole run** | — | 629.5s | €0.2335 | 1.00× |
| A | DeepSeek-V4-Pro | 4k | 15 | 10,163 | 37,909 | 7 | 3 | 219.8s | €0.2404 | 1.03× |
| B | **Gemini-3.7-Flash** | 4k | 11 | 3,907 | 34,501 | **0** | **0** | **72.6s** | **€0.1920** | **0.82×** |
| C | GLM-5.3 | 8k | 15 | 10,203 | 79,088 | 6 | 3 | 245.6s | €0.4465 | 1.91× |
| D | GLM-5.3 | 16k | 10 | 3,835 | 58,912 | **0** | 3 | 257.1s | €0.3137 | 1.34× |

### A bigger per-section budget does not make things worse — that reading was wrong

Runs C and D are the same model at 8k and 16k, and 16k is better on every axis that matters:
truncation goes from six to **zero**, calls from fifteen to ten, and cost *falls* from €0.4465 to
€0.3137. The reason is the retry loop: at 8k, six sections were cut off and each bought a second
attempt, so the smaller budget was paid for twice. Raising the ceiling until the work fits is
therefore correct, and the earlier claim that it backfires is contradicted by run D.

### What the budget cannot fix

Run D still lost three sections, and not to truncation — to the 120s per-section ceiling
(`sectionTimeoutMs`), a knob this probe sets, not a model limit. GLM-5.3 was spending 85–130s and
8,861–15,627 completion tokens on a section whose prompt asks for **roughly 1,500 characters**. That
is a 10–20× overshoot against the target, and it is reasoning, not prose.

The comparison that isolates it is B against D — same fan-out, same brief, same budgets in spirit:

- **B (no reasoning burn)**: ~3,500 completion tokens per section, zero truncation, 72.6s, every
  criterion met, and **18% cheaper than the monolith it replaces**.
- **D (reasoning that cannot be switched off here)**: 4–5× the tokens per section, 3.5× the wall
  clock, 34% more expensive.

`enable_thinking: false` is honoured by SiliconFlow and ignored by OpenRouter
(`chatRequestAdapter.ts:216-240`), so every OpenRouter run measures the fan-out **without** the
reasoning split. The split is not a refinement of this design; on a hybrid-reasoning model it is the
difference between cheaper-than-before and a third more expensive.

### The prompts the fan-out actually sends

`FANOUT_DRY_RUN=1 npm run fanout:probe -w apps/api` prints them without dispatching. Measured:

| | monolith (`f51ee098`) | fan-out section call |
|---|---|---|
| system prompt | 47,021 chars | **750 chars** |
| user prompt | 10,408 chars | **114 chars** |
| length instruction | Layer P, 4,750 chars | one line: "roughly 1500 characters" |

## 10. What this makes unnecessary

Progressive feedback stops being a separate feature. `GENERATION_PROGRESS_INSPECTOR_PLAN.md` exists
because one long opaque call needs synthetic reassurance; N short calls that land one after another
*are* the progress signal, and each one is a real completed unit rather than a tip invented next to a
silent socket. Sections render as they arrive.

The inspector plan should be re-read after this ships, not before: most of what it proposes may be
answered by the stage journal the fan-out already writes.
