# Session Resume — the model you choose is the model that runs

**Read this first if you are picking up cold.** Everything here was established by reading code or
running things against the live stack; where a number appears, it came from a measurement.

Branch: `feat/parallel-section-generation`, off `develop`. **Nothing is pushed** — see §7.

---

## 1. The thread, in one paragraph

"Didactic mode says fetch failed" turned out to be an expired TLS certificate on the configured
provider. Fixing the provider surfaced the real problem underneath: the didactic generation was
running on a model nobody had chosen, priced at a flat rate while the provider had reported the
actual cost, and the reason it picked that model was that **the superadmin catalog was silently
destroying the operator's configuration on every read**. Chasing that one thread closed nine
defects, four of them user-visible, and produced one architectural rule that now governs the whole
pipeline: *the model the user selects is the model every user-initiated request uses.*

---

## 2. Findings that cost real effort — do not re-derive these

| Finding | Evidence |
|---|---|
| SiliconFlow's cert for `api.siliconflow.com` expired **Sep 7 10:12:23 GMT**; first failure 10:51:27 | `tls.connect` from inside the api container |
| It has since been replaced (valid to Dec 2026) but **completions still 402** | `{"code":30001,"message":"Sorry, your account balance is insufficient"}` — `/v1/models` is free and returns 200, which is what makes this look fixed |
| `api.siliconflow.cn` is **not** a fallback | same key → `401 "Api key is invalid"`; the key is region-bound |
| **Hydration destroyed 6 of 7 role defaults on every read** | Mongo said 7 role defaults, `GET /v1/admin/llm-registry` returned 1, both `quality_check` |
| The superadmin activation toggle **never survived a round trip** | write landed (`isActive=true` in Mongo), same response and every later GET said `false` |
| Cause: the live-model cache is keyed `provider\|baseUrl\|hasAuth` — curated state is not in the key | three consecutive GETs: 57/34/46 ms vs ~900 ms for real discovery |
| **Setting a model as default was a silent no-op** | `normalizeModels` kept the FIRST `isDefault`; `upsertModel` appends the edited record LAST |
| `LLM_DEFAULT_MAX_COMPLETION_TOKENS=167000` breaks any model with a smaller window | `400 maximum context length is 128000 … you requested about 167515 (167000 in the output)` |
| Didactic generation really costs ~EUR 0.022 and uses 4,348–6,076 completion tokens | measured runs; the 16,000 ceiling is set from these |
| The optimizer honoured a model override **without ever checking catalog membership** | `gateOverrideOnOpenAiCompatible` checked only `apiType`; its `false` branch was `Boolean(requestedModel)` — no verification in either branch |
| OpenRouter dropped `minimax/minimax-m3:free` mid-session (430 → 428 live models) | not a regression; hydration correctly stops presenting it as active |
| `sessions` and `execution_logs` must **not** be cascaded on project delete | auth state, and a 90-day audit trail documented to survive the actions it records |

---

## 3. What is fixed and verified

Thirteen commits. Suite: **97 files / 737 tests**, tsc clean on api, web and contracts. The local
deploy stack runs this code.

### The catalog now tells the truth — `372c476`, `d776bff`
Hydration keeps one default **per role**, matching what storage has always written; the three
mutating admin routes clear the live cache and re-read with `forceRefresh`. The duplicate-default
tie-break is last-wins, so the operator's own choice survives the write that made it.

Verified live with the same script before and after:

```
before   openrouter  isDefault=1 [quality_check]   toggle: false / false
after    openrouter  isDefault=3 [quality_check,dialogue,vision]   toggle: true / true
         openrouter dialogue default -> openai/gpt-4o-mini
```

### One costing model, and Didactic follows it — `f3685e1`
`resolveLlmCallCost` owns the three pricing steps that were hand-written at six call sites. Didactic
skipped steps 1 and 2 entirely: it never read `usage.cost`, billed at flat rate, recorded
`providerCostUsd: 0`, and returned a hardcoded `{ providerCostEur: 0, totalEur: 0 }` to the panel.

```
before   source=flat-rate  providerCostUsd=0        EUR 0.024585   panel showed 0
after    source=provider   providerCostUsd=0.0220248 EUR 0.022289  journal = ledger = panel
```

### The selected model is the model that runs — `372c476`, `efb3b32`, `2694c75`
An audit of all seven model-resolution call sites found the rule already implemented in four —
`VibeClassify`, `VibePrefill`, `ResolvePipelineModelLock` share the idiom
`policy: (chose) ? "strict" : "legacy"`, and `ResolvePromptExecution` verifies against the catalog.
Didactic and the optimizer were the two exceptions; both now refuse an unresolvable choice with
`409 SELECTED_MODEL_UNAVAILABLE` naming the model, rather than substituting in silence.

The rule, for every future change: **a user-initiated request uses the user's current selection.
Only background tasks the superadmin configures may differ.**

### Evidence instead of verdicts — `0118858`, `88f7352`
`describeGeneratedJavaScriptSyntaxError` reports line, column and the offending source line.
`describeError` walks the cause chain, so `fetch failed` became
`fetch failed <- CERT_HAS_EXPIRED: certificate has expired` — the answer was one dereference away
at every logging site.

### Project deletion stops leaving orphans — `40baf50`
Nine collections added, files on disk and MinIO removed through the existing single-item primitives.
`project_assets` excludes `scope: user|global` so the reusable library survives.

### Didactic tracing and parsing — `ded0994`, `6579006`, `14926bd`
`pipelineRunId` carried end to end; `parseDidacticJson` uses the shared five-strategy repair chain
(the gap was **candidate selection**, not repair capability: prose before the JSON plus a truncation
made both old candidates `null`); the completion budget is clamped to 16,000.

---

## 4. Behaviour changes an operator will notice

1. **The dialogue default is now in force.** `openai/gpt-4o-mini` for openrouter — what was
   configured in Mongo all along. Change it from the admin console; the toggle works now.
2. **A model that is not in the catalog stops the request** with a 409 instead of quietly running
   something else. This is on the busiest path (auto-optimize runs on every message).
3. The admin editor shows a "Default for {role}" badge and disables the toggle when unchecking it
   would only be reverted.

---

## 5. Verified against the live stack, and what was not

Verified: the admin round trip (write → read → render), didactic generation end to end on a real
provider, the cost row matching journal and ledger, the optimizer accepting a valid selection
(`200`) and refusing an invalid one (`409`, no dispatch), and the failure row naming the model
actually requested — `openrouter / definitely/not-real`, where it used to record
`siliconflow / MiniMaxAI/MiniMax-M3`.

One methodological note worth keeping: that last check first appeared to fail. The container image
was sixteen minutes older than the commit, so the measurement was taken against code that did not
contain the fix. **Compare `docker image inspect andy-code-cat-api --format '{{.Created}}'` against
the commit timestamp before trusting any live verification here** — a background rebuild that has
not landed looks exactly like a fix that does not work.

**Not verified live:** `pipelineRunId`. The wiring compiles and is complete, but no test exercises
it — the e2e specs call the API directly without it. It is only observable by using Didactic mode
from the UI after entering through a pipeline handoff.

A coherence pass checked three regression risks and found the first two clean (no spurious 409;
the role-less `find(isActive && isDefault)` consumers still resolve the same model as before) and
`normalizeModels` running only on writes. It found one real defect — a refused optimization
journalling the hardcoded fallback constants instead of the model asked for — fixed in `2694c75`.
**That defect was found by reading rows a live check produced, not by a failing test.**

---

## 5bis. The release gate is RED — read this before deploying

`tests/e2e/release-smoke-three-modes.spec.ts` is the repo's own pre-release gate. Run on
2026-09-09 for the first time: **VIBE and ZERO EFFORT pass and both reach a real artifact.
PROJECT MODE fails.**

One cause was found and fixed (`16fe15f`): the test clicked a project *card* instead of the mode
pill, because `hasText` is a case-insensitive substring match and the bot account now owns twelve
projects, one named "Default Project". Proven from the page snapshot Playwright saves on failure.

**A second cause remains and is not identified.** After the selector fix the run gets materially
further — 1 minute to the full 5-minute generation timeout — but still no `POST /v1/projects`
reaches the API. Nothing on this branch touches `handleProjectMode` (`VibeCoreEntry.tsx:361`), and
the other two modes exercise the same launch endpoint successfully, so the evidence does not
implicate the product path. It is not proof that the product is fine.

Do not read a green suite as a green release: the unit suites and the didactic e2e all pass while
this gate is red.

---

## 6. Still open

- `preview_snapshots` thumbnails are not deleted with the snapshot (pre-existing, not made worse).
- `LLM_DEFAULT_MAX_COMPLETION_TOKENS=167000` is still read raw by `llmMessageBuilder.ts:56`.
  `.env.docker` was deliberately not modified — that is an operator decision.
- The accordion fragmenting a large code block: reported twice, never reproduced, component never
  located. **Do not fix it blind.**
- WP2: cost as one referential record (also fixes the header cost lagging one refresh).
- `vibe_intakes.attachments[] → project_assets` link.
- Auto-optimize does not re-enable after the first artifact when the snapshot was refused:
  `page.tsx:2713` gates `restoreAutoOptimizeAfterAutomatedArtifact()` on `previewVersionSaved`.

---

## 7. Environment and blockers

- **Nothing is pushed.** `git push` cannot authenticate from the agent shell (Git Credential Manager
  wants a browser; no `gh`, no `GITHUB_TOKEN`). Also pending:
  `fix/model-selection-ssot-consolidation`, `docs/gitflow-template-hardening`.
- **SiliconFlow is unusable** (402, no balance). OpenRouter is the only working provider; every user
  in the database still has `llmPreferences.defaultProvider: siliconflow` except the two moved this
  session (`superadmin@andy-code-cat.local`, `bot@andy-code-cat-e2e.invalid`).
- `.env.docker` holds `OPEN_ROUTER_API_KEY` (underscore spelling).
- A **test superadmin** was left in the local database: `sa-e2e@andy-code-cat.local`, created
  through the real `/v1/auth/register` flow and promoted by setting `roles` only. Delete it when it
  is no longer useful.
- Local stack is the **deploy** compose file. Update services with
  `docker compose -f docker-compose.deploy.yml up -d --no-deps api web`, never the dev file.

## 8. Tests worth running before a release

```bash
cd apps/api && npx vitest run                                  # 97 files / 737 tests, ~11s
npx playwright test tests/e2e/didactic-knowledge.spec.ts       # real provider, ~25s
npx playwright test tests/e2e/release-smoke-three-modes.spec.ts # VIBE / ZERO EFFORT / PROJECT
```

The e2e specs spend real money and use the bot account, which now points at OpenRouter. Half of
`tests/config/authorized-test-models.json` lists SiliconFlow models that cannot run today.
