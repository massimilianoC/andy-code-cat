# Multi-Provider LLM — Best Practices Riusabili

Guida pratica estratta dall'implementazione di questo progetto.
Copre: catalogo provider, routing, token budget, costi, background tasks, image gen, streaming SSE, local dev.
Applicabile a qualsiasi sistema Node.js/TypeScript che integra modelli da OpenAI-compatible, SiliconFlow, OpenRouter, LM Studio o altri provider eterogenei.

---

## Indice

1. [Principio fondamentale: provider-agnostic by design](#1-principio-fondamentale-provider-agnostic-by-design)
2. [Architettura del catalogo multi-provider](#2-architettura-del-catalogo-multi-provider)
3. [Modello dati: entità canoniche](#3-modello-dati-entità-canoniche)
4. [Ruoli modello — tassonomia riusabile](#4-ruoli-modello--tassonomia-riusabile)
5. [Auth routing: api-key / bearer / none](#5-auth-routing-api-key--bearer--none)
6. [Config validation al bootstrap (Zod pattern)](#6-config-validation-al-bootstrap-zod-pattern)
7. [Dual-source catalog: env vs MongoDB](#7-dual-source-catalog-env-vs-mongodb)
8. [Provider key routing sicuro](#8-provider-key-routing-sicuro)
9. [Context budget management](#9-context-budget-management)
10. [History pruning — token-safe](#10-history-pruning--token-safe)
11. [Output budget policy nel system prompt](#11-output-budget-policy-nel-system-prompt)
12. [Cost tracking dual-source (provider-reported vs flat-rate)](#12-cost-tracking-dual-source-provider-reported-vs-flat-rate)
13. [Streaming SSE da LLM al client](#13-streaming-sse-da-llm-al-client)
14. [Background tasks pattern (image gen, pipeline lenta)](#14-background-tasks-pattern-image-gen-pipeline-lenta)
15. [Image generation: polling e timeout](#15-image-generation-polling-e-timeout)
16. [Deduplication modelli nel catalogo](#16-deduplication-modelli-nel-catalogo)
17. [LM Studio come provider locale (dev/offline)](#17-lm-studio-come-provider-locale-devoffline)
18. [Model-specific prompt templates](#18-model-specific-prompt-templates)
19. [Pricing lookup table per provider](#19-pricing-lookup-table-per-provider)
20. [Errori provider: codici normalizzati](#20-errori-provider-codici-normalizzati)
21. [Checklist per nuovo progetto multi-provider](#21-checklist-per-nuovo-progetto-multi-provider)

---

## 1. Principio fondamentale: provider-agnostic by design

**Tutti i provider compatibili OpenAI condividono lo stesso schema API:**

```
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}     ← oppure nessun header se authType === "none"
Content-Type: application/json

{
  "model": "{model_id}",
  "messages": [...],
  "max_tokens": 8000,
  "stream": true
}
```

Questo vale per: **OpenAI, SiliconFlow, OpenRouter, LM Studio, Ollama, Together.ai, Groq, Parasail, Azure OpenAI** e decine di altri.

**Pattern chiave**: non scrivere codice specifico per provider. Usa sempre:
- `baseUrl` risolto dal catalogo
- `apiKey` risolto dalla mappa provider→chiave
- `model` risolto dal ruolo richiesto

---

## 2. Architettura del catalogo multi-provider

```
domain/
  entities/
    LlmCatalog.ts              ← LlmModel, LlmProviderCatalog, PipelineModelRole
  repositories/
    LlmCatalogRepository.ts    ← interfaccia pura (niente infra)

application/
  use-cases/
    GetLlmCatalog.ts           ← env source o mongo source, stesso output
    SeedLlmCatalog.ts          ← popola MongoDB dal catalogo statico
  llm/
    defaultSiliconFlowCatalog.ts
    defaultLmStudioCatalog.ts
    defaultOpenRouterCatalog.ts
    modelRegistryPresets.ts    ← decorateModel (displayName, description, promptTemplate)

infra/
  repositories/
    MongoLlmCatalogRepository.ts   ← implementazione concreta
```

**Regola**: la presentation layer vede solo `LlmProviderCatalog[]` — non sa niente di endpoint o chiavi specifiche.

---

## 3. Modello dati: entità canoniche

```typescript
export type PipelineModelRole =
    | "coding" | "coding_fast"
    | "dialogue" | "dialogue_fast"
    | "vision" | "vision_fast"
    | "quality_check"
    | "image_gen" | "image_gen_fast"
    | "embeddings";

export interface LlmModel {
    id: string;                  // ID reale del provider (es. "Qwen/Qwen3-32B")
    provider: string;            // chiave logica (es. "siliconflow")
    role: PipelineModelRole;
    capabilities: string[];      // ["chat"] | ["vision","chat"] | ["image_generation"]
    isDefault: boolean;          // modello primario per quel ruolo
    isFallback: boolean;         // alternativa se il default fallisce
    isActive: boolean;
    displayName?: string;        // etichetta UI
    description?: string;        // note operative
    promptTemplate?: string;     // istruzioni specifiche per questo modello
    focusPromptTemplate?: string;// istruzioni in modalità focused-edit
    priceTier?: "free" | "€" | "€€" | "€€€" | "€€€€";
    priceInputUsdPerM?: number;  // USD per milione di token in input
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

**Perché separare `isDefault` da `isFallback`?**
- `isDefault=true`: preferito dal sistema — usato nella selezione automatica per ruolo.
- `isFallback=true`: attivato solo quando il default è irraggiungibile o restituisce errore.
- Un modello può essere entrambi `isDefault=false, isFallback=true` (presente, ma non il primary choice).

---

## 4. Ruoli modello — tassonomia riusabile

Usare ruoli semantici invece di ID modello hardcoded permette di cambiare modello senza toccare la logica applicativa.

| Ruolo | Uso tipico | Capability |
|---|---|---|
| `coding` | Generazione codice, architettura | `["chat"]` |
| `coding_fast` | Fix veloci, scaffolding | `["chat"]` |
| `dialogue` | Chat generici, UX content | `["chat"]` |
| `dialogue_fast` | Iterazioni rapide, bozze | `["chat"]` |
| `vision` | Screenshot, layout, multimodal | `["vision","chat"]` |
| `vision_fast` | Check visuale rapido | `["vision","chat"]` |
| `quality_check` | Review, QA, validazione | `["chat"]` |
| `image_gen` | Asset creativi, alta qualità | `["image_generation"]` |
| `image_gen_fast` | Explorazione rapida | `["image_generation"]` |
| `embeddings` | Retrieval, matching semantico | `["embeddings"]` |

**Pattern di risoluzione ruolo → modello:**

```typescript
function resolveModelForRole(
    providers: LlmProviderCatalog[],
    providerKey: string,
    role: PipelineModelRole
): LlmModel | undefined {
    const provider = providers.find(p => p.provider === providerKey && p.isActive);
    if (!provider) return undefined;

    // 1. default attivo per quel ruolo
    const defaultModel = provider.models.find(
        m => m.role === role && m.isDefault && m.isActive
    );
    if (defaultModel) return defaultModel;

    // 2. qualsiasi attivo per quel ruolo
    return provider.models.find(m => m.role === role && m.isActive);
}
```

---

## 5. Auth routing: api-key / bearer / none

Ogni provider ha un proprio regime di autenticazione. Centralizzare la logica in un mapper evita `if (provider === "siliconflow")` sparsi.

```typescript
type AuthType = "api-key" | "bearer" | "none";

// Mappa: provider → header da iniettare
function buildAuthHeaders(
    authType: AuthType | undefined,
    apiKey: string | undefined
): Record<string, string> {
    if (!authType || authType === "none") return {};
    if (!apiKey) throw new Error("API key required but not configured");

    // Sia "bearer" che "api-key" usano Authorization: Bearer in OpenAI-compat
    return { Authorization: `Bearer ${apiKey}` };
}

// Utilizzo
const headers = buildAuthHeaders(
    context.providerCatalog.authType,
    env.providerApiKeys[context.providerCatalog.provider]
);
```

**Note pratiche:**
- LM Studio locale → `authType: "none"` (nessun header)
- SiliconFlow, OpenRouter → `authType: "bearer"` (token nella porta API)
- OpenAI diretto → `authType: "api-key"` (Bearer, ma semanticamente diverso)
- Anthropic → `authType: "api-key"` + header `x-api-key` (richiede adapter dedicato)

---

## 6. Config validation al bootstrap (Zod pattern)

Tutti gli env critici validati con Zod all'avvio. Il processo si ferma con errore leggibile se manca qualcosa.

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

    // Chiavi aggiuntive come JSON per provider arbitrari
    LLM_PROVIDER_API_KEYS_JSON: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error("Invalid environment configuration", parsed.error.format());
    process.exit(1);
}

// Derivare booleani e mappe da env → non spargerli nel codice
export const env = {
    ...parsed.data,
    hasSiliconFlowApiKey: Boolean(parsed.data.SILICONFLOW_API_KEY?.trim()),
    hasOpenRouterApiKey: Boolean(parsed.data.OPEN_ROUTER_API_KEY?.trim()),
    providerApiKeys: buildProviderKeyMap(parsed.data),
};
```

**Pattern `LLM_PROVIDER_API_KEYS_JSON`** — per supportare provider arbitrari senza aggiungere env var dedicate:

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
        } catch { /* ignora JSON malformato */ }
    }
    return map;
}
```

---

## 7. Dual-source catalog: env vs MongoDB

**Problema**: in sviluppo vuoi un catalogo sempre disponibile senza DB. In produzione vuoi editarlo da UI admin senza rebuild.

**Soluzione**: due sorgenti con stessa interfaccia di output.

```typescript
// LLM_CATALOG_SOURCE=env  → catalogo statico hardcoded nei file defaultXxxCatalog.ts
// LLM_CATALOG_SOURCE=mongo → MongoDB con fallback al catalogo statico se vuoto

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

        // Mongo vuoto → fallback env
        return { source: "env", providers: fallback };
    }
}
```

**Seed idempotente al bootstrap** (solo in `LLM_CATALOG_SOURCE=mongo`):

```typescript
// SeedLlmCatalog.execute() usa upsert, non insert — sicuro da rieseguire ogni startup
if (env.LLM_CATALOG_SOURCE === "mongo" && env.llmAutoSeedOnStartup) {
    await seedLlmCatalog.execute();
}
```

---

## 8. Provider key routing sicuro

Mai esporre la chiave al frontend. Mai hardcodare nel codice. Il backend la inietta solo al momento della chiamata.

```typescript
// ❌ Mai fare
const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}` }
});

// ✅ Sempre risolvere dalla mappa centralizzata
const apiKey = env.providerApiKeys[context.providerCatalog.provider];
if (!apiKey && context.providerCatalog.authType !== "none") {
    throw new HttpError(`Missing API key for provider ${context.providerCatalog.provider}`, {
        statusCode: 503,
        code: "LLM_PROVIDER_API_KEY_MISSING",
    });
}
```

**Hint per UI admin**: salvare nell'env l'hint del nome variabile per ogni provider, così l'admin sa cosa configurare:

```typescript
const PROVIDER_KEY_ENV_HINTS: Record<string, string> = {
    siliconflow: "SILICONFLOW_API_KEY",
    openrouter: "OPEN_ROUTER_API_KEY",
    // provider arbitrari → "LLM_PROVIDER_API_KEYS_JSON"
};
```

---

## 9. Context budget management

I modelli hanno finestre di contesto finite. Gestire il budget in modo esplicito previene errori `context_length_exceeded` in produzione.

```typescript
// Costanti da env (tunable senza rebuild)
const MAX_CONTEXT_CHARS = env.LLM_CONTEXT_MAX_CHARS;          // 64000 default
const MAX_ARTIFACT_CHARS = env.LLM_ARTIFACT_CONTEXT_MAX_CHARS; // 16000 default
const MAX_HISTORY_MESSAGES = env.LLM_MAX_HISTORY_MESSAGES;     // 12 default
const MAX_HISTORY_MESSAGE_CHARS = env.LLM_HISTORY_MESSAGE_MAX_CHARS; // 2000 default
const MAX_HISTORY_CHARS = env.LLM_HISTORY_MAX_CHARS;           // 7000 default

// Troncare il contesto artifact prima di inviarlo
function truncateArtifact(html: string, maxChars: number): string {
    if (html.length <= maxChars) return html;
    return html.slice(0, maxChars) + "\n<!-- [TRUNCATED FOR CONTEXT BUDGET] -->";
}

// Ogni messaggio storico viene troncato individualmente
function truncateMessage(content: string, maxChars: number): string {
    return content.length > maxChars
        ? content.slice(0, maxChars) + " [...]"
        : content;
}
```

**Regola pratica**: usa caratteri, non token, per la stima del budget (1 token ≈ 3–4 caratteri per testi misti). Questo evita dipendenze dal tokenizer specifico del modello.

---

## 10. History pruning — token-safe

```typescript
function pruneHistory(
    history: HistoryMessage[],
    maxMessages: number,
    maxCharsPerMessage: number,
    maxTotalChars: number
): LlmMessage[] {
    // Prendi solo gli ultimi N messaggi
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

**Modalità storia per focus-edit** (risparmio token significativo):

```typescript
// LLM_FOCUS_HISTORY_MODE=none  → nessuna storia (max risparmio)
// LLM_FOCUS_HISTORY_MODE=user_only → solo messaggi utente (rimuove HTML artifacts dall'assistant)
// LLM_FOCUS_HISTORY_MODE=full  → storia completa (default chat)
```

---

## 11. Output budget policy nel system prompt

Includere una sezione esplicita nel system prompt istruisce il modello a rispettare i limiti.

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

Alcuni provider (es. **OpenRouter**) restituiscono il costo reale in USD nel campo `usage.cost`. Questo è sempre più preciso della stima flat-rate.

```typescript
interface CostPolicyInput {
    capability?: "chat" | "vision" | "image_generation" | "embeddings";
    tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    imageCount?: number;
    providerCostUsd?: number; // da usage.cost OpenRouter o prezzo lookup SiliconFlow
}

function estimateCost(input: CostPolicyInput, cfg: CostPolicyConfig): CostEstimate {
    // Provider-reported cost ha precedenza
    if (input.providerCostUsd !== undefined && input.providerCostUsd > 0) {
        const amount = input.providerCostUsd * cfg.usdToEurRate * cfg.markupFactor;
        return { currency: "EUR", amount, source: "provider", providerCostUsd: input.providerCostUsd, ... };
    }

    // Fallback: stima flat-rate da token
    const tokenCost = (input.tokenUsage?.totalTokens ?? 0) / 1000 * cfg.textEurPer1kTokens;
    const imageCost = (input.imageCount ?? 0) * cfg.imageEurPerAsset;
    return { currency: "EUR", amount: tokenCost + imageCost, source: "flat-rate", ... };
}
```

**Per SiliconFlow**: costruire una price lookup table `Record<modelId, SfModelPrice>` con prezzi hardcoded aggiornati periodicamente. Calcolare il costo reale moltiplicando token usati × prezzo per M.

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

**Price tier derivati da percentile** (per UI): categorizzare i modelli in tier `free/€/€€/€€€/€€€€` basandosi su percentili della distribuzione dei prezzi nel catalogo, con unità omogenee (evitare di mescolare `per_m_tokens` con `per_image`).

---

## 13. Streaming SSE da LLM al client

```typescript
// Setup SSE su Express
router.get("/llm/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Helper per inviare eventi tipizzati
    function sendSse(payload: unknown) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    sendSse({ type: "start", provider: context.providerCatalog.provider });

    // Chiama il provider con stream: true
    const stream = await callProviderStream(context, messages);

    for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (delta) sendSse({ type: "chunk", content: delta });
    }

    sendSse({ type: "done", usage: stream.usage });
    res.end();
});
```

**Attenzione**: non tutti i provider OpenAI-compatible supportano `stream: true` in modo identico. LM Studio lo supporta, SiliconFlow sì, OpenRouter sì. Verificare la documentazione per campi edge (`finish_reason`, `usage` nello stream).

---

## 14. Background tasks pattern (image gen, pipeline lenta)

Per operazioni che richiedono > 2–3 secondi, rispondere immediatamente con un task ID e aggiornare il record in background.

### Entità

```typescript
interface BackgroundTask {
    id: string;
    type: string;                // "image_gen" | "pipeline" | "analysis" | ...
    status: "pending" | "running" | "completed" | "failed";
    pipelineProfile?: string;    // quale pipeline/config ha eseguito
    input?: unknown;
    output?: unknown;
    error?: string;
    startedAt: Date;
    completedAt?: Date;
    tokenUsage?: TokenUsage;
    costEstimate?: CostEstimate;
}
```

### Flusso

```typescript
// 1. Rispondere subito con task pending
const task = await conversationRepo.addBackgroundTask(conversationId, {
    type: "image_gen",
    status: "pending",
    input: { prompt, model, size },
});
res.json({ taskId: task.id, status: "pending" });

// 2. Eseguire in background (non await nella response chain)
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

### Polling dal client (se non puoi usare WebSocket)

```typescript
// Frontend: poll ogni 2s fino a completamento o timeout (30s)
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

**Perché non 1 secondo?** SiliconFlow FLUX.1 richiede ~4–6s. Un singolo refresh a 1.8s lascia gli asset bloccati in `pending`. Usare poll interrompibile con back-off progressivo per task che possono durare > 10s.

---

## 15. Image generation: polling e timeout

SiliconFlow usa l'endpoint `/images/generations` (OpenAI-compatible image gen):

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

        // Scaricare e bufferizzare i bytes
        const imageBuffer = await fetchBufferFromUrl(imageUrl, opts.apiKey);

        return {
            provider: "siliconflow",
            model: opts.model,
            buffer: imageBuffer,
            // ... altri metadati
        };
    } finally {
        clearTimeout(timer);
    }
}
```

**Pitfall**:
- Il campo `data[0].url` può essere una URL temporanea con scadenza. Scaricare e salvare subito, non salvare la URL.
- `num_inference_steps` default = 20, ma `FLUX.1-schnell` funziona bene con 4 step (molto più veloce, quasi identico per uso generale).
- Calcolare `providerCostUsd` dalla price lookup table in base al modello, non dall'API (SiliconFlow non restituisce `usage.cost`).

---

## 16. Deduplication modelli nel catalogo

Provider come OpenRouter possono restituire lo stesso modello con ruoli diversi (es. `gpt-4o-mini` per `dialogue` e `dialogue_fast`). Deduplicare per ID mantenendo la priorità `isDefault`.

```typescript
function dedupeModelsById(models: LlmModel[]): LlmModel[] {
    const byId = new Map<string, LlmModel>();

    for (const model of models) {
        if (!model.isActive || !model.id) continue;
        if (!byId.has(model.id)) {
            byId.set(model.id, model);
            continue;
        }
        // Preferire il modello marcato come default
        const prev = byId.get(model.id)!;
        if (model.isDefault && !prev.isDefault) {
            byId.set(model.id, model);
        }
    }

    return [...byId.values()];
}
```

**Quando applicare**: solo nella risposta al frontend (`/llm/providers`). Il catalogo interno può contenere duplicati per ruolo — serve per la logica di fallback per ruolo.

---

## 17. LM Studio come provider locale (dev/offline)

LM Studio espone un server OpenAI-compatible su `http://localhost:1234/v1` (o indirizzo LAN in Docker).

```typescript
export function buildDefaultLmStudioCatalog(baseUrl: string): LlmProviderCatalog {
    return {
        provider: "lmstudio",
        baseUrl,
        apiType: "openai-compatible",
        authType: "none",    // ← nessuna chiave richiesta
        isActive: true,
        models: [{
            id: "local/default-chat",  // placeholder — LM Studio usa il modello caricato
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

**In Docker**: usare `host.docker.internal:1234` invece di `localhost`.

```env
LMSTUDIO_BASE_URL=http://host.docker.internal:1234/v1
```

**Uso consigliato**: fallback offline, test senza spendere crediti, sviluppo locale di nuovi flow prima di connettere provider cloud.

---

## 18. Model-specific prompt templates

Modelli diversi reagiscono meglio a stili di istruzione diversi. Centralizzare le note per ruolo in un file dedicato (`modelRegistryPresets.ts`) invece di spargerle nel codice.

```typescript
const ROLE_PROMPT_TEMPLATES: Record<PipelineModelRole, string> = {
    coding: "## MODEL-SPECIFIC GUIDANCE\nPrefer precise steps, clean architecture, production-ready code.",
    coding_fast: "## MODEL-SPECIFIC GUIDANCE\nOptimize for fast, concise output. Keep edits small and reviewable.",
    dialogue: "## MODEL-SPECIFIC GUIDANCE\nPrioritize clarity and structured reasoning. Ask only when ambiguity blocks.",
    quality_check: "## MODEL-SPECIFIC GUIDANCE\nAct as a strict reviewer. Surface inconsistencies and risks first.",
    // ...
};

// Decorare i modelli al momento della build del catalogo
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

## 19. Pricing lookup table per provider

Mantenere una `Record<modelId, { input: number; output: number; priceUnit: string }>` per ogni provider che non restituisce `usage.cost`.

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

**Aggiornamento**: tenere il file sincronizzato con la pagina prezzi del provider. Utile aggiungere un commento con data ultimo aggiornamento + URL fonte.

---

## 20. Errori provider: codici normalizzati

Normalizzare gli errori HTTP del provider in codici interni prima di propagarli al client.

```typescript
// HTTP 401 → API key non valida
// HTTP 429 → rate limit
// HTTP 503 → provider temporaneamente irraggiungibile
// HTTP 400 → richiesta malformata (es. model ID errato)

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

**Suggerimento**: loggare sempre `{ provider, model, durationMs, code }` per ogni chiamata fallita. È fondamentale per debugging in produzione.

---

## 21. Checklist per nuovo progetto multi-provider

### Struttura minima

- [ ] `domain/entities/LlmCatalog.ts` — tipi `LlmModel`, `LlmProviderCatalog`, `PipelineModelRole`
- [ ] `domain/repositories/LlmCatalogRepository.ts` — interfaccia pura
- [ ] `application/llm/defaultXxxCatalog.ts` — uno per provider, con `buildDefaultXxxCatalog(baseUrl)`
- [ ] `application/use-cases/GetLlmCatalog.ts` — dual-source (env/mongo)
- [ ] `application/use-cases/SeedLlmCatalog.ts` — idempotente
- [ ] `application/llm/modelRegistryPresets.ts` — `decorateSeedModel()`
- [ ] `application/llm/costPolicy.ts` — `estimateCost()` con dual-source

### Config

- [ ] Env validati con Zod al bootstrap
- [ ] `LLM_CATALOG_SOURCE=env` come default sicuro
- [ ] `providerApiKeys: Record<string, string>` derivato da env al bootstrap
- [ ] `buildAuthHeaders()` centralizzato, non sparso
- [ ] Nessuna chiave API mai esposta al frontend

### Context management

- [ ] Costanti budget da env (tunabili senza rebuild)
- [ ] Troncamento history per messaggio + totale
- [ ] Troncamento artifact prima di inviare al LLM
- [ ] Output budget policy nel system prompt

### Operazioni lente (> 3s)

- [ ] Background task con `status: "pending" | "running" | "completed" | "failed"`
- [ ] Risposta HTTP immediata con `taskId`
- [ ] Polling client ogni 2–3s (non 1s)
- [ ] Timeout con `AbortController` su tutte le chiamate provider

### Image generation

- [ ] Endpoint separato da chat completions
- [ ] `num_inference_steps` configurabile (default 4 per fast, 20 per quality)
- [ ] Download e bufferizzazione dell'immagine subito (non salvare URL temporanee)
- [ ] Costo da lookup table (SiliconFlow non restituisce `usage.cost`)

### Qualità e debugging

- [ ] Log strutturato per ogni chiamata: `{ provider, model, durationMs, tokenUsage, costEstimate, error? }`
- [ ] Codici errore normalizzati (`LLM_PROVIDER_AUTH_FAILED`, `LLM_PROVIDER_RATE_LIMIT`, ecc.)
- [ ] Deduplication modelli per ID prima di rispondere al frontend
- [ ] Separare `isDefault` da `isFallback` nel modello dati

---

## Riferimenti interni

| File | Cosa contiene |
|---|---|
| [apps/api/src/domain/entities/LlmCatalog.ts](../../apps/api/src/domain/entities/LlmCatalog.ts) | Tipi canonici |
| [apps/api/src/application/use-cases/GetLlmCatalog.ts](../../apps/api/src/application/use-cases/GetLlmCatalog.ts) | Dual-source catalog |
| [apps/api/src/application/llm/defaultSiliconFlowCatalog.ts](../../apps/api/src/application/llm/defaultSiliconFlowCatalog.ts) | Catalogo SiliconFlow con fallback |
| [apps/api/src/application/llm/defaultOpenRouterCatalog.ts](../../apps/api/src/application/llm/defaultOpenRouterCatalog.ts) | Catalogo OpenRouter: free vs paid |
| [apps/api/src/application/llm/costPolicy.ts](../../apps/api/src/application/llm/costPolicy.ts) | Cost estimate dual-source |
| [apps/api/src/application/llm/siliconflowPricing.ts](../../apps/api/src/application/llm/siliconflowPricing.ts) | Lookup table prezzi SiliconFlow |
| [apps/api/src/application/llm/modelRegistryPresets.ts](../../apps/api/src/application/llm/modelRegistryPresets.ts) | `decorateSeedModel` e role templates |
| [apps/api/src/application/llm/llmMessageBuilder.ts](../../apps/api/src/application/llm/llmMessageBuilder.ts) | Context budget, history pruning |
| [apps/api/src/application/media/generateImageWithSiliconFlow.ts](../../apps/api/src/application/media/generateImageWithSiliconFlow.ts) | Image gen + timeout |
| [docs/guides/LLM_JSON_PARSING_GUIDELINES.md](LLM_JSON_PARSING_GUIDELINES.md) | Parsing robusto output LLM |
| [docs/guides/OPENROUTER_INTEGRATION_GUIDE.md](OPENROUTER_INTEGRATION_GUIDE.md) | Integrazione OpenRouter dettagliata |
| [docs/specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md](../specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md) | Playbook completo architettura piattaforma |
| [apps/api/src/config.ts](../../apps/api/src/config.ts) | Schema Zod env completo |
