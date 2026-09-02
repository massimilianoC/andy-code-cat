# Session Redundancy — measured analysis

Measured on a real exported session (`c0f2b120-7044-4fd8-a993-ebc7a605448f`, project *Glossario
tecnico e perimetro*, generated with `moonshotai/kimi-k2.7-code`), not estimated. Export produced by
`apps/api/src/scripts/session-export.js`; the file was 468 KB.

---

## 1. Where the bytes are

| Field | Chars |
|---|---|
| `prompt_execution_logs.renderedSystemPrompt` (4 calls) | **99,810** |
| `prompt_execution_logs.renderedUserPrompt` | 18,282 |
| `preview_snapshots.artifacts` (html+css+js) | 23,476 |
| `conversations.metadata.rawResponse` | 22,710 |
| `conversations.metadata.generatedArtifacts` | 21,888 |
| `prompt_execution_logs.rawResponse` | 7,104 |
| `pipeline_runs.canonicalBrief.content` | 7,925 |
| `canonicalBrief.sourceFields` | 7,395 |

The system prompts dominate. That is not duplication — each call legitimately carries the prompt it
was given — but it is where a redundancy *inside* the prompt would cost the most.

---

## 2. The artifact is stored three times, and the three disagree

This is the important finding, and it is worse than duplication.

| Copy | Size | Matches the snapshot? |
|---|---|---|
| `preview_snapshots.artifacts.html` | 16,948 | — it is the authority |
| `conversations[].metadata.generatedArtifacts.html` | **14,767** | **no** |
| `conversations[].metadata.rawResponse` | 22,710 | **does not even contain it** |

Three records of one artifact that do not agree on what the artifact is. Duplication wastes space;
**divergence produces wrong answers**, and the workspace reads `generatedArtifacts` as a live
fallback (`page.tsx:1901` for what the preview shows, `:2146` for what is sent as the base of the
next generation). So the second copy — the shorter, different one — can drive both the display and
the next turn's input.

This is WP1 in `SESSION_TRACING_EXECUTION_PLAN.md`, and it is no longer a theoretical risk: the
divergence is measured, on a real run, at 2,181 characters.

---

## 3. The brief is stored three times, and that is fine

| Copy | Size |
|---|---|
| `pipeline_runs.canonicalBrief.content` | 7,925 — the authority, content-hashed |
| `prompt_execution_logs[generate].renderedUserPrompt` | 7,925 — byte-identical |
| `conversations[].message.content` | 7,925 — byte-identical |

Byte-identical in all three, which is the difference from §2. And each copy answers a different
question: what the brief *is*, what was *sent to the model*, and what the *user's turn* looked like.
The journal copy in particular must stay — a prompt record that reconstructs the prompt by reference
would stop being a record of what was actually sent.

Accepted redundancy, deliberately.

---

## 4. Two references that are missing

**From the intake to the stored attachment.** `vibe_intakes.attachments[]` holds filename, mime type
and size; the `project_assets` row holds `storedFilename`, `originalName`, `enrichmentTrace` and the
analysis. Nothing links them. So the export can show *that* a `.docx` was attached and, separately,
*that* an asset exists — but not that they are the same file, and there is no path from the session
to a download.

**From the journal to the artifact — this one turned out to exist.** First reading of the export said
the `generate` row carries no `snapshotId`, and that was a wrong conclusion drawn from looking at the
wrong side of the link. The snapshot points back:

```
preview_snapshots.metadata.promptExecutionId  ==  prompt_execution_logs._id
92cca1b5-7cdd-42ee-978a-a44c14e7d201          ==  92cca1b5-7cdd-42ee-978a-a44c14e7d201   ✓ verified
```

One hop, no ambiguity, and pointing the correct way: the generate route cannot know a snapshot id
because the client writes the snapshot afterwards, so the reference belongs to the snapshot. Nothing
to add. The only cost is that it is nested inside `metadata` rather than being a first-class field,
which makes it easy to miss — as it just was.

---

## 5. What to do

| # | Action | Why |
|---|---|---|
| 1 | **Collapse the artifact to one authority** (WP1) | §2 — the only measured correctness defect. Remove the reads first, then the write, then the field; never the reverse |
| 2 | `assetId` on `vibe_intakes.attachments[]`, filled once the upload produces a `ProjectAsset` | Closes the path from session to downloadable file. The intake keeps recording what the user *submitted*; the id links it to what was *stored* |
| 3 | Nothing for the journal→artifact link | It already exists and is verified; promoting it out of `metadata` is cosmetic |
| 4 | Leave the brief triplication alone | §3 |

Explicitly **not** doing: deduplicating attachment *content* across sessions by hash to skip
re-analysis. Tempting, and rejected — the same file analysed by a different model, or in a different
project context, is a different analysis, and silently reusing a previous one would make two runs
that look identical actually be different. Reference attachments; do not optimise them.

---

## 6. What this implies for the prompt inspector

The UI superstructure follows from the data rather than being designed against it. Three blocks,
each rendered only when the session produced it:

**Vibe** — the prompt as typed (`vibe_intakes.prompt`), the attachments with a download link (needs
§5.2), the model override if any. Then the classify call: rendered prompts, raw reply, endpoint,
cost.

**Zero Effort** — the prefill call, and beside it the two sides of the decision: what the model
proposed (`zero_effort_form_proposals.prefilled`) and which fields the user changed. Then the
deterministic brief with its `contentHash`, plus `sourceFields` — the nineteen fields it was derived
from.

**Artifact generation** — the `generate` call with its full layered system prompt (the inspector can
already split it by `PF_LAYER` markers, and `assertPromptTraceParity` guarantees those spans are the
bytes that went on the wire), the raw reply, and the artifact reached through `preview_snapshots.metadata.promptExecutionId`, which already points
back at that exact row.

Every block reads from `prompt_execution_logs` for the call detail and from its own mode object for
the human-facing input. Nothing in the UI needs a new shape: the components select from one session
export.
