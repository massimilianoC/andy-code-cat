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

## 2. Audit — what the 13 LLM call sites recorded (historical, closed 2026-09-02)

**This table is the diagnosis, not the current state.** Every row that said "no" has been closed:
all thirteen call sites now write a journal row carrying both rendered prompts, the raw reply before
any parsing, the endpoint actually called, `finishReason`, cost and the session it belongs to. Kept
because it is the evidence that motivated the work, and because "what was missing" is the fastest way
to understand what the journal is for.


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

### 2.1 Two structural gaps — both closed

1. ~~`prompt_execution_logs` has no `pipelineRunId`~~ — it now carries `workSessionId`,
   `pipelineRunId`, `pipelineStage` and `endpoint`, so a Vibe request and the artifact it produced
   are one query apart.
2. ~~The endpoint called is not recorded~~ — every row now names the URL actually POSTed to, which
   makes "are there endpoints bypassing the SSOT?" answerable for the first time.

The live claim about what is and is not certified now lives in
`SESSION_RECONSTRUCTION_CERTIFICATE.md`, which is checkable rather than descriptive.

What *is* already stored: `PipelineRun.canonicalBrief`, content-hashed. The brief is not lost.

---

## 3. What a session is — revised after review

The first version of this section put the user's prompt, attachments and model override on
`WorkSession` itself, as an `openingInput`. That was wrong, for three reasons that only show up once
you try to use it:

- a session entered through **workspace** has no Vibe prompt and no attachments, so the field is
  meaningless on a third of all sessions;
- a user who goes back and re-prompts produces **two** intakes and the shape can hold one;
- it conflates two different assertions — *"a session began"* and *"this is what the Vibe tool was
  handed"*. The first is about identity; the second is one tool's input/output cycle.

`WorkSession` is a **certificate**, and holds only what is true of the session as a whole: which
user, which organisation, which entry mode, when, and session-scoped configuration. No mode payload.

### 3.1 Which new objects are actually justified

A new collection has to earn itself by owning a fact nothing else owns. Most of what a per-mode
object would naturally contain is already owned:

| Fact | Existing owner |
|---|---|
| the composed system prompt actually sent | `prompt_execution_logs.renderedSystemPrompt`, and on `generate` it is byte-checked against the inspector by `assertPromptTraceParity` |
| the raw reply, the thinking trace | `prompt_execution_logs.rawResponse` / `.reasoningTrace` |
| tokens, cost, duration, finish_reason, endpoint | `prompt_execution_logs` |
| which model a generation was locked to | `PipelineRun.modelLock` |
| stage dispatch history, blocking | `PipelineRun.stages[]` |
| the canonical brief | `PipelineRun.canonicalBrief`, content-hashed |
| conversation turns | `Conversation` |
| the artifact | `PreviewSnapshot` |

So a `VibeModeRun` that stored "the system prompt sent and the JSON received" would be a second copy
of a journal row. The mode objects must **reference** journal rows by id, never restate them.

What is genuinely **unowned** today, and therefore justifies a collection:

**`VibeIntake`** — the user's prompt, the attachment references, the model override and the options,
as they were at the moment the button was pressed. Today this exists only as an HTTP request body:
nothing persists it. A Vibe request that dies before producing anything currently leaves no trace
that it was ever made.

**`ZeroEffortForm`** — the nineteen-field intake (`guidedLaunchSchema`,
`packages/contracts/src/pipeline.ts:30-61`) as the user confirmed it. Today it is a DTO that flows
through `LaunchGuidedProject` and is never stored; only the brief *derived* from it is
(`canonicalBrief`). Two questions are therefore unanswerable: **what did the form actually contain**,
and **did the user change what the prefill proposed**. That second one is the difference between the
model's suggestion and the user's decision, and it is invisible.

**Project mode does not justify a fourth object.** Its turn is a user prompt plus a model against a
project, and `Conversation` + `PipelineRun` + the journal already hold all three. Adding
`ProjectModeTurn` for symmetry would create a fourth owner for facts that have three. Symmetry is
not a reason.

### 3.1bis What the review found — the schema does not lack collections, it has duplicate copies

Checking the proposal against the code turned up the opposite of the assumed problem, and cost this
document one of its own proposals.

**The execution-order shape already exists.** `PipelineStageExecutionRef`
(`packages/contracts/src/pipelineRun.ts:116`) is an ordered list where each entry names the stage,
its status, its timestamps and `promptExecutionId` — a pointer to the journal row that did the work.
`PipelineRun.stages[]` is therefore already "an execution order carrying references to the real
objects that ran", which is what a redesign would have been trying to build.

**The confirmed Zero Effort intake is already persisted.** `buildCanonicalGenerationBrief` writes
`sourceFields: { ...input }` into the envelope (`:39` and `:152`), so all nineteen fields already
live on `PipelineRun.canonicalBrief`, hashed and timestamped, for the derived and hand-edited cases
alike. A `ZeroEffortForm.confirmed` would have been a straight duplicate — the entity was cut down to
hold only the prefill proposal and the diff, which nothing owns.

**The artifact already exists in three places.**

| copy | written by |
|---|---|
| `preview_snapshots.artifacts` | the snapshot write path |
| `conversations[].metadata.generatedArtifacts` | the web client, `page.tsx:2384` — and read back as a fallback at `:1901` and `:2146` |
| `conversations[].metadata.rawResponse` | the web client, `page.tsx:2379` |

This changes the shape of the problem. The instinct to give each modality a strongly-identified
object is sound, and the pieces that carry it are largely in place; what the schema actually suffers
from is the same fact stored several times by different writers, which is the failure mode that adding
collections makes worse rather than better.

The consequence for the new fields in §4: `PromptExecutionLog.rawResponse` overlaps the conversation
copy **on the `generate` path only**. It is kept deliberately, because the two are not the same fact
— the conversation copy is what the browser chose to send back, the journal copy is what the server
received — and because on every other call site (classify, prefill, image, didactic) no copy exists
at all. That overlap is a knowing one, recorded here rather than discovered later.

### 3.2 The shape

```
WorkSession                       certificate: user, org, entryMode, timestamps, session config
 ├─ VibeIntake        (new)       prompt as typed · attachment refs · model override · options
 │                                → promptExecutionLogIds[] for classify and prefill
 ├─ ZeroEffortForm    (new)       the 19 fields as confirmed · prefilled vs edited
 │                                → briefRef (PipelineRun.canonicalBrief hash)
 ├─ PipelineRun[]     (existing)  one per generation · modelLock · stages · canonicalBrief
 └─ PromptExecutionLog[] (existing)  one per LLM call · prompts · raw reply · cost · endpoint
```

Every one of these carries `workSessionId`. The mode objects hold **what the user did and got**; the
journal holds **what went on the wire**. Two different facts, one owner each, joined by id.

### 3.3 Inheritance without refactoring the tools

Every tool invoked inside a session must record its membership — image generation, prompt
optimisation, didactic answers, all of them. Threading `workSessionId` manually through thirteen
call sites and their constructors is the refactor we are trying to avoid.

The codebase already solves this shape: routes read `req.auth!.userId` and `req.sandbox!.projectId`
from a request-scoped context populated by middleware. `workSessionId` joins them there. A tool then
receives it the same way it already receives `projectId` — as part of the call it is already being
given — rather than through a new constructor dependency.

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
