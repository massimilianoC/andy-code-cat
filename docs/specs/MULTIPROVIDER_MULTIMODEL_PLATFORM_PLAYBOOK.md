# Multi-Provider Multi-Model Platform Playbook (Simple)

> **Status: historical generic playbook.** It is not the product routing contract. The active
> authority for user override precedence, fail-closed model locks, notifications and execution
> proof is [SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md](SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md).

## 1) Goal

Build a simple but extensible LLM platform, with:

- multiple providers (e.g. LM Studio, Ollama, SiliconFlow, OpenAI, Anthropic)
- multiple models per provider
- UI with 2 nested combo boxes: Provider -> Model
- runtime routing of the LLM call based on the user's selection
- cost governance with tokens + abstract credits

## 2) Recommended Minimal Architecture

Minimal services:

- LLM API Gateway (core)
- Configuration/catalog database (Mongo or SQL)
- Frontend/BFF (optional but recommended)

Core modules in the gateway:

- providers_registry: provider endpoint/auth/status configuration
- provider_models_catalog: catalog of enabled models
- provider_adapter_factory: adapter per provider protocol
- gateway_router: resolves provider/model and routes the request
- usage_metering: counts tokens and computes credits
- policies: provider/model access controls per tenant/role

## 3) Minimal Data Model

### providers_registry

Minimal fields:

- providerKey (e.g. siliconflow)
- displayName
- baseUrl
- apiType (openai-compatible, anthropic-compatible, custom)
- authType (api-key, bearer, none)
- enabled
- timeoutMs
- retryPolicy

### provider_models_catalog

Minimal fields:

- providerKey
- modelKey (real provider id)
- displayName
- capability (chat, embedding, image, rerank)
- contextWindow
- maxOutputTokens
- enabled
- pricingProfileKey (logical key for cost rating)

### credit_rates

Minimal fields:

- providerKey
- modelKey
- capability
- inputCreditsPer1k
- outputCreditsPer1k
- cacheReadCreditsPer1k (optional)
- cacheWriteCreditsPer1k (optional)
- active

### usage_events

Minimal fields:

- organizationId
- userId
- providerKey
- modelKey
- capability
- tokensIn
- tokensOut
- creditsCharged
- latencyMs
- status (ok|error|timeout)
- createdAt

## 4) UI Flow With Two Nested Combo Boxes

UX rule:

- combo 1 shows only providers that are enabled and accessible to the user
- combo 2 shows only enabled models of the selected provider

Flow:

1. GET /v1/providers
2. user selects a provider
3. GET /v1/providers/:providerKey/models
4. user selects a model
5. POST /v1/chat/completions with the chosen provider+model

Chat request payload (example):

```json
{
  "provider": "siliconflow",
  "model": "Qwen/Qwen3-32B",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "temperature": 0.7,
  "max_tokens": 512
}
```

## 5) Runtime Routing in the Gateway

Simple algorithm:

1. validate that the provider exists and is enabled
2. validate that the model belongs to the provider and is enabled
3. resolve the adapter from the factory (openai-compatible, anthropic-compatible, ...)
4. apply the token policy (max input/output)
5. forward the request to the correct provider
6. normalize the response into a unified schema
7. save the usage_event and charge credits

Pseudo-code:

```ts
const provider = providersRepo.getEnabled(providerKey)
const model = modelsRepo.getEnabled(providerKey, modelKey)
const adapter = adapterFactory.create(provider.apiType)

const bounded = tokenPolicy.apply(model, request)
const response = await adapter.chat(provider, model, bounded)

const usage = usageExtractor.from(response)
const credits = creditEngine.compute(providerKey, modelKey, usage)

await walletService.charge(orgId, credits)
await usageRepo.insert({ ...usage, credits })

return responseNormalizer.toUnified(response)
```

## 6) Model Discovery (Bootstrap + On-demand)

Recommended pattern:

- startup sync: on boot, each provider attempts listModels()
- on-demand sync: admin endpoint POST /admin/providers/:providerKey/sync
- fallback: if the provider doesn't respond, use the existing DB catalog

Best practice:

- idempotent sync (upsert)
- don't immediately delete missing models: mark them deprecated before disabling
- keep discoveredAt and source (seed|auto_discovery|manual)

## 7) Abstract Token and Credit Strategy

Goal: hide real price differences between providers behind a single internal metric (credits).

Recommended base formula:

- inputUnits = tokensIn / 1000
- outputUnits = tokensOut / 1000
- credits = inputUnits * inputRate + outputUnits * outputRate

Where rates come from credit_rates per provider/model/capability.

Useful extensions:

- model complexity multiplier (small=0.8, medium=1.0, large=1.4, reasoning=1.8)
- low-latency surcharge (fast lane)
- discounts for local/self-hosted models

Practical example:

- tokensIn = 1200
- tokensOut = 800
- inputRate = 1.0 credits/1k
- outputRate = 2.0 credits/1k

Calculation:

- input = 1.2 * 1.0 = 1.2
- output = 0.8 * 2.0 = 1.6
- total = 2.8 credits

## 8) Simple Model Weighting Policy

Initial classification (simplified):

- econo: small/fast models, low cost
- standard: balanced
- premium: large models or advanced reasoning

Suggested mapping:

- econo: input 0.6, output 1.0
- standard: input 1.0, output 2.0
- premium: input 1.8, output 3.2

Practical rule:

- start simple with 3 tiers
- then refine rates using real usage_events (spend, latency, satisfaction)

## 9) Minimal API Endpoints

Public:

- GET /v1/providers
- GET /v1/providers/:providerKey/models
- POST /v1/chat/completions

Admin:

- POST /v1/admin/providers/:providerKey/sync
- POST /v1/admin/credit-rates
- PATCH /v1/admin/providers/:providerKey/models/:modelKey/enabled

## 10) Standard Error Handling

Uniform schema:

- code
- message
- provider
- model
- correlationId

Provider -> gateway error mapping:

- provider timeout -> PROVIDER_TIMEOUT
- provider auth -> PROVIDER_AUTH_FAILED
- model not found -> MODEL_NOT_AVAILABLE
- insufficient credits -> INSUFFICIENT_CREDITS

## 11) Recommended Progressive Rollout

Step 1:

- 1 provider + static seed catalog
- double combo UI
- basic routing

Step 2:

- 2 providers
- startup model sync + manual sync endpoint
- usage_events

Step 3:

- abstract credits + organization wallet
- provider/model access policy per tenant

Step 4:

- automatic provider fallback
- data-driven rate tuning

## 12) Quick Implementation Checklist

- [ ] providers_registry table/collection
- [ ] provider_models_catalog table/collection
- [ ] providers and models endpoints
- [ ] adapter factory for provider protocol
- [ ] provider/model-aware chat router
- [ ] double combo in the UI with dynamic fetch
- [ ] usage metering (tokens and latency)
- [ ] credit engine with rates per provider/model
- [ ] on-demand model sync endpoint
- [ ] logging with correlationId

## 13) Decisions That Avoid Common Regressions

- don't use low hardcoded limits on models (e.g. 10)
- use 0 as an explicit no-limit
- pre-warm the model cache at BFF boot
- plan a fallback to the DB catalog if the provider is down
- keep a manual sync script for operations and incidents

## 14) Minimal Env Template

```env
PROVIDERS_AUTO_MODEL_DISCOVERY_ENABLED=true
PROVIDERS_AUTO_MODEL_DISCOVERY_ON_STARTUP=true
GATEWAY_MODELS_LIMIT_PER_PROVIDER=0

TOKEN_POLICY_DEFAULT_COMPLETION_TOKENS=512
TOKEN_POLICY_MAX_COMPLETION_TOKENS=4096

CREDITS_ENFORCEMENT_ENABLED=true
```

## 15) Key UX Rule

The Model combo must always depend on the selected Provider, and the API request must include both fields (provider + model). This removes ambiguity when the same modelKey appears on different providers.

## 16) Real Snapshot From MongoDB (llm_gateway)

Data extracted from the local Mongo (key collections):

- providers_registry: 4 documents
- provider_models_catalog: 84 documents
- org_provider_access: 2 documents
- credit_rates: 6 documents

Providers actually present:

```json
[
  {
    "providerKey": "lmstudio",
    "displayName": "LM Studio Local",
    "baseUrl": "${LMSTUDIO_BASE_URL}",
    "enabled": true
  },
  {
    "providerKey": "siliconflow",
    "displayName": "Silicon Flow",
    "baseUrl": "${SILICONFLOW_BASE_URL}",
    "enabled": true
  },
  {
    "providerKey": "comfyui",
    "displayName": "ComfyUI",
    "baseUrl": "${COMFYUI_BASE_URL}",
    "enabled": true
  },
  {
    "providerKey": "rag-service",
    "displayName": "RAG Service",
    "baseUrl": "${RAG_SERVICE_BASE_URL}",
    "enabled": true
  }
]
```

Real LM Studio model examples:

```json
[
  "google/gemma-3n-e4b",
  "qwen/qwen3.5-9b",
  "mistralai/ministral-3-3b",
  "nvidia/nemotron-3-nano-4b",
  "local/default-chat"
]
```

Real SiliconFlow model examples:

```json
[
  "deepseek-ai/deepseek-r1",
  "bytedance-seed/seed-oss-36b-instruct",
  "black-forest-labs/flux.2-pro",
  "black-forest-labs/flux.1-schnell",
  "baidu/ernie-4.5-300b-a47b"
]
```

Real per-organization access policy (excerpt):

```json
[
  {
    "organizationId": "69ccf5e75a5a68f9a39082a7",
    "providerKey": "lmstudio",
    "enabled": true
  },
  {
    "organizationId": "69ccf5e75a5a68f9a39082a7",
    "providerKey": "siliconflow",
    "enabled": true
  }
]
```

## 17) Read-only Mongo Queries for Agents (copy/paste)

Count of key configurations:

```javascript
const cols = ['providers_registry', 'provider_models_catalog', 'org_provider_access', 'credit_rates'];
for (const c of cols) {
  print(c + ': ' + db.getCollection(c).countDocuments());
}
```

List of active providers:

```javascript
db.providers_registry.find(
  { enabled: true },
  { _id: 0, providerKey: 1, displayName: 1, baseUrl: 1, apiType: 1, authType: 1 }
).sort({ providerKey: 1 });
```

Models per provider (for the second combo box):

```javascript
db.provider_models_catalog.find(
  { providerKey: 'siliconflow', enabled: true },
  { _id: 0, modelKey: 1, displayName: 1, capability: 1 }
).sort({ modelKey: 1 });
```

Active credit rates:

```javascript
db.credit_rates.find(
  { active: true },
  { _id: 0, providerKey: 1, modelKey: 1, capability: 1, inputPer1kCredits: 1, outputPer1kCredits: 1, multiplier: 1 }
).sort({ providerKey: 1, modelKey: 1 });
```

Org->provider access policy:

```javascript
db.org_provider_access.find(
  { organizationId: '69ccf5e75a5a68f9a39082a7' },
  { _id: 0, providerKey: 1, enabled: 1, note: 1 }
).sort({ providerKey: 1 });
```

## 18) Quick Multi-provider Bootstrap (LM Studio + SiliconFlow)

### Minimal Env

```env
LMSTUDIO_BASE_URL=http://host.docker.internal:1234/v1
SILICONFLOW_BASE_URL=https://api.siliconflow.com/v1
SILICONFLOW_API_KEY=sk-your-real-key

PROVIDERS_AUTO_MODEL_DISCOVERY_ENABLED=true
PROVIDERS_AUTO_MODEL_DISCOVERY_ON_STARTUP=true
GATEWAY_MODELS_LIMIT_PER_PROVIDER=0
```

### Recommended Provider Seed

```json
{
  "providers": [
    {
      "providerKey": "lmstudio",
      "displayName": "LM Studio Local",
      "baseUrl": "${LMSTUDIO_BASE_URL}",
      "apiType": "openai-compatible",
      "authType": "none",
      "enabled": true
    },
    {
      "providerKey": "siliconflow",
      "displayName": "Silicon Flow",
      "baseUrl": "${SILICONFLOW_BASE_URL}",
      "apiType": "openai-compatible",
      "authType": "api-key",
      "enabled": true
    }
  ]
}
```

### On-demand Model Sync

```bash
npm run devops:providers:init:siliconflow
npm run devops:providers:init -- siliconflow lmstudio
```

## 19) Code Snippets for Development Agents

### API for combo 1 (provider)

```ts
// GET /v1/providers
return providersRegistryRepository.listEnabledByOrganization(organizationId)
```

### API for combo 2 (model nested under the provider)

```ts
// GET /v1/providers/:providerKey/models
return providerModelsRepository.listEnabledByProvider({
  providerKey,
  capability: 'chat',
})
```

### Provider/model-aware Chat Router

```ts
const provider = await providersRegistryRepository.findEnabledByKey(input.provider)
if (!provider) throw new Error('PROVIDER_NOT_AVAILABLE')

const model = await providerModelsRepository.findEnabledModel(input.provider, input.model)
if (!model) throw new Error('MODEL_NOT_AVAILABLE')

const adapter = providerAdapterFactory.create(provider.apiType)
const response = await adapter.chat({
  provider,
  model,
  payload: input,
})
```

### Computing Abstract Credits From Token Usage

```ts
const usage = {
  tokensIn: response.usage?.prompt_tokens ?? 0,
  tokensOut: response.usage?.completion_tokens ?? 0,
}

const rate = await creditRatesRepository.resolveActiveRate({
  providerKey: input.provider,
  modelKey: input.model,
  capability: 'chat',
})

const inputCredits = (usage.tokensIn / 1000) * (rate.inputPer1kCredits ?? 1)
const outputCredits = (usage.tokensOut / 1000) * (rate.outputPer1kCredits ?? 1)
const multiplier = rate.multiplier ?? 1
const totalCredits = (inputCredits + outputCredits) * multiplier

await walletService.chargeCredits({ organizationId: input.organizationId, amount: totalCredits })
```

## 20) 15-minute Operational Startup Checklist

1. Configure the LM Studio and SiliconFlow env.
2. Verify the provider seed in providers_registry.
3. Run model sync (startup or on-demand script).
4. Expose the provider and models endpoints for the double combo UI.
5. Route POST chat with provider+model mandatory.
6. Save usage_events and charge credits from credit_rates.
7. Set the per-provider limit to 0 (no hard model cap).
