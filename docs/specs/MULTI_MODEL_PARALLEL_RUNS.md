# Multi-model parallel runs — parked idea

**Status: idea, deliberately not scheduled.** Recorded because most of what it needs already exists,
built for other reasons, and that is worth knowing before anyone builds it again.

---

## The idea

Run the same input through several models at once. Not to pick a winner in the abstract, but to end a
generation with **three versioned artifacts to choose from** — 1.1, 1.2, 1.3 — and keep working on
whichever is best. The same mechanism, pointed at measurement rather than choice, is a benchmarking
platform: same pipeline, same input, different models, compared on output quality, cost and time.

---

## Why it is closer than it looks

Four pieces already exist, none of them built for this:

| Piece | Built for | What it gives a benchmark run |
|---|---|---|
| `boundedPool.ts` | the section fan-out | bounded concurrency, per-task and per-run time ceilings, and a collector that keeps every sibling's result when one fails — which is exactly the failure mode of running N models at once, since one refusing must not lose the other two |
| `prompt_execution_logs` | the tracing programme | per call: cost, duration, tokens, endpoint, `finishReason`, both rendered prompts, the raw reply. The comparison table is a query, not a new pipeline |
| `WorkSession` | correlating one intent | the container that makes N runs one experiment instead of N unrelated generations |
| `PipelineRun.modelLock` | the 2026-08-26 incident | each run already pins exactly one model and refuses to drift off it, which is the property a fair comparison depends on |
| `preview_snapshots.parentSnapshotId` | version history | branching versions already exist; three artifacts from one parent is the shape it already supports |

So the shape is: **one `WorkSession`, N `PipelineRun`s each locked to a different model, fanned out
through the existing pool, each producing its own snapshot.** The comparison view reads the journal
that is already being written.

What genuinely does not exist: the launch surface that says "run this with these three models", and
the view that puts the three artifacts side by side.

---

## What makes it hard, and it is not the concurrency

**Cost multiplies by N, visibly.** Three models on one brief is three times the spend for one kept
result. That is defensible when chosen deliberately and indefensible as a default, so it cannot be a
silent behaviour.

**Fairness is a property of the prompt, not the runner.** Two models given the same brief are only
comparable if they also got the same layers, the same attachments and the same budgets. The
`assertPromptTraceParity` guarantee helps — it proves what went on the wire — but a benchmark has to
assert equality *across* runs, which nothing does today.

**"Better" is not measurable by the platform.** Cost and latency are. Whether the artifact is good is
a human judgement, and a benchmark that quietly substitutes token count or word count for quality
would be worse than no benchmark. The honest version presents three results and lets the user choose;
the dishonest version ranks them.

---

## Relationship to the section fan-out

Different axis, same machinery. The fan-out splits **one generation** across sections to make it fit
and finish; this splits **one input** across models to compare. Both need bounded concurrency, both
need every call journalled, and both need failures collected rather than propagated. If either is
built, the other becomes mostly configuration.

Worth noting the sequencing, though: the fan-out is still unreachable from the product, and a
benchmark of a pipeline nobody can run in parallel would measure the monolith N times.
