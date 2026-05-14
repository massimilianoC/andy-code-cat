# User Settings Panel & API Key Management

_Status: Planned — R3.5_  
_Last updated: 2026-04-28_

---

## Overview

This spec covers two tightly related deliverables that share the same motivation: giving users and superadmins a single, role-scoped configuration surface rather than separate parallel interfaces.

### Problem

The platform currently has two disconnected governance surfaces:

- The **superadmin area** (`/admin/*`) manages everything: users, LLM models, platform config, presets.
- The **user** has scattered, minimal configuration options (mostly inline in the workspace).

As the platform grows (BaaS secrets, API keys, LLM preferences, usage dashboards), building separate UI sections for each role would lead to duplicated layouts, diverging patterns, and maintenance debt.

### Solution

1. **API Key System** — users generate long-lived programmatic credentials tied to their account, with CRUD management from the UI. Enables third-party integrations and server-to-server calls without exposing user passwords.

2. **User Settings Panel (`/settings`)** — a unified, tabbed settings shell where both regular users and superadmins land. Each tab queries data scoped to the caller's role: a user sees only their own data; a superadmin sees the same tabs plus additional platform-level tabs.

---

## Design Principles

- **One URL, role-scoped data.** `/settings` is the single settings entry point. Tab visibility and data scope are controlled by the authenticated role.
- **No duplicate interfaces.** Superadmin platform controls are tabs in the same shell, not a separate application.
- **Least privilege by query.** Every API endpoint in `/v1/me/*` returns only data owned by the caller. Superadmin-only endpoints live under `/v1/admin/*` as today.
- **Key shown once.** The full API key value is returned only on creation and never stored in plaintext. Subsequent views show only a masked prefix.
- **Extensible scopes.** The initial scope set is minimal; scopes can be expanded without breaking existing keys.

---

## Part 1 — API Key System

### Entity Model

```typescript
interface ApiKey {
  id: string;                  // MongoDB ObjectId
  userId: string;              // owner
  name: string;                // human label ("CI/CD pipeline", "n8n integration")
  keyPrefix: string;           // first 8 chars of key, e.g. "acc_Xk7m" — shown in lists
  keyHash: string;             // bcrypt(fullKey, 12) — never returned after creation
  scopes: ApiKeyScope[];       // granted permissions
  createdAt: Date;
  expiresAt: Date | null;      // null = never expires
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  status: "active" | "revoked" | "suspended";
}
```

### Key Format

```
acc_<48 bytes base64url-encoded random>
```

Example: `acc_Xk7mQ2vLpR8nZwAb3cDe4fGh5iJk6lMn7oPq8rSt`

- `acc_` prefix disambiguates from JWT Bearer tokens in the auth middleware.
- 48 random bytes = 384 bits of entropy — infeasible to brute-force.
- Full key shown **once** at creation in a copy-to-clipboard modal. Not retrievable after dismissal.

### Scope Set (initial)

| Scope | Allows |
|---|---|
| `projects:read` | Read project metadata and assets |
| `projects:write` | Create/update projects and assets |
| `generate` | Trigger AI generation |
| `publish` | Publish and unpublish pages |
| `*` | Full access (all current and future scopes) |

Scopes are additive. A key with `["projects:read", "publish"]` cannot trigger generation.

### Auth Middleware Extension

The existing `authMiddleware` is extended to detect API key format before attempting JWT validation:

```
Authorization: Bearer acc_Xk7mQ2v...
```

Detection logic (pseudo):
1. Extract Bearer value.
2. If value starts with `acc_` → API key path.
3. Hash the presented key with bcrypt and compare against stored hashes for a candidate lookup (or use a fast prefix index to narrow candidates first).
4. Check `status === "active"`, `expiresAt` not past.
5. Populate `req.auth = { userId, roles, scopes, apiKeyId }` identically to JWT path.
6. Update `lastUsedAt` asynchronously (fire-and-forget, no blocking).
7. If JWT format → existing JWT path unchanged.

**Important:** API key auth does NOT grant roles beyond what the key's scopes allow, even if the user is a superadmin. A `projects:read` key issued by a superadmin can only read projects.

### Rate Limiting

- Per-key rate limit: configurable, default 60 req/min.
- Platform-level override in `PlatformConfig` (superadmin).
- Exceeded limit returns `429 Too Many Requests` with `Retry-After` header.

---

## Part 2 — REST API Endpoints

All endpoints under `/v1/me/api-keys` require a valid JWT Bearer token (not an API key — you cannot use an API key to create more API keys).

### List Keys

```
GET /v1/me/api-keys
```

Response: array of keys with `keyPrefix`, `name`, `scopes`, `status`, `createdAt`, `expiresAt`, `lastUsedAt`. Never includes `keyHash`.

### Create Key

```
POST /v1/me/api-keys
Body: { name, scopes, expiresAt? }
```

Response: full key object **plus** `fullKey` (the only time it is returned).

### Update Key (rename / change expiry / suspend / unsuspend)

```
PATCH /v1/me/api-keys/:id
Body: { name?, expiresAt?, status? }
```

Only `name`, `expiresAt`, and `status` (between `active` and `suspended`) are patchable. Scopes cannot be changed after creation — revoke and recreate.

### Revoke Key

```
DELETE /v1/me/api-keys/:id
```

Sets `status = "revoked"` and `revokedAt = now()`. Irreversible. Returns 204.

### Superadmin: List All Keys

```
GET /v1/admin/api-keys?userId=&status=&page=
```

Superadmin-only. Returns paginated list across all users. Supports filter by `userId` and `status`.

### Superadmin: Revoke Any Key

```
DELETE /v1/admin/api-keys/:id
```

Superadmin can revoke any key. Audit log entry written.

---

## Part 3 — User Settings Panel

### Route

`/settings` — new Next.js page.

### Shell Layout

```
/settings
  ├── [tab: profile]         — name, email, password change
  ├── [tab: api-keys]        — API key CRUD (own keys)
  ├── [tab: usage]           — token consumption, cost summary (own)
  ├── [tab: preferences]     — LLM preferences, UI preferences
  ├── [tab: platform]        — (superadmin only) PlatformConfig, registration policy
  ├── [tab: models]          — (superadmin only) LLM model catalog
  ├── [tab: users]           — (superadmin only) User list, roles, block/unblock
  └── [tab: keys-admin]      — (superadmin only) All API keys, revoke any
```

### Tab Visibility Matrix

| Tab | User | Admin | Superadmin |
|---|---|---|---|
| Profile | ✅ | ✅ | ✅ |
| API Keys | ✅ | ✅ | ✅ |
| Usage | ✅ | ✅ | ✅ |
| Preferences | ✅ | ✅ | ✅ |
| Platform Config | ❌ | ❌ | ✅ |
| LLM Models | ❌ | ❌ | ✅ |
| Users & Roles | ❌ | ❌ | ✅ |
| All API Keys | ❌ | ❌ | ✅ |

Tab visibility is enforced **client-side** (for UX) and **server-side** (for data). The API endpoints enforce role checks independently of what the UI renders.

### Superadmin Migration Path

The existing `/admin/*` routes are **not removed in this milestone**. The Settings panel is built as a new, parallel surface. Migration of superadmin tabs into the settings shell happens incrementally:

1. Build `/settings` with user-facing tabs (Phase 2).
2. Add superadmin-only tabs to the settings shell (Phase 3), pointing to the same existing `/v1/admin/*` endpoints.
3. Deprecate the standalone `/admin` layout in a future cleanup milestone once the settings shell is stable.

This ensures zero regression risk on the existing admin workflow during this milestone.

---

## Part 4 — MongoDB Schema

### Collection: `api_keys`

```javascript
{
  _id: ObjectId,
  userId: ObjectId,           // indexed
  name: String,               // max 64 chars
  keyPrefix: String,          // 8 chars, indexed for display lookups
  keyHash: String,            // bcrypt hash
  scopes: [String],
  status: String,             // "active" | "revoked" | "suspended"
  createdAt: Date,
  expiresAt: Date | null,
  lastUsedAt: Date | null,
  revokedAt: Date | null
}
```

Indexes:
- `{ userId: 1 }` — list by owner
- `{ keyPrefix: 1 }` — fast prefix lookup during auth
- `{ status: 1, expiresAt: 1 }` — housekeeping queries

No TTL index: revoked keys are retained for audit history. Periodic archival can be added separately.

---

## Part 5 — Security Considerations

| Concern | Mitigation |
|---|---|
| Key compromise | Revoke immediately via UI or superadmin. Key is hashed — theft of DB does not expose live keys. |
| Brute force | 384-bit entropy makes search space infeasible. Rate limit on auth endpoint. |
| Privilege escalation | API key scopes are a strict subset — no key can exceed user's own permissions. |
| Key reuse for key management | API keys cannot create/list/revoke other keys. JWT required for key management endpoints. |
| Audit trail | `lastUsedAt`, `revokedAt`, and superadmin revocations are written to execution log. |
| Secret exposure | Full key returned only once, over HTTPS. UI displays a copy-modal with dismissal confirmation. |

---

## Deliverables by Phase

### Phase 1 — API Key Backend (no UI)

- [ ] `ApiKey` domain entity
- [ ] `ApiKeyRepository` interface + `MongoApiKeyRepository`
- [ ] Auth middleware extension (detect `acc_` prefix, validate key)
- [ ] `POST /v1/me/api-keys`
- [ ] `GET /v1/me/api-keys`
- [ ] `PATCH /v1/me/api-keys/:id`
- [ ] `DELETE /v1/me/api-keys/:id`
- [ ] `GET /v1/admin/api-keys`
- [ ] `DELETE /v1/admin/api-keys/:id`
- [ ] MongoDB index migrations

### Phase 2 — Settings Panel Shell + API Keys Tab

- [ ] `/settings` route and tabbed shell layout
- [ ] Profile tab (move from existing settings location if any)
- [ ] API Keys tab: list, create (with copy-once modal), revoke, suspend
- [ ] Responsive layout, i18n keys (IT + EN)

### Phase 3 — Superadmin Integration into Settings

- [ ] Superadmin-only tabs visible in settings shell
- [ ] All API Keys tab (admin view with user filter)
- [ ] Users & Roles tab (migrated from `/admin`, same endpoints)
- [ ] Platform Config tab
- [ ] LLM Models tab
- [ ] `/admin` legacy routes kept alive (not removed) — deprecation notice in code

---

## Testing Checklist

- [ ] Create key → `fullKey` returned once, not in list endpoint
- [ ] Use key as Bearer → authenticates as key's owner with correct scopes
- [ ] Use key with insufficient scope → 403
- [ ] Revoke key → 401 on next use
- [ ] Expired key → 401
- [ ] Suspended key → 401
- [ ] User cannot see or manage another user's keys
- [ ] Superadmin can list all keys across users
- [ ] Superadmin revoke logs to audit trail
- [ ] Settings tabs respect role visibility
- [ ] Settings tab data scoped to own user (not cross-user leak)

---

## Open Questions (to resolve before Phase 1)

1. **Scope enforcement granularity** — should `generate` scope also implicitly require `projects:read`, or are scopes fully independent?
2. **Key limits per user** — max number of active keys per user (suggest 20, configurable in PlatformConfig)?
3. **IP allowlist** — add `allowedIps: string[]` to entity now (empty = unrestricted) for future enforcement, or defer?
4. **Webhook for key events** — out of scope for this milestone, noted for R4 BaaS.
