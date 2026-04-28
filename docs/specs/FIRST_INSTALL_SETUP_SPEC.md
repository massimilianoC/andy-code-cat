# First Install & Guided Setup Wizard

**Status:** Planned → R0.5 milestone
**Supersedes:** Env-var-only superadmin seed in `SUPER_ADMIN_SPEC.md § Seed`
**Author:** Architecture team
**Date:** 2026-04-27

---

## Purpose

On a fresh deployment of Andy Code Cat there is no superadmin account and no platform configuration.
Today the only way to bootstrap the system is to set `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` env vars
and rerun a seed script — an operator-only, console-access-required flow that is not usable by
self-hosters or first-time deployers.

This spec defines a **guided installation wizard** accessible at `/install` that covers:

1. Detecting whether the system has been installed (no superadmin exists yet).
2. Collecting first-superadmin credentials and display name.
3. Collecting core server configuration (public domain, storage settings, registration policy).
4. Seeding first platform instances (platform config singleton, default provider placeholder).
5. Locking the installer permanently after first completion.

The design is intentionally similar to the WordPress `/wp-admin/install.php` pattern: self-contained,
visible only before setup, permanently closed after.

---

## Scope

| In scope | Out of scope |
|---|---|
| `/install` detection endpoint | Licence key activation |
| Guided multi-step setup wizard UI | Stripe / billing onboarding |
| First superadmin account creation | Automated SSL provisioning |
| Core platform config (domain, registration, storage) | Multi-node cluster setup |
| Seed of initial PlatformConfig singleton | Import/migration from another instance |
| Auto-lock after completion | Reset/reinstall flow |

---

## State Machine

```
System state           Route behaviour
──────────────────────────────────────────────────────────────
NOT_INSTALLED          GET /install → 200 { installed: false }
                       POST /install → 201 (creates superadmin + config, locks)
                       All other routes → 307 Redirect /install (optional guard)

INSTALLED              GET /install → 200 { installed: true }
                       POST /install → 409 { error: "Already installed" }
                       Normal routes function normally
```

The "installed" state is determined by a single DB check:

```ts
const superadminExists = await userRepo.existsWithRole("superadmin");
```

No additional migration table or boolean flag is needed. If a superadmin exists, the system
is considered installed. This is idempotent and survives container restarts, DB upgrades, and
partial migrations.

---

## API Endpoints

### `GET /v1/install`

Public — no auth required.

**Response**

```json
// Not installed
{ "installed": false }

// Already installed
{ "installed": true }
```

Used by the frontend wizard to decide what to render on `/install`.

---

### `POST /v1/install`

Public — no auth required. Only succeeds when `installed === false`.

**Request body**

```ts
interface InstallRequest {
    // Step 1 — First superadmin account
    superadmin: {
        email: string;           // valid email
        password: string;        // min 12 chars
        displayName: string;     // non-empty
    };

    // Step 2 — Server configuration
    server: {
        publicDomain: string;       // e.g. "example.com" or "localhost"
        registrationOpen: boolean;  // allow public self-registration after install
        emailVerificationRequired: boolean;
        appName?: string;           // override default "Andy Code Cat"
    };

    // Step 3 — Storage (optional — can remain env-var driven)
    storage?: {
        minioEndpoint?: string;
        minioBucket?: string;
        minioAccessKey?: string;
        minioSecretKey?: string;
    };
}
```

**Success response — 201 Created**

```json
{
    "message": "Installation complete.",
    "userId": "<superadmin-user-id>"
}
```

The response intentionally does NOT return a JWT. The operator must log in normally after setup.
This prevents install tokens being cached in proxies or access logs.

**Error responses**

| Status | Meaning |
|---|---|
| 409 | Already installed — superadmin already exists |
| 422 | Validation error (Zod — field-level errors returned) |
| 500 | Internal error during seed (DB unreachable, etc.) |

---

## Backend Install Sequence

The `POST /v1/install` handler performs these steps atomically (early-return on any failure):

```
1. existsWithRole("superadmin")
   → if true: return 409

2. RegisterUser(email, password, displayName)
   → standard user creation (roles: ["user"])

3. userRepo.setRoles(userId, ["superadmin"])
   → elevates to superadmin

4. platformConfigRepo.createOrUpdate({
       id: "global",
       registrationOpen: server.registrationOpen,
       emailVerificationRequired: server.emailVerificationRequired,
       defaultUserLimits: { /* unlimited defaults */ },
       publicDomain: server.publicDomain,
       appName: server.appName ?? "Andy Code Cat",
       installedAt: new Date(),
       installedByUserId: userId,
   })
   → seeds the PlatformConfig singleton

5. (optional) if storage fields provided:
       platformConfigRepo.updateStorageConfig(storage)

6. return 201 { message: "Installation complete.", userId }
```

Step 3 (`setRoles`) already exists in `MongoUserRepository`. Steps 1–2 reuse existing use-cases.
Step 4 extends `PlatformConfig` with two new scalar fields: `publicDomain`, `appName`, `installedAt`,
`installedByUserId`.

---

## Frontend Wizard — `/install`

Route: `app/install/page.tsx`
Layout guard: `app/install/layout.tsx` — fetches `GET /v1/install` on mount; redirects to `/` if `installed: true`.

### Step flow

```
┌─────────────────────────────────────────────┐
│  Step 1: Welcome & Superadmin credentials   │
│  ─ Email                                    │
│  ─ Password (strength meter)                │
│  ─ Display name                             │
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│  Step 2: Server configuration               │
│  ─ Public domain (e.g. localhost or FQDN)   │
│  ─ App name override (optional)             │
│  ─ Registration open toggle                 │
│  ─ Email verification required toggle       │
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│  Step 3: Storage (MinIO)                    │
│  ─ "Use env defaults" radio (default)       │
│  ─ Custom endpoint / bucket / credentials  │
│  (collapsed by default — only for advanced) │
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│  Step 4: Review & Install                   │
│  ─ Summary of all entered values            │
│  ─ "Install" button → POST /v1/install      │
│  ─ On success: "Setup complete → Go to      │
│    login" link to /login                    │
└─────────────────────────────────────────────┘
```

### Component structure

```
app/install/
├── layout.tsx          ← install-state guard (redirect if installed)
├── page.tsx            ← orchestrates step state and POST call
└── components/
    ├── StepWelcome.tsx
    ├── StepServer.tsx
    ├── StepStorage.tsx
    └── StepReview.tsx
```

The wizard shares the same shadcn/ui primitives and Tailwind semantic tokens as the rest of the app.
It is intentionally minimal — no sidebar, no navbar — an isolated full-page layout with a progress bar.

---

## Security Considerations

1. **No auth required** — the install endpoint must be accessible before any superadmin exists.
2. **Single-use** — the `existsWithRole` check makes it idempotent; the endpoint is a no-op after install.
3. **No install token** — the endpoint returns no JWT; login is a separate, normal flow.
4. **Password strength** — minimum 12 characters enforced at Zod level; the UI adds a strength meter.
5. **Sensitive fields in transit** — the endpoint must be served over HTTPS in production (the nginx
   config already enforces this on the droplet).
6. **Storage credentials** — if the operator provides custom MinIO credentials, they are stored in
   `PlatformConfig` (encrypted at rest if the planned envelope encryption is enabled in R4).
   Until R4, credentials go into the same config doc as other platform settings and are not
   returned in any GET response (field is write-only via the config API).
7. **Rate limiting** — the install endpoint should be rate-limited to 5 req/min per IP to prevent
   brute-force completion races (the race window is very small but worth closing).

---

## Manual DB Promotion (Emergency / Dev)

If the wizard is not yet deployed or the container is unreachable, a superadmin can be promoted
directly from `mongosh`. This is the **only supported out-of-band path**:

```bash
# 1. Connect to the running MongoDB container
docker exec -it andy-code-cat-mongodb mongosh

# 2. Switch to the application database
use andy-code-cat

# 3. Find the user by email
db.users.findOne({ email: "your@email.com" }, { email: 1, roles: 1 })

# 4. Promote to superadmin
db.users.updateOne(
    { email: "your@email.com" },
    { $set: { roles: ["superadmin"] } }
)

# 5. Verify
db.users.findOne({ email: "your@email.com" }, { email: 1, roles: 1 })
# Expected: { email: "your@email.com", roles: ["superadmin"] }

# 6. The JWT cache in Redis will expire naturally (access tokens live 15m).
#    Force logout if you need immediate effect: delete the session or wait for token expiry.
```

> After promotion the user must log out and log back in to get a new JWT that carries
> the `superadmin` role claim.

For **Redis session invalidation** (if needed immediately):

```bash
docker exec -it andy-code-cat-redis redis-cli -p 6379
# List sessions for the user (pattern depends on key naming):
KEYS "session:*"
# or use SCAN for production-safe iteration:
SCAN 0 MATCH "refresh:*" COUNT 100
# Delete a specific key:
DEL refresh:<token-or-userId>
```

---

## PlatformConfig Schema Additions

These fields extend the existing `PlatformConfig` interface (additive, backward-compatible):

```ts
interface PlatformConfig {
    // ... existing fields ...

    // Added by installer
    publicDomain: string;          // e.g. "example.com" or "localhost"
    appName: string;               // display name, default "Andy Code Cat"
    installedAt?: Date;            // set once at POST /install; never updated
    installedByUserId?: string;    // userId of the first superadmin
}
```

---

## Delivery Checklist

- [ ] `GET /v1/install` endpoint
- [ ] `POST /v1/install` endpoint with Zod validation
- [ ] `InstallRequest` / `InstallResponse` Zod contracts in `@andy-code-cat/contracts`
- [ ] Extend `PlatformConfig` interface and `MongoPlatformConfigRepository`
- [ ] `app/install/layout.tsx` with install-state guard
- [ ] `app/install/page.tsx` with 4-step wizard
- [ ] Step components: StepWelcome, StepServer, StepStorage, StepReview
- [ ] i18n keys for all wizard copy (IT + EN)
- [ ] Rate-limit middleware on install routes
- [ ] `LOCAL_DOCKER_START.md` note about `/install` on first run
- [ ] Update `SUPER_ADMIN_SPEC.md § Seed` to reference this spec

---

## Related Documents

- [SUPER_ADMIN_SPEC.md](SUPER_ADMIN_SPEC.md) — superadmin role model and admin API
- [ROADMAP.md](../project/ROADMAP.md) — milestone placement (R0.5)
- [LOCAL_DOCKER_START.md](../guides/LOCAL_DOCKER_START.md) — local dev stack and safe rebuild
- [BETA_LAUNCH_HARDENING_PLAN.md](../runbooks/BETA_LAUNCH_HARDENING_PLAN.md) — deployment readiness
