# Test Coverage Roadmap

**Status:** Living document — update the checklist as items land.
**Companion to:** `docs/guides/TESTING_POLICY.md` (how we test) — this document is what to test
and in what order.

## 1. Why this exists

Several non-negotiable rules of this system — defined in `AGENTS.md` and
`docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md` — have regressed at least once during
development without anything catching it before a human noticed. A rule that is only written
down is a rule a future change can violate by accident. The fix is not more documentation; it's
tests that fail the moment the rule is violated, wired into the CI added in
`.github/workflows/ci.yml`.

This roadmap is organized by **risk**, not by file layout: the two areas explicitly called out
as having burned the project before come first, ahead of general application coverage.

## 2. Already covered — keep, do not weaken

- `assertPromptTraceParity()` (PP-021) — pure-function unit tests in
  `apps/api/src/application/llm/__tests__/promptTraceParity.test.ts`: accepts exact provider
  messages, rejects post-composition text additions, rejects incomplete layer registries,
  rejects altered descriptor metadata/char counts.
- `PROMPT_LAYER_DESCRIPTORS` / layer composition order — `systemPromptComposer.ssot.test.ts`.
- Document mime-map parity across the parser factory, kind detector, and upload allowlist —
  `mimeCoverage.parity.test.ts` (the reference implementation for §4 of `TESTING_POLICY.md`).
- Gitflow branch naming + release version format — enforced both locally (`npm run
  gitflow:guard`) and now in CI on every PR.

## 3. Tier 1 — Cardinal correctness rules (highest priority)

These are the two areas the product owner named explicitly as unacceptable to regress.

### 3.1 Prompt explainability — the exact sent prompt, versioned, in the workspace

**Rule (PP-020, PP-021):** the workspace Prompt Inspector must render the *exact*,
byte-identical prompt that was sent to the provider for that specific generation — not a
reconstruction, not an approximation — including which model/provider produced it. This is
what makes a generated page explainable after the fact.

**Covered today:** the parity-check pure function (`assertPromptTraceParity`) is solid, AND
(as of this delivery) its live enforcement in the real generation route —
`tests/api/prompt-trace-generation.test.ts` — see §7.

**Test targets, in build order:**

1. ~~Route-level integration test~~ — **Implemented, see §7.** One refinement versus the
   original plan below: the test asserts against the `POST
   /projects/:id/llm/chat-preview` HTTP response's `promptingTrace` field — where
   `assertPromptTraceParity()` is actually invoked, synchronously, before the provider call —
   rather than a persisted `PreviewSnapshot.metadata.promptingTrace`. Snapshot persistence is a
   separate downstream step (the frontend calls a dedicated snapshot-create endpoint with the
   route's response); the response-level trace is the authoritative enforcement point per
   PP-021, so testing there is strictly closer to the invariant than testing after an extra
   persistence hop. Original framing kept below for context, superseded by §7's entry.
   Original plan: drive a real generation call through `resolveContext()` and assert the
   persisted `PreviewSnapshot.metadata.promptingTrace` (a) exists, (b) its
   `effectiveSystemPrompt` is byte-identical to what was actually sent, (c) includes `layers`
   covering every `PROMPT_LAYER_DESCRIPTORS` entry including empty ones. This is the test that
   would have caught a silent unwiring of PP-021 enforcement.
2. **Model/provider attribution** — **Implemented as part of item 1**, see §7: assert
   `promptingTrace`/response records which provider and model produced the generation.
3. **Frontend render contract** (blocked on §6 — `apps/web` has no test runner yet): once
   Vitest+Testing Library exists for `apps/web`, add a test asserting
   `PromptLayersView.tsx` renders exclusively from persisted `promptingTrace.layers` or the
   `/llm/prompt-preview` dry-run response — per PP-020, no client-side recomposition, no
   fallback/mock text ever appears when a trace is present.

### 3.2 Active artifact version integrity

**Rule:** exactly one `PreviewSnapshot` per project (or per conversation) is `isActive: true` —
this is *the* version that Inspector edits, Focus Patch, and the editor's watch/sync mechanisms
target and mutate. A snapshot with unresolved media placeholders must never become active. A
stale-vs-published mismatch must be visible to the user (`workspace.ui.staleVersion` in the
workspace page already renders this — the invariant it depends on has no test).

**Covered today (as of this delivery):** use-case guard logic (`ActivatePreviewSnapshot.test.ts`)
and real-Mongo exclusivity (`previewSnapshot-activation.test.ts`) — see §7. Item 3 below (Focus
Patch / Inspector edit-target resolution) remains open.

**Test targets, in build order:**

1. **`ActivatePreviewSnapshot.test.ts`** — **Implemented, see §7.** 404 on missing snapshot,
   404 on conversation-mismatch, 400 and no repository mutation on unresolved media
   placeholders, correct dispatch to `activate()` vs `activateForProject()`.
2. **Repository exclusivity integration test** — **Implemented, see §7**
   (`previewSnapshot-activation.test.ts`, real Mongo via `mongodb-memory-server`): create
   multiple snapshots, activate each in turn, assert after every activation exactly one document
   has `isActive: true` — this is the invariant a use-case-level fake cannot prove, because the
   exclusivity is implemented as two separate Mongo writes (`updateMany` then `updateOne`) with
   no transaction.
3. **Focus Patch / Inspector edit target test**: whichever code path applies an in-place edit
   (Focus Patch, Inspector field edit, the editor's watch/sync mechanism — see
   `docs/specs/FOCUSED_EDIT_SPEC.md`) must always resolve its write target through
   `getActive`/`getActiveForProject`, never a stale snapshot id captured earlier in a session.
   Add a regression test once the exact call site is identified (this item needs its own short
   investigation — the current codebase search found the *read* side of `isActive` well
   scattered across ~38 files; the edit-target resolution call site needs to be pinned down
   before a test can be written against it).
4. **Publish-staleness test**: `isPublishStale` logic in the workspace page (active snapshot
   version number vs. last-published version number) — once §6 lands, cover this as a frontend
   unit test with a fabricated snapshot list.

## 4. Tier 2 — AGENTS.md non-negotiable rules → concrete test targets

Each rule below is written down in `AGENTS.md` as prose. None currently has a test that fails
if the rule is violated by a future change, except where noted.

| Rule (AGENTS.md) | Test target | Status |
|---|---|---|
| Double sandbox: every mutable op resolves user from JWT + verifies `project.ownerUserId == jwt.sub` | Route-level integration test hitting a mutable endpoint (e.g. asset upload, snapshot activate) with a token for user A and a `projectId` owned by user B → expect 403/404, never a leak | Not covered |
| Never access MongoDB directly from presentation routes | Static/architectural check: grep `presentation/http/routes/**` for direct `mongodb`/`Collection` imports; fail if found | Not covered — cheap to add as a script + CI step, no vitest needed |
| Dependency direction (`presentation → application → domain`, `infra → domain`, never the reverse) | Same static-grep approach: `domain/**` importing from `infra/**` or `presentation/**` is a violation | Not covered |
| Never hardcode secrets | Already partially covered by GitHub secret scanning / dependabot on the remote; add a local grep-based pre-check for common key patterns as a CI step | Not covered locally |
| Docker stack safety (never mix dev/deploy compose, always `--no-deps`) | Not unit-testable — this is an operator/agent discipline rule. Documented in `AGENTS.md` and the memory system; no test substitutes for reading the running stack before acting | Out of scope for automated tests, by nature |
| PP-002 (JS exclusively in `artifacts.js`, never inline `<script>`) | `artifactSafetyRepair.ts` repairs this deterministically post-generation — the existing repair-tag tests (if any) should assert the repair actually strips/relocates inline script; verify coverage exists | Needs an audit — see §7 follow-up |
| PP-018 (viewport/layout ownership exclusively Layer B) | `viewportMode.test.ts` exists — audit whether it also asserts Layer A stays silent on layout for every preset, not just that Layer B emits the block | Partially covered — audit needed |

## 5. Tier 3 — Startup, service health, and the simplified vibe-coding pipeline

Lighter-weight smoke coverage, valuable mainly to catch "the app doesn't boot" or "a core flow
is wired wrong" regressions — matches `AGENTS.md`'s own "Stepwise Delivery Protocol":

1. Start service health.
2. Auth register/login.
3. Project CRUD minimal path.
4. Session creation with double sandbox.
5. Seed scripts for bootstrap users/projects.

**Test targets** (all `tests/api/` tier, real in-memory Mongo — this tier already exists and is
the right home for these):

1. `GET /health` (or equivalent) returns 200 with no auth.
2. Register → login → receive access + refresh token pair; refresh token stored as hash only
   (assert the stored value is not the raw token).
3. Create project → list projects → verify ownership binding.
4. Zero-effort pipeline smoke test, end to end through mocked/stubbed LLM calls only (never a
   real provider call in CI): classify → prefill → create project → (skip real generation) —
   this is the "vibe coding pipeline simplified" the product owner asked for; a full real-LLM
   generation is explicitly out of scope for CI (cost, non-determinism), but the orchestration
   *up to* the provider call boundary should be exercised.

## 6. Tier 4 — `apps/web` test infrastructure (blocking dependency for §3.1.3 and §3.2.4)

Already flagged as a gap in `TESTING_POLICY.md` §7. Referenced here because two Tier-1 items
depend on it. Scoping this is its own small piece of work, not bundled into this roadmap:

1. Add Vitest + `@testing-library/react` to `apps/web`.
2. Replace the placeholder `"test"` script.
3. Add the `apps/web` job to `.github/workflows/ci.yml`'s `test` job (currently `apps/api`
   only).
4. First real test: `PromptLayersView.tsx` render contract (§3.1.3) — chosen as the first test
   deliberately, because it directly protects the cardinal rule this roadmap opens with.

## 7. Delivery log

Keep this list current — check an item off with the PR that landed it, not before.

- [x] `docs/guides/TEST_COVERAGE_ROADMAP.md` (this document)
- [x] `ActivatePreviewSnapshot.test.ts` — §3.2 item 1
- [x] Repository exclusivity integration test — §3.2 item 2 — `tests/api/previewSnapshot-activation.test.ts`, real Mongo via `mongodb-memory-server`. Covers conversation-scoped `activate()`, project-scoped `activateForProject()` (including cross-conversation exclusivity), and per-project isolation.
- [x] Prompt-trace route-level integration test — §3.1 item 1 — `tests/api/prompt-trace-generation.test.ts`. Drives a real `POST /projects/:id/llm/chat-preview` call through the live `resolveContext()` → `assertPromptTraceParity()` → provider-fetch path, with only the outbound provider call replaced (a local mock HTTP server behind `LMSTUDIO_BASE_URL`, the `lmstudio` provider's own `authType:"none"` local-testing seam — no application code mocked). Independently re-runs the real `assertPromptTraceParity()` against the returned trace, and asserts every `PROMPT_LAYER_DESCRIPTORS` id is present plus provider/model attribution.
- [ ] Double-sandbox cross-tenant integration test — §4
- [ ] Architectural dependency-direction static check — §4
- [ ] `apps/web` test infra bootstrap — §6
- [ ] `PromptLayersView.tsx` render contract — §3.1 item 3 (needs §6 first)

### 7.1 Unplanned findings from this delivery

- **`tests/api/` was never wired into any npm script or CI.** The three pre-existing E2E files
  in this tier (`artifact-safety-repair.test.ts`, `cost-routes.test.ts`,
  `vibecore-routes.test.ts`) were documented as "run manually from repo root" and were not run
  automatically anywhere. Fixed as part of this delivery: `npm run test:e2e` (root
  `package.json`, explicit file list — deliberately not a shell glob, to stay identical across
  bash/PowerShell/CI) and a new `test-e2e` job in `.github/workflows/ci.yml`.
- **Running this tier for the first time surfaced a stale, silently-failing test**:
  `vibecore-routes.test.ts` asserted a 3-item cap on `attachmentMeta` that the route's zod
  schema had since raised to 100 (a deliberate, documented change — the 100 cap is a defensive
  ceiling, not a product limit). Fixed in the same commit. This is exactly the failure mode this
  whole roadmap exists to prevent — a real regression (well, a stale assertion left behind by an
  intentional change) sat undetected because nothing forced the test to run.

Each unchecked item is sized to land as its own `feat/*` or `test/*` PR — do not batch several
Tier-1 items into one branch; a failing check should point at exactly one concern.
