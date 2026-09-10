# Parallelising the Zero Effort brief — measured, and rejected

**Status: tested, not adopted.** Recorded so the question is not reopened from intuition.

The hypothesis was reasonable: the Zero Effort prefill fills nineteen fields in one call that takes
one to five minutes, so splitting it into three or five focused calls should finish sooner. It does
not, and the reason is structural rather than incidental.

---

## Method

Reproduced a **real recorded run** rather than a synthetic one. `prompt_execution_logs` holds the
rendered system prompt, the user prompt, the output and the duration of every prefill, so the probe
(`apps/api/src/scripts/prefill-fanout-probe.ts`) replays an actual production call byte for byte and
compares strategies against it.

Baseline: project *INNESTI — Piante Pioniere*, `openrouter/minimax/minimax-m3`, 30,727-char system
prompt (Layer D with the attachment extraction already inside it), 230-char user prompt, 123.4 s,
14,827 tokens.

Every strategy receives the **same system prompt**. The attachment is extracted once, upstream; only
the field-filling is split. Fan-out calls differ from the monolith by one added sentence naming which
fields to fill.

---

## Results

| Strategy | Wall | Calls | Input tokens | Output | Cost | Fields filled |
|---|---|---|---|---|---|---|
| monolith | 104.5 s | 1 | 7,488 | 2,399 | €0.049 | **19/19** |
| fan-out, 5 groups, concurrency 5 | 180.0 s | 5 | 30,132 (≈7,533 each) | 7,786 | €0.190 | 19/19, 1 call failed |
| fan-out, 5 groups, concurrency 2 | 91.5 s | 5 | 37,670 | 11,933 | €0.248 | 14/19 |
| monolith (second run) | **298.2 s** | 1 | 7,488 | 6,688 | €0.071 | **19/19** |
| fan-out, 3 groups, concurrency 3 | 180.0 s | 3 | 15,037 (≈7,519 each) | 5,395 | €0.102 | 15/19, 1 call failed |

Per-call input is the same across strategies — about 7,500 tokens. The larger totals are not a bigger
prompt; they are **the same prompt paid for N times**, which is the price of parallelism rather than
a flaw in the measurement.

---

## Why it does not work

**Splitting the output does not split the work.** Each group must still read and reason over the
whole context to answer its slice. The cost is the context, not the answer — so N calls means N ×
the context for one brief.

**Wall clock is the slowest call, not the average.** Individual calls really are faster: in the
concurrency-2 run the slowest fan-out call finished in 72 s against the monolith's 104.5 s. It buys
nothing, because you wait for the last one.

**And the slowest call is unpredictable.** The same monolith call measured 104.5 s and 298.2 s on two
runs of identical input. With one call you are exposed to that variance once. With N you are exposed
to its maximum every time, and pay N times for the privilege.

**Completeness degraded.** Splitting cost fields in three of four fan-out runs — 14/19 and 15/19
against the monolith's consistent 19/19. `VibePrefill.ts:28-49` records why: the nineteen fields are
written in a deliberate order, the expressive ones last, because each is informed by what came
before. Independent calls cannot honour an ordering they cannot see.

---

## What would change the answer

Only one thing: **reducing the context per call**, which this probe deliberately held constant to
avoid confounding two questions. It is harder than it sounds — most of those 30,727 characters are
the Layer D extraction of the user's attachment, and it is not obvious which group can do without it.
A `content` group asked to design the structure without the source document would invent one.

If that is ever attempted, it must be measured on **output quality**, not on latency alone. Latency
is where this idea looks attractive; quality is where it would fail.

---

## Where parallelism does pay

The artifact generation stage, measured separately in
`PARALLEL_SECTION_GENERATION_SPEC.md`: 8.7× faster and 18% cheaper than the monolith it replaces.
The difference is that there the output is large, the provider's output cap is a real ceiling, and
the sections are genuinely independent — none of which is true of the prefill.

Same technique, opposite result, because the constraint being relieved is not the same one.
