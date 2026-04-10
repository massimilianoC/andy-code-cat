# Multi-Provider Multi-Model Platform Playbook (Simple)

## 1) Obiettivo

Creare una piattaforma LLM semplice ma estendibile, con:

- piu provider (es. LM Studio, Ollama, SiliconFlow, OpenAI, Anthropic)
- piu modelli per provider
- UI con 2 combo box annidate: Provider -> Model
- routing runtime della chiamata LLM in base alla selezione utente
- governance costi con token + crediti astratti

## 2) Architettura minima consigliata

Servizi minimi:

- API Gateway LLM (core)
- Database configurazione/catalogo (Mongo o SQL)
- Frontend/BFF (opzionale ma consigliato)

Moduli core nel gateway:

- providers_registry: configurazione provider endpoint/auth/status
- provider_models_catalog: catalogo modelli abilitati
- provider_adapter_factory: adapter per protocollo provider
- gateway_router: risolve provider/model e instrada la request
- usage_metering: conta token e calcola crediti
- policies: controlli accesso provider/model per tenant/ruolo

## 3) Modello dati minimo

### providers_registry

Campi minimi:

- providerKey (es. siliconflow)
- displayName
- baseUrl
- apiType (openai-compatible, anthropic-compatible, custom)
- authType (api-key, bearer, none)
- enabled
- timeoutMs
- retryPolicy

### provider_models_catalog

Campi minimi:

- providerKey
- modelKey (id reale provider)
- displayName
- capability (chat, embedding, image, rerank)
- contextWindow
- maxOutputTokens
- enabled
- pricingProfileKey (chiave logica per rating costi)

### credit_rates

Campi minimi:

- providerKey
- modelKey
- capability
- inputCreditsPer1k
- outputCreditsPer1k
- cacheReadCreditsPer1k (opzionale)
- cacheWriteCreditsPer1k (opzionale)
- active

### usage_events

Campi minimi:

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

## 4) Flusso UI con due combo box annidate

Regola UX:

- combo 1 mostra solo provider enabled e accessibili all utente
- combo 2 mostra solo modelli enabled del provider selezionato

Flusso:

1. GET /v1/providers
2. utente seleziona provider
3. GET /v1/providers/:providerKey/models
4. utente seleziona model
5. POST /v1/chat/completions con provider+model scelti

Payload richiesta chat (esempio):

```json
{
  "provider": "siliconflow",
  "model": "Qwen/Qwen3-32B",
  "messages": [
    { "role": "user", "content": "Ciao" }
  ],
  "temperature": 0.7,
  "max_tokens": 512
}
```

## 5) Routing runtime nel gateway

Algoritmo semplice:

1. valida provider esistente e enabled
2. valida model del provider e enabled
3. risolve adapter da factory (openai-compatible, anthropic-compatible, ...)
4. applica token policy (max input/output)
5. inoltra richiesta al provider corretto
6. normalizza risposta in schema unificato
7. salva usage_event e addebita crediti

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

## 6) Discovery modelli (bootstrap + on-demand)

Pattern consigliato:

- startup sync: alla partenza, ogni provider prova listModels()
- on-demand sync: endpoint admin POST /admin/providers/:providerKey/sync
- fallback: se provider non risponde, usa catalogo DB esistente

Best practice:

- sync idempotente (upsert)
- non cancellare subito modelli mancanti: marca deprecated prima di disabilitare
- tieni discoveredAt e source (seed|auto_discovery|manual)

## 7) Strategia token e crediti astratti

Obiettivo: nascondere differenze di prezzo reali tra provider dietro una metrica unica interna (crediti).

Formula base consigliata:

- inputUnits = tokensIn / 1000
- outputUnits = tokensOut / 1000
- credits = inputUnits *inputRate + outputUnits* outputRate

Dove rates arrivano da credit_rates per provider/model/capability.

Estensioni utili:

- moltiplicatore complessita modello (small=0.8, medium=1.0, large=1.4, reasoning=1.8)
- surcharge latenza bassa (fast lane)
- sconti per modelli locali/self-hosted

Esempio pratico:

- tokensIn = 1200
- tokensOut = 800
- inputRate = 1.0 crediti/1k
- outputRate = 2.0 crediti/1k

Calcolo:

- input = 1.2 * 1.0 = 1.2
- output = 0.8 * 2.0 = 1.6
- totale = 2.8 crediti

## 8) Policy semplici di pesatura modelli

Classificazione iniziale (semplificata):

- econo: modelli piccoli/veloci, costo basso
- standard: bilanciati
- premium: modelli grandi o reasoning avanzato

Mappatura suggerita:

- econo: input 0.6, output 1.0
- standard: input 1.0, output 2.0
- premium: input 1.8, output 3.2

Regola pratica:

- parti semplice con 3 tier
- poi rifinisci rates usando usage_events reali (spesa, latenza, soddisfazione)

## 9) Endpoint minimi API

Pubblici:

- GET /v1/providers
- GET /v1/providers/:providerKey/models
- POST /v1/chat/completions

Admin:

- POST /v1/admin/providers/:providerKey/sync
- POST /v1/admin/credit-rates
- PATCH /v1/admin/providers/:providerKey/models/:modelKey/enabled

## 10) Error handling standard

Schema uniforme:

- code
- message
- provider
- model
- correlationId

Mappa errori provider -> gateway:

- timeout provider -> PROVIDER_TIMEOUT
- auth provider -> PROVIDER_AUTH_FAILED
- model non trovato -> MODEL_NOT_AVAILABLE
- crediti insufficienti -> INSUFFICIENT_CREDITS

## 11) Rollout progressivo consigliato

Step 1:

- 1 provider + catalogo statico seed
- doppia combo UI
- routing base

Step 2:

- 2 provider
- sync modelli startup + endpoint sync manuale
- usage_events

Step 3:

- crediti astratti + wallet organization
- policy accesso provider/model per tenant

Step 4:

- fallback provider automatico
- tuning rates data-driven

## 12) Checklist implementazione rapida

- [ ] tabella/collection providers_registry
- [ ] tabella/collection provider_models_catalog
- [ ] endpoint providers e models
- [ ] adapter factory per provider protocol
- [ ] router chat provider/model-aware
- [ ] doppia combo in UI con fetch dinamico
- [ ] usage metering (tokens e latency)
- [ ] credit engine con rates per provider/model
- [ ] endpoint sync modelli on-demand
- [ ] logging con correlationId

## 13) Decisioni che evitano regressioni comuni

- non usare limiti bassi hardcoded sui modelli (es. 10)
- usare 0 come no-limit esplicito
- pre-warm cache modelli al boot del BFF
- prevedere fallback su catalogo DB se provider down
- mantenere sync script manuale per operazioni e incidenti

## 14) Template env minimo

```env
PROVIDERS_AUTO_MODEL_DISCOVERY_ENABLED=true
PROVIDERS_AUTO_MODEL_DISCOVERY_ON_STARTUP=true
GATEWAY_MODELS_LIMIT_PER_PROVIDER=0

TOKEN_POLICY_DEFAULT_COMPLETION_TOKENS=512
TOKEN_POLICY_MAX_COMPLETION_TOKENS=4096

CREDITS_ENFORCEMENT_ENABLED=true
```

## 15) Regola chiave per la UX

La combo Model deve dipendere sempre dal Provider selezionato e la request API deve includere entrambi i campi (provider + model). Questo elimina ambiguita quando lo stesso modelKey compare su provider diversi.

## 16) Snapshot reale da MongoDB (llm_gateway)

Dati estratti dal Mongo locale (collection chiave):

- providers_registry: 4 documenti
- provider_models_catalog: 84 documenti
- org_provider_access: 2 documenti
- credit_rates: 6 documenti

Provider realmente presenti:

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

Esempi reali modelli LM Studio:

```json
[
  "google/gemma-3n-e4b",
  "qwen/qwen3.5-9b",
  "mistralai/ministral-3-3b",
  "nvidia/nemotron-3-nano-4b",
  "local/default-chat"
]
```

Esempi reali modelli SiliconFlow:

```json
[
  "deepseek-ai/deepseek-r1",
  "bytedance-seed/seed-oss-36b-instruct",
  "black-forest-labs/flux.2-pro",
  "black-forest-labs/flux.1-schnell",
  "baidu/ernie-4.5-300b-a47b"
]
```

Access policy reale per organization (estratto):

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

## 17) Query Mongo read-only per agenti (copia/incolla)

Conteggio configurazioni salienti:

```javascript
const cols = ['providers_registry', 'provider_models_catalog', 'org_provider_access', 'credit_rates'];
for (const c of cols) {
  print(c + ': ' + db.getCollection(c).countDocuments());
}
```

Lista provider attivi:

```javascript
db.providers_registry.find(
  { enabled: true },
  { _id: 0, providerKey: 1, displayName: 1, baseUrl: 1, apiType: 1, authType: 1 }
).sort({ providerKey: 1 });
```

Modelli per provider (per seconda combo box):

```javascript
db.provider_models_catalog.find(
  { providerKey: 'siliconflow', enabled: true },
  { _id: 0, modelKey: 1, displayName: 1, capability: 1 }
).sort({ modelKey: 1 });
```

Rate crediti attive:

```javascript
db.credit_rates.find(
  { active: true },
  { _id: 0, providerKey: 1, modelKey: 1, capability: 1, inputPer1kCredits: 1, outputPer1kCredits: 1, multiplier: 1 }
).sort({ providerKey: 1, modelKey: 1 });
```

Policy accesso org->provider:

```javascript
db.org_provider_access.find(
  { organizationId: '69ccf5e75a5a68f9a39082a7' },
  { _id: 0, providerKey: 1, enabled: 1, note: 1 }
).sort({ providerKey: 1 });
```

## 18) Bootstrap veloce multiprovider (LM Studio + SiliconFlow)

### Env minimo

```env
LMSTUDIO_BASE_URL=http://host.docker.internal:1234/v1
SILICONFLOW_BASE_URL=https://api.siliconflow.com/v1
SILICONFLOW_API_KEY=sk-your-real-key

PROVIDERS_AUTO_MODEL_DISCOVERY_ENABLED=true
PROVIDERS_AUTO_MODEL_DISCOVERY_ON_STARTUP=true
GATEWAY_MODELS_LIMIT_PER_PROVIDER=0
```

### Seed provider consigliato

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

### Sync modelli on-demand

```bash
npm run devops:providers:init:siliconflow
npm run devops:providers:init -- siliconflow lmstudio
```

## 19) Snippet codice per agenti di sviluppo

### API per combo 1 (provider)

```ts
// GET /v1/providers
return providersRegistryRepository.listEnabledByOrganization(organizationId)
```

### API per combo 2 (model annidata al provider)

```ts
// GET /v1/providers/:providerKey/models
return providerModelsRepository.listEnabledByProvider({
  providerKey,
  capability: 'chat',
})
```

### Router chat provider/model-aware

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

### Calcolo crediti astratti da token usage

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

## 20) Checklist operativa per avvio in 15 minuti

1. Configura env di LM Studio e SiliconFlow.
2. Verifica provider seed in providers_registry.
3. Esegui sync modelli (startup o script on-demand).
4. Esponi endpoint provider e models per doppia combo UI.
5. Instrada POST chat con provider+model obbligatori.
6. Salva usage_events e addebita crediti da credit_rates.
7. Metti limit per provider a 0 (no hard cap modelli).
