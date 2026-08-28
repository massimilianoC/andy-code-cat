# Generation Progress & Inspector — Plan

**Status: proposed, not implemented.** Written for review. Nothing in this document has been
built; the measurements and file references are from the code as of 2026-08-27.

---

## 0. The complaint, and what it actually is

> "La prima compilazione vibe del zero-effort è molto lenta senza azioni e feedback UI."

The obvious readings are both wrong, and worth killing before anything is designed on top of them.

**"We need streaming."** The calls are already streaming. `POST /projects/:id/llm/chat-preview/stream`
exists, the workspace uses it as the primary path (`streamLlmChatPreview`,
`apps/web/app/workspace/[projectId]/page.tsx:2209`), and the non-streaming `llmChatPreview` survives
only as a fallback inside the catch. Adding streaming would add nothing.

**"We need better progress tips."** A tip that is not driven by a real event is a guess rendered as
a fact. The pipeline already knows exactly which phase it is in; inventing a plausible-looking
sequence next to it is worse than silence, because it is silence that lies.

The real problem is narrower and fixable: **the stream opens too late.**

---

## 1. Where the silence comes from

`apps/api/src/presentation/http/routes/llmRoutes.ts`:

| Line | What happens |
|---|---|
| 1039 | handler entered |
| 1054 | `resolvePromptExecution.execute()` — Layer D, brand context, prompt composition, model resolution |
| ~1150 | `fetch` to the provider |
| **1204** | **`res.flushHeaders()` — the SSE stream opens here** |
| 1268 | first `thinking` / `answer` events reach the client |

Everything above line 1204 happens with an open POST and **zero bytes written to it**. The browser
has no way to distinguish "working" from "hung".

Measured on the local deploy stack, 2026-08-27, from the route's own `[stream-debug]` lines:

```
[stream-debug] starting fetch to provider at        163ms
[stream-debug] provider response ok, stream read at 4384ms
```

163 ms of server-side preparation, then **4.2 seconds of nothing on the wire** — and that was a
short turn on `Qwen/Qwen3-32B`. The zero-effort first generation carries a much larger canonical
brief and asks for a complete page, so the pre-stream window is substantially longer.

The silence therefore has two distinct parts, and neither is covered by streaming the answer:

1. **Server-side preparation** — cheap in the sample above, but it is where Layer D enrichment,
   brand context and media resolution live, and those are the phases that get slow on a first
   generation with assets.
2. **Provider time-to-first-token** — 4.2 s in the sample. Nothing can shorten it; the only
   honest response is to say that we are waiting on the provider, and since when.

---

## 2. What already exists and should be reused

Per AGENTS.md (reuse before inventing), none of this needs new machinery:

| Asset | Where | Why it fits |
|---|---|---|
| `sendSse(res, payload)` | `llmRoutes.ts:82` | the transport, already used by two routes |
| Early-flush precedent | `llmRoutes.ts:419-432`, the `optimize-prompt/stream` route | already flushes headers **before** doing work and emits `thinking` events while it runs — the exact pattern this plan proposes, 800 lines up in the same file |
| `media_progress` event | `LlmChatStreamEvent`, `apps/web/lib/api/llm.ts:232` | a structured progress event with `phase` / `index` / `total` already exists in this union; a `stage` event is the same idea, not a new concept |
| `ExecutionLogger` | `application/services/ExecutionLogger` | already emits `domain` / `eventType` / `status` / `durationMs` for the same phases |
| `EXECUTION_LOG_SPEC.md` | `docs/specs/` | the event taxonomy is already specified; the inspector is a **live view of it**, not a second vocabulary |
| `promptLayers` | returned by `resolvePromptExecution`, already sent to the client | the layer breakdown the inspector would display is already on the wire |

---

## 3. A defect found while surveying, which this work should fix on the way past

`LlmChatStreamEvent` is declared **only in `apps/web/lib/api/llm.ts:229`**. The server writes those
events through `sendSse(res, payload: unknown)` — untyped. So the shape of the generation event
stream is asserted by the consumer and by nothing else: the server can emit a field the client
never reads, or rename one, and nothing fails until a user notices.

This is the same class as the artifact contract before AL-046, and the same as
`promptingTrace.promptConfigId`, which the client declared and sent and zod silently stripped.

Adding stage events means touching this union anyway. **It moves to `packages/contracts` as part of
increment 1**, and `sendSse` becomes typed against it. Adding events to an untyped stream would be
adding to the problem.

---

## 4. Increments

Each is shippable alone and does not regress the one before it.

### Increment 1 — open the channel before the wait, and put real events on it

**Server.**

1. Move the union into `packages/contracts` (`llmChatStreamEventSchema`), type `sendSse` against it.
2. Flush SSE headers **immediately after `resolvePromptExecution` returns** (after line 1054), not
   after the provider responds.
3. Emit a `stage` event at each real boundary. Proposed shape, mirroring `media_progress`:

   ```ts
   { type: "stage";
     stage: "prompt_composed" | "model_resolved" | "provider_requested" | "first_token";
     elapsedMs: number;
     detail?: {
       layerCount?: number;      // prompt_composed
       promptChars?: number;     // prompt_composed
       provider?: string;        // model_resolved
       model?: string;           // model_resolved
       source?: string;          // model_resolved — lock | user-selection | cascade
     } }
   ```

   Every value above is something the route already holds. No new computation, no new query.

**Client.** Handle `stage` in the existing `onEvent` switch and render it where the "thinking"
indicator is today: *"modello scelto: siliconflow / GLM-5.2 · in attesa del provider da 6s"*. An
unknown event type is already ignored, so an older bundle degrades to today's behaviour.

**The risk, named.** Once headers are flushed the response status is fixed at 200: no route past
that point can answer 4xx/5xx. This matters because `MODEL_NOT_AVAILABLE` (409) and
`ARTIFACT_BASE_STALE` (409) are load-bearing.

Mitigation is structural, not hopeful: **model resolution happens at line 1054, before the flush
point.** Everything that refuses already refuses before the stream opens. Anything failing after
becomes an `error` event, which the client already handles. `errorHandler` already checks
`res.headersSent` and ends the response rather than trying to set a status.

**Acceptance.** With the API artificially delayed before the provider call, the client shows a
named phase within ~200 ms of pressing send; a refused model still arrives as HTTP 409, not as a
stream event; an old client bundle behaves exactly as today.

### Increment 2 — the optional inspector sidebar

A collapsible panel rendering, for the current turn:

- the stage timeline from increment 1, with elapsed time per phase
- the composed layer breakdown, from `promptLayers` — **already on the wire today**, currently
  surfaced only in the request-insight disclosure
- the `media_progress` events, which today produce a transient notification and are then lost
- the resolved provider/model and why (lock, user selection, cascade)

Pure client work over data that already flows. No endpoint, no schema, no storage.

**Open design question for review:** does this live in the existing right-hand disclosure panel, or
as a genuinely separate sidebar? The former is less UI to build and keeps one place for "what
happened"; the latter is visible *during* generation, which is the whole point.

### Increment 3 — live execution log, only if 1 and 2 are not enough

Increments 1 and 2 cover a chat turn. They do **not** cover work that happens outside it — Layer D
enrichment scheduled in the background, asset ingestion, thumbnail jobs. Those already write to
`execution_logs`; making them visible live needs a subscribe endpoint, which is the first genuinely
new piece of infrastructure in this plan.

**Deliberately last.** It is the largest piece and the least certain to be needed: if the first
generation feels responsive after increment 1, this buys much less than it costs.

---

## 5. What this plan deliberately does not do

| Not doing | Why |
|---|---|
| Add streaming to the LLM calls | already streaming |
| Synthetic progress bars or rotating tips | a guess rendered as a fact; the pipeline knows the real phase |
| Make the generation faster | this is an observability change; 4.2 s of provider latency stays 4.2 s |
| A new event taxonomy | `EXECUTION_LOG_SPEC.md` already defines one |
| Persist stage events | they are a live view; the durable record is `execution_logs` and `prompt_execution_logs` |

---

## 6. Open questions — for review, not for an agent to decide

1. **Is provider time-to-first-token the dominant cost on a real zero-effort run?** The 163 ms /
   4384 ms sample is a short chat turn. Before building, instrument one real first generation and
   split preparation from provider wait. If preparation turns out to be 20 s of Layer D, the
   priority order in increment 1 changes.
2. **Sidebar or existing disclosure panel?** See increment 2.
3. **Should stage events be shown to every user, or only when the inspector is open?** Showing the
   resolved model and layer counts to an end user is arguably internal detail.
4. **Does the inspector need to survive a reload mid-generation?** Today the stream dies with the
   tab. Making it resumable is increment 3 territory.

---

## 7. Related documents

- `docs/specs/EXECUTION_LOG_SPEC.md` — the event taxonomy this reuses
- `AGENTS.md` — Rule Zero (one path), and the corollary on sources of truth, which section 3 applies
- `docs/specs/ARTIFACT_LIFECYCLE_SPEC.md` — AL-046, the same duplication defect in the artifact contract
