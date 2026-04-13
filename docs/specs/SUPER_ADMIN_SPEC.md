# Super Admin — God Mode Platform Management

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

| Route | Purpose |
|---|---|
| `/admin` | Dashboard: platform stats overview |
| `/admin/users` | Paginated user list with search + filter |
| `/admin/users/[userId]` | Master-detail user view: info, block, role, limits, plan |
| `/admin/config` | Platform configuration editor |
| `/admin/governance` | Per-product governance editor with Monaco-backed prompt/injection/nginx sections |

The admin UI uses the same shadcn/ui primitives and Tailwind semantic tokens as the rest of the
application.  It is not linked from the user-facing navigation and is invisible to regular users.

---

## Seed

The `apps/api/src/scripts/seed.ts` script creates a superadmin account if it does not already
exist.  Credentials are read from environment variables:

| Variable | Default |
|---|---|
| `SUPERADMIN_EMAIL` | `superadmin@andy-code-cat.local` |
| `SUPERADMIN_PASSWORD` | *(no default — must be set explicitly in production)* |

If `SUPERADMIN_PASSWORD` is not set, the seed script logs a warning and skips superadmin creation
(the regular seed user is created regardless).

---

## Environment Variables

Add the following to `.env.example` (no defaults with real values):

```
# Super Admin seed credentials — override in production
SUPERADMIN_EMAIL=superadmin@andy-code-cat.local
SUPERADMIN_PASSWORD=
```

---

## Out of Scope (Future Milestones)

- Limit enforcement in use-cases (billing milestone)
- License purchase flows / Stripe integration
- Admin impersonation ("login as user")
- Audit log dedicated collection
- Multi-admin delegation (granting `admin` role access to sub-sections)
- Cost dashboard with token spend per user

---

## Related Documents

- [Architecture overview](../architecture/BOOTSTRAP_ARCHITECTURE.md)
- [Security baseline](../security/SECURITY_BASELINE.md)
- [Testable steps runbook](../runbooks/TESTABLE_STEPS.md)
- [Code agent index](../agents/CODE_AGENT_INDEX.md)
