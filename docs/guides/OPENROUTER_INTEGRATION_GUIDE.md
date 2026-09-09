# OpenRouter Multi-Provider Integration Guide

Technical guide derived from the implementation in this repository.
Coverage: backend (Node.js / Express, Clean Architecture) and frontend (Next.js / React).

---

## Index

1. [What OpenRouter is and when to use it](#1-what-openrouter-is-and-when-to-use-it)
2. [Required environment variables](#2-required-environment-variables)
3. [Multi-provider catalog architecture](#3-multi-provider-catalog-architecture)
4. [Data structure: domain entities](#4-data-structure-domain-entities)
5. [Default static catalog (seed)](#5-default-static-catalog-seed)
6. [Live model discovery via /models](#6-live-model-discovery-via-models)
7. [Price tiers — derivation and thresholds](#7-price-tiers--derivation-and-thresholds)
8. [Cost policy — dual-source (provider vs flat-rate)](#8-cost-policy--dual-source-provider-vs-flat-rate)
9. [Authentication and key routing](#9-authentication-and-key-routing)
10. [Model resolution route (`resolveContext`)](#10-model-resolution-route-resolvecontext)
11. [Endpoint `/llm/providers` — frontend response](#11-endpoint-llmproviders--frontend-response)
12. [Frontend: TypeScript types and model selector](#12-frontend-typescript-types-and-model-selector)
13. [Frontend: showing cost in the UI](#13-frontend-showing-cost-in-the-ui)
14. [Seed script and Mongo vs env source](#14-seed-script-and-mongo-vs-env-source)
15. [Fallback and deduplication patterns](#15-fallback-and-deduplication-patterns)
16. [Checklist for bringing this integration into a new project](#16-checklist-for-bringing-this-integration-into-a-new-project)

---

## 1. What OpenRouter is and when to use it

[OpenRouter](https://openrouter.ai) is a unified proxy that exposes hundreds of LLMs (OpenAI, Anthropic, Google, Meta, Mistral, and others) through a single **OpenAI-compatible** API (`POST /chat/completions`).

**Key advantages:**

- One API key for access to many providers
- Fully free `:free` models (rate-limited, but no charge)
- The `/models` endpoint returns **per-token USD pricing metadata**, allowing precise price tiers without static lookup tables
- The `usage.cost` field in completion responses returns the **real request cost in USD**, reducing the need for estimation
- `X-Title` and `HTTP-Referer` headers make it easier to identify your app in OpenRouter analytics

**Use it when:**

- you want access to multiple model families without managing separate API keys
- you want zero-cost prototypes or tests using the `:free` models
- you want accurate per-call cost tracking rather than flat-rate estimates

---

## 2. Required environment variables

```env
# API base URL (does not change)
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# API key (optional for :free models, required for paid models)
OPEN_ROUTER_API_KEY=sk-or-v1-...

# LLM catalog source: "env" = static from code, "mongo" = persisted in the DB
LLM_CATALOG_SOURCE=env

# Automatic seed on startup (populates MongoDB with the static catalog)
LLM_AUTO_SEED_ON_STARTUP=true

# Default provider when the client does not specify one
LLM_DEFAULT_PROVIDER=openrouter

# Cost policy (USD → EUR conversion)
COST_POLICY_USD_TO_EUR_RATE=0.92
COST_POLICY_PROVIDER_MARKUP_FACTOR=1.1

# Flat-rate fallback (used only when the provider does not report usage.cost)
COST_POLICY_TEXT_EUR_PER_1K_TOKENS=0.2
```

> **Security**: the `OPEN_ROUTER_API_KEY` must never be exposed to the frontend. The backend injects it into the `Authorization: Bearer <key>` header at call time.

The backend config validates the environment with **Zod** at startup and derives `env.hasOpenRouterApiKey` as a boolean:

```typescript
// apps/api/src/config.ts
OPEN_ROUTER_API_KEY: z.string().optional(),
// ...
hasOpenRouterApiKey: Boolean(parsed.data.OPEN_ROUTER_API_KEY?.trim()),
providerApiKeys: {
    openrouter: "sk-or-v1-...",  // populated when the key is present
},
```

---

## 3. Multi-provider catalog architecture

The system supports **multiple providers in parallel** (SiliconFlow, local LM Studio, OpenRouter) behind a common abstraction.

```
domain/
  entities/
    LlmCatalog.ts          ← LlmModel, LlmProviderCatalog, PipelineModelRole
  repositories/
    LlmCatalogRepository.ts ← interface: listActiveProviders, upsertProvider

application/
  llm/
    defaultOpenRouterCatalog.ts  ← static catalog with free and paid models
    defaultSiliconFlowCatalog.ts ← static SiliconFlow catalog
    defaultLmStudioCatalog.ts    ← static local LM Studio catalog
    costPolicy.ts                ← EUR cost estimate (dual-source)
  use-cases/
    GetLlmCatalog.ts             ← retrieves the catalog from env or mongo
    SeedLlmCatalog.ts            ← upserts all providers into MongoDB

infra/
  repositories/
    MongoLlmCatalogRepository.ts ← MongoDB implementation

presentation/
  http/routes/
    llmRoutes.ts                 ← GET /llm/providers, POST /projects/:id/llm/chat-preview
```

**Dependency flow (Clean Architecture):**

```
presentation → application → domain
infra → domain
```

The domain knows nothing about MongoDB or Express. The catalog builders live in `application/llm/` and depend only on domain entities.

---

## 4. Data structure: domain entities

```typescript
// apps/api/src/domain/entities/LlmCatalog.ts

export type PipelineModelRole =
    | "coding" | "coding_fast"
    | "dialogue" | "dialogue_fast"
    | "vision" | "vision_fast"
    | "quality_check"
    | "image_gen" | "image_gen_fast"
    | "embeddings";

export interface LlmModel {
    id: string;              // "openai/gpt-4o-mini", "google/gemma-3-12b-it:free"
    provider: string;        // "openrouter"
    role: PipelineModelRole;
    capabilities: string[];  // ["chat"] | ["vision", "chat"]
    isDefault: boolean;      // first candidate for this role
    isFallback: boolean;     // used when the default is unavailable
    isActive: boolean;
    priceTier?: "free" | "low" | "mid" | "high";  // computed, not persisted
}

export interface LlmProviderCatalog {
    provider: string;        // "openrouter"
    baseUrl: string;         // "https://openrouter.ai/api/v1"
    apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
    authType?: "api-key" | "bearer" | "none";
    isActive: boolean;
    models: LlmModel[];
    createdAt: Date;
    updatedAt: Date;
}
```

> `priceTier` is a field **computed at runtime** (not stored in the DB). It is derived from OpenRouter's `/models` payload during discovery and added to the `/llm/providers` response.

---

## 5. Default static catalog (seed)

The `defaultOpenRouterCatalog.ts` file defines the bootstrap models:

```typescript
// Free models (:free suffix) — no cost, rate-limited
const FREE_DEFAULTS = [
    { id: "google/gemma-3-12b-it:free",  role: "dialogue",      capabilities: ["chat"] },
    { id: "google/gemma-3-4b-it:free",   role: "dialogue_fast", capabilities: ["chat"] },
    { id: "nvidia/nemotron-3-nano-30b-a3b:free", role: "coding", capabilities: ["chat"] },
    { id: "z-ai/glm-4.5-air:free",       role: "quality_check", capabilities: ["chat"] },
    { id: "google/gemma-3n-e4b-it:free", role: "vision",        capabilities: ["vision", "chat"] },
    // ...
];

// Paid models — used only when OPEN_ROUTER_API_KEY is present
const PAID_DEFAULTS = [
    { id: "openai/gpt-4o-mini",           role: "dialogue",      capabilities: ["vision", "chat"] },
    { id: "anthropic/claude-sonnet-4-5",  role: "coding",        capabilities: ["chat"] },
    { id: "anthropic/claude-3.5-haiku",   role: "coding_fast",  capabilities: ["chat"] },
    { id: "google/gemini-2.5-pro",        role: "quality_check", capabilities: ["vision", "chat"] },
    { id: "openai/gpt-4o",               role: "vision",        capabilities: ["vision", "chat"] },
];
```

**Paid-first logic:**

```typescript
export function buildDefaultOpenRouterCatalog(
    baseUrl: string,
    hasApiKey: boolean
): LlmProviderCatalog {
    if (hasApiKey) {
        // Paid = default, free = fallback
        PAID_DEFAULTS.forEach(m => models.push({ ...m, isDefault: true, isFallback: false }));
        FREE_DEFAULTS.forEach(m => models.push({ ...m, isDefault: false, isFallback: true }));
    } else {
        // Free only: the first is the default, the rest are fallbacks
        FREE_DEFAULTS.forEach((m, i) =>
            models.push({ ...m, isDefault: i === 0, isFallback: i !== 0 })
        );
    }
    return { provider: "openrouter", baseUrl, apiType: "openai-compatible", authType: "bearer", ... };
}
```

---

## 6. Live model discovery via /models

When `GET /v1/llm/providers` is called, the backend calls `GET https://openrouter.ai/api/v1/models` to obtain the current list of models available to the account.

```typescript
// In llmRoutes.ts → discoverOpenAiCompatibleModels()

const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
});

type OpenRouterModel = {
    id?: string;
    architecture?: { modality?: string };
    pricing?: { prompt?: string; completion?: string };
};

const payload = await response.json() as { data?: Array<OpenRouterModel> };
```

**Modality filter — text-output models only:**

```typescript
// OpenRouter: keep only models with text output
const textModels = rawModels.filter((m) => {
    const modality = m.architecture?.modality ?? "";
    return modality.endsWith("->text");
    // Examples: "text->text", "text+image->text", "text+audio->text"
    // Excluded: "text->image", "text->audio", "text->video"
});
```

The `architecture.modality` field is specific to OpenRouter — other OpenAI-compatible providers (SiliconFlow) do not expose it, so they need a different filter.

---

## 7. Price tiers — derivation and thresholds

OpenRouter returns pricing in USD **per single token** (not per million):

```json
{
  "id": "openai/gpt-4o-mini",
  "pricing": {
    "prompt": "0.00000015",       // $0.15 / 1M tokens input
    "completion": "0.00000060"    // $0.60 / 1M tokens output
  }
}
```

**Thresholds used in this project:**

| Tier   | Prompt price (USD/token) | Per-million equivalent |
|--------|--------------------------|------------------------|
| `free` | `== 0`                   | Free                   |
| `low`  | `< 0.000001`             | < $1/M                 |
| `mid`  | `< 0.000005`             | $1–5/M                 |
| `high` | `>= 0.000005`            | > $5/M                 |

```typescript
const pp = parseFloat(m.pricing.prompt);
if (pp === 0)           priceTier = "free";
else if (pp < 0.000001) priceTier = "low";
else if (pp < 0.000005) priceTier = "mid";
else                    priceTier = "high";
```

> Providers that do **not** return pricing from the `/models` endpoint (SiliconFlow, for example) require a static lookup table maintained by hand.

**Detecting free OpenRouter models:**

```typescript
const isFree =
    input.providerKey === "openrouter" &&
    m.pricing?.prompt === "0" &&
    m.pricing?.completion === "0";
```

Models with the `:free` suffix are priced at `"0"` in the API.

---

## 8. Cost Policy — dual-source (provider vs flat-rate)

OpenRouter exposes the actual cost of the call under the `usage.cost` key of the completion response:

```json
{
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 456,
    "total_tokens": 1690,
    "cost": 0.000253
  }
}
```

This value is in **USD**. The system converts it to EUR with a markup:

```typescript
// apps/api/src/application/llm/costPolicy.ts

export interface CostPolicyConfig {
    textEurPer1kTokens: number;
    imageEurPerAsset: number;
    videoEurPerAsset: number;
    usdToEurRate?: number;           // default 0.92
    providerMarkupFactor?: number;   // default 1.0
}

export interface CostPolicyInput {
    capability?: LlmCapability;
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    imageCount?: number;
    videoCount?: number;
    providerCostUsd?: number;   // ← the key field for OpenRouter
}

export function estimateCost(input: CostPolicyInput, cfg: CostPolicyConfig): CostEstimate {
    // Priority 1: real cost reported by the provider
    if (input.providerCostUsd !== undefined && input.providerCostUsd > 0) {
        const amount = input.providerCostUsd * (cfg.usdToEurRate ?? 0.92) * (cfg.providerMarkupFactor ?? 1.0);
        return {
            currency: "EUR",
            amount: Number(amount.toFixed(6)),
            source: "provider",          // <- indicates the origin
            breakdown: { tokenCost: 0, imageCost: 0, videoCost: 0 },
            providerCostUsd: input.providerCostUsd,
            // ...
        };
    }

    // Priority 2: flat-rate estimate on token count (fallback when the provider does not report cost)
    const tokenCost = (tokens / 1000) * cfg.textEurPer1kTokens;
    return { source: "flat-rate", amount: tokenCost, ... };
}
```

**The `source` field in the response:**

```typescript
costEstimate: {
    currency: "EUR",
    amount: 0.000233,
    source: "provider",   // "provider" | "flat-rate"
    providerCostUsd: 0.000253,
    breakdown: { tokenCost: 0, imageCost: 0, videoCost: 0 },
    unitRates: { textEurPer1kTokens: 0.2, imageEurPerAsset: 0.1, videoEurPerAsset: 0.2 },
}
```

The frontend can show an "actual cost" vs "estimate" badge based on `source`.

---

## 9. Authentication and key routing

The backend owns key handling. The frontend never sees a key.

```typescript
// config.ts
providerApiKeys: {
    openrouter: process.env.OPEN_ROUTER_API_KEY,
    siliconflow: process.env.SILICONFLOW_API_KEY,
    // or from LLM_PROVIDER_API_KEYS_JSON: '{"openrouter":"sk-...","custom":"sk-..."}'
}

// llmRoutes.ts
function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none") {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return authType === "api-key" ? key : `Bearer ${key}`;
}
```

**OpenAI compatibility:** OpenRouter uses `Authorization: Bearer sk-or-v1-...` — identical to the OpenAI API. The `authType: "bearer"` property in the catalog is sufficient.

---

## 10. Model resolution route (resolveContext)

When `POST /projects/:id/llm/chat-preview` arrives, `resolveContext` resolves the model to use with this precedence:

```
1. If body.model is explicit AND the provider is openai-compatible
   → use the model directly (bypasses the DB catalog)

2. If body.model is in the catalog AND is active
   → use from catalog

3. If body.capability selects an isDefault model
   → use it

4. If body.pipelineRole selects an isDefault model
   → use it

5. Fall back to the pipelineRole entry with isFallback=true
6. Fall back to the first dialogue isDefault model
7. Fall back to the first isActive model
```

Bypassing the catalog for `openai-compatible` (point 1) is essential for OpenRouter: the catalog seed holds only a few representative models, while the user can pick **any** model from the live `/models` list — the backend accepts it directly, without requiring a catalog update.

---

## 11. Endpoint `/llm/providers` — frontend response

```typescript
// GET /v1/llm/providers
// Requires: Authorization: Bearer <access_token>

{
    source: "env",            // "env" | "mongo"
    byokEnabled: true,
    activeProvider: "openrouter",
    hasProviderApiKeyConfigured: true,
    providers: [
        {
            provider: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
            apiType: "openai-compatible",
            authType: "bearer",
            isActive: true,
            models: [
                {
                    id: "openai/gpt-4o-mini",
                    provider: "openrouter",
                    role: "dialogue",
                    capabilities: ["vision", "chat"],
                    isDefault: true,
                    isFallback: false,
                    isActive: true,
                    priceTier: "low"        // ← derived from pricing.prompt
                },
                {
                    id: "google/gemma-3-12b-it:free",
                    priceTier: "free",
                    isDefault: false,
                    isFallback: true,
                    // ...
                },
                // ... (full live list from /models when a key is present)
            ]
        },
        // siliconflow, lmstudio...
    ]
}
```

---

## 12. Frontend: TypeScript types and model selector

```typescript
// apps/web/lib/api.ts

export interface ModelItem {
    id: string;
    provider: string;
    role: string;
    capabilities: string[];
    isDefault: boolean;
    isFallback: boolean;
    isActive: boolean;
    priceTier?: "free" | "low" | "mid" | "high";
}

export interface LlmProviderCatalogDto {
    provider: string;
    baseUrl: string;
    isActive: boolean;
    models: ModelItem[];
}

export function getLlmProviders(token: string) {
    return call<LlmProvidersResponse>("GET", "/v1/llm/providers", undefined, {
        Authorization: `Bearer ${token}`,
    });
}
```

**Model selector with price tier badge:**

```typescript
// Cost badge — prefix on the model name inside the <option>
function tierBadge(tier: ModelItem["priceTier"]): string {
    if (tier === "low")  return "€ ";
    if (tier === "mid")  return "€€ ";
    if (tier === "high") return "€€€ ";
    return "";  // "free" → no badge (these are split into their own group)
}

// Paid/free grouping with <optgroup> per family
function groupedModelOptions(models: ModelItem[]): React.ReactNode {
    const paid = models.filter(m => m.priceTier !== "free");
    const free = models.filter(m => m.priceTier === "free");
    // paid → grouped by family, alphabetical
    // free → separated by a "── 🆓 Free models ──" divider
}
```

**Display utilities:**

```typescript
// Extract the family from the model ID (namespace before the slash)
function modelFamily(id: string): string {
    if (id.includes("/")) return id.slice(0, id.indexOf("/"));
    const m = id.match(/^([a-zA-Z]+)/);
    return m ? m[1] : "other";
}

// Short name: strip the namespace
function modelShortName(id: string): string {
    const slash = id.indexOf("/");
    return slash >= 0 ? id.slice(slash + 1) : id;
}
```

---

## 13. Frontend: showing cost in the UI

The `POST /llm/chat-preview` response includes `costEstimate`. The frontend attaches it to the message and can show it in the conversation:

```typescript
// In workspace/[projectId]/page.tsx
const llm = await llmChatPreview(token, projectId!, payload);

// Persist the cost on the message (for total conversation tracking)
await logBackgroundTask(token, projectId!, convId, assistantMsg.id, {
    type: "llm-call",
    costEstimate: llm.costEstimate,
    tokenUsage: llm.usage,
});

// Update the conversation's total cost
setActiveConv(prev => prev ? {
    ...prev,
    totalCost: (prev.totalCost ?? 0) + (llm.costEstimate?.amount ?? 0),
} : prev);
```

**Formatting for the UI:**

```typescript
// Show the cost with an indicator of where it came from
const cost = message.metadata?.costEstimate;
if (cost) {
    const label = cost.source === "provider" ? "real" : "estimated";
    const display = `€${cost.amount.toFixed(4)} (${label})`;
    // Optional: show providerCostUsd in a tooltip
}
```

---

## 14. Seed script and Mongo vs env source

The system supports two catalog modes:

**`LLM_CATALOG_SOURCE=env`** (dev default): the catalog is rebuilt from the static builders on every startup. No database is needed for the base values.

**`LLM_CATALOG_SOURCE=mongo`**: the catalog is read from MongoDB (the `llm_providers` collection). Requires the seed to have been run.

```bash
# Run the seed (populates MongoDB with the static catalog)
npx ts-node apps/api/src/scripts/seed-llm.ts
# or through the npm script (when defined)
npm run seed:llm
```

```typescript
// SeedLlmCatalog use-case
async execute() {
    await this.repository.upsertProvider({
        provider: "openrouter",
        baseUrl: this.openRouterBaseUrl,
        apiType: "openai-compatible",
        authType: "bearer",
        isActive: true,
        models: openRouterCatalog.models
    });
    // ...siliconflow, lmstudio
}
```

**MongoDB collection (`llm_providers`):**

```typescript
// Index: { provider: 1 } unique
// Index: { isActive: 1 }
await collection.updateOne(
    { provider: catalog.provider },
    { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
);
```

The idempotent upsert guarantees the seed can be re-run without creating duplicates.

---

## 15. Fallback and deduplication patterns

**Deduplication by ID:**

When the same model ID appears both as `isDefault` and as `isFallback` (in merged catalogs, for instance), deduplication prefers the `isDefault` entry:

```typescript
function dedupeModelsById(models) {
    const byId = new Map();
    for (const model of models) {
        if (!model.isActive || !model.id) continue;
        if (!byId.has(model.id)) { byId.set(model.id, model); continue; }
        const prev = byId.get(model.id);
        if (model.isDefault && !prev.isDefault) byId.set(model.id, model);
    }
    return [...byId.values()];
}
```

**Fallback chain in model selection:**

```
1. explicit model from body.model (catalog bypass for openai-compatible)
2. model found in the catalog for body.model
3. isDefault model for body.capability
4. isDefault model for body.pipelineRole
5. isFallback model for body.pipelineRole
6. isDefault model for the "dialogue" role
7. first isActive model
```

**Fallback on discovery errors:**

If `/models` is unreachable or returns an error, the system falls back to the static default catalog:

```typescript
try {
    const response = await fetch(`${baseUrl}/models`, { ... });
    if (!response.ok) return dedupeModelsById(input.fallbackModels);  // ← graceful
    // ...
} catch {
    return dedupeModelsById(input.fallbackModels);  // ← graceful
}
```

---

## 16. Checklist for bringing this integration into a new project

### Backend

- [ ] **Env schema**: add `OPENROUTER_BASE_URL`, `OPEN_ROUTER_API_KEY` (optional), `COST_POLICY_USD_TO_EUR_RATE`, `COST_POLICY_PROVIDER_MARKUP_FACTOR`, validated with Zod.
- [ ] **Domain entity**: define `LlmModel` with a `priceTier?: "free" | "low" | "mid" | "high"` field.
- [ ] **Catalog builder** (`defaultOpenRouterCatalog.ts`): paid-first logic, with free models as the fallback when no API key is present.
- [ ] **costPolicy.ts**: implement `estimateCost`, preferring `providerCostUsd` over flat-rate; include the `source` field.
- [ ] **discoverOpenAiCompatibleModels**: filter on `architecture.modality.endsWith("->text")`, derive `priceTier` from `pricing.prompt`.
- [ ] **resolveAuthHeader**: centralise key handling, inject `Bearer <key>` for `authType: "bearer"`.
- [ ] **resolveContext**: catalog bypass for `openai-compatible` plus an explicit model; complete fallback chain.
- [ ] **GET /llm/providers**: expose the models enriched by live discovery, with `priceTier`, `byokEnabled`, `activeProvider`.
- [ ] **POST /llm/chat-preview**: extract `usage.cost` from the OpenRouter response and pass it to `estimateCost` as `providerCostUsd`.
- [ ] **Seed script**: `SeedLlmCatalog` use-case with an idempotent `upsertProvider`.
- [ ] **`LLM_CATALOG_SOURCE`**: support `"env"` (dev) and `"mongo"` (scalable production).

### Frontend

- [ ] **Types**: `ModelItem.priceTier`, `LlmChatPreviewResult.costEstimate.source`, `costEstimate.providerCostUsd`.
- [ ] **getLlmProviders()**: `GET /v1/llm/providers` authenticated.
- [ ] **tierBadge()**: `€` / `€€` / `€€€` prefix for paid models.
- [ ] **groupedModelOptions()**: paid grouped by family (alphabetical) plus a separate free section with a divider.
- [ ] **modelFamily() / modelShortName()**: derive the display name from the `namespace/model-id` format.
- [ ] **Cost tracking**: store `costEstimate` on the assistant message, accumulate `totalCost` on the conversation.
- [ ] **Source indicator**: show "real" vs "estimated" based on `costEstimate.source`.
- [ ] **Provider/model selection**: `body.provider` and `body.model` optional on the chat-preview request; falls back to the backend default.

### Security

- [ ] API keys **must never** be exposed to the frontend.
- [ ] The `/llm/providers` endpoint must require authentication (JWT).
- [ ] The `/llm/chat-preview` endpoint must enforce the sandbox (user + project ownership).
- [ ] The estimated cost must not be used for critical billing without additional server-side validation.

---

## Notes on keeping the free model list current

OpenRouter's free models (the `:free` suffix) change from time to time. The strategy adopted here:

1. **Static catalog** in `defaultOpenRouterCatalog.ts` = guaranteed bootstrap, always working.
2. **Live discovery** from `/models` at startup = replaces the catalog with the current list when a key is present.
3. **Catalog bypass** for requests carrying an explicit `model`: the user can pick any model from the live list without a code change.

This means the models in the static catalog can go stale without causing downtime: the fallback chain guarantees a valid model is always available.
