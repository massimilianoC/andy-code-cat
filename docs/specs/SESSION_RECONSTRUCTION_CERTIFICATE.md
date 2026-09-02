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

## 4. Known holes, as of 2026-09-02

Recorded so the certificate is honest about what it does not yet certify.

| Hole | Consequence |
|---|---|
| `vibe_intakes` has no repository — nothing writes it | question 1 fails |
| `zero_effort_form_proposals` has no repository — nothing writes it | question 4 fails |
| `PipelineRun` accepts `workSessionId` but no caller passes it | questions 5 and 8 cannot be reached from the session id |
| The guided/workspace launch routes do not join the session | the second half of the chain is orphaned |
| `cost_transactions` rows carry no `workSessionId` | question 8 fails |

Questions 2, 3, 6 and 7 already pass — classify, prefill and generate all journal, and all record
their endpoint.

Closing these five is what makes this document a certificate rather than an aspiration.

---

## 5. Why this comes before parallelising anything

The fan-out experiment asks whether removing layers or splitting the work lowers cost and raises
quality. Replaying a session whose history has holes measures the holes, not the change. So the
certificate is not a preliminary to that work — it is the instrument the work depends on.
