# DEPRECATED: External API Key Management — Platform Integration Hub

> Deprecated on 2026-05-29.  
> Superseded for image-provider governance by `docs/specs/IMAGE_FETCH_PERSISTENCE_REFACTOR_PROPOSAL.md`.  
> Reason: this plan mixes general API key management with a permissive automatic image fallback policy. The current target architecture requires explicit provider policy, fail-fast or notify fallback behavior, persistent system notifications, and local persistence of stock images before HTML/snapshot use.
>
> Historical value: still useful as background for `ServiceApiKey` encryption/BYOK ideas, but it must not be used as the active image-provider implementation spec.

---

# Legacy Spec: External API Key Management — Platform Integration Hub

> **Status:** Planned — Milestone M-APIKEYS  
> **Date:** 2026-05-13  
> **Scope:** Centralized management of third-party API keys at the platform level (superadmin), with a BYOK-ready architecture for a future per-user override; integration with image services and LLM providers; image fallback policy injected into the base prompt.  
> **Backward compatibility:** maximal — no breaking change to existing entities, no mandatory change to the active LLM pipeline.

---

## 1. Motivation

### 1.1 Current problem

The system manages API keys exclusively through environment variables (`SILICONFLOW_API_KEY`, `OPEN_ROUTER_API_KEY`, `LLM_PROVIDER_API_KEYS_JSON`). This approach:

- is not manageable from the admin UI without SSH/deploy access
- does not support key rotation without restarting the container
- does not support per-user override (BYOK)
- has no audit trail of who inserted/modified a key
- does not cover image services (LoremFlickr, Unsplash, Pexels, Pixabay)
- has no declarative fallback policy for services

### 1.2 Placeholder image problem

The `## IMAGES` section of `DEFAULT_PRE_PROMPT` (in `GetLlmPromptConfig.ts`) has two critical flaws:

1. **`source.unsplash.com` has been deprecated** since April 2023 — it produces broken redirects or 404 errors
2. **`picsum.photos/seed/<keyword>`** is not semantic: the `seed` parameter is a pure hash, producing fixed random images independent of the keyword — completely decontextualized

The IMAGES section must be replaced with sources that support keyword search and have an automatic fallback policy.

---

## 2. Goals of this milestone

1. **`ServiceApiKey` collection** — new MongoDB entity for external API keys, platform scope + scaffold for a future user BYOK
2. **Encryption** — AES-256-GCM with random IV; the raw key is never stored; SHA-256 fingerprint (8 hex chars) visible in the UI
3. **Seeding from env** — on first boot, keys in env are automatically migrated into the collection (non-destructive)
4. **Admin UI — "Integrations" tab** — dedicated panel in the `/admin/` layout, with management per category (LLM, Image, Notification, ...)
5. **Image service registry** — pre-wired image services with a primary/fallback policy; API key bypass for services that don't require one (LoremFlickr, LMStudio)
6. **Image fallback policy** — if the primary service responds non-200, the system automatically tries the fallback
7. **Injection into the base prompt** — `DEFAULT_PRE_PROMPT` becomes dynamic: the `## IMAGES` section is generated at runtime by reading the DB config, with the effective primary + fallback
8. **BYOK-ready architecture** — the data structure includes `scope: "platform" | "user"` and an optional `ownerUserId` for a future per-user override; the UI is active for superadmin only for now
9. **Urgent fix** — removal of `source.unsplash.com` (dead) and addition of LoremFlickr as a no-key-required fallback source

---

## 3. Data architecture

### 3.1 `ServiceApiKey` entity

```typescript
// apps/api/src/domain/entities/ServiceApiKey.ts

/**
 * Category of the external service.
 * Extensible without a breaking change by adding values.
 */
export type ServiceCategory =
  | "llm"           // LLM text generation providers
  | "image"         // Stock/placeholder image services
  | "image_gen"     // AI image generation (e.g. FLUX via SiliconFlow)
  | "notification"  // Telegram, email, etc.
  | "payment"       // Stripe, etc.
  | "analytics"     // Google Analytics, etc.
  | "storage"       // S3-compatible, MinIO overrides
  | "other";

/**
 * Authentication policy of the service.
 * "none" = service accessible without a key (e.g. LoremFlickr, LMStudio local)
 */
export type ServiceKeyPolicy = "api-key" | "bearer" | "none";

/**
 * Scope of the key.
 * "platform" = global installation, managed by the superadmin.
 * "user"     = per-user BYOK override (UI not yet active, structure ready).
 */
export type ServiceKeyScope = "platform" | "user";

export interface ServiceApiKey {
  id: string;                    // Stable UUID

  /** Technical identifier of the service: "siliconflow", "unsplash", "pexels", "loremflickr", ... */
  serviceId: string;

  category: ServiceCategory;

  /** Human-readable label shown in the UI */
  label: string;

  /** Auth policy: if "none", encryptedKey is null and the service is never excluded even without a key */
  keyPolicy: ServiceKeyPolicy;

  /**
   * Key encrypted with AES-256-GCM.
   * Format: base64("<iv:12B>:<tag:16B>:<ciphertext>")
   * Null if keyPolicy === "none".
   */
  encryptedKey?: string | null;

  /**
   * SHA-256 of the first 32 bytes of the raw key, in lowercase hex.
   * Used as a visual fingerprint in the UI (only the prefix is shown: e.g. "a3f9c1b2...").
   * Null if keyPolicy === "none".
   */
  keyFingerprint?: string | null;

  /** Base URL override. If null, the connector's hard-coded default is used. */
  baseUrl?: string | null;

  /** Whether the key is active (included in runtime resolution) */
  isActive: boolean;

  /**
   * Primary service for the category.
   * Exactly 1 record per (category + scope + ownerUserId) should have isDefault=true.
   * Managed by the use-case's upsert.
   */
  isDefault: boolean;

  /**
   * Fallback service for the category.
   * Used if the call to the primary returns non-200.
   * Exactly 1 record per (category + scope + ownerUserId) should have isFallback=true.
   */
  isFallback: boolean;

  /** Scope: platform (superadmin) | user (future BYOK) */
  scope: ServiceKeyScope;

  /** Null for scope=platform. Owner's userId for scope=user (future BYOK). */
  ownerUserId?: string | null;

  /** Extensible additional metadata (e.g. per-key rate limit, region, org ID, ...) */
  metadata?: Record<string, unknown> | null;

  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  updatedByUserId?: string | null;
}
```

### 3.2 MongoDB indexes (collection: `service_api_keys`)

```
{ serviceId: 1, scope: 1, ownerUserId: 1 }   — unique per combination
{ category: 1, scope: 1, isActive: 1 }        — query by category
{ scope: 1, ownerUserId: 1 }                   — BYOK lookup per user
```

### 3.3 `ServiceApiKeyPublic` entity (key-free DTO)

```typescript
// packages/contracts/src/serviceApiKeys.ts

export interface ServiceApiKeyPublicDto {
  id: string;
  serviceId: string;
  category: ServiceCategory;
  label: string;
  keyPolicy: ServiceKeyPolicy;
  hasKey: boolean;                // true if encryptedKey is present
  keyFingerprint?: string | null; // first 8 hex chars of the SHA-256
  baseUrl?: string | null;
  isActive: boolean;
  isDefault: boolean;
  isFallback: boolean;
  scope: ServiceKeyScope;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
```

> **Security rule:** the raw key and the `encryptedKey` are **never** returned via the API. Only `hasKey` and `keyFingerprint`.

---

## 4. Registry of pre-wired services

### 4.1 LLM Providers

| serviceId | label | keyPolicy | default baseUrl | Note |
|-----------|-------|-----------|-----------------|------|
| `siliconflow` | SiliconFlow | `api-key` | `https://api.siliconflow.cn/v1` | Primary provider |
| `openrouter` | OpenRouter | `api-key` | `https://openrouter.ai/api/v1` | Alternative provider |
| `lmstudio` | LM Studio (local) | `none` | `http://lmstudio:1234/v1` | No API key — automatic bypass |

### 4.2 Image Services (stock photo / placeholder)

| serviceId | label | keyPolicy | URL pattern | Note |
|-----------|-------|-----------|-------------|------|
| `pexels` | Pexels | `api-key` | `https://api.pexels.com/v1/search?query={kw}&per_page=1` | Keyword search; 200 req/h free |
| `unsplash` | Unsplash | `api-key` | `https://api.unsplash.com/photos/random?query={kw}` | 50 req/h free |
| `pixabay` | Pixabay | `api-key` | `https://pixabay.com/api/?key={k}&q={kw}&image_type=photo` | CC0, 100 req/min free |
| `loremflickr` | LoremFlickr | `none` | `https://loremflickr.com/{w}/{h}/{kw}` | No key — semantic keyword from Flickr CC0 |
| `picsum` | Lorem Picsum | `none` | `https://picsum.photos/seed/{kw}/{w}/{h}` | No key — deterministic, not semantic, fallback only |

**Default policy for images:**

- **Primary**: `pexels` if an API key is present, otherwise `loremflickr` (no-key bypass)
- **Fallback**: `loremflickr` (always available, no key required)

### 4.3 Future connectors (category scaffold)

| serviceId | category | keyPolicy | Note |
|-----------|-----------|-----------|------|
| `telegram` | `notification` | `api-key` | Bot token |
| `stripe` | `payment` | `api-key` | Secret key |
| `asana` | `other` | `bearer` | Personal Access Token |
| `ga4` | `analytics` | `api-key` | Measurement ID + API secret |

---

## 5. Encryption

### 5.1 AES-256-GCM scheme

```
ENCRYPTION_MASTER_KEY = HKDF-SHA256(
  inputKeyMaterial = env.JWT_ACCESS_SECRET,
  salt             = SHA256(env.MONGODB_DB_NAME + "service-api-keys"),
  info             = "service-api-key-encryption-v1",
  length           = 32 bytes
)
```

The master key is **derived from variables already in env** — no new mandatory variable.

```
encrypt(rawKey: string):
  iv          = crypto.randomBytes(12)
  cipher      = createCipheriv("aes-256-gcm", masterKey, iv)
  ciphertext  = cipher.update(rawKey) + cipher.final()
  authTag     = cipher.getAuthTag()
  stored      = base64url(iv + authTag + ciphertext)   // 12 + 16 + len(rawKey) bytes

fingerprint(rawKey: string):
  SHA256(rawKey)[0..4].toString("hex")   // 8 hex characters
```

### 5.2 Decryption flow (server-side only)

Decryption happens **exclusively** inside `ServiceApiKeyResolver` — an infrastructure adapter that never exposes the raw key outside the infra layer.

---

## 6. Seeding from env (non-destructive migration)

At API bootstrap (or on the superadmin call `POST /admin/service-keys/seed-from-env`), the service:

1. Reads `env.SILICONFLOW_API_KEY`, `env.OPEN_ROUTER_API_KEY`, `env.LLM_PROVIDER_API_KEYS_JSON`
2. For each key found: if a record `{ serviceId, scope: "platform" }` already exists → skip; otherwise → insert
3. Never deletes existing records — it is **additive only**
4. Logs safely: "seeded X service keys from env (no values logged)"

This guarantees that existing deployments keep working identically.

---

## 7. Runtime key resolution

### 7.1 Resolution priority (runtime)

```
1. scope=user, ownerUserId=<currentUser>   (user BYOK — future)
2. scope=platform, isDefault=true          (platform superadmin key)
3. env.providerApiKeys[serviceId]          (env fallback — backward compatibility)
4. no key → service with keyPolicy="none" → bypass
5. no key → service with keyPolicy="api-key" → skip/log warning
```

Having `env` as priority step 3 guarantees **zero breaking change**: deployments that only use env keep working without touching MongoDB.

### 7.2 `ServiceApiKeyResolver` (infra adapter)

```typescript
// apps/api/src/infra/adapters/ServiceApiKeyResolver.ts

export interface ResolvedServiceKey {
  serviceId: string;
  apiKey: string | null;     // null if keyPolicy="none" or no key found
  baseUrl: string;
  keyPolicy: ServiceKeyPolicy;
  source: "db" | "env" | "none"; // internal audit trail
}

export interface ServiceApiKeyResolver {
  resolve(serviceId: string, scope?: ServiceKeyScope, userId?: string): Promise<ResolvedServiceKey>;
  resolveDefault(category: ServiceCategory, scope?: ServiceKeyScope, userId?: string): Promise<ResolvedServiceKey | null>;
  resolveFallback(category: ServiceCategory, scope?: ServiceKeyScope, userId?: string): Promise<ResolvedServiceKey | null>;
}
```

---

## 8. Image fallback policy

### 8.1 Behavior

```
1. Resolve the primary serviceId for category="image" from the DB
2. If keyPolicy="none" → always use it (no API call needed for resolution)
   If keyPolicy="api-key" → resolve apiKey; if no key → skip to fallback
3. Call the primary service with keyword + dimensions
4. If it responds 200 → use the returned URL
5. If it responds non-200, times out (3s), or has no key → call the fallback
6. Fallback: loremflickr (always available, no key, semantic keyword)
7. If the fallback also fails → use deterministic picsum (never fails)
```

### 8.2 Image service connector interface

```typescript
// apps/api/src/infra/adapters/imageServices/IImageService.ts

export interface ImageServiceQuery {
  keyword: string;
  width: number;
  height: number;
}

export interface ImageServiceResult {
  url: string;
  sourceServiceId: string;
  isPlaceholder: boolean;  // true for picsum/loremflickr
}

export interface IImageService {
  serviceId: string;
  requiresApiKey: boolean;
  getImageUrl(query: ImageServiceQuery, apiKey?: string): Promise<ImageServiceResult>;
}
```

Concrete implementations:

- `PexelsImageService` — GET `/v1/search`, returns `photos[0].src.large`
- `UnsplashImageService` — GET `/photos/random?query=`, returns `urls.regular`
- `PixabayImageService` — GET `/?key=&q=&image_type=photo`, returns `hits[0].largeImageURL`
- `LoremFlickrImageService` — builds the URL directly (no HTTP call), keyPolicy=none
- `PicsumImageService` — builds the URL directly (no HTTP call), keyPolicy=none, deterministic

---

## 9. Dynamic injection into the base prompt

### 9.1 Current problem

The `## IMAGES` section in `DEFAULT_PRE_PROMPT` (`GetLlmPromptConfig.ts`) is:

- hardcoded with `source.unsplash.com` (endpoint dead since 2023)
- not reflective of the system's actual configuration

### 9.2 Solution

The `## IMAGES` section becomes **generated at runtime** by the function:

```typescript
// apps/api/src/application/llm/buildImageSourcesBlock.ts

export async function buildImageSourcesBlock(
  resolver: ServiceApiKeyResolver,
  scope: ServiceKeyScope = "platform",
  userId?: string
): Promise<string>
```

This function:

1. Resolves the primary service (`category="image"`, `isDefault=true`)
2. Resolves the fallback service (`category="image"`, `isFallback=true`)
3. Builds the `## IMAGES` section with example URLs for the active service
4. Injects the policy: "if unavailable, use fallback"

### 9.3 Pipeline integration

`GetLlmPromptConfig.execute()` calls `buildImageSourcesBlock()` and replaces the static IMAGES section in the template.

Alternatively (architecturally cleaner), `DEFAULT_PRE_PROMPT` contains a `{{IMAGE_SOURCES_BLOCK}}` marker that is replaced by the function in the composer.

### 9.4 Urgent fix (prerequisite)

**Immediate removal** of `source.unsplash.com/random` from `DEFAULT_PRE_PROMPT` and replacement with LoremFlickr as a contextual, no-key semantic source.

This fix is separate from the DB implementation and can be carried out in Wave 0 (quick fix, no infrastructure needed).

---

## 10. Admin API — New routes

All protected by `authMiddleware + requireSuperAdmin`:

```
GET    /admin/service-keys                          — list all service keys (no raw key)
GET    /admin/service-keys/:id                      — single key detail
POST   /admin/service-keys                          — create/update a service key
PUT    /admin/service-keys/:id                      — update label/baseUrl/flags
DELETE /admin/service-keys/:id                      — delete (soft delete: isActive=false)
POST   /admin/service-keys/seed-from-env            — non-destructive seeding from env
GET    /admin/service-keys/defaults                 — returns primary+fallback per category
PATCH  /admin/service-keys/:id/set-default          — sets as default for the category
PATCH  /admin/service-keys/:id/set-fallback         — sets as fallback for the category
PATCH  /admin/service-keys/:id/toggle               — activate/deactivate
```

### Validation schema (Zod) — `packages/contracts/src/serviceApiKeys.ts`

```typescript
export const createServiceApiKeySchema = z.object({
  serviceId: z.string().min(1).max(64),
  category: z.enum(["llm","image","image_gen","notification","payment","analytics","storage","other"]),
  label: z.string().min(1).max(120),
  keyPolicy: z.enum(["api-key", "bearer", "none"]),
  rawKey: z.string().min(1).optional(),  // create/update only, never in the response
  baseUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  isFallback: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const updateServiceApiKeySchema = createServiceApiKeySchema.partial().omit({ rawKey: true }).extend({
  rotateKey: z.string().min(1).optional(),  // new raw key for rotation
});
```

---

## 11. Admin UI — "Integrations" Tab

### 11.1 Placement in the admin layout

```typescript
// apps/web/app/admin/layout.tsx — add to the nav:
{ href: "/admin/integrations", label: "Integrations", icon: "plug" }
```

### 11.2 `/admin/integrations` page structure

```
┌─────────────────────────────────────────────────────┐
│ Integration Hub                                      │
│ Manage API keys and connectors for external services │
├─────────────────────────────────────────────────────┤
│ [LLM Providers] [Image Services] [Notifications]    │  ← Tabs per category
│                 [Payments]       [Other]             │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │  SiliconFlow                    [Default] ● ON  │ │  ← ServiceKeyCard
│ │  api-key • ••••••••a3f9c1b2    [Edit] [Delete]  │ │
│ │  Base URL: https://api.siliconflow.cn/v1         │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │  OpenRouter                     [Fallback] ● ON │ │
│ │  api-key • ••••••••b7e2f0c5    [Edit] [Delete]  │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │  LM Studio (local)              [Inactive] ● ON │ │
│ │  no-key-required • bypass       [Edit]           │ │
│ └─────────────────────────────────────────────────┘ │
│                                        [+ Add key]  │
└─────────────────────────────────────────────────────┘
```

### 11.3 Add/edit key modal

Fields: Service (select from registry), Label, API Key (password input, placeholder "••••••••"), Base URL override (optional), Default (checkbox), Fallback (checkbox), Active (toggle).

**UI rule:** the API key is shown only at the moment it is entered. After saving, the input shows only `••••••••` + the last 8 hex chars of the fingerprint.

---

## 12. Wave-based implementation plan

### Dependencies

```
Wave 0 → no dependency (standalone fix)
Wave 1 → Wave 0 complete
Wave 2 → Wave 1 complete
Wave 3 → Wave 1 + Wave 2 complete
Wave 4 → Wave 3 complete
Wave 5 → Wave 4 complete
Wave 6 → Wave 1 complete (can proceed in parallel with Wave 4-5)
```

---

### Wave 0 — Urgent prompt fix (no-infra, standalone)

**Goal:** remove the reference to `source.unsplash.com` (dead) and add LoremFlickr.  
**Impact:** 1 file, ~20 lines, zero regression risk.  
**Estimated duration:** 1 session.

**Files to change:**

- `apps/api/src/application/use-cases/GetLlmPromptConfig.ts` — `## IMAGES` section in `DEFAULT_PRE_PROMPT`

**Change:**

```
REMOVE:
  ### Unsplash — high-quality topical photos
  URL pattern: https://source.unsplash.com/random/<W>x<H>?<keyword>   ← DEPRECATED
  
REPLACE WITH:
  ### LoremFlickr — keyword-based contextual images (primary free source)
  URL pattern: https://loremflickr.com/<W>/<H>/<keyword>
  Multi-keyword: https://loremflickr.com/<W>/<H>/<keyword1>,<keyword2>
  Examples:
    Hero yoga:    <img src='https://loremflickr.com/1200/600/yoga,wellness' alt='yoga studio'>
    Food card:    <img src='https://loremflickr.com/400/300/food,organic' alt='product'>
    Tech hero:    <img src='https://loremflickr.com/1200/600/technology,office' alt='tech'>
    Avatar:       <img src='https://loremflickr.com/200/200/portrait,professional' alt='team'>
  Use 1-2 keywords derived from the page brief topic — not generic section names.
  No API key required. Returns semantically relevant photos from Flickr CC0.

KEEP (as second fallback):
  ### Lorem Picsum — deterministic fallback (use only if LoremFlickr unavailable)
  URL pattern: https://picsum.photos/seed/<word>/<W>/<H>
  Note: seed is a hash, not a semantic search. Use only for decorative/non-topic images.
```

---

### Wave 1 — Entity + Repository + Encryption (backend core)

**Goal:** data foundations. No UI, no change to the existing pipeline.  
**Backward compatible:** yes, everything is additive.

**Files to create:**

- `apps/api/src/domain/entities/ServiceApiKey.ts`
- `apps/api/src/domain/repositories/ServiceApiKeyRepository.ts`
- `apps/api/src/infra/crypto/serviceApiKeyCrypto.ts` — encrypt/decrypt/fingerprint with AES-256-GCM
- `apps/api/src/infra/repositories/MongoServiceApiKeyRepository.ts` — `service_api_keys` collection
- `apps/api/src/infra/adapters/ServiceApiKeyResolver.ts` — priority resolution (db → env → none)
- `packages/contracts/src/serviceApiKeys.ts` — DTOs and Zod schemas
- `apps/api/src/application/use-cases/SeedServiceKeysFromEnv.ts` — non-destructive migration

**Files to change:**

- `apps/api/src/config.ts` — add optional image variables (`PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `PIXABAY_API_KEY`) as optional in the Zod schema
- `apps/api/src/infra/db/mongooseSchemas.ts` (or equivalent) — add the `service_api_keys` schema
- `apps/api/src/container.ts` (or bootstrap) — register the new repository/adapter

**Tests:**

- Unit test `serviceApiKeyCrypto.ts` — encrypt→decrypt roundtrip, deterministic fingerprint
- Unit test `SeedServiceKeysFromEnv` — verifies it does not overwrite existing keys

---

### Wave 2 — Admin API routes

**Goal:** CRUD backend for key management from the UI.

**Files to create:**

- `apps/api/src/application/use-cases/ManageServiceApiKeys.ts` — use-cases: create, update, delete, setDefault, setFallback
- `apps/api/src/presentation/http/routes/adminServiceKeyRoutes.ts`

**Files to change:**

- `apps/api/src/presentation/http/routes/adminRoutes.ts` — mount the new route handler
- `packages/contracts/src/admin.ts` — import and re-export the new schemas

**Deliverable:** `GET /admin/service-keys` endpoint working and testable with curl/Postman.

---

### Wave 3 — Image service connectors + fallback policy

**Goal:** concrete connectors for image services with automatic fallback.

**Files to create:**

- `apps/api/src/infra/adapters/imageServices/IImageService.ts`
- `apps/api/src/infra/adapters/imageServices/PexelsImageService.ts`
- `apps/api/src/infra/adapters/imageServices/UnsplashImageService.ts`
- `apps/api/src/infra/adapters/imageServices/PixabayImageService.ts`
- `apps/api/src/infra/adapters/imageServices/LoremFlickrImageService.ts` — no HTTP call, URL builder
- `apps/api/src/infra/adapters/imageServices/PicsumImageService.ts` — no HTTP call, URL builder
- `apps/api/src/infra/adapters/imageServices/ImageServiceRegistry.ts` — factory + fallback orchestrator

**Fallback behavior:**

```
resolve(keyword, w, h) {
  primary = resolver.resolveDefault("image")
  if (primary && primary.keyPolicy != "none" && !primary.apiKey) → skip to fallback
  try { result = await primary.getImageUrl(query, primary.apiKey); return result; }
  catch/non-200 → try fallback
  fallback = resolver.resolveFallback("image")
  return fallback.getImageUrl(query)  // LoremFlickr or Picsum — always succeeds
}
```

---

### Wave 4 — Dynamic injection into the prompt

**Goal:** the `## IMAGES` section of the pre-prompt reflects the actual DB configuration.

**Files to create:**

- `apps/api/src/application/llm/buildImageSourcesBlock.ts`

**Files to change:**

- `apps/api/src/application/use-cases/GetLlmPromptConfig.ts` — `DEFAULT_PRE_PROMPT` uses `{{IMAGE_SOURCES_BLOCK}}` as a marker; the replacement happens in `execute()`
- `apps/api/src/application/llm/systemPromptComposer.ts` — or alternatively, the replacement happens here

**Note:** if the DB resolver is unavailable (cold startup path), `buildImageSourcesBlock()` falls back to the static version with LoremFlickr (Wave 0 output).

---

### Wave 5 — Admin UI "Integrations" tab

**Goal:** visual API key management for the superadmin.

**Files to create:**

- `apps/web/app/admin/integrations/page.tsx`
- `apps/web/components/admin/integrations/ServiceKeyCard.tsx`
- `apps/web/components/admin/integrations/ServiceKeyModal.tsx`
- `apps/web/components/admin/integrations/ServiceKeyCategoryTabs.tsx`
- `apps/web/lib/api/serviceKeys.ts` — client API hooks

**Files to change:**

- `apps/web/app/admin/layout.tsx` — add the "Integrations" entry to the nav
- `apps/web/lib/api/admin.ts` (or equivalent) — add calls to the new endpoint

**UI rules (from AGENTS.md):**

- Use `Card`, `Button`, `Input`, `Badge`, `Dialog` from `@/components/ui/`
- Use semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`)
- No inline styles

---

### Wave 6 — LLM provider resolution via DB (parallel to Wave 4-5)

**Goal:** LLM API key resolution reads from the DB before env.  
**This closes the loop:** adding a SiliconFlow key from the admin UI → works immediately in generation.

**Files to change:**

- `apps/api/src/infra/llm/` — everywhere `env.providerApiKeys[provider]` is called, replace with `ServiceApiKeyResolver.resolve(provider)`, which applies the db→env priority
- Backward compatibility: resolver step 3 is always `env.providerApiKeys[provider]`, so env-only deployments keep working

---

## 13. Backward compatibility — guarantees

| Existing behavior | Impact of this milestone |
|-------------------------|----------------------------|
| API key in env only | Keeps working — resolver step 3 |
| LLM generation with env key | No change until Wave 6 |
| Static `DEFAULT_PRE_PROMPT` | Wave 0 fix, Wave 4 optional upgrade |
| Existing `PlatformConfig` | Unmodified — new, separate collection |
| Existing `LlmProviderCatalog` | Unmodified — providers keep their current structure |
| Deploy without a service-keys DB | Works — the resolver has an env fallback |
| Users without BYOK | Not impacted — scope="user" not yet visible in the UI |

---

## 14. Security notes

- **Never log the raw API key** — not even in debug mode
- **Never return `encryptedKey`** via the API — only `hasKey` + `keyFingerprint`
- **Key rotation**: updates the record with `rotateKey` — the old encrypted value is overwritten
- **Master key derivation** uses `JWT_ACCESS_SECRET` — if this secret changes, keys in the DB are no longer decryptable: document this risk in the runbook
- **Audit log**: every create/update/delete logs userId + serviceId + timestamp (no key value)
- **Endpoint rate limit**: the `/admin/service-keys` routes share the global admin rate limit

---

## 15. Required documentation updates

On completion of each wave:

- `docs/INDEX.md` — add a reference to this spec
- `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` — add a section on the `service_api_keys` collection
- `docs/runbooks/TESTABLE_STEPS.md` — add a smoke-test step for the new endpoint
- `.env.example` — add the optional image variables, commented out (Wave 1)
- `docs/agents/CODE_AGENT_INDEX.md` — update with the new file paths for this feature

---

## 16. Deliverable checklist for milestone closure

- [ ] Wave 0: `source.unsplash.com` removed, LoremFlickr added to `DEFAULT_PRE_PROMPT`
- [ ] Wave 1: `ServiceApiKey` entity + repository + crypto + resolver working
- [ ] Wave 1: `SeedServiceKeysFromEnv` non-destructive and working
- [ ] Wave 2: all admin CRUD endpoints working and testable
- [ ] Wave 3: image connectors with fallback policy tested (primary non-200 → fallback)
- [ ] Wave 3: LoremFlickr and Picsum no-key bypass working
- [ ] Wave 4: `buildImageSourcesBlock()` injects the dynamic IMAGES section into the pre-prompt
- [ ] Wave 5: "Integrations" tab visible and functional for superadmin
- [ ] Wave 5: API key not visible after saving (fingerprint only)
- [ ] Wave 6: LLM generation uses the DB key if present, env as fallback
- [ ] All env-only deployments keep working without modification
