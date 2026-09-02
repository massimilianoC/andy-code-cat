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

## 3. The feature — and it is narrower than it first looked

**Project mode already has recovery, and nothing needs building there.** The workspace has a chat and
a model picker: typing "riprova" sends a new turn carrying the conversation history, and the picker
changes the model for it. A user who lands in the workspace after a failure can already resume from
what exists, with a different model if they want. Adding a button there would be a shortcut to
something that works.

**Zero Effort has none of that**, and that is the whole feature. There is no chat to type into and no
turn to send. When a generation breaks on that path the user's options are to start over from the
beginning, having paid for everything that already happened.

So the offer belongs where the recovery does not already exist:

> This generation stopped. There are **N tokens** of work already paid for — a partial result and
> the model's reasoning. **Retry with this model**, **retry with a different one** (the existing
> model selector), or **discard the project**.

The token figure is not a guess: `usage.totalTokens`, `rawResponse` and `reasoningTrace` are on the
journal row, so the modal can state what is actually there rather than promising something vague.

**Retry** starts a new generation inside the same `WorkSession`, seeded with the original brief plus
the partial answer and the reasoning — the model continues a train of thought rather than boarding
it again. Changing the model is the interesting case: a run that GLM abandoned at eight minutes may
be finishable by a faster model given everything the first one worked out.

**Discard** deletes the project.

### The list-hygiene problem is real and measurable

**98 of 156 projects carry no snapshot at all** — no artifact was ever produced. That number
conflates genuine failures with drafts nobody launched, so it is an upper bound rather than a failure
count. But it is the shape of what the user sees: a list where most entries are not things they have.

## 3bis. It must be additive — it reuses the flow, it does not add one

The strongest constraint on this feature, and the one that decides its shape: **a recovery is a
project-mode generation with an injected prompt.** Nothing about it is new machinery.

The workspace already knows how to take a prompt, a model and a conversation and produce an artifact.
A recovery hands it the original brief plus the partial answer and the reasoning, with whatever model
the user picked. So it enters `/llm/chat-preview` like any other turn, is journalled by the row that
route already writes, joins the `WorkSession` that already exists, and lands in the conversation the
project already has.

What that buys: the certification is not re-implemented. The resumed call is traced, costed and
correlated by the same code that traces every other call, and the inspector will show it without
being taught anything new.

What it needs beyond that is small:

- **one flag** marking that this generation was resumed from a failed one, and naming the row it
  resumed from. Enough to answer "why is there a second generation here" in the history, and nothing
  more;
- **the modal**, on the Zero Effort path only, offering retry-with-this-model, retry-with-another
  (the existing selector), or discard;
- **discard deleting the pending project**, so a failure does not leave a dead entry in the dashboard.

Anything larger than that is a sign the feature has drifted away from reusing the existing flow.

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
