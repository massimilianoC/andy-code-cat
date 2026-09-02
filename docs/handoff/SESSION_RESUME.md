# Session Resume — prompt certification, and what comes next

**Read this first if you are picking up cold.** Everything here was established by reading code or
running things; where a number appears, it came from a measurement.

Branch: `feat/parallel-section-generation`, off `develop`. **Nothing is pushed** — see §6.

---

## 1. The thread, in one paragraph

A ten-section deck generated with GLM-5.3 took 10m 29s, stopped at exactly 32,768 completion tokens —
a provider cap, not a model finishing — and was journalled as `succeeded` while the deck was visibly
incomplete. Chasing that produced two lines of work: make the pipeline record what it actually does,
and find out whether splitting generations makes them faster. The first is **done and verified
against a live run**. The second turned out to depend entirely on *which* stage you split.

---

## 2. Findings that cost real effort — do not re-derive these

| Finding | Evidence |
|---|---|
| The failing run: 32,768 completion tokens, 629,546 ms, `succeeded`, 13,938 prompt tokens | `prompt_execution_logs` doc `f51ee098…` |
| Its 47,021-char system prompt by layer | A 7,667 · L 370 · B 1,532 · S 5,251 · C 11,915 · D 3,262 · E 12,274 · **P 4,750** |
| Layer P spends 4,750 chars asking for brevity, and the run hit the cap anyway | prose asks, structure enforces |
| **The prompt inspector cannot lie on `generate`** | `promptTraceParity.ts:15` throws unless the wire matches what it shows, layer spans included |
| `enable_thinking:false` is honoured by SiliconFlow and ignored by OpenRouter | so every OpenRouter measurement is the fan-out *without* the reasoning split |
| Artifact fan-out **works**: 8.7× faster, 18% cheaper, 7/7 criteria | `PARALLEL_SECTION_GENERATION_SPEC.md` §9bis |
| Prefill fan-out **does not**: slower, 2-5× costlier, fields lost | `PREFILL_PARALLELISATION_FINDINGS.md` |
| The same monolith call measured **104.5 s and 298.2 s** on identical input | why N calls exposed to the maximum is a bad trade |
| The artifact exists in three places and **they disagree** by 2,181 chars | `SESSION_REDUNDANCY_ANALYSIS.md` §2 — the only live correctness defect |
| 98 of 156 projects carry no snapshot at all | upper bound on failures; includes never-launched drafts |

---

## 3. What is built and verified

The journal now records every LLM call in the product: both rendered prompts, the raw reply before
parsing, the endpoint actually called, `finishReason`, cost, and the session it belongs to.

**Certificate passed live** (`SESSION_RECONSTRUCTION_CERTIFICATE.md`): session
`931a3cc0-6690-4be9-9efa-888f87837949`, all eight questions answered from one `workSessionId`, six
collections joined by that id. Two provider failures recorded *with the provider's own words*, which
is precisely what used to vanish.

Key commits: `6a862f4` (Zero Effort journalling) · `e1a7d0b` `08fbc13` (WorkSession as a certificate,
VibeIntake, ZeroEffortFormProposal) · `e2f569e` (session opened and carried by request) · `18fb11f`
(the last five silent call sites, four parallel agents) · `58aa21a` (certificate holes closed) ·
`7af5709` (one intent one session) · `bfded0f` (live verification) · `1d22600` (interrupted runs keep
their partial answer and reasoning) · `2a13370` (generate names the documents that shaped it) ·
`5245029` (dashboard copies the real prompt, not the template).

Suite: **687 passing**, tsc clean on api and web. The local stack runs this code.

---

## 4. Where the two features stand

Session ended on credits, agents stopped mid-flight. The tree is green: api tsc clean,
**695 tests**, web tsc clean.

### DONE — WP1, the artifact SSOT violation
Four commits in the order its spec demanded: `714d5a6` (snapshot committed before the assistant
message can reach state — the window the fallback existed to paper over), `340f69c` (reads removed),
`f5798fd` (write removed), `af45782` (field removed). `generatedArtifacts` now survives only in the
comments explaining why it is gone. This was the only measured correctness defect.

### DONE — the inspector backend
`GET /v1/projects/:projectId/work-sessions` (list, no prompt bodies) and `…/:workSessionId`
(detail, with them). 404 not 403 for another user's session. 8 tests. See
`docs/handoff/INSPECTOR_BACKEND_PROGRESS.md`.

Its DTOs live in the use cases rather than `packages/contracts`, chosen to avoid colliding with two
concurrent agents. **Promote them into contracts before the frontend mirrors the shape**, or they
become a second declaration of the same thing.

### NOT DONE — the inspector frontend
`SESSION_INSPECTOR_SPEC.md` is the document to implement from; the endpoints it needs now exist. This
is the next piece of work and it is unblocked.

### PARTIAL — Zero Effort recovery
Backend groundwork landed: `GetZeroEffortRecoveryStatus`, `DiscardPendingProject`, `recoveryRoutes`,
`packages/contracts/src/recovery.ts`, and `resumedFromPromptExecutionId` on the journal row. **The
modal did not.** Nothing calls those routes, so behaviour is unchanged — it is scaffolding waiting
for a front end. `INTERRUPTED_RUN_RECOVERY.md` §3bis is the constraint that decides its shape.

### Known limitation, not introduced by this work
`ICostTransactionRepository.findBySourceRef` caps at 50 rows, so a session with more than 50 cost
rows would undercount its total. Not hit by current data.

## 5. Tools that exist

- `apps/api/src/scripts/session-export.js` — dumps a whole session to one JSON, and reports how much
  of it the session id alone can reach. That coverage number found two real gaps.
- `apps/api/src/scripts/fanout-probe.ts` — section fan-out against a live provider, `FANOUT_DRY_RUN=1`
  prints the exact prompts without spending.
- `apps/api/src/scripts/prefill-fanout-probe.ts` — replays a recorded prefill and compares strategies.

---

## 6. Blockers, none of them code

- **Nothing is pushed.** `git push` cannot authenticate from the agent shell (Git Credential Manager
  wants a browser, no `gh`, no `GITHUB_TOKEN`). Also pending from earlier:
  `fix/model-selection-ssot-consolidation`, `docs/gitflow-template-hardening`.
- **SiliconFlow returns 402**, so the reasoning-split half of the artifact fan-out is still unmeasured
  — it is the only provider that honours `enable_thinking:false`.
- `.env.docker` holds `OPEN_ROUTER_API_KEY` (underscore spelling); that is how every live probe ran.
