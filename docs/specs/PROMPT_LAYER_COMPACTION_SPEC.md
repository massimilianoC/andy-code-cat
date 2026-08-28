# Prompt Layer Compaction — Layer K

**Status: SPECIFIED, NOT IMPLEMENTED. Deliberately deferred.**

This spec describes a safety net for a limit the platform has **not yet hit in production traffic**.
See [Evidence](#evidence-why-this-is-deferred) before scheduling the work: the measured headroom
made building it before the September 2026 demo a worse trade than the truncation it prevents.

Related: [PROMPT_LAYER_SSOT_SPEC.md](PROMPT_LAYER_SSOT_SPEC.md) (layer registry, markers, trace
parity), [SSOT_REFACTOR_PROGRESS.md](../SSOT_REFACTOR_PROGRESS.md).

---

## 1. The problem

The system prompt is composed from 15 registry-declared layers. Chat requests then append
conversation history and the current artifact. All of it competes for one fixed budget:

```
LLM_CONTEXT_MAX_CHARS = 64000

budgetForHistory = min(LLM_HISTORY_MAX_CHARS, MAX_CONTEXT_CHARS − systemPrompt − userContent − 100)
```

The artifact (up to `LLM_ARTIFACT_CONTEXT_MAX_CHARS`, 16000) is inside `userContent`, so it is
deducted before history is allocated. History is the only compressible term, which inverts the
priority we want: when a conversation grows long — exactly when memory matters — history is the
first thing to go, and it goes **silently**. There is no field in the trace recording that it
happened; `historyIncluded` exists only in a debug `console.log`.

### Measured composition

A real generation (project `6a8eb70c…`, 2026-08-26), system prompt 40 918 chars:

| Layer | Chars | Class |
|---|---|---|
| E — pre-prompt template | 12 274 | content |
| A — base constraints | 7 667 | **contract** |
| C — style context | 5 581 | content |
| S — template skills | 5 251 | content |
| P — output budget policy | 4 750 | **contract** |
| D — document context | 3 493 | **evidence** |
| B — preset output format | 1 532 | **contract** |
| L — output language | 370 | **contract** |

Contract 14 319 · content 26 599 · evidence 3 493. **65 % of the system prompt is compressible
content.**

Layer D was 3 493 against a configured cap (`ENRICHMENT_LAYER_D_MAX_CHARS`) of 21 000. A project
with attachments near that cap reaches a ~58 400-char system prompt, at which point a 16 000-char
artifact drives `budgetForHistory` negative and history is dropped entirely.

---

## 2. Evidence — why this is deferred

Measured across **all 23 real chat requests** in the local database:

| Signal | Occurrences |
|---|---|
| Artifact truncated (`...[troncato]`) | **0** |
| History compacted (`[history-compact]`) | **0** |
| `budgetForHistory <= 0` | **0** |
| Peak context usage | **51 808 / 64 000 (81 %)** |

The failure mode is real in the arithmetic and has **never fired in practice**. For an alpha demo
the worst realistic outcome is occasional truncation, which is acceptable; building compaction
first would add a new LLM call, a new cache, and a change to a trace invariant on the critical
path, for a problem no user has met.

**Revisit when** any of these becomes true:
- a request records artifact truncation or history compaction;
- peak usage crosses ~90 % of `LLM_CONTEXT_MAX_CHARS` on real traffic;
- Layer D routinely exceeds ~10 000 chars (heavier attachments).

Cheaper prerequisite, worth doing first regardless: **make the degradation visible** — persist
`historyIncluded`, dropped-message count and artifact-truncation flag in the prompting trace and
render them in the Prompt tab. That converts a silent failure into an observable one and gives the
trigger above real data to fire on.

---

## 3. Design

### 3.1 Layer K

One new registry entry, placed after the contract layers:

```ts
{ id: "K", field: "layerK", key: "compacted-context",
  label: "Layer K — Compacted context", editableBy: "none" }
```

Behavior is binary:

- **Below threshold** — `layerK` is empty. Composition is byte-identical to today.
- **Above threshold** — `layerK` holds the compacted text; every compacted layer keeps its registry
  slot with `chars: 0` and `source: "compacted-into-K"`.

The presence of a non-empty Layer K *is* the signal that the threshold was crossed. No separate
flag, no separate state to keep in sync.

### 3.2 Layer classification

| Class | Layers | Treatment |
|---|---|---|
| Contract | A, L, V, B, P, Q, R | Never touched. These define output shape; altering them breaks parsing. |
| Evidence | D, X | Never LLM-rewritten. Documents and grounded data are the user's source material — a lossy summary can silently change a date, an amount or a condition. Reduce via the existing deterministic knobs (`maxAssets`, `maxChars`, `ENRICHMENT_LAYER_D_MAX_CHARS`) so loss is honest truncation, not paraphrase. |
| Content | S, T, C, G, E | Compacted into Layer K. |
| Undecided | F (governance) | Excluded by default. Governance states boundaries, which makes it closer to contract than to content; compressing it softens rules. Flagged as a product decision, not a technical one. |

On the measured prompt above the content set is S + C + E = 23 106 chars. Compacted to ~6 000 that
recovers ~17 000 chars without touching a single document or constraint.

### 3.3 Threshold

Two parameters, no percentage arithmetic beyond one multiplication:

```
LLM_CONTEXT_MAX_CHARS           = 64000   # existing
PROMPT_COMPACTION_THRESHOLD_PCT = 70      # new
```

Compaction triggers when the composed system prompt exceeds
`LLM_CONTEXT_MAX_CHARS × PCT / 100`. At 70 that is 44 800 chars: the measured 40 918-char prompt
stays untouched; a second sizeable attachment pushes it over. Setting `PCT = 100` disables the
feature entirely — the rollback lever needs no code change.

Target length for Layer K derives from the same threshold, so one number governs the whole
behavior:

```
targetK = thresholdChars − (contractChars + layerDChars + layerXChars)
```

**Measure the system prompt only, not the full payload.** The artifact changes size every turn, so
including it would make the prompt oscillate between compacted and uncompacted across consecutive
messages, thrash the cache, and present the model with different instructions on alternating turns.
Measuring only the system prompt makes the decision a stable property of the project and its
attachments. Guaranteeing room for history and artifact is the *goal*, not the *input*.

### 3.4 Determinism

- **The decision is fully deterministic** — a length measurement against a threshold.
- **The compaction result is not** (it is an LLM call), so it is made **reproducible** by caching on
  `hash(concatenated source layers + targetK + model)`. Identical inputs yield identical output, and
  the run happens once until something changes. Attachment changes alter Layer D, which alters the
  hash — invalidation needs no separate logic.
- **Deterministic fallback:** if compaction fails or times out, truncate each compactable layer
  proportionally and proceed. Prompt composition must never block on an optimization.

Model selection for the compaction call follows the same policy as the rest of the pipeline
(`PipelineRun.modelLock` when governed, the standard cascade otherwise).

### 3.5 Trace and UI

The Prompt tab is registry-driven, so the compacted layers already render as zero-char rows; only
the reason label is new. Layer K renders as a normal expandable layer. The cache record retains the
pre-compaction text so the original remains retrievable.

SSOT holds throughout: what is displayed remains exactly what is sent.

### 3.6 Impact on PP-021 trace parity

`assertPromptTraceParity` currently requires every zero-char layer to carry `source: "empty"`.
Layers emptied by compaction carry `source: "compacted-into-K"`, so the assertion must accept that
value.

This is three lines, but it relaxes an invariant that guarantees displayed/sent correspondence. It
must be done deliberately, with a dedicated test asserting that a compacted layer is accepted **and
that any other zero-char source is still rejected**.

---

## 4. Cost

| Item | Scope |
|---|---|
| Registry + composer | one descriptor, one field |
| Compaction service + cache | new application service, one collection |
| Config | two env vars |
| Trace parity | 3 lines + dedicated test |
| Prompt tab | one label, one banner |

Estimated **400–600 lines including tests**. No change to dispatch paths, model lock, or the prompt
execution journal. Purely additive: at `PCT = 100` behavior is identical to today.

---

## 5. Relationship to per-model context windows

This spec assumes the fixed 64 000-char budget. That budget is a platform constant applied
identically to every model; the catalog does **not** currently store a context window
(`LlmModel` has no `contextLength` field), although OpenRouter's `/models` already returns
`context_length` and `top_provider.context_length`.

The two changes are independent and compose cleanly. Deriving the budget from the selected model's
window is the more valuable of the two — for a large-window model it removes the problem instead of
compressing around it — and it makes this spec's threshold simply stop firing. Compaction remains
worthwhile as the safety net for genuinely small-window models.
