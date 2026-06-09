# Global Brand Identity System — Implementation Spec

**Status:** planned  
**Branch target:** `develop`  
**Milestone tag:** `R4-brand-identity`

---

## 0. Purpose

This spec defines the Global Brand Identity System: a hierarchical, additive asset-injection pipeline that lets platform operators (superadmin), individual users, and individual projects define reusable brand assets — logos, color palettes, contact details, taglines, etc. — which are silently and automatically injected into every LLM system prompt without requiring the user to re-attach or re-specify them each time.

---

## 1. Reusability Audit — What Already Exists

Before reading the implementation plan, sub-agents MUST understand what is already in place and reused directly. Do NOT reinvent these.

| Existing piece | File | Reused how |
|---|---|---|
| File storage abstraction | `apps/api/src/infra/storage/StorageFactory.ts` + `IFileStorage.ts` | Brand file uploads use `getFileStorage()` unchanged |
| Multer upload middleware | `apps/api/src/presentation/http/routes/projectAssetRoutes.ts` lines 40–43 | Copy the same `multer({ storage: memoryStorage(), limits: { fileSize: 20MB } })` |
| Auth middleware | `authMiddleware.ts` | All brand-asset routes require it |
| `requireSuperAdmin` | `apps/api/src/presentation/http/middlewares/requireSuperAdmin.ts` | Platform-scope routes added inside `createAdminRoutes()` reuse this |
| Sandbox middleware | `createSandboxMiddleware` | Project-scope routes added inside `createProjectAssetRoutes()` reuse this |
| File download stream pattern | `projectAssetRoutes.ts` lines 706–752 | Brand asset download handler uses identical `storage.createReadStream(filePath).pipe(res)` |
| Mongo repository pattern | `MongoUserStyleProfileRepository.ts` | `MongoBrandAssetRepository` follows the same `Document` interface + `toEntity()` + `createIndex` pattern |
| `composeSystemPrompt` orchestration | `systemPromptComposer.ts` | Receives one new optional `brandContextLayer?: string` param; chain order preserved |
| `systemPromptLayers.ts` | existing file | One new exported function `buildGlobalBrandLayer` is appended; nothing else changes |
| `llmRoutes.ts` | existing file | One `ResolveBrandContext` call inserted before `composeSystemPrompt`; nothing else changes |
| `adminRoutes.ts` | existing file | Platform brand-asset routes appended to the existing router; no new route file |
| `userProfileRoutes.ts` | existing file | User brand-asset routes appended to the existing router; no new route file |
| `projectAssetRoutes.ts` | existing file | Project brand-asset routes appended to the existing router; no new route file |

**Net new files required (minimal list):**

```
apps/api/src/domain/entities/BrandAsset.ts
apps/api/src/domain/repositories/BrandAssetRepository.ts
apps/api/src/infra/repositories/MongoBrandAssetRepository.ts
apps/api/src/application/use-cases/ResolveBrandContext.ts
apps/api/src/application/use-cases/SetBrandAsset.ts
apps/api/src/application/use-cases/ListBrandAssets.ts
apps/api/src/application/use-cases/DeleteBrandAsset.ts
packages/contracts/src/brandAssets.ts
```

No new route files. No new route registrations in `app.ts`. No new Docker service.

---

## 2. Core Concepts

### 2.1 Scope hierarchy

```
platform  (superadmin-managed, applies to ALL users and projects)
  └── user  (user-managed, applies to ALL their projects)
        └── project  (project-managed, applies only to that project)
```

Resolution is **summative, not replacement**: entries from all three scopes are collected and composed, ordered by scope priority. No scope silently overrides another — all applicable entries are injected into the prompt with their scope label.

### 2.2 Usage policy

Each entry carries a `policy`:

- `must_use` — mandatory injection with strong LLM language: "do not omit"
- `prefer` — soft injection: "use unless strong design reason not to"
- `optional` — listed as available; LLM may use at discretion

### 2.3 Value types

| `valueType` | Meaning | Storage |
|---|---|---|
| `asset_ref` | Points to an uploaded file via `storedFilename` + `userId` | File on MinIO/disk |
| `text` | Inline string (name, email, phone, tagline) | DB only |
| `color_list` | Comma-separated hex values (`#003087,#0066CC`) | DB only |
| `url` | External URL (social profile, website) | DB only |

### 2.4 Promote vs upload

Sub-agents implementing routes MUST support two creation paths:

1. **Promote**: reference an existing `ProjectAsset` by `assetId`. The `storedFilename` and `userId` are copied from the existing asset. No file duplication.
2. **Direct upload**: new file uploaded via multipart/form-data, stored via `getFileStorage()` under the brand asset owner's path.

---

## 3. Domain Entity

### `apps/api/src/domain/entities/BrandAsset.ts`

```typescript
export type BrandAssetScope = "platform" | "user" | "project";

export type BrandAssetRole =
    // Visual identity — file assets
    | "brand_logo"
    | "brand_logo_dark"
    | "brand_logo_light"
    | "client_logo"
    | "brand_hero"
    | "brand_pattern"
    | "brand_font_sample"
    // Visual identity — value assets
    | "brand_color_palette"     // textValue = "#hex1,#hex2,..."
    // Textual identity
    | "company_name"
    | "brand_tagline"
    | "contact_email"
    | "contact_phone"
    | "contact_address"
    | "social_instagram"
    | "social_linkedin"
    | "social_website"
    | "legal_vat"
    // Escape hatch
    | "custom";                 // customRoleLabel required

export type BrandAssetPolicy = "must_use" | "prefer" | "optional";
export type BrandAssetValueType = "asset_ref" | "text" | "color_list" | "url";

export interface BrandAsset {
    id: string;
    scope: BrandAssetScope;
    ownerUserId?: string;       // null/undefined only for scope=platform
    projectId?: string;         // only for scope=project
    role: BrandAssetRole;
    customRoleLabel?: string;   // only when role="custom"; max 80 chars
    policy: BrandAssetPolicy;
    valueType: BrandAssetValueType;
    // asset_ref fields
    storedFilename?: string;    // filename as stored on disk (from upload or promote)
    originalName?: string;      // display name
    mimeType?: string;
    fileSize?: number;
    // inline value fields
    textValue?: string;         // text | color_list | url values; max 2000 chars
    // human-readable hint for LLM injection
    description?: string;       // max 200 chars
    isActive: boolean;
    priority: number;           // lower = higher priority; tie-break within scope+role
    createdAt: Date;
    updatedAt: Date;
}

export type CreateBrandAssetInput = Omit<BrandAsset, "id" | "createdAt" | "updatedAt">;
export type UpdateBrandAssetInput = Partial<
    Pick<BrandAsset, "role" | "customRoleLabel" | "policy" | "textValue" | "description" | "isActive" | "priority">
>;
```

---

## 4. Repository Interface

### `apps/api/src/domain/repositories/BrandAssetRepository.ts`

```typescript
import type { BrandAsset, CreateBrandAssetInput, UpdateBrandAssetInput } from "../entities/BrandAsset";

export interface BrandAssetRepository {
    findById(id: string): Promise<BrandAsset | null>;

    // Scoped list queries
    listPlatform(): Promise<BrandAsset[]>;
    listByUser(userId: string): Promise<BrandAsset[]>;
    listByProject(projectId: string, userId: string): Promise<BrandAsset[]>;

    // Hierarchical resolution query — returns all active entries for platform + user + project
    resolveForContext(opts: {
        userId?: string;
        projectId?: string;
    }): Promise<BrandAsset[]>;

    create(input: CreateBrandAssetInput): Promise<BrandAsset>;
    update(id: string, patch: UpdateBrandAssetInput): Promise<BrandAsset>;
    delete(id: string): Promise<boolean>;
}
```

---

## 5. MongoDB Repository

### `apps/api/src/infra/repositories/MongoBrandAssetRepository.ts`

Follow the exact same pattern as `MongoUserStyleProfileRepository.ts`:

- Internal `BrandAssetDocument` interface mirroring the entity with `_id: string`
- `toEntity(doc): BrandAsset` pure mapping function
- `private async collection()` lazy getter that calls `getDb()` and creates indexes
- Required indexes:
  ```
  { scope: 1, ownerUserId: 1 }
  { scope: 1, projectId: 1, ownerUserId: 1 }
  { scope: 1, isActive: 1 }
  ```
- Collection name: `"brand_assets"`

All methods implement the `BrandAssetRepository` interface.

`resolveForContext` implementation:
```typescript
async resolveForContext({ userId, projectId }) {
    const col = await this.collection();
    const conditions: Filter<BrandAssetDocument>[] = [
        { scope: "platform", isActive: true },
    ];
    if (userId) conditions.push({ scope: "user", ownerUserId: userId, isActive: true });
    if (projectId && userId) conditions.push({ scope: "project", projectId, ownerUserId: userId, isActive: true });
    const docs = await col.find({ $or: conditions }).sort({ scope: 1, priority: 1 }).toArray();
    return docs.map(toEntity);
}
```

---

## 6. Use Cases

### 6.1 `ResolveBrandContext`

**File:** `apps/api/src/application/use-cases/ResolveBrandContext.ts`

**Purpose:** Fetches and orders all applicable brand asset entries, then resolves file download URLs for `asset_ref` entries so they can be safely injected into the prompt.

```typescript
export interface ResolvedBrandEntry {
    id: string;
    scope: BrandAssetScope;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    valueType: BrandAssetValueType;
    displayValue: string;     // resolved text, color string, URL, or file download path
    originalName?: string;    // for asset_ref entries
    description?: string;
}

export interface ResolvedBrandContext {
    entries: ResolvedBrandEntry[];   // ordered: platform first, then user, then project
    hasMustUse: boolean;
}
```

**Resolution rules:**

1. Call `brandAssetRepository.resolveForContext({ userId, projectId })`
2. For `asset_ref` entries: `displayValue = /v1/brand-assets/{entry.id}/download`
3. For `text | url` entries: `displayValue = entry.textValue ?? ""`
4. For `color_list`: `displayValue = entry.textValue ?? ""` (the raw hex CSV)
5. Return entries in order: platform (priority ASC) → user (priority ASC) → project (priority ASC)
6. `hasMustUse = entries.some(e => e.policy === "must_use")`

The use case constructor takes `BrandAssetRepository` only. No LLM call, no file I/O.

### 6.2 `SetBrandAsset`

**File:** `apps/api/src/application/use-cases/SetBrandAsset.ts`

Handles both create and update. On create with `sourceAssetId` (promote path), reads `storedFilename`, `originalName`, `mimeType`, `fileSize` from the source `ProjectAsset` via `ProjectAssetRepository.findById`.

Constructor: `(brandAssetRepository, projectAssetRepository)`

### 6.3 `ListBrandAssets`

**File:** `apps/api/src/application/use-cases/ListBrandAssets.ts`

Thin wrapper — delegates to the appropriate repository method based on scope parameter. Constructor: `(brandAssetRepository)`

### 6.4 `DeleteBrandAsset`

**File:** `apps/api/src/application/use-cases/DeleteBrandAsset.ts`

Deletes the DB record. If `asset.valueType === "asset_ref"` and `asset.storedFilename` is set AND the file was NOT promoted from an existing `ProjectAsset` (checked by a `promotedFromAssetId` field), also delete the file from storage. Constructor: `(brandAssetRepository, storage: IFileStorage)`

---

## 7. Contracts (Zod Schemas)

### `packages/contracts/src/brandAssets.ts`

```typescript
import { z } from "zod";

export const BRAND_ASSET_ROLES = [
    "brand_logo", "brand_logo_dark", "brand_logo_light",
    "client_logo", "brand_hero", "brand_pattern", "brand_font_sample",
    "brand_color_palette",
    "company_name", "brand_tagline",
    "contact_email", "contact_phone", "contact_address",
    "social_instagram", "social_linkedin", "social_website",
    "legal_vat", "custom",
] as const;

export const BRAND_ASSET_POLICIES = ["must_use", "prefer", "optional"] as const;
export const BRAND_ASSET_VALUE_TYPES = ["asset_ref", "text", "color_list", "url"] as const;
export const BRAND_ASSET_SCOPES = ["platform", "user", "project"] as const;

// Create via inline value
export const createBrandAssetTextSchema = z.object({
    role: z.enum(BRAND_ASSET_ROLES),
    customRoleLabel: z.string().max(80).optional(),
    policy: z.enum(BRAND_ASSET_POLICIES).default("prefer"),
    valueType: z.enum(["text", "color_list", "url"] as const),
    textValue: z.string().min(1).max(2000),
    description: z.string().max(200).optional(),
    isActive: z.boolean().default(true),
    priority: z.number().int().min(0).max(999).default(0),
});

// Create via promote (reference existing ProjectAsset)
export const promoteBrandAssetSchema = z.object({
    role: z.enum(BRAND_ASSET_ROLES),
    customRoleLabel: z.string().max(80).optional(),
    policy: z.enum(BRAND_ASSET_POLICIES).default("prefer"),
    description: z.string().max(200).optional(),
    isActive: z.boolean().default(true),
    priority: z.number().int().min(0).max(999).default(0),
    sourceAssetId: z.string().uuid(),   // existing ProjectAsset to promote
});

// Patch
export const updateBrandAssetSchema = z.object({
    role: z.enum(BRAND_ASSET_ROLES).optional(),
    customRoleLabel: z.string().max(80).optional(),
    policy: z.enum(BRAND_ASSET_POLICIES).optional(),
    textValue: z.string().max(2000).optional(),
    description: z.string().max(200).optional(),
    isActive: z.boolean().optional(),
    priority: z.number().int().min(0).max(999).optional(),
});

export type CreateBrandAssetTextInput = z.infer<typeof createBrandAssetTextSchema>;
export type PromoteBrandAssetInput = z.infer<typeof promoteBrandAssetSchema>;
export type UpdateBrandAssetInput = z.infer<typeof updateBrandAssetSchema>;

// DTO shape (for HTTP responses)
export interface BrandAssetDto {
    id: string;
    scope: typeof BRAND_ASSET_SCOPES[number];
    ownerUserId?: string;
    projectId?: string;
    role: typeof BRAND_ASSET_ROLES[number];
    customRoleLabel?: string;
    policy: typeof BRAND_ASSET_POLICIES[number];
    valueType: typeof BRAND_ASSET_VALUE_TYPES[number];
    originalName?: string;
    mimeType?: string;
    fileSize?: number;
    textValue?: string;
    description?: string;
    isActive: boolean;
    priority: number;
    downloadUrl?: string;   // only for asset_ref entries
    createdAt: string;
    updatedAt: string;
}
```

Export `BrandAssetDto` and all schemas from `packages/contracts/src/index.ts`.

---

## 8. Layer G — `buildGlobalBrandLayer`

**File:** `apps/api/src/application/llm/systemPromptLayers.ts` — **append** this function; do not modify existing functions.

```typescript
export function buildGlobalBrandLayer(context: ResolvedBrandContext, opts?: { maxChars?: number }): string {
    if (!context.entries.length) return "";

    const budget = opts?.maxChars ?? 4000;
    const SCOPE_LABEL: Record<BrandAssetScope, string> = {
        platform: "Platform",
        user: "User",
        project: "Project",
    };
    const POLICY_LABEL: Record<BrandAssetPolicy, string> = {
        must_use: "MUST USE",
        prefer: "PREFER",
        optional: "OPTIONAL",
    };

    // Group entries by role for readable output
    const grouped = new Map<string, ResolvedBrandEntry[]>();
    for (const entry of context.entries) {
        const key = entry.role === "custom" ? (entry.customRoleLabel ?? "custom") : entry.role;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(entry);
    }

    const lines: string[] = [
        "## GLOBAL BRAND IDENTITY",
        "",
        "Scope hierarchy: Platform → User → Project  |  must_use items are mandatory.",
        "",
    ];

    for (const [roleName, entries] of grouped) {
        lines.push(`### ${roleName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`);
        for (const e of entries) {
            const prefix = `[${POLICY_LABEL[e.policy]} / ${SCOPE_LABEL[e.scope]}]`;
            const value = e.displayValue || "(not set)";
            const desc = e.description ? `  — ${e.description}` : "";
            if (e.valueType === "asset_ref") {
                lines.push(`${prefix} ${e.originalName ?? roleName}: ${value}${desc}`);
                lines.push(`  Use this asset URL as the src for ${roleName} elements in generated HTML.`);
            } else if (e.valueType === "color_list") {
                lines.push(`${prefix} Colors: ${value}${desc}`);
                lines.push(`  Use these exact hex values as the color palette.`);
            } else {
                lines.push(`${prefix} ${value}${desc}`);
            }
        }
        lines.push("");
    }

    if (context.hasMustUse) {
        lines.push(
            "### Mandatory rules",
            "- Items marked [MUST USE] are non-negotiable — include them in every generated artifact.",
            "- Never substitute a must_use logo or color with a placeholder or generic alternative.",
            "- must_use contact details must appear in the appropriate sections (footer, contact page, etc.).",
        );
    }

    const result = lines.join("\n");
    if (result.length > budget) return "";   // skip entirely if over budget rather than truncate mid-entry
    return result;
}
```

**Import needed in `systemPromptLayers.ts`:**
```typescript
import type { ResolvedBrandContext, ResolvedBrandEntry } from "../use-cases/ResolveBrandContext";
import type { BrandAssetScope, BrandAssetPolicy } from "../../domain/entities/BrandAsset";
```

---

## 9. Extending `composeSystemPrompt`

**File:** `apps/api/src/application/llm/systemPromptComposer.ts`

**Change 1** — Add optional `brandContextLayer?: string` to both `composeSystemPrompt` and `composeSystemPromptWithLayers` parameter objects.

**Change 2** — Insert `opts.brandContextLayer ?? ""` between `opts.styleBlock ?? ""` (Layer C) and `opts.documentContextLayer ?? ""` (Layer D) in both array compositions.

**Change 3** — Add `layerG: string` to `ResolvedPromptLayers` interface and assign it `opts.brandContextLayer ?? ""` in `composeSystemPromptWithLayers`.

Final layer order in the composed array:
```
layerA, layerB, layerT, layerC (styleBlock), layerG (brandContextLayer), layerD (documentContextLayer), layerX, layerE, layerF, budgetPolicy, requestSystemPrompt
```

All three changes are purely additive — existing callers that don't pass `brandContextLayer` see zero behavior change.

---

## 10. Integration in `llmRoutes.ts`

**File:** `apps/api/src/presentation/http/routes/llmRoutes.ts`

### 10.1 Repository and use-case construction

In the route factory function, alongside the existing repository instantiations, add:

```typescript
const brandAssetRepository = new MongoBrandAssetRepository();
const resolveBrandContext = new ResolveBrandContext(brandAssetRepository);
```

### 10.2 Call before prompt composition

In both the chat-preview handler and the streaming handler, immediately before the `composeSystemPrompt(...)` call, add:

```typescript
const brandContext = await resolveBrandContext.execute({
    userId: req.auth!.userId,
    projectId: req.sandbox!.projectId,
}).catch(() => ({ entries: [], hasMustUse: false }));
const brandContextLayer = buildGlobalBrandLayer(brandContext, { maxChars: 4000 });
```

Then pass `brandContextLayer` to `composeSystemPrompt`.

**Error isolation:** the `.catch(() => ...)` ensures a brand-asset resolution failure never blocks generation.

---

## 11. HTTP Routes

### Rule: extend existing routers — do NOT create new route files

#### 11.1 Platform scope — append to `createAdminRoutes()` in `adminRoutes.ts`

The router already has `router.use(authMiddleware, requireSuperAdmin)` at the top, so all routes below inherit both guards.

```
GET    /admin/brand-assets                 → listBrandAssets.execute({ scope: "platform" })
POST   /admin/brand-assets                 → text/color/url entry (createBrandAssetTextSchema)
POST   /admin/brand-assets/upload          → multipart upload → SetBrandAsset (asset_ref)
POST   /admin/brand-assets/promote         → promoteBrandAssetSchema → SetBrandAsset
PATCH  /admin/brand-assets/:id             → updateBrandAssetSchema → brandAssetRepository.update
DELETE /admin/brand-assets/:id             → deleteBrandAsset.execute
GET    /admin/brand-assets/:id/download    → stream file via storage.createReadStream
```

Upload storage path for platform assets: `storage.uploadFilePath("platform", "brand", storedFilename)`

#### 11.2 User scope — append to `createUserProfileRoutes()` in `userProfileRoutes.ts`

Routes inherit the existing `authMiddleware` from the router.

```
GET    /users/me/brand-assets              → listBrandAssets.execute({ scope: "user", userId })
POST   /users/me/brand-assets              → createBrandAssetTextSchema
POST   /users/me/brand-assets/upload       → multipart upload → SetBrandAsset (asset_ref)
POST   /users/me/brand-assets/promote      → promoteBrandAssetSchema → SetBrandAsset
PATCH  /users/me/brand-assets/:id          → updateBrandAssetSchema (ownership check: entry.ownerUserId === req.auth.userId)
DELETE /users/me/brand-assets/:id          → ownership check then deleteBrandAsset
GET    /users/me/brand-assets/:id/download → stream file
```

Upload storage path for user assets: `storage.uploadFilePath(userId, "brand", storedFilename)`

#### 11.3 Project scope — append to `createProjectAssetRoutes()` in `projectAssetRoutes.ts`

Routes inherit existing `authMiddleware` + `sandboxMiddleware`.

```
GET    /projects/:projectId/brand-assets              → listBrandAssets.execute({ scope: "project", projectId, userId })
POST   /projects/:projectId/brand-assets              → createBrandAssetTextSchema
POST   /projects/:projectId/brand-assets/upload       → multipart upload → SetBrandAsset
POST   /projects/:projectId/brand-assets/promote      → promoteBrandAssetSchema (source asset must belong to same projectId)
PATCH  /projects/:projectId/brand-assets/:id          → updateBrandAssetSchema (ownership + projectId check)
DELETE /projects/:projectId/brand-assets/:id          → deleteBrandAsset
GET    /projects/:projectId/brand-assets/:id/download → stream file
```

Upload storage path for project assets: `storage.uploadFilePath(userId, projectId, storedFilename)` — same as existing project asset convention.

#### 11.4 Download handler — shared pattern

All three scopes implement the download handler identically:

```typescript
const entry = await brandAssetRepository.findById(req.params.id);
if (!entry || entry.valueType !== "asset_ref") { res.status(404).json(...); return; }
// ownership check per scope
const filePath = storage.uploadFilePath(ownerUserId, scopeFolder, entry.storedFilename!);
const exists = await storage.fileExists(filePath);
if (!exists) { res.status(410).json({ error: "File no longer available" }); return; }
res.setHeader("Content-Type", entry.mimeType ?? "application/octet-stream");
res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(entry.originalName ?? "file")}"`);
const stream = await storage.createReadStream(filePath);
stream.pipe(res);
```

Note `Content-Disposition: inline` (not `attachment`) so browsers can display images directly — needed for the generated HTML `<img src>` use case.

---

## 12. `packages/contracts/src/index.ts`

Add the following exports:

```typescript
export * from "./brandAssets";
```

---

## 13. Prompt-Preview Endpoint

**File:** `apps/api/src/presentation/http/routes/llmRoutes.ts`

The `GET /v1/projects/:projectId/llm/prompt-preview` endpoint calls `composeSystemPromptWithLayers`. Extend it to also call `resolveBrandContext` and pass `brandContextLayer`, then include `layerG` in the response JSON.

---

## 14. Retrocompatibility Invariants

Sub-agents MUST verify these hold after every change:

1. When no `BrandAsset` records exist for a given (userId, projectId) context, `resolveBrandContext` returns `{ entries: [], hasMustUse: false }` and `buildGlobalBrandLayer` returns `""`. Layer G is absent from the composed prompt. **No behavior change for existing users.**

2. All existing `composeSystemPrompt` call sites that do NOT pass `brandContextLayer` continue to compile and behave identically.

3. `ResolvedPromptLayers.layerG` is an additive field. It does not change the existing `layerA`–`layerF` or `budgetPolicy` fields.

4. Existing `projectAssetRoutes.ts` upload/list/delete/download endpoints are untouched. Brand asset routes are added AFTER the existing route definitions.

5. The `BrandAsset` entity and `ProjectAsset` entity are independent. The promote flow reads from `ProjectAsset` at creation time (copies `storedFilename`), but the two records remain independent after that.

---

## 15. Testable Steps (add to `TESTABLE_STEPS.md`)

### Step 11o — Platform brand asset injection

1. As superadmin, `POST /v1/admin/brand-assets` with `{ role: "company_name", valueType: "text", textValue: "Acme Corp", policy: "must_use" }`
2. As superadmin, `POST /v1/admin/brand-assets` with `{ role: "contact_email", valueType: "text", textValue: "hello@acme.com", policy: "must_use" }`
3. As any user, open workspace and send any message
4. Expected: Layer G in the prompt preview contains both entries under `## GLOBAL BRAND IDENTITY`
5. Expected: generated HTML includes "Acme Corp" and "hello@acme.com"

### Step 11p — User-scope brand logo

1. As user, `POST /v1/users/me/brand-assets/upload` with a logo file and `role: "brand_logo"`, `policy: "must_use"`
2. As user, open workspace for any project
3. Expected: Layer G contains `[MUST USE / User] brand logo: <filename>` with a download URL
4. Expected: generated HTML contains an `<img>` with src pointing to the brand asset download URL

### Step 11q — Project overrides are additive

1. Platform has `company_name: "Acme Corp"` (must_use)
2. Project has `client_logo: "ClientX.png"` (must_use)
3. Expected: Layer G contains BOTH entries — platform entry AND project entry
4. Expected: neither entry replaces the other

### Step 11r — Empty context → no Layer G

1. No brand assets defined
2. Expected: `GET /v1/projects/:id/llm/prompt-preview` → `layerG: ""`
3. Expected: composed prompt is identical to before the feature was deployed

---

## 16. Implementation Order for Sub-Agents

Execute in this order to keep the build passing at each step:

| Step | Files | Can build? |
|---|---|---|
| 1 | `BrandAsset.ts` entity | ✅ types only |
| 2 | `BrandAssetRepository.ts` interface | ✅ types only |
| 3 | `packages/contracts/src/brandAssets.ts` + `index.ts` export | ✅ no runtime deps |
| 4 | `MongoBrandAssetRepository.ts` | ✅ DB only |
| 5 | `ResolveBrandContext.ts` use case | ✅ no Layer G yet |
| 6 | `SetBrandAsset.ts`, `ListBrandAssets.ts`, `DeleteBrandAsset.ts` | ✅ |
| 7 | `buildGlobalBrandLayer` appended to `systemPromptLayers.ts` | ✅ |
| 8 | `composeSystemPrompt` + `composeSystemPromptWithLayers` extension | ✅ all existing tests still pass |
| 9 | `llmRoutes.ts` — `resolveBrandContext` + `brandContextLayer` injection | ✅ end-to-end works |
| 10 | Platform routes in `adminRoutes.ts` | ✅ |
| 11 | User routes in `userProfileRoutes.ts` | ✅ |
| 12 | Project routes in `projectAssetRoutes.ts` | ✅ |
| 13 | Prompt-preview endpoint extension | ✅ |
| 14 | Tests + `TESTABLE_STEPS.md` update | ✅ |

---

## 17. Out of Scope for This Milestone

- Frontend UI (admin panel, user settings tab, project settings tab) — separate UI milestone
- `asset://brand/<role>` media manifest integration — post-MVP
- Automatic logo variant generation (dark/light) — post-MVP
- Brand asset sharing across users (multi-tenant agency) — post-MVP
- Removing `ProjectAsset.styleRole` / `useInProject` — these remain as is; the new system is additive
