# Cost Transaction Ledger — System-Wide Specification

**Status:** Proposed — v1.0  
**Author:** Architecture team  
**Date:** 2026-05-14  
**Branch target:** `feat/cost-transaction-ledger`

---

## 1. Executive Summary

The current cost-tracking implementation embeds cost metadata as denormalized fields on other domain
objects (`Conversation`, `PromptExecutionLog`, `ProjectAsset`, `User.tokensConsumedLifetime`).  
While this is adequate for approximate analytics, it creates several structural weaknesses:

- Project total cost requires aggregating across 3+ collections with different schemas.
- Platform markup, infrastructure cost share, and provider cost are not independently tracked
  per event — only a final rolled-up `amount` survives.
- There is no enforcement surface: the cost data is informational only.
- User-level and project-level cost policies cannot be evaluated atomically.
- New resource types (embeddings, compute jobs, fixed platform fees) cannot be added without
  modifying multiple unrelated entities.

This spec defines a **`cost_transactions` collection** — an append-only, atomic, fully-indexed
ledger of every cost event in the system — alongside a configurable **`cost_rates`** document
stored in `PlatformConfig` and managed through a new SuperAdmin **Cost Policy** tab.

Existing metadata on conversations, prompt logs, and assets is **preserved as-is** (no regression,
no refactor of existing objects).  The ledger is purely additive.

---

## 2. Design Goals

| Goal | Description |
|---|---|
| **Atomicity** | Each billable action emits exactly one `CostTransaction` record |
| **Immutability** | Transactions are write-once; corrections are new offsetting entries |
| **Traceability** | Every transaction carries the originating object reference (`sourceRef`) |
| **Composability** | Project cost = `$sum costTransactions.total_eur WHERE projectId = X` |
| **Configurability** | All rate parameters live in `PlatformConfig.costRates` — no code changes required |
| **Auditability** | SuperAdmin can inspect, filter, and export any slice of the ledger |
| **Extensibility** | New resource types are added by extending `ResourceType` enum only |

---

## 3. Ledger Collection — `cost_transactions`

### 3.1 Document Schema

```typescript
interface CostTransaction {
  // ── Identity ────────────────────────────────────────────────────────
  _id: ObjectId;
  txId: string;                    // human-readable "TX-YYYYMMDD-XXXXXXXX"

  // ── Sandbox ─────────────────────────────────────────────────────────
  userId: ObjectId;                // JWT sub — always required
  projectId: ObjectId;             // x-project-id — always required

  // ── Resource classification ──────────────────────────────────────────
  resourceType: ResourceType;      // see §3.2
  resourceSubtype?: string;        // e.g. model id, image size, task key

  // ── Cost decomposition (all amounts in EUR unless noted) ────────────
  providerCostUsd: number;         // raw USD charged by third-party provider (0 if local/internal)
  providerCostEur: number;         // = providerCostUsd × rates.usdToEurRate
  infraCostEur: number;            // platform infrastructure share (compute, bandwidth, storage)
  platformMarkupEur: number;       // = (providerCostEur + infraCostEur) × rates.platformMarkupPct
  totalEur: number;                // = providerCostEur + infraCostEur + platformMarkupEur

  // ── Rate snapshot (immutable copy of rates at time of transaction) ───
  ratesSnapshot: CostRatesSnapshot;

  // ── Units consumed ───────────────────────────────────────────────────
  units: CostUnits;

  // ── Source reference (one of, depending on resourceType) ─────────────
  sourceRef: CostSourceRef;

  // ── Contextual metadata ───────────────────────────────────────────────
  meta: Record<string, unknown>;   // arbitrary typed metadata (provider, model, finishReason…)

  // ── Status ───────────────────────────────────────────────────────────
  status: "settled" | "voided";    // voided only via admin correction entry
  voidedBy?: ObjectId;             // txId of the corrective entry

  createdAt: Date;                 // insertion timestamp (immutable)
}
```

### 3.2 `ResourceType` Enum

```typescript
enum ResourceType {
  // ── LLM ─────────────────────────────────────────────────────────────
  LLM_CHAT          = "llm.chat",           // conversational LLM call
  LLM_PREPROMPT     = "llm.preprompt",      // pre-prompt evaluation
  LLM_PROMPT_OPT    = "llm.prompt_opt",     // prompt optimizer
  LLM_TEMPLATE_DRAFT = "llm.template_draft",// DraftProjectTemplate
  LLM_EMBEDDING     = "llm.embedding",      // embedding generation
  LLM_BACKGROUND    = "llm.background",     // background task LLM calls

  // ── Image / Video ────────────────────────────────────────────────────
  IMAGE_GEN         = "image.gen",          // image generation (FLUX, DALL-E…)
  IMAGE_PROMPT_OPT  = "image.prompt_opt",   // OptimizeImagePrompt
  IMAGE_SUGGEST     = "image.suggest",      // SuggestProjectImageIdea
  VIDEO_GEN         = "video.gen",          // future video generation

  // ── Compute / Internal ───────────────────────────────────────────────
  COMPUTE_TASK      = "compute.task",       // background deterministic job (local or cloud fn)
  COMPUTE_GPU       = "compute.gpu",        // local GPU inference (no third-party cost)
  COMPUTE_LAMBDA    = "compute.lambda",     // cloud function invocation
  COMPUTE_STORAGE   = "compute.storage",   // storage I/O beyond free tier

  // ── Platform fees ────────────────────────────────────────────────────
  PLATFORM_EXPORT   = "platform.export",   // export/publish action
  PLATFORM_DOMAIN   = "platform.domain",   // custom domain provisioning
  PLATFORM_EVENT    = "platform.event",    // metered platform event
  PLATFORM_FIXED    = "platform.fixed",    // fixed one-time charge
}
```

### 3.3 Supporting Types

```typescript
interface CostUnits {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  imageCount?: number;
  videoSeconds?: number;
  computeMs?: number;               // wall-clock milliseconds for compute tasks
  storageBytes?: number;
}

interface CostSourceRef {
  // Exactly one of these is populated
  conversationId?: ObjectId;       // LLM_CHAT, LLM_BACKGROUND
  messageId?: string;              // specific message within a conversation
  backgroundTaskId?: string;       // backgroundTask._id string
  promptExecutionLogId?: ObjectId; // LLM_PREPROMPT, LLM_PROMPT_OPT, LLM_TEMPLATE_DRAFT
  assetId?: ObjectId;              // IMAGE_GEN, IMAGE_SUGGEST, IMAGE_PROMPT_OPT
  enrichmentTraceId?: ObjectId;    // AssetEnrichmentTrace
  backgroundJobId?: ObjectId;      // COMPUTE_TASK, COMPUTE_LAMBDA
  exportId?: ObjectId;             // PLATFORM_EXPORT
  sessionId?: string;              // generic session reference
}

interface CostRatesSnapshot {
  // Immutable copy captured at transaction creation time
  usdToEurRate: number;
  platformMarkupPct: number;       // e.g. 0.10 = 10%
  infraCostPct: number;            // e.g. 0.05 = 5% of provider cost
  textEurPer1kTokens: number;      // flat-rate fallback
  imageEurPerAsset: number;
  videoEurPerAsset: number;
  computeEurPerMs: number;
  storageEurPerGbMonth: number;
  snapshotAt: Date;                // when this config snapshot was valid
}
```

### 3.4 MongoDB Indexes

```javascript
// Primary query patterns
db.cost_transactions.createIndex({ userId: 1, createdAt: -1 });
db.cost_transactions.createIndex({ projectId: 1, createdAt: -1 });
db.cost_transactions.createIndex({ userId: 1, projectId: 1, createdAt: -1 });

// Admin / analytics
db.cost_transactions.createIndex({ resourceType: 1, createdAt: -1 });
db.cost_transactions.createIndex({ createdAt: -1 });
db.cost_transactions.createIndex({ status: 1, createdAt: -1 });

// Source reference lookups (all sparse)
db.cost_transactions.createIndex({ "sourceRef.conversationId": 1 }, { sparse: true });
db.cost_transactions.createIndex({ "sourceRef.promptExecutionLogId": 1 }, { sparse: true });
db.cost_transactions.createIndex({ "sourceRef.assetId": 1 }, { sparse: true });
db.cost_transactions.createIndex({ "sourceRef.backgroundJobId": 1 }, { sparse: true });

// Uniqueness guard on human-readable txId
db.cost_transactions.createIndex({ txId: 1 }, { unique: true });
```

---

## 4. Cost Rates Configuration — `PlatformConfig.costRates`

All rate parameters are stored in the existing `platform_configs` collection under the
`PlatformConfig` document.  A new `costRates` sub-document replaces the scattered env-var-only
approach for dynamic parameters (env vars remain as **bootstrap defaults** only).

### 4.1 Schema Addition to `PlatformConfig`

```typescript
interface PlatformCostRates {
  // ── FX & Markup ──────────────────────────────────────────────────────
  usdToEurRate: number;            // default: 0.92
  platformMarkupPct: number;       // default: 0.10  (10%)
  infraCostPct: number;            // default: 0.05  (5% of provider cost)

  // ── Flat-rate fallbacks (used when provider reports no cost) ─────────
  textEurPer1kTokens: number;      // default: 0.005
  imageEurPerAsset: number;        // default: 0.10
  videoEurPerAsset: number;        // default: 0.20

  // ── Internal compute rates ───────────────────────────────────────────
  computeEurPerMs: number;         // default: 0.000001  (~€3.60/hr)
  storageEurPerGbMonth: number;    // default: 0.023

  // ── Provider override table ──────────────────────────────────────────
  // Supersedes siliconflowPricing.ts hardcoded table when present.
  // Key = provider model id, value = USD per million tokens (or per image)
  providerModelOverrides?: Record<string, {
    inputUsdPerMToken?: number;
    outputUsdPerMToken?: number;
    perImageUsd?: number;
    priceUnit: "per_m_tokens" | "per_image";
  }>;

  // ── Fixed fees ───────────────────────────────────────────────────────
  exportEurFixed: number;          // default: 0.00 (free tier)
  domainProvisionEurFixed: number; // default: 0.00

  updatedAt: Date;
  updatedBy: ObjectId;             // superadmin userId
}
```

### 4.2 Priority Resolution Order

When computing a transaction cost, the system resolves rates in this order:

1. **Provider-reported cost** (`usage.cost` from OpenRouter) → converts to EUR with `usdToEurRate`
2. **`providerModelOverrides[modelId]`** from `PlatformConfig.costRates` (live DB config)
3. **`siliconflowPricing.ts` static table** (bundled code fallback)
4. **Flat-rate tokens** (`textEurPer1kTokens × totalTokens / 1000`)

Infra cost and markup are **always applied** on top of whichever base cost is resolved.

---

## 5. Cost Calculation Service

A new `CostTransactionService` (application layer) encapsulates all ledger writes.

### 5.1 Interface

```typescript
// apps/api/src/application/cost/CostTransactionService.ts

interface CreateTransactionInput {
  userId: string;
  projectId: string;
  resourceType: ResourceType;
  resourceSubtype?: string;
  units: CostUnits;
  providerCostUsd?: number;        // pass when provider reports it
  sourceRef: CostSourceRef;
  meta?: Record<string, unknown>;
}

interface CostTransactionService {
  /**
   * Compute cost breakdown from input + current rates, then persist the
   * transaction record.  Returns the settled CostTransaction.
   * This method is idempotent when called with an identical sourceRef key.
   */
  record(input: CreateTransactionInput): Promise<CostTransaction>;

  /**
   * Void an existing transaction and create an offsetting correction entry.
   * Only callable by superadmin.
   */
  void(txId: string, reason: string, adminUserId: string): Promise<CostTransaction>;
}
```

### 5.2 Computation Logic

```typescript
// Pseudocode — actual implementation in CostTransactionService.ts

function computeBreakdown(input, rates): CostBreakdown {
  const providerCostEur = (input.providerCostUsd ?? 0) * rates.usdToEurRate;

  let baseCostEur = providerCostEur;
  if (baseCostEur === 0) {
    // flat-rate fallback
    baseCostEur =
      ((input.units.totalTokens ?? 0) / 1000) * rates.textEurPer1kTokens +
      (input.units.imageCount ?? 0) * rates.imageEurPerAsset +
      (input.units.videoSeconds ?? 0) * rates.videoEurPerAsset +
      ((input.units.computeMs ?? 0)) * rates.computeEurPerMs;
  }

  const infraCostEur = baseCostEur * rates.infraCostPct;
  const platformMarkupEur = (baseCostEur + infraCostEur) * rates.platformMarkupPct;
  const totalEur = baseCostEur + infraCostEur + platformMarkupEur;

  return { providerCostUsd: input.providerCostUsd ?? 0, providerCostEur, infraCostEur, platformMarkupEur, totalEur };
}
```

---

## 6. Integration Points — Where Transactions Are Emitted

The following table maps every current cost-bearing code path to the new `CostTransactionService.record()` call.
Existing metadata on the originating object is **not removed** — it remains as local context.

| Trigger | Location | ResourceType | sourceRef populated |
|---|---|---|---|
| LLM chat (non-streaming) | `llmRoutes.ts` ~L1060 | `LLM_CHAT` | `conversationId`, `messageId` |
| LLM chat (streaming) | `llmRoutes.ts` ~L1543 | `LLM_CHAT` | `conversationId`, `messageId` |
| LLM background task | `llmRoutes.ts` (backgroundTask finalization) | `LLM_BACKGROUND` | `conversationId`, `backgroundTaskId` |
| OptimizeUserPrompt | `OptimizeUserPrompt.ts` | `LLM_PROMPT_OPT` | `promptExecutionLogId` |
| DraftProjectTemplate | `DraftProjectTemplate.ts` | `LLM_TEMPLATE_DRAFT` | `promptExecutionLogId` |
| GenerateProjectImage | `GenerateProjectImage.ts` | `IMAGE_GEN` | `assetId` |
| OptimizeImagePrompt | `prompting/OptimizeImagePrompt.ts` | `IMAGE_PROMPT_OPT` | `promptExecutionLogId` |
| SuggestProjectImageIdea | `prompting/SuggestProjectImageIdea.ts` | `IMAGE_SUGGEST` | `promptExecutionLogId` |
| Pre-prompt evaluation | `PrepromptEngine` (when implemented) | `LLM_PREPROMPT` | `promptExecutionLogId` |
| Embedding generation | `EmbeddingService` (when implemented) | `LLM_EMBEDDING` | `sessionId` |
| Asset enrichment trace | `AssetEnrichmentTrace` writer | `LLM_BACKGROUND` | `enrichmentTraceId` |

> **Rule:** `CostTransactionService.record()` MUST be called before returning the response to the client
> for all synchronous LLM calls, and as the **final step** of any async background job finalization.

---

## 7. Aggregation & Query Patterns

All cost aggregations are trivially expressible as single-collection `$group` pipelines on
`cost_transactions`, removing the need to join across `conversations`, `prompt_execution_logs`,
and `project_assets`.

### 7.1 Project Total Cost

```javascript
db.cost_transactions.aggregate([
  { $match: { projectId: ObjectId("..."), status: "settled" } },
  { $group: { _id: null, totalEur: { $sum: "$totalEur" }, txCount: { $sum: 1 } } }
]);
```

### 7.2 User Cost Breakdown by Project

```javascript
db.cost_transactions.aggregate([
  { $match: { userId: ObjectId("..."), status: "settled" } },
  { $group: { _id: "$projectId", totalEur: { $sum: "$totalEur" }, txCount: { $sum: 1 } } },
  { $sort: { totalEur: -1 } }
]);
```

### 7.3 Platform Cost by Resource Type (Admin)

```javascript
db.cost_transactions.aggregate([
  { $match: { createdAt: { $gte: periodStart, $lte: periodEnd }, status: "settled" } },
  { $group: {
    _id: "$resourceType",
    totalEur: { $sum: "$totalEur" },
    providerCostEur: { $sum: "$providerCostEur" },
    infraCostEur: { $sum: "$infraCostEur" },
    markupEur: { $sum: "$platformMarkupEur" },
    txCount: { $sum: 1 }
  }},
  { $sort: { totalEur: -1 } }
]);
```

### 7.4 Daily Cost Trend

```javascript
db.cost_transactions.aggregate([
  { $match: { projectId: ObjectId("..."), status: "settled" } },
  { $group: {
    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
    totalEur: { $sum: "$totalEur" },
    txCount: { $sum: 1 }
  }},
  { $sort: { "_id": 1 } }
]);
```

### 7.5 Cost by Source Model (top spenders)

```javascript
db.cost_transactions.aggregate([
  { $match: { projectId: ObjectId("..."), status: "settled" } },
  { $group: { _id: "$resourceSubtype", totalEur: { $sum: "$totalEur" }, txCount: { $sum: 1 } } },
  { $sort: { totalEur: -1 } },
  { $limit: 10 }
]);
```

---

## 8. Cost Policy Enforcement

### 8.1 Per-User Limits

The existing `User.limits` structure is extended to support cost-based thresholds:

```typescript
interface UserLimits {
  maxMonthlyTokensK: number;       // existing — token-based cap (-1 = unlimited)
  maxMonthlyCostEur?: number;      // NEW — EUR cap per calendar month (-1 = unlimited)
  maxDailyCostEur?: number;        // NEW — EUR cap per calendar day (-1 = unlimited)
}
```

### 8.2 Per-Project Limits (new)

A `costPolicy` sub-document is added to the `Project` entity:

```typescript
interface ProjectCostPolicy {
  maxTotalCostEur?: number;        // absolute project lifetime cap (-1 = unlimited)
  maxMonthlyCostEur?: number;      // rolling monthly cap (-1 = unlimited)
  alertThresholdPct?: number;      // e.g. 0.80 = alert when 80% of cap is reached
  hardStop: boolean;               // if true: reject requests beyond cap; if false: alert only
}
```

### 8.3 Pre-Request Check (Middleware)

A new `costGuardMiddleware` is injected into the LLM and image-generation route chains:

```
Request
  → authMiddleware (JWT)
  → sandboxMiddleware (user + project ownership)
  → costGuardMiddleware          ← NEW
      reads User.limits + Project.costPolicy
      calls CostPolicyChecker.check(userId, projectId, estimatedCost?)
      rejects 402 if any cap is exceeded in hardStop mode
  → [LLM / image handler]
  → CostTransactionService.record()
```

The `CostPolicyChecker` queries:

1. `SUM(totalEur) WHERE userId=X AND createdAt in current month` (from `cost_transactions`)
2. `SUM(totalEur) WHERE projectId=Y` (project lifetime)

These aggregations are cached with a short TTL (30 s) in Redis to avoid per-request DB hits.

---

## 9. New MongoDB Repositories

### 9.1 `ICostTransactionRepository` (domain interface)

```typescript
// apps/api/src/domain/repositories/ICostTransactionRepository.ts

interface ICostTransactionRepository {
  create(tx: CostTransaction): Promise<CostTransaction>;
  findById(id: string): Promise<CostTransaction | null>;
  findBySourceRef(ref: Partial<CostSourceRef>): Promise<CostTransaction[]>;
  sumByProject(projectId: string, filter?: CostQueryFilter): Promise<CostSummary>;
  sumByUser(userId: string, filter?: CostQueryFilter): Promise<CostSummary>;
  sumByProjectPerType(projectId: string, filter?: CostQueryFilter): Promise<CostTypeBreakdown[]>;
  listByProject(projectId: string, opts: PageOpts): Promise<PagedResult<CostTransaction>>;
  listByUser(userId: string, opts: PageOpts): Promise<PagedResult<CostTransaction>>;
  listAll(filter: AdminCostFilter, opts: PageOpts): Promise<PagedResult<CostTransaction>>;
  platformSummaryByType(filter: DateRangeFilter): Promise<CostTypeBreakdown[]>;
  voidTransaction(txId: string, voidedBy: string): Promise<void>;
}
```

### 9.2 `ICostRatesRepository` (domain interface)

```typescript
// Reads/writes PlatformConfig.costRates
interface ICostRatesRepository {
  getCurrent(): Promise<PlatformCostRates>;
  update(rates: Partial<PlatformCostRates>, updatedBy: string): Promise<PlatformCostRates>;
}
```

---

## 10. New Use-Cases

| Use-case | Path | Trigger |
|---|---|---|
| `RecordCostTransaction` | `application/cost/RecordCostTransaction.ts` | Called by all resource-consuming use-cases |
| `GetProjectCostSummary` | `application/cost/GetProjectCostSummary.ts` | `GET /v1/projects/:id/cost` |
| `GetUserCostSummary` | `application/cost/GetUserCostSummary.ts` | `GET /v1/users/me/cost` |
| `ListProjectTransactions` | `application/cost/ListProjectTransactions.ts` | `GET /v1/projects/:id/cost/transactions` |
| `GetAdminCostDashboard` | `application/cost/GetAdminCostDashboard.ts` | `GET /v1/admin/cost/dashboard` |
| `ListAdminTransactions` | `application/cost/ListAdminTransactions.ts` | `GET /v1/admin/cost/transactions` |
| `UpdateCostRates` | `application/cost/UpdateCostRates.ts` | `PATCH /v1/admin/cost/rates` |
| `VoidCostTransaction` | `application/cost/VoidCostTransaction.ts` | `POST /v1/admin/cost/transactions/:id/void` |

---

## 11. REST API Endpoints

### 11.1 User / Project (tenant-scoped)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/projects/:projectId/cost` | Cost summary for a project (total, by type, trend) |
| `GET` | `/v1/projects/:projectId/cost/transactions` | Paginated transaction list for a project |
| `GET` | `/v1/users/me/cost` | Cost summary for the authenticated user (per project + totals) |

### 11.2 Admin

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/cost/dashboard` | Platform-wide cost dashboard (by type, by period, top projects) |
| `GET` | `/v1/admin/cost/transactions` | Full paginated ledger with filters (user, project, type, date) |
| `GET` | `/v1/admin/cost/transactions/:txId` | Single transaction detail |
| `POST` | `/v1/admin/cost/transactions/:txId/void` | Void a transaction (creates offsetting entry) |
| `GET` | `/v1/admin/cost/rates` | Get current cost rate configuration |
| `PATCH` | `/v1/admin/cost/rates` | Update cost rates (superadmin only) |
| `GET` | `/v1/admin/cost/rates/history` | Rate change audit log |

---

## 12. SuperAdmin UI — Cost Policy Tab

A new **Cost Policy** tab is added to the SuperAdmin dashboard, with four sections:

### 12.1 Rate Configuration Panel

Controls all fields in `PlatformConfig.costRates`:

| Field | Input type | Default |
|---|---|---|
| USD → EUR exchange rate | Decimal input | 0.92 |
| Platform markup % | Percentage slider + input | 10% |
| Infrastructure cost % | Percentage slider + input | 5% |
| Flat-rate: text (EUR / 1k tokens) | Decimal input | 0.005 |
| Flat-rate: image (EUR / asset) | Decimal input | 0.10 |
| Flat-rate: video (EUR / asset) | Decimal input | 0.20 |
| Compute rate (EUR / ms) | Scientific notation input | 0.000001 |
| Storage rate (EUR / GB-month) | Decimal input | 0.023 |
| Export fixed fee (EUR) | Decimal input | 0.00 |
| Domain provisioning fee (EUR) | Decimal input | 0.00 |

Changes are saved as an **atomic update** to `PlatformConfig.costRates` with the superadmin `userId`
and a `updatedAt` timestamp.  All subsequent transactions capture the new snapshot.

### 12.2 Provider Model Overrides Panel

A table-editor for `costRates.providerModelOverrides`:

- Each row: `model id`, `input USD/M tokens`, `output USD/M tokens`, `per-image USD`, `price unit`
- Rows can be added, edited, or deleted
- Changes take effect immediately (no redeploy required)

### 12.3 Platform Cost Dashboard

Read-only analytics view:

- **KPI cards:** total platform cost this month, provider cost share, infra cost share, markup earned
- **Bar chart:** cost by `ResourceType` for selected period
- **Line chart:** daily cost trend (rolling 30 / 90 / 365 days)
- **Table:** top 20 projects by cost in period

### 12.4 Transaction Ledger

Searchable, filterable, paginated table of all `cost_transactions`:

- Filters: `userId`, `projectId`, `resourceType`, `dateRange`, `status`
- Columns: `txId`, `date`, `user`, `project`, `type`, `model/subtype`, `providerUSD`, `infraEUR`, `markupEUR`, `totalEUR`, `status`
- Row expansion: shows full `sourceRef`, `units`, `meta`, `ratesSnapshot`
- Actions: **Void** (superadmin only) — opens confirmation dialog with `reason` field

---

## 13. contracts Package Updates

```typescript
// packages/contracts/src/cost.ts  (new file)

export interface CostTransactionDto {
  txId: string;
  resourceType: string;
  resourceSubtype?: string;
  providerCostUsd: number;
  providerCostEur: number;
  infraCostEur: number;
  platformMarkupEur: number;
  totalEur: number;
  units: CostUnitsDto;
  sourceRef: Record<string, string>;
  status: "settled" | "voided";
  createdAt: string; // ISO 8601
}

export interface ProjectCostSummaryDto {
  projectId: string;
  totalEur: number;
  txCount: number;
  byType: Array<{ resourceType: string; totalEur: number; txCount: number }>;
  trend: Array<{ date: string; totalEur: number }>; // daily
}

export interface AdminCostDashboardDto {
  periodStart: string;
  periodEnd: string;
  totalEur: number;
  providerCostEur: number;
  infraCostEur: number;
  markupEur: number;
  byType: CostTypeBreakdownDto[];
  topProjects: Array<{ projectId: string; totalEur: number }>;
  trend: Array<{ date: string; totalEur: number }>;
}

export interface CostRatesDto {
  usdToEurRate: number;
  platformMarkupPct: number;
  infraCostPct: number;
  textEurPer1kTokens: number;
  imageEurPerAsset: number;
  videoEurPerAsset: number;
  computeEurPerMs: number;
  storageEurPerGbMonth: number;
  exportEurFixed: number;
  domainProvisionEurFixed: number;
  providerModelOverrides: Record<string, ProviderModelOverrideDto>;
  updatedAt: string;
}
```

---

## 14. Migration Strategy

The `cost_transactions` collection starts empty.  Historical data migration is **optional** and
**non-blocking** — the existing `prompt_execution_logs` and `project_assets` collections remain
intact as the source of historical analytics.

A migration script (`scripts/migrate-cost-history.ts`) can be run on demand to back-fill historical
transactions from existing records:

1. Read all `prompt_execution_logs` (paginated, 1000 at a time)
2. For each record, call `CostTransactionService.record()` with `status: "settled"` and
   `createdAt` copied from the original document
3. Read all `project_assets` with `generationMetadata.cost` present
4. Same back-fill process
5. Read all `conversations.messages` with embedded `costEstimate`
6. Same back-fill process — use `conversationId` + `messageId` as idempotency key

The migration script is idempotent: duplicate `sourceRef` keys are skipped.

---

## 15. Dependency Diagram

```
presentation
    llmRoutes.ts ──────────────────────────────────────────────────────────┐
    adminCostRoutes.ts ──────────────────────────────────────────────────┐ │
                                                                         ▼ ▼
application
    RecordCostTransaction ◄── called by all use-cases that consume resources
    GetProjectCostSummary
    ListProjectTransactions
    GetAdminCostDashboard
    UpdateCostRates
    VoidCostTransaction
    CostPolicyChecker (used by costGuardMiddleware)
                │
                ▼
domain
    CostTransaction (entity)
    ICostTransactionRepository (interface)
    ICostRatesRepository (interface)
                │
                ▼
infra
    MongoCostTransactionRepository
    MongoCostRatesRepository (wraps PlatformConfig)
    RedisCostPolicyCache (TTL 30s for policy checks)
```

---

## 16. Non-Goals (Explicitly Out of Scope for This Spec)

| Out of scope | Reason |
|---|---|
| Stripe / payment integration | Covered by `DB_PLATFORM_SPEC.md §2.6` (future milestone) |
| Credit wallet / balance | Separate concern; this spec is the ledger foundation |
| Real-time WebSocket cost push | Nice-to-have; add after ledger is stable |
| Removing existing `costEstimate` metadata from conversations/assets | Breaking change with no immediate benefit |
| Cost forecasting / ML | Post-MVP analytics feature |

---

## 17. Implementation Checklist

### Phase 1 — Foundation (no UI, no enforcement)

- [ ] Create `CostTransaction` domain entity + `ICostTransactionRepository` interface
- [ ] Create `MongoCostTransactionRepository` implementation
- [ ] Create `CostTransactionService` with `record()` and `computeBreakdown()`
- [ ] Add `PlatformCostRates` to `PlatformConfig` schema; seed defaults from env vars
- [ ] Create `ICostRatesRepository` backed by `PlatformConfig.costRates`
- [ ] Wire `CostTransactionService.record()` into all 8 existing cost-bearing use-cases
- [ ] Add `cost_transactions` indexes to MongoDB init
- [ ] Add `CostTransactionDto` and related types to `packages/contracts`

### Phase 2 — Analytics API

- [ ] Implement `GetProjectCostSummary` use-case
- [ ] Implement `ListProjectTransactions` use-case
- [ ] Implement `GetUserCostSummary` use-case
- [ ] Implement `GetAdminCostDashboard` use-case
- [ ] Implement `ListAdminTransactions` use-case
- [ ] Mount new routes in `llmRoutes.ts` / new `costRoutes.ts`
- [ ] Expose dashboard aggregations to frontend

### Phase 3 — Policy Enforcement

- [ ] Extend `User.limits` with `maxMonthlyCostEur` and `maxDailyCostEur`
- [ ] Add `Project.costPolicy` sub-document
- [ ] Implement `CostPolicyChecker` with Redis cache
- [ ] Implement `costGuardMiddleware` and wire into route chain
- [ ] 402 response contract in `packages/contracts`

### Phase 4 — SuperAdmin UI

- [ ] Rate Configuration Panel component
- [ ] Provider Model Overrides editor
- [ ] Platform Cost Dashboard (charts + KPIs)
- [ ] Transaction Ledger table with void action
- [ ] Wire `UpdateCostRates` and `VoidCostTransaction` to new admin endpoints

### Phase 5 — Historical Migration (optional)

- [ ] Write `scripts/migrate-cost-history.ts`
- [ ] Validate idempotency
- [ ] Document rollback procedure

---

## 18. Open Questions

| # | Question | Owner |
|---|---|---|
| Q1 | Should `computeEurPerMs` be tracked per server profile (dev/prod/GPU node)? | Arch |
| Q2 | Should `cost_transactions` have a TTL, or is it a permanent audit log? | Product |
| Q3 | What is the Redis key schema for cost policy cache? | Infra |
| Q4 | Should `ProjectCostPolicy.hardStop` default to `false` for all existing projects? | Product |
| Q5 | Is a `PLATFORM_FIXED` transaction needed for user signup bonuses? | Product |

---

## 19. Audit Results — Phase D Project-Wide External API Sweep (2026-05-14)

> Comprehensive audit of all external GenAI / paid-API call sites in `apps/api/src/`.
> Every site verified for: `userId` in scope, `projectId` in scope, `CostTransactionService.record()` called.

### 19.1 Conformant Sites (all ✅)

| # | Call site | Endpoint | ResourceType | userId | projectId | Ledger write |
|---|---|---|---|---|---|---|
| 1 | `llmRoutes.ts` `/chat` ~L893 | `/chat/completions` | `LLM_CHAT` | ✅ | ✅ sandbox | ✅ ~L1176 |
| 2 | `llmRoutes.ts` `/chat-stream` ~L1274 | `/chat/completions` | `LLM_CHAT` | ✅ | ✅ sandbox | ✅ ~L1666 |
| 3 | `conversationRoutes.ts` background task finalization | (internal) | `LLM_BACKGROUND` | ✅ | ✅ | ✅ ~L191 |
| 4 | `OptimizeUserPrompt.ts` L420 | `/chat/completions` | `LLM_PROMPT_OPT` | ✅ | ✅ | ✅ ~L216 |
| 5 | `OptimizeUserPrompt.ts` L501 (retry path) | `/chat/completions` | `LLM_PROMPT_OPT` | ✅ | ✅ | ✅ same path |
| 6 | `VibePrefill.ts` L220 | `/chat/completions` | `LLM_BACKGROUND` | ✅ | ✅ auto-create | ✅ L273 |
| 7 | `VibeClassify.ts` L143 | `/chat/completions` | `LLM_PREPROMPT` | ✅ | ✅ auto-create | ✅ Phase C fix |
| 8 | `SuggestProjectImageIdea.ts` L202 | `/chat/completions` | `IMAGE_SUGGEST` | ✅ | ✅ | ✅ L113 |
| 9 | `OptimizeImagePrompt.ts` L194 | `/chat/completions` | `IMAGE_PROMPT_OPT` | ✅ | ✅ | ✅ L271 |
| 10 | `DraftProjectTemplate.ts` L150 | `/chat/completions` | `LLM_TEMPLATE_DRAFT` | ✅ | ✅ `INTERNAL_PROJECT_ID` sentinel | ✅ L227 |
| 11 | `generateImageWithSiliconFlow.ts` L97 | `/images/generations` | `IMAGE_GEN` | ✅ | ✅ | ✅ via `GenerateProjectImage.ts` L423 |
| 12 | `DocumentBriefExtractor.ts` L79 | `/chat/completions` | `LLM_BACKGROUND` (`enrich_document`) | ✅ | ✅ | ✅ via `AssetEnrichmentPipeline` (Phase C fix) |
| 13 | `ImageAnalyzer.ts` L102 | `/chat/completions` (vision) | `LLM_BACKGROUND` (`enrich_image`) | ✅ | ✅ | ✅ via `AssetEnrichmentPipeline` (Phase C fix) |

**No active integrations found** for: OpenAI, Anthropic, Replicate, HuggingFace, fal.ai, Stability AI, ElevenLabs, Deepgram, RunwayML, TTS/STT, video generation.
`/embeddings` calls exist only in `scripts/sf-probe.ts` (admin diagnostics, not a hot path).

### 19.2 Known Gap — Stock-Image Connectors Not Tracked (GAP-001)

**Status:** Open — pending product decision  
**Severity:** Low (all three stock APIs are free-tier; zero monetary cost at current usage)  
**Affected code:**

- `infra/image/PexelsConnector.ts` → `api.pexels.com/v1/search`
- `infra/image/PixabayConnector.ts` → `pixabay.com/api`
- `infra/image/UnsplashConnector.ts` → `api.unsplash.com/search/photos`
- `infra/image/LoremFlickrConnector.ts` → `loremflickr.com` (no key, always free)
- Orchestrated by `infra/image/ImageServiceOrchestrator.ts` → `application/llm/imageUrlRewriter.ts`
- Called from `llmRoutes.ts` L1049 and L1561 after every `/chat` and `/chat-stream` response that contains image placeholder URLs

**Root cause:** `resolveImagesInHtml(html, keyRepo?)` does not accept `userId` / `projectId`
parameters, so attribution is structurally impossible even if a record call were added.

**Impact:**
- Zero EUR cost today (free API tiers)
- Usage quota burns are invisible in the cost dashboard
- If any connector ever upgrades to a paid plan, consumption would not surface in project analytics

**Proposed fix (backward-compatible):**

1. Add `IMAGE_STOCK = "image.stock"` to the `ResourceType` enum in
   `apps/api/src/domain/entities/CostTransaction.ts`.
2. Extend `resolveImagesInHtml(html, keyRepo?, attribution?: { userId: string; projectId: string })`.
3. For each image successfully resolved, call:
   ```typescript
   CostTransactionService.instance.record({
     userId: attribution.userId,
     projectId: attribution.projectId,
     resourceType: ResourceType.IMAGE_STOCK,
     resourceSubtype: result.provider,   // "pexels" | "pixabay" | "unsplash" | "loremflickr" | "picsum"
     providerCostUsd: 0,
     units: { imageCount: 1 },
     meta: { keyword, width, height },
   });
   ```
4. In `llmRoutes.ts` L1049 and L1561, pass `{ userId: req.auth.userId, projectId: req.sandbox.projectId }`.
5. Update §3.2 ResourceType enum table in this spec (add `IMAGE_STOCK` row).
6. Update §6 Integration Points table (add `resolveImagesInHtml` row).

**Decision required:** Confirm whether zero-cost quota events should appear in the per-project cost ledger.

### 19.3 ResourceType Gap — `IMAGE_STOCK` Not Defined

The current `ResourceType` enum (§3.2) does not include a type for stock-image lookups.
Adding `IMAGE_STOCK = "image.stock"` is non-breaking (additive only).  The `resourceSubtype`
field carries the provider name (`pexels`, `pixabay`, `unsplash`, `loremflickr`, `picsum`).

### 19.4 Audit Methodology

- Searched all files under `apps/api/src/**` for: `chat/completions`, `/images/generations`,
  `/embeddings`, `pexels`, `pixabay`, `unsplash`, `stability`, `replicate`, `elevenlabs`,
  `deepgram`, `fal.ai`, `anthropic`, `huggingface`, `runwayml`, `generativelanguage`, `lmstudio`.
- Cross-referenced each hit against `CostTransactionService.instance.record()` call presence.
- Verified `userId` (from `req.auth.userId` / JWT sub) and `projectId` (from `req.sandbox.projectId`
  or explicit parameter) are in scope at call time.
- Script files (`scripts/`) excluded from production audit scope.

---

*Last updated: 2026-05-14 — v1.1 — added §19 Phase D audit results*
