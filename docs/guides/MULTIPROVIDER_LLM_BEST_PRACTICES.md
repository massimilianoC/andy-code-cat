# Multi-Provider LLM — Reusable Best Practices

A practical guide drawn from this project's implementation.
Covers: provider catalog, routing, token budget, costs, background tasks, image gen, streaming SSE, local dev.
Applicable to any Node.js/TypeScript system integrating models from OpenAI-compatible services, SiliconFlow, OpenRouter, LM Studio or other heterogeneous providers.

---

## Contents

1. [Founding principle: provider-agnostic by design](#1-founding-principle-provider-agnostic-by-design)
2. [Multi-provider catalog architecture](#2-multi-provider-catalog-architecture)
3. [Data model: canonical entities](#3-data-model-canonical-entities)
4. [Model roles — a reusable taxonomy](#4-model-roles--a-reusable-taxonomy)
5. [Auth routing: api-key / bearer / none](#5-auth-routing-api-key--bearer--none)
6. [Config validation at bootstrap (the Zod pattern)](#6-config-validation-at-bootstrap-the-zod-pattern)
7. [Dual-source catalog: env vs MongoDB](#7-dual-source-catalog-env-vs-mongodb)
8. [Safe provider key routing](#8-safe-provider-key-routing)
9. [Context budget management](#9-context-budget-management)
10. [History pruning — token-safe](#10-history-pruning--token-safe)
11. [Output budget policy in the system prompt](#11-output-budget-policy-in-the-system-prompt)
12. [Cost tracking dual-source (provider-reported vs flat-rate)](#12-cost-tracking-dual-source-provider-reported-vs-flat-rate)
13. [SSE streaming from the LLM to the client](#13-sse-streaming-from-the-llm-to-the-client)
14. [Background task pattern (image generation, slow pipelines)](#14-background-task-pattern-image-generation-slow-pipelines)
15. [Image generation: polling and timeouts](#15-image-generation-polling-and-timeouts)
16. [Model deduplication in the catalog](#16-model-deduplication-in-the-catalog)
17. [LM Studio as a local provider (dev/offline)](#17-lm-studio-as-a-local-provider-devoffline)
18. [Model-specific prompt templates](#18-model-specific-prompt-templates)
19. [Per-provider pricing lookup table](#19-per-provider-pricing-lookup-table)
20. [Provider errors: normalised codes](#20-provider-errors-normalised-codes)
21. [Checklist for a new multi-provider project](#21-checklist-for-a-new-multi-provider-project)

---

## 1. Founding principle: provider-agnostic by design

**Every OpenAI-compatible provider shares the same API schema:**

```
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}     ← or no header at all when authType === "none"
Content-Type: application/json

{
  "model": "{model_id}",
  "messages": [...],
  "max_tokens": 8000,
  "stream": true
}
```

This holds for **OpenAI, SiliconFlow, OpenRouter, LM Studio, Ollama, Together.ai, Groq, Parasail, Azure OpenAI** and dozens of others.

**Key pattern**: do not write provider-specific code. Always use:
- `baseUrl` resolved from the catalog
- `apiKey` resolved from the provider→key map
- `model` resolved from the requested role

---

## 2. Multi-provider catalog architecture

```
domain/
  entities/
    LlmCatalog.ts              ← LlmModel, LlmProviderCatalog, PipelineModelRole
  repositories/
    LlmCatalogRepository.ts    ← pure interface (no infra)

application/
  use-cases/
    GetLlmCatalog.ts           ← env source or mongo source, same output
    SeedLlmCatalog.ts          ← populates MongoDB from the static catalog
  llm/
    defaultSiliconFlowCatalog.ts
    defaultLmStudioCatalog.ts
    defaultOpenRouterCatalog.ts
    modelRegistryPresets.ts    ← decorateModel (displayName, description, promptTemplate)

infra/
  repositories/
    MongoLlmCatalogRepository.ts   ← concrete implementation
```

**Rule**: the presentation layer sees only `LlmProviderCatalog[]` — it knows nothing about specific endpoints or keys.

---

## 3. Data model: canonical entities

```typescript
export type PipelineModelRole =
    | "coding" | "coding_fast"
    | "dialogue" | "dialogue_fast"
    | "vision" | "vision_fast"
    | "quality_check"
    | "image_gen" | "image_gen_fast"
    | "embeddings";

export interface LlmModel {
    id: string;                  // the provider's real ID (e.g. "Qwen/Qwen3-32B")
    provider: string;            // logical key (e.g. "siliconflow")
    role: PipelineModelRole;
    capabilities: string[];      // ["chat"] | ["vision","chat"] | ["image_generation"]
    isDefault: boolean;          // primary model for that role
    isFallback: boolean;         // alternative used when the default fails
    isActive: boolean;
    displayName?: string;        // UI label
    description?: string;        // operational notes
    promptTemplate?: string;     // instructions specific to this model
    focusPromptTemplate?: string;// instructions in focused-edit mode
    priceTier?: "free" | "€" | "€€" | "€€€" | "€€€€";
    priceInputUsdPerM?: number;  // USD per million input tokens
    priceOutputUsdPerM?: number;
}

export interface LlmProviderCatalog {
    provider: string;
    baseUrl: string;
    apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
    authType?: "api-key" | "bearer" | "none";
    isActive: boolean;
    models: LlmModel[];
    createdAt: Date;
    updatedAt: Date;
}
```

**Why separate `isDefault` from `isFallback`?**
- `isDefault=true`: preferred by the system — used by automatic per-role selection.
- `isFallback=true`: engaged only when the default is unreachable or returns an error.
- A model may be both `isDefault=false, isFallback=true` (available, but not the primary choice).

---

## 4. Model roles — a reusable taxonomy

Using semantic roles instead of hardcoded model IDs allows the model to change without touching application logic.

| Role | Typical use | Capability |
|---|---|---|
| `coding` | Code generation, architecture | `["chat"]` |
| `coding_fast` | Quick fixes, scaffolding | `["chat"]` |
| `dialogue` | Generic chat, UX content | `["chat"]` |
| `dialogue_fast` | Rapid iterations, drafts | `["chat"]` |
| `vision` | Screenshot, layout, multimodal | `["vision","chat"]` |
| `vision_fast` | Quick visual check | `["vision","chat"]` |
| `quality_check` | Review, QA, validation | `["chat"]` |
| `image_gen` | Creative assets, high quality | `["image_generation"]` |
| `image_gen_fast` | Quick exploration | `["image_generation"]` |
| `embeddings` | Retrieval, semantic matching | `["embeddings"]` |

**Role → model resolution pattern:**

```typescript
function resolveModelForRole(
    providers: LlmProviderCatalog[],
    providerKey: string,
    role: PipelineModelRole
): LlmModel | undefined {
    const provider = providers.find(p => p.provider === providerKey && p.isActive);
    if (!provider) return undefined;

    // 1. active default for that role
    const defaultModel = provider.models.find(
        m => m.role === role && m.isDefault && m.isActive
    );
    if (defaultModel) return defaultModel;

    // 2. any active model for that role
    return provider.models.find(m => m.role === role && m.isActive);
}
```

---

## 5. Auth routing: api-key / bearer / none

Every provider has its own authentication regime. Centralising the logic in a mapper avoids `if (provider === "siliconflow")` scattered through the code.

```typescript
type AuthType = "api-key" | "bearer" | "none";

// Map: provider → header to inject
function buildAuthHeaders(
    authType: AuthType | undefined,
    apiKey: string | undefined
): Record<string, string> {
    if (!authType || authType === "none") return {};
    if (!apiKey) throw new Error("API key required but not configured");

    // Both "bearer" and "api-key" use Authorization: Bearer under OpenAI-compat
    return { Authorization: `Bearer ${apiKey}` };
}

// Usage
const headers = buildAuthHeaders(
    context.providerCatalog.authType,
    env.providerApiKeys[context.providerCatalog.provider]
);
```

**Practical notes:**
- Local LM Studio → `authType: "none"` (no header)
- SiliconFlow, OpenRouter → `authType: "bearer"` (token carried in the API port)
- OpenAI directly → `authType: "api-key"` (Bearer, but semantically different)
- Anthropic → `authType: "api-key"` + header `x-api-key` (requires a dedicated adapter)

---

## 6. Config validation at bootstrap (the Zod pattern)

All critical environment variables are validated with Zod at startup. The process stops with a readable error when something is missing.

```typescript
import { z } from "zod";

const envSchema = z.object({
    LLM_CATALOG_SOURCE: z.enum(["env", "mongo"]).default("env"),
    LLM_DEFAULT_PROVIDER: z.string().default("siliconflow"),
    LLM_DEFAULT_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(24000),
    LLM_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(167000),
    LLM_CONTEXT_MAX_CHARS: z.coerce.number().int().positive().default(64000),

    LMSTUDIO_BASE_URL: z.string().url().default("http://localhost:1234/v1"),
    SILICONFLOW_BASE_URL: z.string().url().default("https://api.siliconflow.com/v1"),
    SILICONFLOW_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
    OPEN_ROUTER_API_KEY: z.string().optional(),

    // Additional keys as JSON, for arbitrary providers
    LLM_PROVIDER_API_KEYS_JSON: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error("Invalid environment configuration", parsed.error.format());
    process.exit(1);
}

// Derive booleans and maps from the environment → do not scatter them through the code
export const env = {
    ...parsed.data,
    hasSiliconFlowApiKey: Boolean(parsed.data.SILICONFLOW_API_KEY?.trim()),
    hasOpenRouterApiKey: Boolean(parsed.data.OPEN_ROUTER_API_KEY?.trim()),
    providerApiKeys: buildProviderKeyMap(parsed.data),
};
```

**The `LLM_PROVIDER_API_KEYS_JSON` pattern** — supports arbitrary providers without adding dedicated environment variables:

```env
# .env
LLM_PROVIDER_API_KEYS_JSON={"myprovider":"sk-abc","anotherprovider":"sk-xyz"}
```

```typescript
function buildProviderKeyMap(data: EnvData): Record<string, string> {
    const map: Record<string, string> = {};
    if (data.SILICONFLOW_API_KEY?.trim()) map.siliconflow = data.SILICONFLOW_API_KEY.trim();
    if (data.OPEN_ROUTER_API_KEY?.trim()) map.openrouter = data.OPEN_ROUTER_API_KEY.trim();

    if (data.LLM_PROVIDER_API_KEYS_JSON?.trim()) {
        try {
            const extra = JSON.parse(data.LLM_PROVIDER_API_KEYS_JSON);
            if (typeof extra === "object" && extra !== null) {
                Object.assign(map, extra);
            }
        } catch { /* ignore malformed JSON */ }
    }
    return map;
}
```

---

## 7. Dual-source catalog: env vs MongoDB

**Problem**: in development you want a catalog that is always available without a database. In production you want to edit it from the admin UI without a rebuild.

**Solution**: two sources behind the same output interface.

```typescript
// LLM_CATALOG_SOURCE=env  → static catalog hardcoded in the defaultXxxCatalog.ts files
// LLM_CATALOG_SOURCE=mongo → MongoDB, falling back to the static catalog when empty

class GetLlmCatalog {
    async execute(): Promise<{ source: "env" | "mongo"; providers: LlmProviderCatalog[] }> {
        const fallback = [
            buildDefaultSiliconFlowCatalog(this.siliconFlowBaseUrl),
            buildDefaultLmStudioCatalog(this.lmStudioBaseUrl),
            buildDefaultOpenRouterCatalog(this.openRouterBaseUrl, this.hasApiKey),
        ];

        if (!this.repository) {
            return { source: "env", providers: fallback };
        }

        const mongoProviders = await this.repository.listActiveProviders().catch(() => []);
        if (mongoProviders.length > 0) {
            return { source: "mongo", providers: mongoProviders };
        }

        // Empty Mongo → fallback to env
        return { source: "env", providers: fallback };
    }
}
```

**Idempotent seed at bootstrap** (only in `LLM_CATALOG_SOURCE=mongo`):

```typescript
// SeedLlmCatalog.execute() uses upsert, not insert — safe to re-run on every startup
if (env.LLM_CATALOG_SOURCE === "mongo" && env.llmAutoSeedOnStartup) {
    await seedLlmCatalog.execute();
}
```

---

## 8. Safe provider key routing

Never expose the key to the frontend. Never hardcode it. The backend injects it only at call time.

```typescript
// ❌ Never do this
const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}` }
});

// ✅ Always resolve from the centralised map
const apiKey = env.providerApiKeys[context.providerCatalog.provider];
if (!apiKey && context.providerCatalog.authType !== "none") {
    throw new HttpError(`Missing API key for provider ${context.providerCatalog.provider}`, {
        statusCode: 503,
        code: "LLM_PROVIDER_API_KEY_MISSING",
    });
}
```

**Hint for the admin UI**: store the variable-name hint for each provider in the environment, so the administrator knows what to configure:

```typescript
const PROVIDER_KEY_ENV_HINTS: Record<string, string> = {
    siliconflow: "SILICONFLOW_API_KEY",
    openrouter: "OPEN_ROUTER_API_KEY",
    // arbitrary providers → "LLM_PROVIDER_API_KEYS_JSON"
};
```

---

## 9. Context budget management

Models have finite context windows. Managing the budget explicitly prevents `context_length_exceeded` errors in production.

```typescript
// Constants from the environment (tunable without a rebuild)
const MAX_CONTEXT_CHARS = env.LLM_CONTEXT_MAX_CHARS;          // 64000 default
const MAX_ARTIFACT_CHARS = env.LLM_ARTIFACT_CONTEXT_MAX_CHARS; // 16000 default
const MAX_HISTORY_MESSAGES = env.LLM_MAX_HISTORY_MESSAGES;     // 12 default
const MAX_HISTORY_MESSAGE_CHARS = env.LLM_HISTORY_MESSAGE_MAX_CHARS; // 2000 default
const MAX_HISTORY_CHARS = env.LLM_HISTORY_MAX_CHARS;           // 7000 default

// Truncate the artifact context before sending it
function truncateArtifact(html: string, maxChars: number): string {
    if (html.length <= maxChars) return html;
    return html.slice(0, maxChars) + "\n<!-- [TRUNCATED FOR CONTEXT BUDGET] -->";
}

// Each historical message is truncated individually
function truncateMessage(content: string, maxChars: number): string {
    return content.length > maxChars
        ? content.slice(0, maxChars) + " [...]"
        : content;
}
```

**Rule of thumb**: use characters, not tokens, to estimate the budget (1 token ≈ 3–4 characters for mixed text). This avoids depending on a specific model's tokenizer.

---

## 10. History pruning — token-safe

```typescript
function pruneHistory(
    history: HistoryMessage[],
    maxMessages: number,
    maxCharsPerMessage: number,
    maxTotalChars: number
): LlmMessage[] {
    // Take only the last N messages
    const recent = history.slice(-maxMessages);

    let totalChars = 0;
    const result: LlmMessage[] = [];

    for (const msg of recent) {
        const truncated = truncateMessage(msg.content, maxCharsPerMessage);
        if (totalChars + truncated.length > maxTotalChars) break;
        totalChars += truncated.length;
        result.push({ role: msg.role, content: truncated });
    }

    return result;
}
```

**History mode for focus-edit** (significant token savings):

```typescript
// LLM_FOCUS_HISTORY_MODE=none  → no history (maximum savings)
// LLM_FOCUS_HISTORY_MODE=user_only → user messages only (strips assistant HTML artifacts)
// LLM_FOCUS_HISTORY_MODE=full  → full history (default chat)
```

---

## 11. Output budget policy in the system prompt

Including an explicit section in the system prompt instructs the model to respect the limits.

```typescript
function buildOutputBudgetPolicy(maxTokens: number): string {
    return [
        "## OUTPUT BUDGET POLICY",
        "- Return ONLY one raw JSON object — no markdown fences, no prose before or after.",
        `- TOTAL OUTPUT MUST stay under ${maxTokens.toLocaleString()} tokens.`,
        "- Target 8000–32000 tokens for typical requests. Never repeat the entire artifact for small changes.",
        "- artifacts.css and artifacts.js must be plain strings without <style> or <script> wrappers.",
        "- Use standard JSON escaping: \\\" for quotes inside HTML, \\n for newlines.",
        "",
        "## REASONING BUDGET (critical)",
        "- Keep internal reasoning under 2000 tokens.",
        "- Skip exploratory analysis and enumerations of rejected alternatives.",
        "- Plan briefly (< 300 words), then produce output immediately.",
    ].join("\n");
}
```

---

## 12. Cost tracking dual-source (provider-reported vs flat-rate)

Some providers (**OpenRouter**, for example) return the actual cost in USD in the `usage.cost` field. This is always more accurate than a flat-rate estimate.

```typescript
interface CostPolicyInput {
    capability?: "chat" | "vision" | "image_generation" | "embeddings";
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    imageCount?: number;
    providerCostUsd?: number; // from usage.cost OpenRouter or SiliconFlow price lookup
}

function estimateCost(input: CostPolicyInput, cfg: CostPolicyConfig): CostEstimate {
    // Provider-reported cost takes precedence
    if (input.providerCostUsd !== undefined && input.providerCostUsd > 0) {
        const amount = input.providerCostUsd * cfg.usdToEurRate * cfg.markupFactor;
        return { currency: "EUR", amount, source: "provider", providerCostUsd: input.providerCostUsd, ... };
    }

    // Fallback: flat-rate estimate from tokens
    const tokenCost = (input.tokenUsage?.totalTokens ?? 0) / 1000 * cfg.textEurPer1kTokens;
    const imageCost = (input.imageCount ?? 0) * cfg.imageEurPerAsset;
    return { currency: "EUR", amount: tokenCost + imageCost, source: "flat-rate", ... };
}
```

**For SiliconFlow**: build a `Record<modelId, SfModelPrice>` price lookup table with hardcoded prices, refreshed periodically. Compute the real cost as tokens used × price per M.

```typescript
function resolveProviderCostUsd(
    model: LlmModel,
    usage: { promptTokens: number; completionTokens: number }
): number | undefined {
    if (!model.priceInputUsdPerM || !model.priceOutputUsdPerM) return undefined;
    return (usage.promptTokens / 1_000_000) * model.priceInputUsdPerM
         + (usage.completionTokens / 1_000_000) * model.priceOutputUsdPerM;
}
```

**Price tiers derived from percentiles** (for the UI): categorise models into `free/€/€€/€€€/€€€€` tiers based on percentiles of the price distribution in the catalog, using homogeneous units (never mix `per_m_tokens` with `per_image`).

---

## 13. SSE streaming from the LLM to the client

```typescript
// SSE setup on Express
router.get("/llm/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Helper to send typed events
    function sendSse(payload: unknown) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    sendSse({ type: "start", provider: context.providerCatalog.provider });

    // Call the provider with stream: true
    const stream = await callProviderStream(context, messages);

    for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (delta) sendSse({ type: "chunk", content: delta });
    }

    sendSse({ type: "done", usage: stream.usage });
    res.end();
});
```

**Caution**: not every OpenAI-compatible provider supports `stream: true` identically. LM Studio supports it, SiliconFlow does, OpenRouter does. Check the documentation for edge fields (`finish_reason`, `usage` inside the stream).

---

## 14. Background task pattern (image generation, slow pipelines)

For operations taking more than 2–3 seconds, respond immediately with a task ID and update the record in the background.

### Entities

```typescript
interface BackgroundTask {
    id: string;
    type: string;                // "image_gen" | "pipeline" | "analysis" | ...
    status: "pending" | "running" | "completed" | "failed";
    pipelineProfile?: string;    // which pipeline/config ran
    input?: unknown;
    output?: unknown;
    error?: string;
    startedAt: Date;
    completedAt?: Date;
    tokenUsage?: TokenUsage;
    costEstimate?: CostEstimate;
}
```

### Flow

```typescript
// 1. Respond immediately with a pending task
const task = await conversationRepo.addBackgroundTask(conversationId, {
    type: "image_gen",
    status: "pending",
    input: { prompt, model, size },
});
res.json({ taskId: task.id, status: "pending" });

// 2. Run in the background (do not await inside the response chain)
setImmediate(async () => {
    try {
        await conversationRepo.updateBackgroundTask(conversationId, task.id, { status: "running" });
        const result = await generateImage(prompt, model);
        await conversationRepo.updateBackgroundTask(conversationId, task.id, {
            status: "completed",
            output: result,
            completedAt: new Date(),
        });
    } catch (err) {
        await conversationRepo.updateBackgroundTask(conversationId, task.id, {
            status: "failed",
            error: String(err),
            completedAt: new Date(),
        });
    }
});
```

### Client-side polling (when WebSockets are not an option)

```typescript
// Frontend: poll every 2s until completion or timeout (30s)
async function pollTaskStatus(taskId: string, maxMs = 30_000): Promise<TaskResult> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const task = await api.getTask(taskId);
        if (task.status === "completed") return task.output;
        if (task.status === "failed") throw new Error(task.error);
        await sleep(2000);
    }
    throw new Error("Task polling timeout");
}
```

**Why not one second?** SiliconFlow FLUX.1 takes roughly 4–6s. A single refresh at 1.8s leaves assets stuck in `pending`. Use interruptible polling with progressive back-off for tasks that can exceed 10s.

---

## 15. Image generation: polling and timeouts

SiliconFlow uses the `/images/generations` endpoint (OpenAI-compatible image gen):

```typescript
async function generateImageWithSiliconFlow(opts: {
    prompt: string;
    model: string;
    size: string;
    steps: number;
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
}): Promise<SiliconFlowImageGenerationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
        const response = await fetch(`${opts.baseUrl}/images/generations`, {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${opts.apiKey}`,
            },
            body: JSON.stringify({
                model: opts.model,
                prompt: opts.prompt,
                image_size: opts.size,
                num_inference_steps: opts.steps,
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`Provider error ${response.status}: ${body}`);
        }

        const json = await response.json();
        const imageUrl = json.data?.[0]?.url;

        // Download and buffer the bytes
        const imageBuffer = await fetchBufferFromUrl(imageUrl, opts.apiKey);

        return {
            provider: "siliconflow",
            model: opts.model,
            buffer: imageBuffer,
            // ... other metadata
        };
    } finally {
        clearTimeout(timer);
    }
}
```

**Pitfall**:
- The `data[0].url` field may be a temporary URL with an expiry. Download and store the bytes immediately; do not store the URL.
- `num_inference_steps` defaults to 20, but `FLUX.1-schnell` works well with 4 steps (much faster, near-identical for general use).
- Compute `providerCostUsd` from the price lookup table for the model, not from the API (SiliconFlow does not return `usage.cost`).

---

## 16. Model deduplication in the catalog

Providers such as OpenRouter may return the same model under different roles (`gpt-4o-mini` for both `dialogue` and `dialogue_fast`, for instance). Deduplicate by ID, keeping `isDefault` priority.

```typescript
function dedupeModelsById(models: LlmModel[]): LlmModel[] {
    const byId = new Map<string, LlmModel>();

    for (const model of models) {
        if (!model.isActive || !model.id) continue;
        if (!byId.has(model.id)) {
            byId.set(model.id, model);
            continue;
        }
        // Prefer the model marked as default
        const prev = byId.get(model.id)!;
        if (model.isDefault && !prev.isDefault) {
            byId.set(model.id, model);
        }
    }

    return [...byId.values()];
}
```

**When to apply it**: only in the response to the frontend (`/llm/providers`). The internal catalog may hold duplicates per role — that is what per-role fallback logic needs.

---

## 17. LM Studio as a local provider (dev/offline)

LM Studio exposes an OpenAI-compatible server at `http://localhost:1234/v1` (or a LAN address in Docker).

```typescript
export function buildDefaultLmStudioCatalog(baseUrl: string): LlmProviderCatalog {
    return {
        provider: "lmstudio",
        baseUrl,
        apiType: "openai-compatible",
        authType: "none",    // ← no key required
        isActive: true,
        models: [{
            id: "local/default-chat",  // placeholder — LM Studio uses the loaded model
            provider: "lmstudio",
            role: "dialogue",
            capabilities: ["chat"],
            isDefault: true,
            isFallback: true,
            isActive: true,
            displayName: "Local Default Chat",
        }],
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}
```

**Under Docker**: use `host.docker.internal:1234` instead of `localhost`.

```env
LMSTUDIO_BASE_URL=http://host.docker.internal:1234/v1
```

**Recommended use**: offline fallback, testing without spending credits, local development of new flows before connecting a cloud provider.

---

## 18. Model-specific prompt templates

Different models respond better to different instruction styles. Centralise per-role notes in a dedicated file (`modelRegistryPresets.ts`) instead of scattering them through the code.

```typescript
const ROLE_PROMPT_TEMPLATES: Record<PipelineModelRole, string> = {
    coding: "## MODEL-SPECIFIC GUIDANCE\nPrefer precise steps, clean architecture, production-ready code.",
    coding_fast: "## MODEL-SPECIFIC GUIDANCE\nOptimize for fast, concise output. Keep edits small and reviewable.",
    dialogue: "## MODEL-SPECIFIC GUIDANCE\nPrioritize clarity and structured reasoning. Ask only when ambiguity blocks.",
    quality_check: "## MODEL-SPECIFIC GUIDANCE\nAct as a strict reviewer. Surface inconsistencies and risks first.",
    // ...
};

// Decorate the models when the catalog is built
function decorateSeedModel(base: Partial<LlmModel>): LlmModel {
    const role = base.role!;
    return {
        ...base,
        displayName: base.displayName ?? ROLE_DISPLAY_NAMES[role],
        description: base.description ?? ROLE_DESCRIPTIONS[role],
        promptTemplate: base.promptTemplate ?? ROLE_PROMPT_TEMPLATES[role],
    } as LlmModel;
}
```

---

## 19. Per-provider pricing lookup table

Maintain a `Record<modelId, { input: number; output: number; priceUnit: string }>` for every provider that does not return `usage.cost`.

```typescript
// siliconflowPricing.ts
export const SILICONFLOW_MODEL_PRICES: Readonly<Record<string, SfModelPrice>> = {
    "Qwen/Qwen3-32B":           { input: 0.14, output: 0.57, priceUnit: "per_m_tokens" },
    "deepseek-ai/DeepSeek-V3":  { input: 0.25, output: 1.00, priceUnit: "per_m_tokens" },
    "BAAI/bge-m3":              { input: 0.00, output: 0.00, priceUnit: "free" },
    // Image gen: input = USD per immagine, output = 0
    "black-forest-labs/FLUX.1-dev":     { input: 0.014, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX.1-schnell": { input: 0.0014, output: 0, priceUnit: "per_image" },
};
```

**Updating**: keep the file in sync with the provider's pricing page. Adding a comment with the last-updated date and the source URL is worthwhile.

---

## 20. Provider errors: normalised codes

Normalise the provider's HTTP errors into internal codes before propagating them to the client.

```typescript
// HTTP 401 → invalid API key
// HTTP 429 → rate limit
// HTTP 503 → provider temporarily unreachable
// HTTP 400 → malformed request (e.g. wrong model ID)

function normalizeProviderError(
    status: number,
    body: unknown,
    provider: string,
    model: string
): HttpError {
    if (status === 401) {
        return new HttpError("Provider API key rejected", {
            statusCode: 503,
            code: "LLM_PROVIDER_AUTH_FAILED",
            details: { provider, model, providerStatus: status, providerBody: body },
        });
    }
    if (status === 429) {
        return new HttpError("Provider rate limit exceeded", {
            statusCode: 429,
            code: "LLM_PROVIDER_RATE_LIMIT",
            details: { provider, model },
        });
    }
    return new HttpError(`Provider returned ${status}`, {
        statusCode: 502,
        code: "LLM_PROVIDER_ERROR",
        details: { provider, model, providerStatus: status, providerBody: body },
    });
}
```

**Tip**: always log `{ provider, model, durationMs, code }` for every failed call. It is essential for debugging in production.

---

## 21. Checklist for a new multi-provider project

### Minimum structure

- [ ] `domain/entities/LlmCatalog.ts` — types `LlmModel`, `LlmProviderCatalog`, `PipelineModelRole`
- [ ] `domain/repositories/LlmCatalogRepository.ts` — pure interface
- [ ] `application/llm/defaultXxxCatalog.ts` — one per provider, exposing `buildDefaultXxxCatalog(baseUrl)`
- [ ] `application/use-cases/GetLlmCatalog.ts` — dual-source (env/mongo)
- [ ] `application/use-cases/SeedLlmCatalog.ts` — idempotent
- [ ] `application/llm/modelRegistryPresets.ts` — `decorateSeedModel()`
- [ ] `application/llm/costPolicy.ts` — `estimateCost()` with dual-source

### Config

- [ ] Environment validated with Zod at bootstrap
- [ ] `LLM_CATALOG_SOURCE=env` as a safe default
- [ ] `providerApiKeys: Record<string, string>` derived from env at bootstrap
- [ ] `buildAuthHeaders()` centralised, not scattered
- [ ] No API key ever exposed to the frontend

### Context management

- [ ] Budget constants from the environment (tunable without a rebuild)
- [ ] History truncation per message + total
- [ ] Artifact truncation before sending to the LLM
- [ ] Output budget policy in the system prompt

### Slow operations (> 3s)

- [ ] Background task with `status: "pending" | "running" | "completed" | "failed"`
- [ ] Immediate HTTP response with `taskId`
- [ ] Client polling every 2–3s (not 1s)
- [ ] Timeout with `AbortController` on every provider call

### Image generation

- [ ] Separate endpoint from chat completions
- [ ] `num_inference_steps` configurable (default 4 for fast, 20 for quality)
- [ ] Download and buffer the image immediately (never store temporary URLs)
- [ ] Cost from lookup table (SiliconFlow does not return `usage.cost`)

### Quality and debugging

- [ ] Structured log for every call: `{ provider, model, durationMs, tokenUsage, costEstimate, error? }`
- [ ] Normalised error codes (`LLM_PROVIDER_AUTH_FAILED`, `LLM_PROVIDER_RATE_LIMIT`, etc.)
- [ ] Model deduplication by ID before responding to the frontend
- [ ] Separate `isDefault` from `isFallback` in the data model

---

## Internal references

| File | What it contains |
|---|---|
| [apps/api/src/domain/entities/LlmCatalog.ts](../../apps/api/src/domain/entities/LlmCatalog.ts) | Canonical types |
| [apps/api/src/application/use-cases/GetLlmCatalog.ts](../../apps/api/src/application/use-cases/GetLlmCatalog.ts) | Dual-source catalog |
| [apps/api/src/application/llm/defaultSiliconFlowCatalog.ts](../../apps/api/src/application/llm/defaultSiliconFlowCatalog.ts) | SiliconFlow catalog with fallback |
| [apps/api/src/application/llm/defaultOpenRouterCatalog.ts](../../apps/api/src/application/llm/defaultOpenRouterCatalog.ts) | OpenRouter catalog: free vs paid |
| [apps/api/src/application/llm/costPolicy.ts](../../apps/api/src/application/llm/costPolicy.ts) | Cost estimate dual-source |
| [apps/api/src/application/llm/siliconflowPricing.ts](../../apps/api/src/application/llm/siliconflowPricing.ts) | SiliconFlow pricing lookup table |
| [apps/api/src/application/llm/modelRegistryPresets.ts](../../apps/api/src/application/llm/modelRegistryPresets.ts) | `decorateSeedModel` and role templates |
| [apps/api/src/application/llm/llmMessageBuilder.ts](../../apps/api/src/application/llm/llmMessageBuilder.ts) | Context budget, history pruning |
| [apps/api/src/application/media/generateImageWithSiliconFlow.ts](../../apps/api/src/application/media/generateImageWithSiliconFlow.ts) | Image gen + timeout |
| [docs/guides/LLM_JSON_PARSING_GUIDELINES.md](LLM_JSON_PARSING_GUIDELINES.md) | Robust LLM output parsing |
| [docs/guides/OPENROUTER_INTEGRATION_GUIDE.md](OPENROUTER_INTEGRATION_GUIDE.md) | Detailed OpenRouter integration |
| [docs/specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md](../specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md) | Complete platform architecture playbook |
| [apps/api/src/config.ts](../../apps/api/src/config.ts) | Complete Zod env schema |
