# OpenRouter Multi-Provider Integration Guide

Guida tecnica derivata dall'implementazione in questo progetto.
Copertura: backend (Node.js / Express, clean architecture) + frontend (Next.js / React).

---

## Indice

1. [Cos'è OpenRouter e quando usarlo](#1-cosè-openrouter-e-quando-usarlo)
2. [Variabili d'ambiente necessarie](#2-variabili-dambiente-necessarie)
3. [Architettura del catalog multi-provider](#3-architettura-del-catalog-multi-provider)
4. [Struttura dati: entità di dominio](#4-struttura-dati-entità-di-dominio)
5. [Catalog statico di default (seed)](#5-catalog-statico-di-default-seed)
6. [Discovery live dei modelli via /models](#6-discovery-live-dei-modelli-via-models)
7. [Price tier — derivazione e thresholds](#7-price-tier--derivazione-e-thresholds)
8. [Cost Policy — dual-source (provider vs flat-rate)](#8-cost-policy--dual-source-provider-vs-flat-rate)
9. [Autenticazione e routing delle chiavi](#9-autenticazione-e-routing-delle-chiavi)
10. [Route di risoluzione del modello (resolveContext)](#10-route-di-risoluzione-del-modello-resolvecontext)
11. [Endpoint `/llm/providers` — risposta al frontend](#11-endpoint-llmproviders--risposta-al-frontend)
12. [Frontend: tipi TypeScript e model selector](#12-frontend-tipi-typescript-e-model-selector)
13. [Frontend: visualizzazione del costo nella UI](#13-frontend-visualizzazione-del-costo-nella-ui)
14. [Seed script e sorgente mongo vs env](#14-seed-script-e-sorgente-mongo-vs-env)
15. [Pattern di fallback e deduplicazione](#15-pattern-di-fallback-e-deduplicazione)
16. [Checklist per portare questa integrazione in un nuovo progetto](#16-checklist-per-portare-questa-integrazione-in-un-nuovo-progetto)

---

## 1. Cos'è OpenRouter e quando usarlo

[OpenRouter](https://openrouter.ai) è un proxy unificato che espone centinaia di modelli LLM (OpenAI, Anthropic, Google, Meta, Mistral, ecc.) attraverso una singola API **compatibile OpenAI** (`POST /chat/completions`).

**Vantaggi chiave:**

- Singola API key per accedere a decine di provider.
- Modelli `:free` completamente gratuiti (rate-limited ma nessun addebito).
- L'endpoint `/models` restituisce metadati di pricing **per-token in USD** — consente price tier accurati senza tabelle statiche.
- Il campo `usage.cost` nella risposta di completamento riporta il **costo reale della chiamata in USD** — elimina la necessità di stimare.
- L'header `X-Title` / HTTP-Referer permette di identificare l'app nelle statistiche OpenRouter.

**Usalo quando:**

- Vuoi accesso a modelli diversi (Anthropic, Google, ecc.) senza gestire n API key separate.
- Vuoi costi zero per prototipi/test usando i modelli `:free`.
- Vuoi tracking accurato dei costi per-call senza stime flat-rate.

---

## 2. Variabili d'ambiente necessarie

```env
# URL base dell'API (non cambia)
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Chiave API (opzionale per i modelli :free, obbligatoria per i modelli paid)
OPEN_ROUTER_API_KEY=sk-or-v1-...

# Sorgente del catalog LLM: "env" = statico da codice, "mongo" = persistito su DB
LLM_CATALOG_SOURCE=env

# Seed automatico su startup (popola MongoDB col catalog statico)
LLM_AUTO_SEED_ON_STARTUP=true

# Provider di default quando il client non specifica
LLM_DEFAULT_PROVIDER=openrouter

# Cost policy (USD → EUR conversione)
COST_POLICY_USD_TO_EUR_RATE=0.92
COST_POLICY_PROVIDER_MARKUP_FACTOR=1.1

# Fallback flat-rate (usato solo se il provider non riporta usage.cost)
COST_POLICY_TEXT_EUR_PER_1K_TOKENS=0.2
```

> **Sicurezza**: la chiave `OPEN_ROUTER_API_KEY` non deve mai essere esposta al frontend. Il backend la inietta nell'header `Authorization: Bearer <key>` al momento della chiamata.

Il config del backend valida le env con **Zod** al startup e deriva `env.hasOpenRouterApiKey` come booleano:

```typescript
// apps/api/src/config.ts
OPEN_ROUTER_API_KEY: z.string().optional(),
// ...
hasOpenRouterApiKey: Boolean(parsed.data.OPEN_ROUTER_API_KEY?.trim()),
providerApiKeys: {
    openrouter: "sk-or-v1-...",  // popolato se la key è presente
},
```

---

## 3. Architettura del catalog multi-provider

Il sistema supporta **provider multipli in parallelo** (SiliconFlow, LM Studio locale, OpenRouter) con un'astrazione comune.

```
domain/
  entities/
    LlmCatalog.ts          ← LlmModel, LlmProviderCatalog, PipelineModelRole
  repositories/
    LlmCatalogRepository.ts ← interfaccia: listActiveProviders, upsertProvider

application/
  llm/
    defaultOpenRouterCatalog.ts  ← catalog statico con modelli free+paid
    defaultSiliconFlowCatalog.ts ← catalog statico SiliconFlow
    defaultLmStudioCatalog.ts    ← catalog statico LM Studio locale
    costPolicy.ts                ← stima costo EUR (dual-source)
  use-cases/
    GetLlmCatalog.ts             ← recupera catalog da env o mongo
    SeedLlmCatalog.ts            ← upsert di tutti i provider su MongoDB

infra/
  repositories/
    MongoLlmCatalogRepository.ts ← implementazione MongoDB

presentation/
  http/routes/
    llmRoutes.ts                 ← GET /llm/providers, POST /projects/:id/llm/chat-preview
```

**Flusso di dipendenza (Clean Architecture):**

```
presentation → application → domain
infra → domain
```

Il dominio non conosce MongoDB né Express. I catalog builder vivono in `application/llm/` e dipendono solo dalle entity di dominio.

---

## 4. Struttura dati: entità di dominio

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
    isDefault: boolean;      // primo candidato per questo role
    isFallback: boolean;     // usato se il default non è disponibile
    isActive: boolean;
    priceTier?: "free" | "low" | "mid" | "high";  // calcolato, non persistito
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

> `priceTier` è un campo **computato a runtime** (non salvato su DB). Viene derivato dal payload `/models` di OpenRouter al momento della discovery e aggiunto alla risposta dell'endpoint `/llm/providers`.

---

## 5. Catalog statico di default (seed)

Il file `defaultOpenRouterCatalog.ts` definisce i modelli di bootstrap:

```typescript
// Modelli gratuiti (suffisso :free) — nessuna spesa, rate-limited
const FREE_DEFAULTS = [
    { id: "google/gemma-3-12b-it:free",  role: "dialogue",      capabilities: ["chat"] },
    { id: "google/gemma-3-4b-it:free",   role: "dialogue_fast", capabilities: ["chat"] },
    { id: "nvidia/nemotron-3-nano-30b-a3b:free", role: "coding", capabilities: ["chat"] },
    { id: "z-ai/glm-4.5-air:free",       role: "quality_check", capabilities: ["chat"] },
    { id: "google/gemma-3n-e4b-it:free", role: "vision",        capabilities: ["vision", "chat"] },
    // ...
];

// Modelli paid — usati solo se OPEN_ROUTER_API_KEY è presente
const PAID_DEFAULTS = [
    { id: "openai/gpt-4o-mini",           role: "dialogue",      capabilities: ["vision", "chat"] },
    { id: "anthropic/claude-sonnet-4-5",  role: "coding",        capabilities: ["chat"] },
    { id: "anthropic/claude-3.5-haiku",   role: "coding_fast",  capabilities: ["chat"] },
    { id: "google/gemini-2.5-pro",        role: "quality_check", capabilities: ["vision", "chat"] },
    { id: "openai/gpt-4o",               role: "vision",        capabilities: ["vision", "chat"] },
];
```

**Logica paid-first:**

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
        // Solo free: il primo è default, gli altri fallback
        FREE_DEFAULTS.forEach((m, i) =>
            models.push({ ...m, isDefault: i === 0, isFallback: i !== 0 })
        );
    }
    return { provider: "openrouter", baseUrl, apiType: "openai-compatible", authType: "bearer", ... };
}
```

---

## 6. Discovery live dei modelli via /models

Quando viene chiamato `GET /v1/llm/providers`, il backend chiama `GET https://openrouter.ai/api/v1/models` per ottenere la lista aggiornata dei modelli disponibili all'account.

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

**Filtro modality — solo modelli con output testo:**

```typescript
// OpenRouter: keep only models with text output
const textModels = rawModels.filter((m) => {
    const modality = m.architecture?.modality ?? "";
    return modality.endsWith("->text");
    // Esempi: "text->text", "text+image->text", "text+audio->text"
    // Esclusi: "text->image", "text->audio", "text->video"
});
```

Il campo `architecture.modality` è specifico di OpenRouter — altri provider compatibili OpenAI (SiliconFlow) non lo espongono, quindi richiedono un filtro diverso.

---

## 7. Price tier — derivazione e thresholds

OpenRouter restituisce il pricing in USD **per singolo token** (non per milione):

```json
{
  "id": "openai/gpt-4o-mini",
  "pricing": {
    "prompt": "0.00000015",       // $0.15 / 1M tokens input
    "completion": "0.00000060"    // $0.60 / 1M tokens output
  }
}
```

**Thresholds usati in questo progetto:**

| Tier   | Prezzo prompt (USD/token) | Equivalente per milione |
|--------|--------------------------|------------------------|
| `free` | `== 0`                   | Gratis                 |
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

> Per i provider che **non** restituiscono pricing nell'endpoint `/models` (es. SiliconFlow), è necessaria una tabella lookup statica mantenuta manualmente.

**Rilevamento modelli free OpenRouter:**

```typescript
const isFree =
    input.providerKey === "openrouter" &&
    m.pricing?.prompt === "0" &&
    m.pricing?.completion === "0";
```

I modelli con suffisso `:free` hanno pricing a `"0"` nell'API.

---

## 8. Cost Policy — dual-source (provider vs flat-rate)

OpenRouter espone il costo effettivo della chiamata nella chiave `usage.cost` della risposta di completamento:

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

Questo valore è in **USD**. Il sistema lo converte in EUR con markup:

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
    providerCostUsd?: number;   // ← campo chiave per OpenRouter
}

export function estimateCost(input: CostPolicyInput, cfg: CostPolicyConfig): CostEstimate {
    // Priorità 1: costo reale riportato dal provider
    if (input.providerCostUsd !== undefined && input.providerCostUsd > 0) {
        const amount = input.providerCostUsd * (cfg.usdToEurRate ?? 0.92) * (cfg.providerMarkupFactor ?? 1.0);
        return {
            currency: "EUR",
            amount: Number(amount.toFixed(6)),
            source: "provider",          // <- indica origine
            breakdown: { tokenCost: 0, imageCost: 0, videoCost: 0 },
            providerCostUsd: input.providerCostUsd,
            // ...
        };
    }

    // Priorità 2: stima flat-rate su token count (fallback se il provider non riporta)
    const tokenCost = (tokens / 1000) * cfg.textEurPer1kTokens;
    return { source: "flat-rate", amount: tokenCost, ... };
}
```

**Il campo `source` nella risposta:**

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

Il frontend può mostrare il badge "costo reale" vs "stima" in base a `source`.

---

## 9. Autenticazione e routing delle chiavi

Il backend centralizza la gestione delle chiavi. Il frontend non vede mai le chiavi.

```typescript
// config.ts
providerApiKeys: {
    openrouter: process.env.OPEN_ROUTER_API_KEY,
    siliconflow: process.env.SILICONFLOW_API_KEY,
    // oppure da LLM_PROVIDER_API_KEYS_JSON: '{"openrouter":"sk-...","custom":"sk-..."}'
}

// llmRoutes.ts
function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none") {
    if (authType === "none") return undefined;
    const key = env.providerApiKeys[providerKey];
    if (!key) return undefined;
    return authType === "api-key" ? key : `Bearer ${key}`;
}
```

**Compatibilità OpenAI:** OpenRouter usa `Authorization: Bearer sk-or-v1-...` — identico all'API OpenAI. La proprietà `authType: "bearer"` nel catalog è sufficiente.

---

## 10. Route di risoluzione del modello (resolveContext)

Quando arriva `POST /projects/:id/llm/chat-preview`, la funzione `resolveContext` risolve il modello da usare con questa precedenza:

```
1. Se body.model è esplicito E il provider è openai-compatible
   → usa il modello direttamente (bypass del catalog DB)

2. Se body.model è nel catalog ED è attivo
   → usa from catalog

3. Se body.capability filtra un modello isDefault
   → usa quello

4. Se body.pipelineRole filtra un modello isDefault
   → usa quello

5. Fallback al pipelineRole con isFallback=true
6. Fallback al primo dialogue isDefault
7. Fallback al primo modello isActive
```

Il bypass del catalog per `openai-compatible` (punto 1) è fondamentale per OpenRouter: il catalog seed contiene pochi modelli rappresentativi, ma l'utente può scegliere **qualsiasi** modello dalla lista live dell'endpoint `/models` — il backend lo accetta direttamente senza richiedere un update del catalog.

---

## 11. Endpoint `/llm/providers` — risposta al frontend

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
                    priceTier: "low"        // ← derivato da pricing.prompt
                },
                {
                    id: "google/gemma-3-12b-it:free",
                    priceTier: "free",
                    isDefault: false,
                    isFallback: true,
                    // ...
                },
                // ... (lista live completa da /models se key presente)
            ]
        },
        // siliconflow, lmstudio...
    ]
}
```

---

## 12. Frontend: tipi TypeScript e model selector

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

**Model selector con price tier badge:**

```typescript
// Badge costo — prefix sul nome del modello nel <option>
function tierBadge(tier: ModelItem["priceTier"]): string {
    if (tier === "low")  return "€ ";
    if (tier === "mid")  return "€€ ";
    if (tier === "high") return "€€€ ";
    return "";  // "free" → nessun badge (viene separato in un gruppo dedicato)
}

// Raggruppamento paid/free con <optgroup> per famiglia
function groupedModelOptions(models: ModelItem[]): React.ReactNode {
    const paid = models.filter(m => m.priceTier !== "free");
    const free = models.filter(m => m.priceTier === "free");
    // paid → gruppi per famiglia, alfabetici
    // free → separati con divider "── 🆓 Free models ──"
}
```

**Utility di display:**

```typescript
// Estrae la famiglia dal model ID (namespace prima dello slash)
function modelFamily(id: string): string {
    if (id.includes("/")) return id.slice(0, id.indexOf("/"));
    const m = id.match(/^([a-zA-Z]+)/);
    return m ? m[1] : "other";
}

// Nome corto: strip del namespace
function modelShortName(id: string): string {
    const slash = id.indexOf("/");
    return slash >= 0 ? id.slice(slash + 1) : id;
}
```

---

## 13. Frontend: visualizzazione del costo nella UI

La risposta di `POST /llm/chat-preview` include `costEstimate`. Il frontend lo associa al messaggio e può mostrarlo nella conversazione:

```typescript
// In workspace/[projectId]/page.tsx
const llm = await llmChatPreview(token, projectId!, payload);

// Salvataggio costo sul messaggio (per il tracking totale della conversazione)
await logBackgroundTask(token, projectId!, convId, assistantMsg.id, {
    type: "llm-call",
    costEstimate: llm.costEstimate,
    tokenUsage: llm.usage,
});

// Aggiornamento totale costo conversazione
setActiveConv(prev => prev ? {
    ...prev,
    totalCost: (prev.totalCost ?? 0) + (llm.costEstimate?.amount ?? 0),
} : prev);
```

**Formattazione per la UI:**

```typescript
// Mostrare il costo con indicatore di fonte
const cost = message.metadata?.costEstimate;
if (cost) {
    const label = cost.source === "provider" ? "reale" : "stimato";
    const display = `€${cost.amount.toFixed(4)} (${label})`;
    // Opzionale: mostrare providerCostUsd in tooltip
}
```

---

## 14. Seed script e sorgente mongo vs env

Il sistema supporta due modalità di catalog:

**`LLM_CATALOG_SOURCE=env`** (default dev): il catalog è ricostruito dai builder statici ad ogni avvio. Nessun DB necessario per i valori base.

**`LLM_CATALOG_SOURCE=mongo`**: il catalog è letto da MongoDB (`llm_providers` collection). Necessita di eseguire il seed.

```bash
# Esegui il seed (popola MongoDB con il catalog statico)
npx ts-node apps/api/src/scripts/seed-llm.ts
# oppure via npm script (se definito)
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

**Collection MongoDB (`llm_providers`):**

```typescript
// Index: { provider: 1 } unique
// Index: { isActive: 1 }
await collection.updateOne(
    { provider: catalog.provider },
    { $set: { ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
);
```

L'upsert idempotente garantisce che il seed possa essere rieseguito senza duplicati.

---

## 15. Pattern di fallback e deduplicazione

**Deduplicazione per ID:**

Quando lo stesso model ID appare sia come `isDefault` che come `isFallback` (es. in cataloghi uniti), il sistema deduplicato preferisce la voce `isDefault`:

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

**Fallback chain nella selezione del modello:**

```
1. modello esplicito da body.model (bypass catalog per openai-compatible)
2. modello in catalog per body.model
3. modello isDefault per body.capability
4. modello isDefault per body.pipelineRole
5. modello isFallback per body.pipelineRole
6. modello isDefault per role "dialogue"
7. primo modello isActive
```

**Fallback su errori di discovery:**

Se `/models` è irraggiungibile o restituisce errore, il sistema usa il catalog statico di default:

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

## 16. Checklist per portare questa integrazione in un nuovo progetto

### Backend

- [ ] **Env schema**: aggiungere `OPENROUTER_BASE_URL`, `OPEN_ROUTER_API_KEY` (opzionale), `COST_POLICY_USD_TO_EUR_RATE`, `COST_POLICY_PROVIDER_MARKUP_FACTOR` con validazione Zod.
- [ ] **Domain entity**: definire `LlmModel` con campo `priceTier?: "free" | "low" | "mid" | "high"`.
- [ ] **Catalog builder** (`defaultOpenRouterCatalog.ts`): logica paid-first con modelli free come fallback quando non c'è API key.
- [ ] **costPolicy.ts**: implementare `estimateCost` con priorità `providerCostUsd` su flat-rate; includere campo `source`.
- [ ] **discoverOpenAiCompatibleModels**: filtro per `architecture.modality.endsWith("->text")`, derivazione `priceTier` da `pricing.prompt`.
- [ ] **resolveAuthHeader**: centralizzare la gestione chiavi, injettare `Bearer <key>` per `authType: "bearer"`.
- [ ] **resolveContext**: bypass del catalog per `openai-compatible` + modello esplicito; fallback chain completa.
- [ ] **GET /llm/providers**: esporre i modelli arricchiti da discovery live, con `priceTier`, `byokEnabled`, `activeProvider`.
- [ ] **POST /llm/chat-preview**: estrarre `usage.cost` dalla risposta OpenRouter e passarlo a `estimateCost` come `providerCostUsd`.
- [ ] **Seed script**: `SeedLlmCatalog` use-case con `upsertProvider` idempotente.
- [ ] **`LLM_CATALOG_SOURCE`**: supportare `"env"` (dev) e `"mongo"` (produzione scalabile).

### Frontend

- [ ] **Tipi**: `ModelItem.priceTier`, `LlmChatPreviewResult.costEstimate.source`, `costEstimate.providerCostUsd`.
- [ ] **getLlmProviders()**: `GET /v1/llm/providers` autenticato.
- [ ] **tierBadge()**: prefisso `€` / `€€` / `€€€` per i modelli paid.
- [ ] **groupedModelOptions()**: paid per famiglia (alphabetical) + sezione free separata con divider.
- [ ] **modelFamily() / modelShortName()**: derivazione display name dal format `namespace/model-id`.
- [ ] **Tracking costo**: salvare `costEstimate` sul messaggio assistente, accumulare `totalCost` sulla conversazione.
- [ ] **Indicatore fonte**: mostrare "reale" vs "stimato" in base a `costEstimate.source`.
- [ ] **Selezione provider/model**: `body.provider` e `body.model` opzionali nella richiesta chat-preview; fallback al default del backend.

### Sicurezza

- [ ] Le API key **non devono mai** essere esposte al frontend.
- [ ] L'endpoint `/llm/providers` deve richiedere autenticazione (JWT).
- [ ] L'endpoint `/llm/chat-preview` deve verificare il sandbox (user + project ownership).
- [ ] Il costo stimato non deve essere usato per billing critico senza validazione server-side aggiuntiva.

---

## Note sull'aggiornamento dei modelli free

I modelli gratuiti di OpenRouter (suffisso `:free`) cambiano periodicamente. La strategia adottata:

1. **Catalog statico** in `defaultOpenRouterCatalog.ts` = bootstrap garantito, sempre funzionante.
2. **Discovery live** da `/models` all'avvio = sostituisce il catalog con la lista aggiornata quando la key è presente.
3. **Bypass catalog** per richieste con `model` esplicito: l'utente può scegliere qualsiasi modello dalla lista live senza dover aggiornare il codice.

Questo significa che i modelli nel catalog statico possono diventare stale senza causare downtime: il fallback chain garantisce che ci sia sempre un modello valido.
