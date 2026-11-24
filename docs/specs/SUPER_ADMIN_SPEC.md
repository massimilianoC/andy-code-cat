# Super Admin — Workspace Platform Management

**Status:** Planned → Implementation  
**Branch:** `feat/superadmin-dashboard`  
**Author:** Architecture team  
**Date:** 2026-04-12

---

## Overview

This document specifies the **Super Admin** capability: a privileged, isolated management surface
accessible only to accounts carrying the `superadmin` role.  It is entirely separate from the
regular user dashboard and covers platform-wide governance — not day-to-day project work.

### Goals

1. **Full user lifecycle management** — create, inspect, block/unblock, role assignment, deletion.
2. **Platform-wide visibility** — master-detail view of all users, projects, deployments, and usage.
3. **Publication control** — ability to suspend any published site regardless of the owner.
4. **Access policy controls** — toggle public registration, enforce email verification.
5. **License model preparation** — per-user limits and plan tiers as a foundation for future billing.
6. **Secure by design** — the admin surface is completely isolated from tenant routes; every endpoint
   is protected by a dedicated `requireSuperAdmin` middleware on top of standard JWT auth.

---

## Role Model

| Role | Description |
|---|---|
| `user` | Standard end-user — full platform access, tenant-isolated |
| `admin` | Reserved for future moderated-admin delegation (currently unused in routes) |
| `superadmin` | God-mode platform operator — full access to all admin endpoints |

Roles are stored in the `users.roles[]` array in MongoDB and reflected in the JWT `roles` claim.
A superadmin account is seeded at bootstrap via `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` env vars
(see [Seed section](#seed)).

---

## API Surface

All admin endpoints are mounted at `/v1/admin` and require:

1. `Authorization: Bearer <access_token>` — standard JWT auth (`authMiddleware`)
2. `roles` claim must contain `"superadmin"` — enforced by `requireSuperAdmin` middleware

### User Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/users` | Paginated user list; query: `page`, `limit`, `search`, `role`, `isBlocked` |
| `GET` | `/v1/admin/users/:userId` | Full user detail with aggregate stats |
| `POST` | `/v1/admin/users` | Create a user directly (bypasses registration gate) |
| `PATCH` | `/v1/admin/users/:userId/block` | Block or unblock a user |
| `PATCH` | `/v1/admin/users/:userId/roles` | Set user roles |
| `PATCH` | `/v1/admin/users/:userId/limits` | Set per-user resource limits |
| `DELETE` | `/v1/admin/users/:userId` | Permanently delete a user account |

### Platform Configuration

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/config` | Get current platform configuration |
| `PATCH` | `/v1/admin/config` | Update platform configuration, including optional per-product governance |

### Platform Statistics

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/stats` | Aggregated platform-wide statistics |

### Publication Control

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/deployments` | Paginated list of all site deployments |
| `PATCH` | `/v1/admin/deployments/:publishId/block` | Suspend a published site |
| `PATCH` | `/v1/admin/deployments/:publishId/slug` | Override custom slug |

---

## Data Model

### `UserLimits` (embedded in `User`)

```ts
interface UserLimits {
    maxProjects: number;          // -1 = unlimited
    maxMonthlyTokensK: number;    // monthly LLM tokens in thousands, -1 = unlimited
    maxStorageMb: number;         // asset storage in MB, -1 = unlimited
    maxPublishedSites: number;    // concurrent live deployments, -1 = unlimited
    plan: UserPlan;               // "free" | "pro" | "enterprise" | "unlimited"
    planExpiresAt?: Date;         // null/undefined = no expiry
}
```

Default limits for every new user (set via `PlatformConfig.defaultUserLimits`):
all caps are `-1` (unlimited) and plan is `"unlimited"` unless overridden by the operator.

> **Note:** Limits are stored and exposed in the API but are **not yet enforced** in business logic.
> Enforcement hooks will be added in a future billing milestone.
> The data model is intentionally forward-compatible.

### `PlatformConfig` (singleton collection `platform_config`)

```ts
interface PlatformConfig {
    id: string;                         // singleton id "global"
    registrationOpen: boolean;          // allow public self-registration
    emailVerificationRequired: boolean; // enforce email verification on register
    defaultUserLimits: UserLimits;      // applied to new users at creation time
   governanceByProduct?: Record<string, ProductGovernanceConfig>; // optional map by product key
    updatedAt: Date;
    updatedByUserId?: string;           // userId of the admin that last changed config
}

interface ProductGovernanceConfig {
   promptTemplates: {
      generationSystem: string;
      focusedEditSystem: string;
      reviewSystem: string;
   };
   injections: {
      headHtml: string;
      headerHtml: string;
      footerHtml: string;
      scriptInHead: string;
      scriptBeforeBodyClose: string;
      googleTagManagerId: string;
      googleAnalyticsId: string;
      matomoSiteId: string;
      matomoUrl: string;
   };
   nginx: {
      publicDomain: string;
      publishSubdomainPattern: string;
      cacheTtlSeconds: number;
      clientMaxBodySizeMb: number;
      extraServerDirectives: string;
   };
}
```

`governanceByProduct` is additive and optional. Existing clients can continue reading/updating
legacy fields without sending governance payloads.

### `SiteDeployment` additions

```ts
isAdminBlocked?: boolean;   // when true, /p/:publishId returns HTTP 403
adminBlockedAt?: Date;
adminBlockedByUserId?: string;
```

When `isAdminBlocked` is `true`, the static file serving endpoint returns `HTTP 403 Forbidden`.
The deployment record and all metadata remain intact — the block is fully reversible.

---

## Security Model

1. **Double layer:** `authMiddleware` → `requireSuperAdmin`.  Neither can be bypassed individually.
2. **No tenant sandbox:** Admin routes intentionally bypass the `sandboxMiddleware` (project ownership
   check); they operate across all tenants.
3. **Audit trail:** All admin write operations log the acting `superadmin` userId and a timestamp
   in the modified document (`updatedByUserId`, `adminBlockedByUserId`, etc.).
4. **Self-protection:** The `blockUser` and `deleteUser` routes refuse to act on the calling user's
   own account (`userId === req.auth.userId` → 400).
5. **Role escalation guard:** No admin can promote another user to `superadmin` unless the caller
   already holds `superadmin`.  Normal admins (if used in future) cannot escalate to superadmin.
6. **Registration gate:** When `registrationOpen: false`, the public `POST /v1/auth/register`
   endpoint returns `403 Registration is currently closed`.  Superadmin `POST /v1/admin/users`
   is always available regardless of this flag.
7. **Input validation:** All admin endpoints validate input with shared Zod contracts from
   `@andy-code-cat/contracts` — same pattern as all other routes.

---

## Frontend

A dedicated Next.js route group `app/admin/` is created.  It is entirely independent of the
regular dashboard.  A layout guard `app/admin/layout.tsx` decodes the stored JWT and redirects
to `/login` if either:

- no access token is stored, or
- the token does not contain the `superadmin` role.

### Pages

Since 2026-11-24 the superadmin is organised around what a local operator does every week
(§ "Information architecture — 2026-11-24" below). Routes:

| Route | Section | Purpose |
|---|---|---|
| `/admin` | Overview | KPIs, cost ledger summary, AI usage |
| `/admin/users` | Users | Accounts, roles, blocks; user panel with projects (→ Projects filtered by owner) |
| `/admin/projects` | Projects | Every project, published or not (`?ownerId=` filter); panel: Overview, **Content** (audited inspection), AI usage, Site, Danger zone |
| `/admin/models` | Models | LLM catalog: which provider/model may be dispatched |
| `/admin/prompts` | Prompts | `?tab=tasks` pipeline tasks (model/budget/template per stage), `?tab=system` system prompts, `?tab=attachments` attachment & document-context limits (read-only) |
| `/admin/config` | Advanced → Platform | Published sites address, background runs, access control, default limits (not enforced), cost policy |
| `/admin/publishing` | Advanced → Publishing | Analytics, HTML/JS injections, cookie banner and legal pages |
| `/admin/integrations` | Advanced → Media providers | Service API keys, stock-image provider policy |
| `/admin/presets` | Advanced → Presets | Project types |
| `/admin/brand` | Advanced → Brand | Platform brand assets |
| `/admin/guided-mode`, `/admin/governance` | — | Redirects to `/admin/prompts` (old links) |

The admin UI uses the same shadcn/ui primitives and Tailwind semantic tokens as the rest of the
application.  It is not linked from the user-facing navigation and is invisible to regular users.

---

## Information architecture — 2026-11-24

Frontend-only restructure (no change to the admin API except the optional inspection reason).

- **Shell** (`app/admin/layout.tsx`): sidebar with two primary groups — *Manage* (Overview, Users,
  Projects) and *AI* (Models, Prompts) — and a collapsible *Advanced* group for everything that
  works but is rarely touched. Drawer on mobile, `next/link` navigation, no inline styles.
- **Shared kit** (`components/admin/AdminUi.tsx`): `AdminPageHeader`, `AdminTabs` (WAI-ARIA
  tablist, arrow keys) with `useTabParam` (tab kept in `?tab=`), `NotEnforcedNotice`. The legacy
  `.admin-tab` / `.admin-seg-*` CSS is removed.
- **One editor per concern, saving only its own fields.** `PipelineTasksEditor` saves the six
  pipeline tasks; `GovernanceEditor` (`scope="prompts"`) saves the system prompt templates and
  its two utility tasks; `GovernanceEditor` (`scope="publishing"`) saves injections, cookie banner
  and legal pages. The configuration route merges per task and per section, so two editors can no
  longer overwrite each other (previously the governance save resent every task as loaded).
- **Inspection of user content.** Projects → Content lists every version; opening one asks for an
  optional reason, then `GET /v1/admin/projects/:id/preview-snapshots/:snapshotId?reason=` returns
  the artifacts and writes `admin_viewed_project_snapshot` with the actor, owner, version and
  `metadata.reason` (≤ 500 chars). The render is a `sandbox="allow-scripts"` frame without the app
  origin.
- **Settings that do nothing are shown as such**: user and default limits are read-only with a
  "Not enforced" notice; attachment/document-context limits are read-only ("the API does not
  accept changes yet"); the nginx runtime card and the CSS-injection tab are no longer shown.
- **Language**: English throughout the admin (i18n of ~5,000 lines judged not worth it now).

## TODO — superadmin (2026-11-24)

1. **User limits** (`maxProjects`, `maxMonthlyTokensK`, `maxStorageMb`, `maxPublishedSites`, and the
   platform defaults): enforce them (ideally on real measured cost) or remove them. Not copied to
   new accounts (`RegisterUser`) and not checked anywhere today.
2. **Attachment & document-context policy**: add them to `setPlatformConfigSchema.governanceByProduct`
   so the Prompts → Attachments panel can become editable (today the API strips them silently).
3. **`maxCompletionTokens` ceiling**: the contract allows 32,000 while stored task defaults go up to
   64,000 — saving such a task is refused with 400.
4. **Publishing injections**: `PublishProject` reads only the preset's scope with no fallback to
   `default`, and swallows a config read error.
5. **Cookie banner and legal pages — GDPR**: consent before any tracking tag, records of consent,
   and how superadmin inspections of user projects are disclosed to users (privacy notice).
6. **Dead configuration**: remove `nginx.*`, `injections.globalCss`, `promptTemplates.reviewSystem`,
   `features.didacticMode`, `LLM_CATALOG_SOURCE` from entity, contract, repository (UI no longer shows them).
7. **Costs**: single ledger at real measured cost, automatic SiliconFlow price list (OpenRouter
   `/endpoints` + ECB rate), cost chip and unified recap (cost analysis of 2026-11-24).
8. **Remaining inline styles / raw controls** in Overview, Media providers, Users and the
   governance panels; the duplicated `POST /admin/service-keys/seed-from-env` route; zod validation
   of service keys and cost rates; session revocation on role change.

## Seed & First-Install Wizard

> **Preferred path:** Use the guided web installer at `/install` on first deployment.
> See [FIRST_INSTALL_SETUP_SPEC.md](FIRST_INSTALL_SETUP_SPEC.md) for the full spec.

The installer creates the first superadmin interactively, collects server configuration, and
seeds the `PlatformConfig` singleton in a single guided flow. It is permanently disabled after
the first superadmin account exists.

### Env-var seed (legacy / CI)

The `apps/api/src/scripts/seed.ts` script creates a superadmin account if it does not already
exist. Credentials are read from environment variables:

| Variable | Default |
|---|---|
| `SUPERADMIN_EMAIL` | `superadmin@andy-code-cat.local` |
| `SUPERADMIN_PASSWORD` | *(no default — must be set explicitly in production)* |

If `SUPERADMIN_PASSWORD` is not set, the seed script logs a warning and skips superadmin creation
(the regular seed user is created regardless).

### Emergency manual promotion (mongosh)

If neither the wizard nor the seed script is usable, a user can be promoted directly from
`mongosh`. See [FIRST_INSTALL_SETUP_SPEC.md § Manual DB Promotion](FIRST_INSTALL_SETUP_SPEC.md#manual-db-promotion-emergency--dev)
for the exact commands.

---

## Environment Variables

Add the following to `.env.example` (no defaults with real values):

```
# Super Admin seed credentials — override in production
SUPERADMIN_EMAIL=superadmin@andy-code-cat.local
SUPERADMIN_PASSWORD=
```

---

## Delivery Status Snapshot — 2026-04-15

The superadmin area now includes live governance surfaces for the current template-management wave:

- `/admin/presets` — project-type template model library with category taxonomy, sort order, recommended runtime metadata, and CRUD persistence
- `/admin/governance` — optimized preprompting controls for template-driven rewriting and runtime rules
- `/dashboard` start UX now consumes the managed template catalog rather than only a static hardcoded list

### Validation priority versus future additions

For the current UX and end-to-end validation cycle, the only indispensable next activity is:

- visual/authenticated QA of the template-model and preprompt flow in the browser

The following remain useful but **additive**, not blocking:

- drag-and-drop template ordering UX
- user-private or pending-review template models with superadmin promotion
- advanced low-level LLM runtime catalog maintenance

## Project-Type Template Model Governance

The current superadmin direction is centered on editable project-type template models.

Each template model should be manageable from the admin side with:

- category and tags
- short description and start UX copy
- brief starter template
- style direction template
- optimized preprompt module injected into the existing preprompting flow
- optional suggested runtime hints

The superadmin workflow should support AI-assisted authoring so that a new template model can be drafted from a few human instructions and refined through the optimizer before publication.

The low-level LLM model catalog remains available only as a paused technical track and should not replace this template-first governance model.

## Planned Extension — Prompting Task Governance

The governance model should be extended with a modular prompt-task section for internal AI helper features such as:

- optimize user prompt
- summarize project brief
- classify intent
- describe uploaded assets
- run content quality checks

Each task should support:

- enable/disable toggle
- provider selection
- model selection
- temperature and max token limits
- editable system and user templates
- per-product overrides

This extension is specified in `docs/specs/PROMPTING_SERVICE_PLATFORM_SPEC.md` and is designed to be additive, preserving backward compatibility with the existing governance editor.

## Out of Scope (Future Milestones)

- Limit enforcement in use-cases (billing milestone)
- License purchase flows / Stripe integration
- Admin impersonation ("login as user")
- Audit log dedicated collection
- Multi-admin delegation (granting `admin` role access to sub-sections)
- Cost dashboard with token spend per user

---

## Related Documents

- [First Install & Guided Setup Wizard](FIRST_INSTALL_SETUP_SPEC.md)
- [Architecture overview](../architecture/BOOTSTRAP_ARCHITECTURE.md)
- [Security baseline](../security/SECURITY_BASELINE.md)
- [Testable steps runbook](../runbooks/TESTABLE_STEPS.md)
- [Code agent index](../agents/CODE_AGENT_INDEX.md)
