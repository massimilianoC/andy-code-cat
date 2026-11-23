# Background runs — spec

**Status: in delivery (MVP, phases 0–3).** Written 2026-11-23 from the code on `develop` (release
2026.11.23.5); decisions in §6 taken by the product owner on 2026-11-23. Delivery state per phase
in §7.

---

## 1. The idea

A user starts a Vibe session, ticks **"Run in background"**, writes the prompt and clicks once.
From there the platform carries the whole flow on its own — classify, brief (auto-approved),
workspace launch, generation, snapshot, publish under a temporary slug — and **notifies the user
when the site is ready** (in-app, e-mail, Telegram). The user does not wait in front of the screen:
they can start other projects, run several background runs at once, or close the browser.

A background run must be:

- **detached** from the browser: closing the tab must not stop it;
- **re-attachable** by ID: the user opens the run's project and finds the same state the workspace
  would have produced;
- **isolated** per customer: a run works only in its owner's project context;
- **the same pipeline** as the interactive one (Rule Zero): a background run is the interactive
  flow with the clicks taken out, never a second implementation.

---

## 2. What the flow is today

Every step is driven by the browser. Measured in the code:

| # | Step | Endpoint | Driven by | Survives a closed tab? |
|---|---|---|---|---|
| 1 | Intent classification | `POST /v1/vibecore/classify` (`VibeClassify`) | `VibeCoreEntry.tsx` | the call yes; the flow no |
| 2 | Brief prefill | `POST /v1/vibecore/prefill` (`VibePrefill`) | `VibeCoreEntry.tsx` | idem |
| 3 | User reviews and confirms the brief form | — | **the user** | — |
| 4 | Workspace launch: conversation, moodboard, `PipelineRun` with model lock and canonical brief | `POST /v1/projects/:id/pipeline/launch-workspace` (`LaunchWorkspacePipeline`) | browser | yes |
| 5 | Prompt optimisation | `POST /v1/projects/:id/llm/optimize-prompt[/stream]` | workspace auto-send | **no** |
| 6 | **Artifact generation** | `POST /v1/projects/:id/llm/chat-preview/stream` | workspace auto-send | **no** — `res.on("close")` aborts the provider fetch (`llmRoutes.ts`, ~L1192) |
| 7 | Preview snapshot + activation | `POST /v1/projects/:id/preview-snapshots`, `…/activate` | workspace | only if the browser gets there |
| 8 | Publish (optional slug) | `POST /v1/projects/:id/publish` (`PublishProject`) | **the user** | yes |
| 9 | Notification | `system_notifications` (in-app only) | — | — |

So the only steps a server can already run without a browser are 1, 2, 4 and 8. Generation (6) and
the snapshot (7) live in the route handler and in the client respectively — that is the real work.

### What already exists and is reused

| Piece | Gives a background run |
|---|---|
| `PipelineRun` (`modelLock`, `canonicalBrief`) | the frozen model and brief a run must not drift from |
| `WorkSession` | one intent = one session, so a run is traceable end to end |
| `prompt_execution_logs` journal (pending before dispatch, idempotency key) | every LLM call recorded and replay-safe |
| Interrupted-run recovery (`INTERRUPTED_RUN_RECOVERY.md`) | partial output and reasoning kept when a call dies — the resume point for a restarted worker |
| `boundedPool.ts` | bounded concurrency with per-task ceilings |
| Unique slug index `customSlug_unique_active` (2026.11.23.4) | an atomic temporary-slug reservation |
| `PublishProject`, `system_notifications` | publish and in-app notice, already server-side |

### What does not exist

- **No queue and no worker.** Redis/BullMQ was removed ("until BullMQ workers are implemented");
  `boundedPool` runs inside the request.
- **Generation is not a use case.** `chat-preview` is ~800 lines in `llmRoutes.ts`, bound to the HTTP
  response.
- **Snapshot creation is client-side.**
- **No e-mail** (no SMTP/provider configured) and **no Telegram** channel in this product.

---

## 3. Design

### 3.1 Phase 0 — one generation path (prerequisite, valuable on its own)

Extract the generation core of `chat-preview[/stream]` into an application use case
(`GenerateArtifact`) that takes the run context and an output sink:

- the interactive route becomes a thin adapter: SSE sink, abort on client close (unchanged behaviour);
- the background worker uses the same use case with a persistence sink and **no** client-close abort
  (its own ceiling instead).

Move snapshot creation and activation to the server as part of the same use case (the client keeps
calling it in interactive mode, so the two paths cannot diverge).

This is the Rule Zero requirement: a background run that re-implemented generation would be a second
pipeline nobody can tell apart from the first. It is also the riskiest part (prompt composition, media
manifest, cost ledger, journal, recovery all pass through it) and must ship behind the existing
golden-snapshot and e2e tests before anything else is built on it.

### 3.2 The `BackgroundRun` aggregate

One document per run, owned by `(userId, projectId)`, linked to `workSessionId` and `pipelineRunId`.

```
queued ─▶ classifying ─▶ briefing ─▶ launching ─▶ generating ─▶ snapshotting ─▶ publishing ─▶ done
   │            │            │            │             │              │              │
   └────────────┴────────────┴────────────┴─────────────┴──────────────┴──────────────┴─▶ failed | cancelled
```

Each transition is written before the step starts and after it ends (same rule as the journal: a
record written only on success cannot explain a run that never came back). Each step stores its
output reference (classification, brief draft, pipelineRunId, snapshotId, deploymentId), so a
restarted worker resumes at the first step without one.

### 3.3 Queue and worker

- **Queue in MongoDB**, no new infrastructure at our volume: the worker claims a run with an atomic
  `findOneAndUpdate({ status: "queued" | lease expired }, { $set: { lease, workerId } })`, renews the
  lease with a heartbeat, and releases it on each transition. An expired lease (crashed or restarted
  worker) makes the run claimable again; the step resumes from the stored outputs and the journal's
  idempotency key prevents a double LLM call.
- **A separate `worker` container**, same image as the API, different command: long runs never compete
  with API requests, and the API can be redeployed without killing work in flight (and vice versa).
- **Concurrency limits**: per user (e.g. 2 runs at once), global pool (e.g. 4), per provider rate.
- **Cancel**: the user can cancel; the worker checks the flag between steps and aborts the provider
  call in flight.

### 3.4 Brief auto-approval and the temporary slug

- The prefill draft is accepted as-is and stored on the run; the user can edit it later and regenerate
  from the workspace.
- The temporary slug is generated (`{brand}-{4 chars}`) and reserved through the unique slug index
  (retry on 409). Publish uses the normal `PublishProject`.
- Proposed: background publishes carry `noindex` and are marked "draft" until the user confirms the
  final slug — path-mode sites are public as soon as they are published.

### 3.5 API and UI

- `POST /v1/background-runs` (authenticated, sandboxed on the project) — start;
  `GET /v1/background-runs` (mine), `GET /v1/background-runs/:id`, `POST /v1/background-runs/:id/cancel`.
- Vibe: a "Run in background" toggle next to the prompt; the click creates the project and the run and
  returns at once.
- A "My runs" panel (state, step, elapsed, cost so far, link to the site) and a badge in the header;
  "Open in workspace" re-attaches to the project the run produced.

### 3.6 Notifications

| Channel | Exists | Needs |
|---|---|---|
| In-app (`system_notifications`) | yes | a notice type for "run done / failed" |
| E-mail | no | a transactional provider (SMTP or API), per-user opt-in, templates IT/EN |
| Telegram | no | a bot, an account-linking flow (one-time code sent to the bot), per-user opt-in |

The notification contains the site link and a link to the run; never the brief or any content.

---

## 4. Security model

**An ID is not a credential.** Re-attaching to a run always requires the logged-in owner:
`GET /v1/background-runs/:id` filters by `userId` from the token, exactly like `sandboxMiddleware`
does for projects. Knowing an ID gives nothing.

**The worker holds no user token.** Authority is established once, when the run is created by an
authenticated, sandbox-checked request. The worker then acts as a **run principal**
`(userId, projectId, runId)`:

- every repository read and write is scoped by those three values — the worker gets scoped repositories,
  not the raw ones;
- before every step it re-checks: user not blocked, project still owned by the user, run not cancelled,
  plan limits (monthly tokens, published sites) not exceeded;
- the LLM context is built only from that project's data (brief, moodboard, assets, brand documents of
  that owner), through the same builders as the interactive path.

**Isolation level.** Logical, per document and per scoped repository — not OS-level. That is adequate
here because the worker never executes model output: generated HTML/JS is stored and served only on the
sites origin (see `PUBLISHED_SITE_ADDRESSES.md`), never run server-side.

**Cost.** A run nobody watches spends money: a per-run cost ceiling (checked against the journal after
each call), the per-user concurrency limit, and the ledger entries attributed to the run.

**Abuse.** Background runs make it cheap to publish many sites: the per-user limits and the existing
`maxPublishedSites` apply; draft/noindex publishing (3.4) limits exposure until the user confirms.

---

## 5. Effort

| Phase | Content | Days |
|---|---|---|
| 0 | `GenerateArtifact` use case (from `llmRoutes`), server-side snapshot, both paths on it, tests | 4–6 |
| 1 | `BackgroundRun` aggregate, Mongo queue with leases, `worker` container, resume, cancel | 3–4 |
| 2 | Orchestrator (steps 1–8), brief auto-approval, temporary slug, draft publish | 2–3 |
| 3 | API + UI (toggle, "My runs", re-attach) | 2–3 |
| 4 | Notifications: in-app 1, e-mail 1–2, Telegram 2 | 1–5 |
| — | e2e on the whole chain, security tests (cross-user access, blocked user, cancelled run) | 2–3 |

**MVP** (phases 0–3, in-app notice, publish confirmed by the user): about **8–10 days**.
**Complete** (all phases, e-mail and Telegram, draft publish): about **15–20 days**.

---

## 6. Decisions (product owner, 2026-11-23)

These replace the open questions of the first draft.

1. **Auto-publish, without a custom slug.** A background run auto-approves the Zero Effort brief and
   publishes on its own at the site's permanent address `/p/{publishId}/` (shown as `publicUrl`,
   `resolvePublicSiteUrl`). No temporary slug is reserved. The completion notification carries the
   public link **and a proposed slug** derived from the project/brief, validated with
   `classifySlugFormat`/`isPublicSiteSlug` and checked free with `isCustomSlugTaken`; the user accepts
   it with one click, which calls the existing `PATCH /v1/projects/:projectId/publish/slug`. Nothing
   is reserved until the user accepts (so §3.4's temporary-slug reservation is not built).
2. **No draft/noindex** handling in the MVP.
3. **Limits:** at most **2 concurrent runs per user**, a **global pool of 2**, and a **per-run cost
   ceiling** read from configuration (`BACKGROUND_RUN_MAX_COST_EUR`, conservative default, see
   `.env.example`) checked against the journal after each LLM call.
4. **Notifications: in-app only** (`system_notifications`). No e-mail, no Telegram in this release.
5. **Queue in MongoDB** (atomic `findOneAndUpdate` claim with lease and heartbeat). No Redis.

---

## 7. Delivery

| Phase | State | Notes |
|---|---|---|
| 0 | ✅ built | `GenerateArtifact` (application) is the one generation engine; `/llm/chat-preview` and `/stream` are transport adapters (SSE, abort on `res.on("close")`). The turn is persisted server-side: assistant message via `AddMessage`, version via `CommitArtifactVersion` → `CreatePreviewSnapshot` (AL-047). The workspace declares its base (`artifactBase`) and reads `result.persisted`. Characterisation suites: `llmChatPreview.characterization.e2e.test.ts`, `previewSnapshotCommit.e2e.test.ts`, `llmGenerateTurnPersistence.e2e.test.ts`; golden prompt-preview snapshot unchanged |
| 1 | planned | `BackgroundRun` aggregate, Mongo queue with leases, `worker` process |
| 2 | planned | orchestrator, run principal, guards, slug proposal, notification |
| 3 | planned | API + UI |
