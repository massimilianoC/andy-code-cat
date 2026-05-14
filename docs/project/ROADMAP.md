# Project Roadmap

Andy Code Cat is developed in iterative releases. Each release is a shippable, testable increment.

_Last review: 2026-04-27_

---

## Current Status: R1 largely delivered, R2–R3 active

The product is now **beyond the original bootstrap phase**. The core platform is stable, the prompt architecture is substantially implemented, and the current focus is shifting toward **observability, publishing hardening, and domain management**.

### Delivery Snapshot

| Release | Status | Notes |
|---|---|---|
| R0 | ✅ Complete | Core AI loop, auth, WYSIWYG, export, publish, onboarding, i18n, preset catalog |
| R0.5 | 🔲 Planned | First-install wizard (`/install`), guided server config, superadmin seed, emergency DB promotion docs |
| R1 | ✅ Functionally delivered | Layered prompting, preset-aware generation, style propagation, provider/model selector, prompt optimization |
| R2 | 🟡 In progress | Execution log infrastructure and prompt usage summaries exist; dashboarding is still incomplete |
| R3 | 🟡 Started | Path publish is live and slug/subdomain foundations exist; custom domains and SSL are still pending |
| R4 | ⏸ Postponed | Deferred until R2/R3 stabilization is complete |
| R5 | ⏸ Postponed | Deferred until the BaaS layer is ready |

### Core platform already operational

- [x] Docker Compose stack (API + Web + MongoDB + Redis + nginx)
- [x] JWT authentication (register / login / refresh)
- [x] Project CRUD with owner isolation (double sandbox)
- [x] Multi-provider LLM catalog (SiliconFlow, OpenRouter, LM Studio)
- [x] AI page generation via chat (Layer 1 — Chat Preview)
- [x] GrapesJS visual editor (WYSIWYG)
- [x] Focused edit — AI edits a selected section within the full page context
- [x] Section-aware context optimization (40–60% token reduction)
- [x] Export to static HTML (ZIP download)
- [x] Path-based publish (/p/{publishId})
- [x] Per-session cost tracking (EUR, with USD→EUR conversion)
- [x] Per-project cost aggregation — LLM prompt costs + image generation costs summed in project list API (commit 9c97dea)
- [x] Project card published URL display — live deployment URL surfaced from API and shown as badge in dashboard (commit 9c97dea)
- [x] Puppeteer thumbnail screenshots — background job renders active snapshot to JPEG, stored in MinIO/filesystem, streamed back with long-lived cache headers (immutable per snapshotId); ProjectCard displays JPEG → legacy HTML iframe → gradient fallback
- [x] Zero Effort pipeline — `/v1/pipeline/launch` and `/v1/pipeline/config` endpoints for guided single-step site generation with normalized brief and pre-seeded workspace (commit eff9e9b)
- [x] Zero Effort auto-send — frontend prompt pre-fill with auto-submit on workspace entry for frictionless launch (commit b4eb3f5)
- [x] Onboarding wizard (style profiling, tag taxonomy)
- [x] Prompt optimizer (inline enrichment)
- [x] i18n foundation (IT/EN)
- [x] Typed preset catalog (A4, slide, form, infographic...)

---

## R0.5 — First Install & Guided Setup Wizard

**Status: 🔲 Planned — self-hosting readiness milestone.**

The platform currently requires manual env-var configuration and a seed script to bootstrap a
superadmin account. This is not usable by self-hosters and makes first deployment error-prone.

See [docs/specs/FIRST_INSTALL_SETUP_SPEC.md](../specs/FIRST_INSTALL_SETUP_SPEC.md) for the full spec.

### Deliverables

- [ ] `GET /v1/install` — detect installed/not-installed state
- [ ] `POST /v1/install` — create first superadmin + seed `PlatformConfig` singleton
- [ ] Install-state guard: redirect all routes to `/install` when not installed
- [ ] Multi-step web wizard at `/install` (4 steps: credentials, server config, storage, review)
- [ ] Parametric server config collected at wizard: public domain, app name, registration policy, email verification
- [ ] Optional custom MinIO config (endpoint, bucket, credentials) — advanced step, collapsed by default
- [ ] Permanent lock after first completion (idempotent: `existsWithRole("superadmin")` check)
- [ ] Emergency manual promotion documented: `mongosh` commands in `FIRST_INSTALL_SETUP_SPEC.md`
- [ ] i18n keys for all wizard copy (IT + EN)
- [ ] Rate-limit on `/v1/install` (5 req/min/IP)

### Why this release exists

- Self-hosting requires a usable first-run experience — env-var-only setup is too fragile
- The wizard is the natural entry point for the `appName`, `publicDomain`, and registration policy
  that governance already models in `PlatformConfig` but currently seeds only via the seed script
- The emergency DB promotion path (mongosh) is documented here for existing deployments and CI

---

## R1 — Prompt Architecture & Preset Layer

**Status: ✅ Delivered in production code, with room for further refinement rather than first-time implementation.**

- [x] Layered prompt composition implemented through modular system prompt assembly (constraints, preset layer, style layer, project template, governance layer)
- [x] Preset-aware generation — output specs and prompt modules exist for typed preset types
- [x] Style context propagation — user profile + moodboard feed the prompt context
- [x] Extended model selector UI (provider + model per session)
- [x] Superadmin template-model registry — Mongo-backed project-type catalog with categories, sort order, recommended runtime hints, and static fallback
- [x] Dashboard start UX by category, with preserved blank option and recommended-model badges
- [x] Optimized preprompting controls exposed in the governance area for template-driven prompt rewriting
- [x] AI template workbench in superadmin for drafting/refining template models from short instructions using the shared prompting service
- [x] Asset-aware context enrichment for prompt optimization using project assets and prompt execution summaries

**Notes**

- The original “PrepromptEngine” objective has effectively been delivered through the current layered prompt composer and prompt preview/debug flows.
- The preset/model governance wave is now implemented end-to-end in code and admin UI.
- Remaining work in this area is mostly **validation, polish, and future modularization**, not a missing MVP feature.

---

## R2 — Execution Logging & Observability

**Status: 🟡 Cost data foundation complete; dashboard UI still pending.**

- [x] execution_logs collection (MongoDB TTL 90d)
- [x] Admin/owner log query endpoint
- [x] Prompt execution logging and usage summary endpoints
- [x] Per-project cost aggregation API — LLM prompt costs + image generation costs summed and exposed in `GET /v1/projects` (foundation for cost dashboard)
- [ ] Full per-operation log coverage for every export/publish/UI workflow
- [ ] Dedicated cost dashboard UI per project (data is now fully available from the API)

**Notes**

- Observability has already advanced ahead of the original roadmap thanks to structured execution logging and prompt usage tracking.
- The next step is to turn these backend signals into a more complete **owner-facing dashboard and filtering UI**.

---

## R3 — Subdomain Publishing & Domain Management

**Status: 🟡 Foundation in place, rollout not complete.**

- [x] Path-based publish is live and stable
- [x] Custom slug availability check and slug update flow
- [ ] Wildcard subdomain publish ({slug}.yourdomain.com) end-to-end hardening
- [ ] Custom domain mapping (BYOD — bring your own domain)
- [ ] nginx dynamic vhost generation
- [ ] SSL automation (Let's Encrypt)

**Notes**

- The publish layer already exposes the right primitives for deployment IDs, slugs, and public URLs.
- The remaining work is mainly **infrastructure automation and ops hardening**, not the base publish capability itself.

---

## R3.5 — User Settings Panel & API Key Management

**Status: 🔲 Planned — prerequisite for R4 BaaS integrations.**

Introduces user-owned API keys for programmatic/server-to-server access, and a unified `/settings` panel where both regular users and superadmins manage configuration within their own data domain — no duplicate interfaces, role-scoped tabs.

See [docs/specs/USER_SETTINGS_AND_API_KEYS_SPEC.md](../specs/USER_SETTINGS_AND_API_KEYS_SPEC.md) for the full spec.

### Phase 1 — API Key Backend

- [ ] `ApiKey` entity + `MongoApiKeyRepository`
- [ ] Auth middleware extension: detects `acc_` prefix, validates key, populates `req.auth` identically to JWT path
- [ ] `POST /v1/me/api-keys` — create key (full key returned once)
- [ ] `GET /v1/me/api-keys` — list own keys (prefix only, never hash)
- [ ] `PATCH /v1/me/api-keys/:id` — rename, change expiry, suspend/unsuspend
- [ ] `DELETE /v1/me/api-keys/:id` — revoke (irreversible)
- [ ] `GET /v1/admin/api-keys` — superadmin list all keys with filters
- [ ] `DELETE /v1/admin/api-keys/:id` — superadmin revoke any key + audit log

### Phase 2 — Settings Panel Shell + API Keys Tab

- [ ] `/settings` route and tabbed shell (Next.js)
- [ ] Profile tab, API Keys tab (list, create with copy-once modal, revoke, suspend)
- [ ] Tab visibility matrix enforced by role
- [ ] i18n keys IT + EN

### Phase 3 — Superadmin Tabs in Settings Shell

- [ ] Superadmin-only tabs in settings: All API Keys, Users & Roles, Platform Config, LLM Models
- [ ] Legacy `/admin` routes kept alive (not removed) — parallel transition period

### Why this release exists

- API keys unlock clean server-to-server integrations without exposing user passwords or managing JWT refresh flows in client services.
- The settings panel establishes the "one URL, role-scoped data" governance pattern that prevents interface proliferation as the platform grows.
- API keys are a prerequisite for R4 BaaS BYOK secrets model.

---

## R4 — BaaS Services Layer

**Status: ⏸ Postponed until observability and publishing are fully stabilized.**

- [ ] Forms service (collect form submissions from published pages)
- [ ] Payments BYOK (Stripe Connect passthrough)
- [ ] Webhook relay
- [ ] Shared service catalog (injectable into published pages as vanilla JS)
- [ ] Envelope encryption for BYOK API secrets (AES-256-GCM)

**Notes**

- This release is still aligned with the long-term product direction.
- It is intentionally deferred to avoid expanding surface area before R2/R3 are fully hardened.

---

## R5 — RAG Chatbot Integration

**Status: ⏸ Postponed.**

- [ ] RAG chatbot for landing pages (BYOK Flowise/n8n/generic)
- [ ] Document ingestion from asset manager
- [ ] Secure BaaS proxy
- [ ] Visitor rate limiting

**Notes**

- This remains a valuable extension, but it should come **after** the services layer and publication governance are mature.

---

## Product Direction Lock — 2026-04-27

The primary product direction is now explicitly locked on **project-type template models** and **optimized preprompting**.

This means:

- the main superadmin governance surface is the editable catalog of project templates
- each template model represents a project type, not an LLM
- each template model carries its own descriptive metadata and its own prompt module to inject into the preprompting flow already in place
- the low-level LLM runtime catalog is kept available only as a paused/secondary infrastructure track and is not the current product center

Examples of target template families include:

- layout, landing, website, keynote
- casual game, serious game, 3D game, VR game with A-Frame
- A4 onepager, poster 70×100 cm, infographic, manifesto

## Immediate Validation and Next Proposals

The latest delivery wave is **already implemented**. The three immediate follow-up proposals should be read as follows:

| Proposal | Nature | Needed for current UX/E2E test? | Why |
|---|---|---|---|
| Visual/authenticated QA of Template Models, Dashboard, Governance, and Workspace flow | Validation activity | **Yes** | This is the step that proves the delivered template-driven UX really works end-to-end in the browser |
| Drag-and-drop or richer reorder UX for presets | Product polish | **No** | Current numeric `sortOrder` already allows ordering and does not block the present test cycle |
| User-owned private/pending presets with superadmin approval | Future governance extension | **No** | The data model is prepared, but this is an additive feature and not required for current validation |

### Broader roadmap focus

1. Complete R2 with a real project-level cost and log dashboard (data layer is now ready)
2. Finish R3 domain automation (wildcard subdomain, SSL, custom domains)
3. Re-open R4 only after the publishing pipeline is considered operationally solid
4. Keep async project-generation orchestration in the documented backlog until R2/R3 are hardened

### Consolidation fixes — 2026-04-27

Targeted robustness pass on existing implementations (no new features):

- `previewSnapshotRoutes.ts`: thumbnail re-render guard — `SnapshotThumbnailJob.schedule()` on activate endpoint now skips re-render when `thumbnailPath` is already set, preventing redundant Puppeteer jobs on every re-activate
- `previewSnapshotRoutes.ts`: storage stream error propagation — thumbnail GET endpoint now forwards stream errors to Express `next()` to prevent hung HTTP responses on storage failures

---

## Future Candidate Backlog

### Async Project Orchestration & Resumable Generation

**Status: ⏸ Deferred for a future cycle.**

- [ ] Project-level background job orchestration for long-running prompt/artifact generation
- [ ] Dashboard project-card running state (spinner/badge)
- [ ] Global progress events aligned with ZIP/publish notifications
- [ ] Resume/re-entry support so the user can leave the workspace and later recover task progress

**Why deferred now**

- High UX value, but also high regression risk around concurrency, snapshot ordering, cancel/resume semantics, and state consistency between workspace, dashboard, and persisted jobs.

---

## Out of Scope (for now)

- SaaS multi-tenant billing (no plans for hosted SaaS)
- Mobile app
- Real-time collaboration

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.
Detailed specs for each feature are in [docs/specs/](docs/specs/).
