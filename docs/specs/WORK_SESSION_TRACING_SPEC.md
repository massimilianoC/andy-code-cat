# Work Session Tracing — Spec

**Status: proposed.** On `feat/parallel-section-generation`. The audit below is from the code as of
2026-09-02; nothing in §4 onward is built.

This precedes the parallel fan-out work (`PARALLEL_SECTION_GENERATION_SPEC.md`). That design cannot
be evaluated against the product until the product records what it actually does, and today it does
not.

---

## 1. The complaint

> "Non sappiamo bene cosa abbiamo chiesto, quando, perché, e perché abbiamo avuto quella risposta."

Two readings of this are worth separating, because one of them is already false.

**"We don't know if the prompt the UI shows is the prompt that was sent."** For the `generate` stage
this is already guaranteed, and guaranteed *hard*. `assertPromptTraceParity`
(`application/llm/promptTraceParity.ts:15`) runs on both chat call sites (`llmRoutes.ts:606`,
`llmRoutes.ts:1081`) and throws unless:

- the `system` message actually handed to the provider is byte-identical to `effectiveSystemPrompt`
  (`:21-23`);
- the layer registry is complete and in declared order (`:25-29`);
- every layer's recorded span really delimits those bytes, `PF_LAYER` markers included (`:50-54`).

So a divergence between the prompt inspector and the wire is not possible on `generate` without the
generation failing outright. That is the mechanism that let us decompose run `f51ee098`'s 47,021-char
system prompt layer by layer after the fact.

**"We don't know what happened outside `generate`."** This one is true, and it is most of the
pipeline.

---

## 2. Audit — what the 13 LLM call sites record today

| Call site | prompt + response stored | cost recorded |
|---|---|---|
| `llmRoutes` chat + stream (`generate`) | yes | yes |
| `OptimizeUserPrompt` | yes | yes |
| `OptimizeImagePrompt` | yes | yes |
| `SuggestProjectImageIdea` | yes | yes |
| `DraftProjectTemplate` | yes | yes |
| `VibeClassify` | **no** | cost only (`:307`) |
| `VibePrefill` — *the Zero Effort JSON* | **no** | cost only (`:822`) |
| `GenerateDidacticKnowledge` | **no** | cost only (`:229`) |
| `AskDidacticQuestion` | **no** | **nothing** |
| `ImageAnalyzer` | **no** | **nothing** |
| `generateImageWithSiliconFlow` | **no** | **nothing** |
| `DocumentBriefExtractor` | **no** | via `AssetEnrichmentPipeline` |

So for the Zero Effort prefill we know what it *cost* and nothing about what it was *asked* or what
it *answered*. Image generation and the didactic Ask path leave no trace at all.

### 2.1 Two structural gaps

1. **`prompt_execution_logs` has no `pipelineRunId`.** The rows exist but nothing correlates them.
   There is no path from a Vibe request to the artifact it eventually produced.
2. **The endpoint called is not recorded.** So the question "are there endpoints bypassing the
   SSOT?" cannot be asked of the history at all — the history does not contain the answer.

What *is* already stored: `PipelineRun.canonicalBrief`, content-hashed. The brief is not lost.

---

## 3. What a session is

`PipelineRun` is **one generation**, deliberately: its model lock is consumed by the first dispatch,
and `dispatch():181-193` treats a second stage as proof the run has said all it can. That semantic is
incident-hardened (2026-08-26) and must not be widened to mean "a session".

A working session is the level above it, and it already has a vocabulary in the codebase:
`pipelineEntryModeSchema = ["vibe", "zero-effort", "workspace"]`
(`packages/contracts/src/pipelineRun.ts:32`) — the three places a session can begin.

```
WorkSession                      one per user intent, from first Vibe keystroke to last edit
 ├─ originating input            the Vibe text, the attachment ids
 ├─ PipelineRun[]                one per generation (existing entity, gains sessionId)
 │   ├─ stages[]                 vibe_classify → vibe_prefill → brief_build → optimize → generate
 │   └─ canonicalBrief           the distilled brief, hashed (existing)
 └─ PromptExecutionLog[]         one per LLM call (existing entity, gains sessionId + runId + stage + endpoint)
```

A conversation cannot be this root: it is project-scoped, and a session starts before a project
exists.

---

## 4. What gets written, and what deliberately does not

**Written for every LLM call, at all 13 sites:** the rendered system prompt, the rendered user
prompt, the raw reply *before any parsing or repair*, `finishReason`, the reasoning trace when the
call was cut off, usage, cost, duration, status, model, provider, **and the endpoint URL actually
called**.

**Not written: the artifact.** The generated HTML already lives in `preview_snapshots`. Storing it
again in the journal would be the same fact in two places — the duplication Rule Zero exists to
prevent.

The raw reply is **not** that duplicate, and the distinction matters: the snapshot holds the artifact
*after* parsing and the five repair strategies in `llmParser.ts`; the journal holds what the model
actually emitted *before* them. Run `f51ee098` is exactly why — a truncated reply that repair made
parseable and the journal recorded as `succeeded`. Only the raw reply can answer "was this repaired,
and what was lost".

### 4.1 Retention

Everything whole, **120 days**. Beyond that is deliberately unresolved: the intended direction is a
compressed copy that lives forever alongside an expanded copy that ages out and can be rehydrated
from it. Recorded here so it is a known item rather than a surprise; not designed yet.

---

## 5. Order of work

1. **Correlation spine** — `sessionId`, `pipelineRunId`, `stage`, `endpoint` on `PromptExecutionLog`;
   `WorkSession` entity and repository; `sessionId` on `PipelineRun`.
2. **The Zero Effort chain** — `VibeClassify`, `VibePrefill`, `brief_build`, `generate` all writing
   full journal rows. Closes the worst gap and is the chain the fan-out experiment needs.
3. **The silent sites** — `AskDidacticQuestion`, `ImageAnalyzer`, `generateImageWithSiliconFlow`,
   `GenerateDidacticKnowledge`, `DocumentBriefExtractor`.
6. **Edit mode and asset regeneration** — same treatment, same session.

---

## 6. Observable acceptance

For one real Zero Effort run started from the UI on the local stack, with an attachment:

1. a single `WorkSession` id reaches every row the run produced, across every collection;
2. the prefill's **prompt and returned JSON** are both readable from the database — today neither is;
3. every LLM call has a recorded endpoint URL, and a query can list distinct endpoints per provider;
4. a truncated call is identifiable as truncated without inspecting the artifact;
5. the run is reconstructible end to end from the database alone: Vibe input + attachment → prefill
   prompt → prefill JSON → brief → composed layered prompt → raw reply → artifact reference;
6. no artifact HTML is stored twice.

Criterion 5 is the one that matters: it is the difference between a history and a black box.
