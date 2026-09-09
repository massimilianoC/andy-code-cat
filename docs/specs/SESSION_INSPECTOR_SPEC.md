# Session Inspector — consolidated spec

**Feature B.** Supersedes the scattered notes in `SESSION_TRACING_EXECUTION_PLAN.md` WP5 and
`SESSION_REDUNDANCY_ANALYSIS.md` §6, which stay as background. This is the document to implement
from.

---

## 1. What it is

The project's existing Prompt view becomes a history of how the artifact came to exist, in three
collapsible blocks:

```
▸ Vibe            what the user typed, what they attached, what the classifier decided
▸ Zero Effort     the form as filled, what the model proposed vs what the user changed, the brief
▾ Generation      the layered prompt, the raw reply, the artifact          ← open by default
▸ Conversation    the turns sent after the generation, and that turn's own layers
```

**Amended 2026-09-09.** This section originally named three blocks, and said the existing Prompt
view *becomes* this history. The flat section it was meant to replace was left standing beneath the
panel instead, so the view showed two stacks of prompt layers: the generation's, inside Generation,
and the current turn's, loose at the bottom. They read as a duplicate and are not one — after a few
chat turns the current turn's system prompt is no longer the generation's.

Conversation absorbs that section. The transcript is its content; the current turn's layers sit
above it as a collapsed accordion, because deleting them would make "exactly what was sent" —
the one thing Rule Zero exists to keep knowable — unknowable for every turn after the first.

Unlike the other three, Conversation renders from state the workspace page already holds, not from
the work-sessions endpoint. It therefore does NOT participate in the detail fetch gate of §5.5:
opening it must not trigger a fetch it has no use for.

**A block appears only if the session produced it.** A project created directly in the workspace has
no Vibe block and no Zero Effort block, and rendering empty ones would teach the user that the panel
lies.

**Generation is open, the others are collapsed.** The user's question is almost always "what just
happened"; the earlier steps are there to open backwards when the answer is not there.

Each block shows its own cost.

---

## 2. The data, and the one endpoint that serves it

Everything below already exists in the database. Nothing new is written for this feature.

| Block | Reads |
|---|---|
| Vibe | `vibe_intakes` (prompt verbatim, attachments, model override) · the `vibe_classify` journal row |
| Zero Effort | `zero_effort_form_proposals` (`prefilled`, `editedFields`) · the `vibe_prefill` row · `pipeline_runs.canonicalBrief` (`content`, `contentHash`, `sourceFields`) |
| Generation | the `generate` row (both rendered prompts, `rawResponse`, `finishReason`, `endpoint`, `usage`, `contextAssetIds`) · the artifact via `preview_snapshots.metadata.promptExecutionId` |
| Every block | `cost_transactions` filtered by `sourceRef.workSessionId` and `sourceRef.promptExecutionLogId` |

### The endpoint

**`GET /v1/projects/:projectId/work-sessions`** — the sessions of a project, newest first, each with
enough to render a collapsed summary: id, `entryMode`, `status`, `createdAt`, the stages it contains,
total cost, total duration.

**`GET /v1/projects/:projectId/work-sessions/:workSessionId`** — one session in full: the intake, the
proposal, the pipeline runs with their `canonicalBrief`, every journal row with its prompts and raw
reply, and the cost rows.

One endpoint per view, not one per block. `apps/api/src/scripts/session-export.js` already assembles
exactly this shape from Mongo and is the reference for what to return — read it before designing the
DTO.

**Size matters here.** A single session's rows carry ~50,000 chars of system prompt each. The list
endpoint must not include prompt bodies; the detail endpoint may, and the client must not fetch it
until a block is expanded.

---

## 3. What each block renders

### Vibe
The prompt **exactly as typed** (`vibe_intakes.prompt` — not a rendered prompt, not an excerpt).
Attachments as a list with name, type and size; where an `assetId` exists, a download link. The model
override if the user set one. Then the classify call: its rendered prompts, its raw reply, its
endpoint, its cost.

### Zero Effort
The nineteen fields as submitted — from `canonicalBrief.sourceFields`, which already owns them.
Beside them, **what the model proposed** (`prefilled`) with the fields the user changed marked
(`editedFields`). This is the only place in the product that can show the difference between the
machine's suggestion and the human's decision.

Then the brief, with its `contentHash` visible — it is the certificate that this text is the one that
was sent.

### Generation
The layered system prompt, **split by its `PF_LAYER` markers** into the layers it is made of. Do not
write a new parser: the markers are `<!-- PF_LAYER id=X key=Y -->` … `<!-- /PF_LAYER id=X -->`, and
`assertPromptTraceParity` throws unless those spans are byte-identical to what went on the wire — so
the panel is displaying verified bytes rather than a reconstruction.

Then the raw reply before parsing, `finishReason`, the endpoint, tokens, cost, and the artifact.

**A truncated call must be visible in the collapsed row**, not only after expanding. `finishReason:
"length"` is the failure this whole programme exists to make visible, and burying it one click deep
would reproduce the original defect in a new place.

---

## 4. Defects to fix inside this work

Folded in here because fixing them separately means touching the same components twice.

**The assistant's reply is missing from the sent-history panel.** Half-diagnosed: it *is* in the
payload — `page.tsx:2132-2137` maps assistant turns into the history, compacted to
`chatStructured.summary` plus bullets, or raw content when there is no structured reply. The payload
is right and the panel does not show what the payload contains, so the defect is in the display.

**A large code block fragments into many accordions.** Reported twice, **not reproduced** — the
rendering component was not located. Reproduce it before writing a fix; a rendering fix written blind
fixes the wrong thing.

**Cost per step.** The data supports it already: every journal row carries its own `costEstimate` and
every cost row now carries `workSessionId`. Show it per block rather than building a separate cost
panel, which would answer the same question in a second place.

**The header cost lags one refresh.** This one belongs to **WP2**, not here — once cost is one
referential record the header aggregates on `workSessionId` instead of recomputing at page load, and
the staleness disappears as a consequence. Do not patch it in this work.

---

## 5. Constraints

1. **Read-only.** This feature writes nothing. If an implementation needs a new field, the design is
   wrong — the data was made complete first precisely so this could be pure presentation.
2. **One fact, one owner.** Render from the owner listed in §2. The brief comes from
   `canonicalBrief`, not from the generate prompt that contains a copy of it.
3. **Reuse the layer splitting.** `PF_LAYER` markers, not a new format.
4. **It collides with WP1.** Both rewrite `apps/web/app/workspace/[projectId]/page.tsx`. They run in
   sequence, never in parallel, and WP1 goes first — it is a live correctness defect (the artifact
   has two disagreeing sources, measured at 2,181 chars apart) and this feature will otherwise be
   rewritten around code that is about to change.
5. **Do not fetch prompt bodies until expanded.** §2.

---

## 6. Acceptance

For a project generated end to end through Vibe → Zero Effort → artifact:

1. three blocks appear, Generation open, the other two collapsed;
2. a workspace-only project shows the Generation block alone, with no empty placeholders;
3. the Vibe block shows the prompt byte-identical to `vibe_intakes.prompt`;
4. the Zero Effort block marks at least one field as changed when the user edited the prefill, and
   marks none when they accepted it;
5. the Generation block splits the system prompt into its layers, and the sum of the layer spans is
   the whole prompt with nothing dropped;
6. a run with `finishReason: "length"` is marked as truncated **in its collapsed row**;
7. each block shows a cost that sums to the session total;
8. opening the page fetches no prompt bodies; expanding a block fetches that block's.

Criterion 5 is the one that proves the panel is showing what was sent rather than what someone
believes was sent.
