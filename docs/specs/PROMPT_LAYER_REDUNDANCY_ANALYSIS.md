# Prompt layer redundancy — measured on real runs

**Feature C.** An analysis, not a plan. Measured on the two most recent successful artifact
generations, using the layer spans `assertPromptTraceParity` guarantees are the bytes that went on
the wire — so these are the real prompts, not a reconstruction.

---

## 1. What the two runs contain

| Layer | Run A (minimax-m3) | Run B (gemini-3.7-flash) |
|---|---|---|
| A base-constraints | 7,667 | 7,667 |
| L output-language | 370 | 370 |
| B preset-format | 889 | 1,384 |
| S template-skills | 7,779 | 6,694 |
| C style-context | 12,562 | 7,373 |
| D document-context | 1,991 | 7,649 |
| X grounded-data | — | 2,144 |
| E preprompt-template | 12,917 | 12,283 |
| P output-budget-policy | 4,750 | 4,750 |
| **system total** | **48,925** | **50,314** |
| user prompt | 11,168 | 6,451 |
| tokens | 49,172 | 37,009 |

---

## 2. The hypothesis was redundancy. There is none — literally

Normalising every instruction line and looking for repeats:

- **0 lines appear in more than one layer**
- **0 lines are repeated inside any single layer**

The layer registry does its job. Whatever else is wrong with a 50,000-character prompt, nobody is
saying the same thing twice, and the dedup pass recorded in
`reports/PROMPT_LAYER_DEDUP_2026-07-02.md` appears to have held.

This does not rule out *semantic* overlap — two layers addressing the same concern in different
words — which line matching cannot see and which only reading can settle. But the cheap, mechanical
form of redundancy is not there.

---

## 3. What the measurement did find

Comparing the two runs layer by layer, byte for byte:

| | Chars | Share |
|---|---|---|
| **Static** — identical across both projects: A, L, P | **12,787** | **25%** |
| Variable — B, C, D, E, S, X | 38,282 | 74% |

About **3,200 tokens per call** are byte-identical instruction, sent again on every generation of
every project, forever.

That is the compressible mass, and the interesting part is *how* to compress it.

---

## 4. Rewriting it is the wrong lever

The obvious move is to shorten those 12,787 characters. Two reasons not to start there:

**They are load-bearing.** Layer A is the architectural contract the generated artifact must obey and
Layer P is the output-budget policy. Both exist because something went wrong without them. Shortening
a constraint to save tokens is trading a known cost for an unknown risk.

**Prompt caching removes their cost without touching a word.** A block that is byte-identical on every
call is exactly what provider-side prompt caching is for. The static layers already sit at the *front*
of the composed prompt (A, L, then the variable ones), which is the ordering caching requires — so
the structure is already right and nothing about the text needs to change.

Verifying that per provider is the concrete next step, and it is a configuration question rather than
a prompt-engineering one.

---

## 5. On caveman-style compression, again

Considered and rejected once already in `PARALLEL_SECTION_GENERATION_SPEC.md` §4, and this analysis
strengthens the rejection rather than weakening it:

- its compressors target JSON, logs, code and diffs — these layers are prose instruction, which is
  the one payload type it does not handle;
- its own documentation states it reduces *output* tokens, not input or reasoning;
- the proxy is BSL-1.1, which is a licensing decision rather than a technical one for a commercial
  product;
- and now the specific reason: there is **no literal redundancy to squeeze**. A compressor's easy
  wins are repetition and boilerplate structure, and the measurement says neither is present.

If an analogous project under a permissive licence were adopted instead, the same objection applies:
the thing it would compress is 25% static text that caching handles for free, and 74% variable
content that is variable precisely because it carries the project's meaning.

---

## 6. The question worth asking instead

Not "is the prompt redundant" — it is not — but **"is all of it read"**.

Layer E (preprompt-template) is the largest at ~12,900 chars and Layer C (style-context) the second
at up to 12,562. Together they are half the prompt. Whether a model attends to instruction at that
depth, or whether the tail dilutes the head, is not answerable by counting characters. It is
answerable by the replay harness in `SESSION_TRACING_EXECUTION_PLAN.md` WP6: run a recorded session
with one layer omitted and compare the artifact.

That is a real experiment with a real answer, and it needs no new theory — only the journal, which
now records enough to replay from.
