# Parallel Section Generation — Spec

**Status: proposed, not implemented.** Written for review on `feat/parallel-section-generation`.
Nothing here is built. Measurements are from the local deploy stack, run `f51ee098`, 2026-09-01.

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
| 4 | Per-section retry loop with concrete errors (§6) | medium |

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
   `succeeded`.

Criteria are deterministic and structural. None of them is "the model reports it is done".

---

## 9. Rollback

- All work on `feat/parallel-section-generation`, branched from `develop`.
- The new path sits behind an env flag (default **off**), mirroring the existing
  `NEXT_PUBLIC_PIPELINE_RUN_UI` precedent. The monolithic `generate` path stays untouched and
  remains the default until acceptance §8 is met on the local stack.
- Rollback after merge is therefore a flag flip, not a revert.
