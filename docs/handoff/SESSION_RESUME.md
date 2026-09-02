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

## 4. The two features to build next

Both are specified. Neither is started.

### A — Interrupted run recovery · `INTERRUPTED_RUN_RECOVERY.md`

Prerequisite is **built**: an interrupted run now keeps its partial answer and its reasoning trace.
The feature is the offer to the user — a modal on a broken Zero Effort run stating how many tokens of
work already exist, with *retry with this model*, *retry with a different one*, or *discard the
project*.

Deliberately narrow: **project mode already has recovery** — the workspace has a chat and a model
picker, so typing "riprova" already resumes with history. Zero Effort has neither, and that is the
whole gap. The spec carries the four decisions to make first.

### B — The session inspector · `SESSION_TRACING_EXECUTION_PLAN.md` WP5 + `SESSION_REDUNDANCY_ANALYSIS.md` §6

Three collapsible blocks — **Vibe**, **Zero Effort**, **Artifact generation** — each rendered only
when the session produced it, each with its own cost. The data is complete; only the surface is
missing. §6 of the redundancy analysis describes what each block reads.

**Before handing this to an agent, consolidate it.** It is currently specified across two documents
plus scattered notes, and an implementer would have to assemble the spec before writing any code.

Also folded into WP5 and worth doing there rather than separately: the header cost lagging one
refresh (belongs to WP2), per-step cost inspection, the assistant reply missing from the sent-history
panel (half-diagnosed — it *is* in the payload at `page.tsx:2132-2137`, so the defect is in the
display), and the accordion fragmenting a large code block (**not reproduced** — needs to be seen).

### Still open elsewhere

**WP1**, the artifact SSOT violation — the only measured correctness defect, and it edits the same
workspace page WP5 rewrites, so decide which goes first. **WP2**, cost as one referential record.
The `vibe_intakes.attachments[] → project_assets` link, so a session can reach a download.

---

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
