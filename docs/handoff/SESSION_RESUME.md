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

## 4. Both features are built, deployed and smoke-tested

The local stack runs this code. api tsc clean · **695 api tests** · **62 web tests** · web tsc clean.

### Session inspector — DONE
Three collapsible blocks in the workspace Prompt view, rendered only when the session produced them,
Generation open by default. System prompt split by its existing `PF_LAYER` markers, with a test
proving the segments reconstruct the original string exactly. Truncation visible in the collapsed
row. No prompt bodies fetched until a block is expanded.

Backed by `GET /v1/projects/:id/work-sessions` (list, no bodies) and `…/:workSessionId` (detail).
Verified live: list returns the session with its stages and cost, detail returns intake, proposal,
run, four journal rows with their prompts, and cost rows. A session belonging to another user
returns nothing — ownership scoping confirmed by querying one.

`WorkSessionDetailDto.artifacts` carries artifacts **by reference** (snapshot id, the journal row
that produced it, sizes) — `preview_snapshots` owns the bytes.

### Interrupted-run recovery — DONE
Two loss points, one destination. A prefill that breaks offers a modal that carries the whole
recovered context into project mode; the workspace loads it into the composer, removing the storage
key first so a reload cannot replay it. Prefilled and deliberately not auto-sent.

`VibePrefill` now keeps its reasoning trace — it counted reasoning tokens and threw the text away.

Cancelling the modal deletes the project, so a failure never survives as a dashboard entry. Escape
and the backdrop do not dismiss: with no "later", dismissing would have to mean one of two acting
choices.

### The SSOT audit before deploying found one violation, now fixed
Two project deletions had appeared. `DeleteProject` removed only the project row and its moodboard,
orphaning the journal, costs, conversations, sessions and runs on **every dashboard delete**;
`DiscardPendingProject` did the thorough version beside it. Consolidated: one deletion, fully wired
in both routes, with discard keeping only the guard and the counts.

Verified single-owner: prompt composition + parity (`promptTraceParity` ← `llmRoutes`), journal
writing (one repository), and the recovery makes no LLM call of its own.

### Stale defect, corrected
"The assistant reply is missing from the sent-history panel" was already fixed by `bf3fb10`
(26 Aug) — `PromptTranscriptView:223-224` renders assistant turns with their own label and accent.
It was almost certainly being observed on a 27-hour-old container image.

### Still open
The accordion fragmenting a large code block — reported twice, never reproduced, component never
located. Do not fix it blind. WP2 (cost as one referential record, which also fixes the header cost
lagging one refresh). The `vibe_intakes.attachments[] → project_assets` link.

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
