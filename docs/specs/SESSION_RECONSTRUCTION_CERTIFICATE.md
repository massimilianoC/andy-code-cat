# Session Reconstruction — Certificate

**What this document is.** Not a design and not a plan: a **checkable claim**. It states exactly what
must exist in the database after one real session, so that anyone can open Mongo and confirm the
history is complete — or find the precise hole.

The user interface is out of scope. The claim is about the database and nothing else: if the data is
there and joins up, the tool works, whether or not anything renders it yet.

Companion: `WORK_SESSION_TRACING_SPEC.md` (the design), `SESSION_TRACING_EXECUTION_PLAN.md` (the
work).

---

## 1. The chain that must be recorded

One user intent, from typing in Vibe to holding an artifact:

```
user types a prompt, maybe attaches a file
   └─ WorkSession opens                                    work_sessions
      ├─ the intake as submitted                           vibe_intakes
      ├─ classify: prompt sent, JSON returned              prompt_execution_logs
      ├─ prefill:  prompt sent, 19-field JSON returned     prompt_execution_logs
      │  └─ what the prefill proposed, and what changed    zero_effort_form_proposals
      ├─ the confirmed form → the brief                    pipeline_runs.canonicalBrief
      ├─ the generation, its locked model, its stages      pipeline_runs
      │  └─ generate: layered prompt sent, raw reply       prompt_execution_logs
      ├─ every cost incurred                               cost_transactions
      └─ the artifact                                      preview_snapshots
```

Every row above must carry `workSessionId`. That single id is what turns nine collections into one
history.

---

## 2. What each row must contain

A row that exists but cannot answer its question does not satisfy this certificate.

### `work_sessions` — exactly one per intent
`userId`, `entryMode` (`vibe` | `zero-effort` | `workspace`), `status`, `createdAt`. `projectId` once
a project exists. No prompt, no attachments, no model: it is a certificate of identity, and the
payload belongs to the mode objects.

### `vibe_intakes` — what the user actually submitted
The prompt **verbatim** as typed, attachment references (ids, never bytes), the model override if one
was made, `generationMode`, `options`. Plus `promptExecutionLogIds` naming the calls it produced.

Written **before** classify dispatches, so a request that dies early still proves it was made.

### `prompt_execution_logs` — one row per LLM call, no exceptions
`workSessionId`, `pipelineRunId`, `pipelineStage`, `endpoint` (the URL actually POSTed to),
`provider`, `model`, `renderedSystemPrompt`, `renderedUserPrompt`, `rawResponse` (before any parsing
or repair), `finishReason`, `reasoningTrace` when the call was cut off, `usage`, `durationMs`,
`status`.

Written **pending before dispatch**, completed after. A row that appears only on success cannot
explain a call that never came back — which is the failure this whole programme started from.

### `zero_effort_form_proposals` — the model's suggestion and the human's decision
`prefilled` (the 19 fields as proposed), `editedFields` (what the user changed),
`prefillPromptExecutionLogId`, `briefContentHash`.

The confirmed form is **not** here: `pipeline_runs.canonicalBrief.sourceFields` already owns it.

### `pipeline_runs` — one per generation
`workSessionId`, `entryMode`, `modelLock` (what was actually dispatched), `stages[]` in order each
naming its `promptExecutionId`, `canonicalBrief` with `content`, `contentHash` and `sourceFields`.

### `cost_transactions` — one per paid call
Addressable back to its `promptExecutionId`, carrying the rate snapshot used.

### `preview_snapshots` — the artifact
The single authority for artifact bytes. Nothing else stores them.

---

## 3. The certificate: eight questions the database must answer

Run one real Zero Effort session with an attachment, take its `workSessionId`, and answer these from
Mongo alone. Each is pass or fail; there is no partial credit.

| # | Question | Passes when |
|---|---|---|
| 1 | What did the user type, and what did they attach? | `vibe_intakes` has the verbatim prompt and the asset ids |
| 2 | What did we ask the classifier, and what did it answer? | a `prompt_execution_logs` row, stage `vibe_classify`, with both rendered prompts and `rawResponse` |
| 3 | What did we ask the prefill, and what JSON came back? | same, stage `vibe_prefill` |
| 4 | Did the user accept the prefill or overrule it? | `zero_effort_form_proposals` has `prefilled` and a populated `editedFields` |
| 5 | Which brief was generated, and from which fields? | `pipeline_runs.canonicalBrief` with `content` and `sourceFields` |
| 6 | What exact prompt produced the artifact, and what came back raw? | a row, stage `generate`, with `renderedSystemPrompt` and `rawResponse` |
| 7 | Where did every request actually go? | every row in the session has a non-null `endpoint` |
| 8 | What did the session cost, call by call? | every paid call resolves to a cost row |

**The binding condition:** all eight answerable **starting only from the `workSessionId`**. If any
requires guessing, correlating by timestamp, or joining on something other than that id, the
certificate fails.

### The verification query

```js
const db = db.getSiblingDB("andy-code-cat");
const ws = "<workSessionId>";
["vibe_intakes","zero_effort_form_proposals","pipeline_runs","prompt_execution_logs","cost_transactions"]
  .forEach(c => print(c.padEnd(28) + db.getCollection(c).countDocuments({ workSessionId: ws })));
db.prompt_execution_logs.find({ workSessionId: ws }, {
  pipelineStage:1, model:1, endpoint:1, finishReason:1, status:1, durationMs:1,
  "usage.totalTokens":1
}).sort({ createdAt: 1 }).forEach(printjson);
```

A zero in the first block is a hole. A null `endpoint` in the second is a hole. A stage missing from
the expected sequence — `vibe_classify`, `vibe_prefill`, `generate` — is a hole.

---

## 4. Holes — closed 2026-09-02

All five are closed in code. What each one turned out to need:

| Hole | Closed by |
|---|---|
| nothing wrote `vibe_intakes` | repository + write in the classify handler, **before** dispatch |
| nothing wrote `zero_effort_form_proposals` | repository + write when prefill returns; `editedFields` filled at launch, the first moment both sides of the comparison exist |
| `PipelineRun` took `workSessionId` but no caller passed it | threaded through `CreatePipelineRunInput` → `LaunchWorkspacePipeline` → the launch route |
| the launch routes did not join the session | `createWorkSessionMiddleware` mounted on all three handlers; `reuseOrOpen` on launch |
| `cost_transactions` carried no session id | explicit `workSessionId` on `CostSourceRef`, passed from the Vibe call sites |

Two decisions worth recording, because both were forced by reality rather than chosen:

**`VibeAttachmentRef.assetId` became optional.** At Vibe intake the classifier receives
`AttachmentMeta` — filename, mime type, size — describing files that become `ProjectAsset` rows only
later. Demanding an id there would have meant inventing one or dropping the attachment from the
record. The metadata still answers what the user attached, which is the question.

**Proposals order by `$natural`, not `createdAt`.** A test caught this: two proposals recorded in the
same millisecond share a timestamp, the tie resolves arbitrarily, and the user's edits get attributed
to a suggestion they never saw. Insertion order is stable for documents that are only inserted and
updated in place.

### Still not verified against a live run

The code is in place and 685 tests pass, but **no real session has been run through it yet** — the
API container is still serving an image built before this work. Until the query in §3 is run against
a session generated from the UI, this document certifies an intention, not an outcome. That run is
the next step and nothing downstream should be trusted before it.

## 5. Why this comes before parallelising anything

The fan-out experiment asks whether removing layers or splitting the work lowers cost and raises
quality. Replaying a session whose history has holes measures the holes, not the change. So the
certificate is not a preliminary to that work — it is the instrument the work depends on.
