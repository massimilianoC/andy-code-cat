# Interrupted run recovery — spec

**Status: prerequisite built, feature not built.** The data a recovery needs is now kept; the offer
to the user is not.

---

## 1. The assumption, checked

> "il thinking dovremmo averlo già tracciato"

It was not, and the numbers said so before any of this was designed:

| | |
|---|---|
| journal rows carrying a `reasoningTrace` | **2** |
| rows with `status: "failed"` | **35** |
| failed rows carrying any partial output | **0** |

The trace was written only when a call ended with `finish_reason: "length"`, and a failure recorded
its error message and nothing else. So in the one case a recovery exists for — a generation that
broke part-way — the material to recover from was being deleted at the moment it was produced.

Worse in the interruption path specifically: `rawReply` and `rawThinking` were both in scope at the
point the row was closed, and neither was written.

## 2. What now happens instead

- an interrupted run keeps its partial answer (`rawResponse`) and its reasoning (`reasoningTrace`),
  and records `finishReason: "interrupted"` when the provider gave none;
- the trace is kept whenever a call did **not** end cleanly, not only on truncation. A `"stop"`
  finish means the model said what it meant to; anything else means work was cut short, and then the
  trace is the only record of it.

That is the whole of what is built. It changes nothing a user sees.

---

## 3. Two loss points, one destination

Corrected twice, and the correction is the design.

The first draft put the offer on the Zero Effort path, reasoning that Zero Effort has no chat to
type "riprova" into. Tracing the flow killed that: the launch page pushes straight to
`/workspace/:projectId`, so artifact generation happens IN the workspace, which has a chat and a
picker.

But the workspace is not the only place work is lost, and treating it as the only one was the second
mistake. There are **two** points, with the same problem and the same answer:

| Where | What breaks | What is lost |
|---|---|---|
| **Vibe → prefill** | the Zero Effort brief call fails or is cut short | the model's reasoning toward a brief. The user lands on an empty form, or stays in Vibe with a warning |
| **Workspace generation** | the artifact call fails or is interrupted | the partial artifact and the reasoning behind it |

Both funnel to the same destination: **carry the recovered context into workspace project mode and
continue there.** The workspace is where a generation can be resumed, so a prefill that died on the
way to it should arrive there carrying what it managed to think, rather than sending the user back
to an empty form.

### Why "riprova" is not already this

Typing "riprova" resends the conversation history, and a failed generation leaves no assistant
message in it. The interrupted path sends the client **200 characters** of partial reply
(`llmRoutes.ts:1402`) and nothing else, while the journal row holds the whole partial answer and the
reasoning trace.

So a manual retry makes the model start thinking again. A recovery makes it continue. That
difference is the entire feature.

### The prefill was throwing its thinking away

Found while checking this: `VibePrefill` counted `reasoning_tokens` into the cost meta and never
stored the reasoning text. We knew how much the model had thought and nothing about what. Fixed —
the trace is now kept whenever the call does not end with a clean `stop`.

### The offer

> This generation stopped. There are **N tokens** of work already paid for — a partial result and the
> model's reasoning. **Continue in the workspace with this model**, **with a different one**, or
> **discard the project**.

`N` comes from the failed journal row, so it is a fact rather than reassurance.

**Discard** deletes the project, because a failure should not sit in the list looking like work.

### The list-hygiene problem is real and measurable

**98 of 156 projects carry no snapshot at all** — no artifact was ever produced. That number
conflates genuine failures with drafts nobody launched, so it is an upper bound rather than a failure
count. But it is the shape of what the user sees: a list where most entries are not things they have.

## 4. What has to be decided before building it

**Is a resumed run the same session or a new one?** It continues one intent, which argues for the
same `WorkSession`. But it is a distinct generation with its own model lock, which argues for a new
`PipelineRun` inside it. That reading is consistent with the model already in place and is the one
to take unless something contradicts it.

**A resumed prompt is not the prompt that was sent.** It carries the partial answer and the trace,
so it must be journalled as its own row with its own rendered prompts. Reusing the failed row would
make the journal claim something was sent that never was.

**Not every failure is resumable.** A 402 or an invalid key produced no partial work at all — the
five most recent failed rows in the database are enrichment calls with `tok=0`, `raw=0`, `think=0`,
and there is nothing to resume from. The offer must appear only when the row actually carries
material, which is now checkable rather than assumed.

**Discard must be genuinely safe.** Deleting a project deletes its journal rows, its costs and its
session. That is defensible for a run the user is rejecting, and it must not be the default, and it
must say what it removes.

## 5. Relationship to the parallelisation idea

Both come from the same observation — that a long single call is fragile — and they attack it from
opposite ends. Recovery makes a failure cheaper after the fact; decomposition makes it rarer, because
a call that takes forty seconds is far less likely to be interrupted than one that takes eight
minutes.

If decomposition lands first, recovery matters less. If recovery lands first, decomposition is still
worth doing. Neither blocks the other.
