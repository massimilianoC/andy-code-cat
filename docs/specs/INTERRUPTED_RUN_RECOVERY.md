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

## 3. The feature

When a generation breaks, the work is not lost, so the honest thing is to offer it back:

> Something went wrong. There is a partial result and the model's reasoning up to the break.
> **Resume from here**, or **discard this project**.

**Resume** starts a generation whose input is the original brief plus the partial answer and the
reasoning that produced it — the model continues its own train of thought instead of restarting it.
That is cheap in the way that matters: the expensive part, thinking its way into the problem, is
already paid for.

**Discard** deletes the project. A failed attempt should not sit in the project list looking like
work; a user's list should contain things they have, not things that broke.

### Why this is worth doing

A generation that dies at minute eight has consumed eight minutes of tokens and produced something.
Today that becomes an error message and a project the user has to clean up by hand. The material to
do better is now sitting in the journal.

---

## 4. What has to be decided before building it

**Is a resumed run the same session or a new one?** It continues one intent, which argues for the
same `WorkSession`. But it is a distinct generation with its own model lock, which argues for a new
`PipelineRun` inside it. That reading is consistent with the model already in place and is the one
to take unless something contradicts it.

**A resumed prompt is not the prompt that was sent.** It carries the partial answer and the trace,
so it must be journalled as its own row with its own rendered prompts. Reusing the failed row would
make the journal claim something was sent that never was.

**Not every failure is resumable.** A 402 or an invalid key produced no partial work at all, and
offering to resume from nothing wastes the user's time and a second call. The offer should appear
only when a partial answer or a trace actually exists — which is now checkable rather than assumed.

**Discard must be genuinely safe.** Deleting a project deletes its journal rows, its costs and its
session. That is defensible for a run the user is rejecting, and it must not be the default, and it
must say what it removes.

---

## 5. Relationship to the parallelisation idea

Both come from the same observation — that a long single call is fragile — and they attack it from
opposite ends. Recovery makes a failure cheaper after the fact; decomposition makes it rarer, because
a call that takes forty seconds is far less likely to be interrupted than one that takes eight
minutes.

If decomposition lands first, recovery matters less. If recovery lands first, decomposition is still
worth doing. Neither blocks the other.
