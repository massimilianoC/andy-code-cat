# Andy Code Cat — RAG Chatbot per Landing Page: Specifiche

> **Stato:** spec approvata — da schedulare dopo stabilizzazione BaaS Layer (BS0-BS1)
> **Dipendenze architetturali:** Asset Manager (✅), double sandbox middleware (✅), BaaS Public Router (⬜), Redis rate-limiting (✅)
> **Principio guida:** il RAG è un servizio esterno interrogato via API. Andy Code Cat non ospita embeddings.
> Fa da orchestratore (ingestione documenti → RAG API) e da proxy sicuro (widget → BaaS → RAG API).

---

## 1. Problema e soluzione

### 1.1 Scenario

L'utente costruisce una landing page (es. landing per un servizio di consulenza, un prodotto
SaaS, uno studio professionale). Vuole che i visitatori possano fare domande sul contenuto
senza leggere l'intera pagina — una UX chatbot "conosci questo prodotto/servizio".

Il proprietario del sito ha già documenti (PDF, DOCX, TXT, MD) che descrivono i servizi,
le FAQ, i prezzi, i case study. Questi documenti finiscono automaticamente nel contesto RAG
e il chatbot risponde a domande dei visitatori in linguaggio naturale.

### 1.2 Approccio

| Livello | Soluzione |
|---|---|
| Storage documenti | Asset Manager Andy Code Cat già esistente |
| Ingestione RAG | API call verso servizio RAG esterno (BYOK o Managed) |
| Query visitatori | Widget vanilla JS nella landing → POST BaaS Andy Code Cat → proxy RAG API |
| Sicurezza chiave RAG | MAI esposta nel HTML — sempre proxiata dal backend Andy Code Cat |
| Generazione widget | LLM inietta snippet HTML/JS nella landing al momento della generazione |

### 1.3 Servizi RAG supportati (fase 1)

Il design è **provider-agnostic** tramite adapter. Primo target:

| Provider | Tipo | Modalità |
|---|---|---|
| [Flowise](https://flowiseai.com) | Self-hosted / Cloud | BYOK |
| [n8n AI Agent Workflow](https://n8n.io) | Self-hosted / Cloud | BYOK |
| Qualsiasi API REST `POST /query { question, context? }` | Generico | BYOK |

Tutti i provider vengono normalizzati attraverso un `RagProviderAdapter` che espone
la stessa interfaccia interna indipendentemente dal provider scelto dall'owner.

---

## 2. Architettura end-to-end

```
┌─────────────────────────────────────────────────────────────────┐
│  DASHBOARD OWNER (apps/web)                                     │
│                                                                 │
│  Tab "Chatbot RAG" nel progetto                                 │
│  1. Abilita servizio RAG → sceglie provider → inserisce API key │
│  2. Lista asset del progetto → seleziona documenti da indicizzare│
│  3. Clicca "Indicizza documenti" → POST /rag/ingest             │
│  4. Vede stato indicizzazione (pending / ok / error per file)   │
│  5. Toggle "Mostra chatbot nella landing" → auto-proposta LLM   │
└───────────────────────┬─────────────────────────────────────────┘
                        │  (owner autenticato, JWT + double sandbox)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Andy Code Cat API — RAG Management Routes (autenticato)            │
│                                                                 │
│  POST /v1/projects/:id/rag/config     → salva RagConfig        │
│  GET  /v1/projects/:id/rag/config     → legge RagConfig        │
│  POST /v1/projects/:id/rag/ingest     → ingest documenti       │
│  GET  /v1/projects/:id/rag/ingest/status → stato indicizzazione│
│  DELETE /v1/projects/:id/rag/ingest/:docId → rimuovi doc dal RAG│
└───────────────────────┬─────────────────────────────────────────┘
                        │  chiama RagProviderAdapter
                        ▼
             ┌──────────────────────┐
             │  External RAG API    │
             │  (Flowise / n8n /    │
             │   custom endpoint)   │
             └──────────────────────┘

─────────────────────────────────────────────────────────────────
  RUNTIME VISITATORI (pagina pubblicata)
─────────────────────────────────────────────────────────────────

  Landing Page statica (HTML/CSS/JS generata da LLM)
    │
    │  <script> Widget Chatbot (vanilla JS, ~4KB gzip)
    │  — bubble FAB bottom-right
    │  — panel messaggi scrollabile
    │  — input testo + invio
    │
    │  POST https://api.Andy Code Cat.io/v1/public/svc/{projectKey}/rag/query
    │       { question: "...", sessionId: "..." }
    │       Origin: https://abc123.Andy Code Cat.io ← verificato CORS
    │
    ▼
  Andy Code Cat BaaS Public Router
    │  · verifica projectKey → risolve project + owner
    │  · verifica CORS (origin ∈ project.allowedOrigins)
    │  · verifica rag abilitato su progetto
    │  · rate limiting Redis: 30 query/ora per sessionId
    │  · recupera RagConfig.endpoint + RagConfig.apiKeyRef (da secret vault)
    │  · chiama RagProviderAdapter.query(question, sessionId)
    │
    ▼
  External RAG API → risposta testuale
    │
    ▼
  BaaS risponde al widget: { answer: "...", sources?: [...] }
```

---

## 3. Entità dati

### 3.1 RagConfig (embedded in Project)

```typescript
interface RagConfig {
  enabled: boolean;

  // Provider RAG esterno
  provider: 'flowise' | 'n8n' | 'generic';

  // Endpoint base dell'API RAG esterna
  endpoint: string;            // es: "https://myFlowise.example.com/api/v1/prediction/abc"

  // Chiave API — MAI in chiaro. Solo il riferimento alla secret vault.
  apiKeyRef: string;           // reference all'entry in RagSecrets collection

  // Documenti del progetto indicizzati nel RAG
  indexedDocs: RagDocEntry[];

  // Configurazione widget
  widget: RagWidgetConfig;

  // Metadati
  createdAt: Date;
  updatedAt: Date;
}

interface RagDocEntry {
  assetId: ObjectId;           // riferimento ad un asset del progetto
  filename: string;            // denormalizzato per UX
  mimeType: string;
  indexedAt: Date | null;      // null = pending / in progress
  status: 'pending' | 'indexing' | 'indexed' | 'error';
  errorMessage?: string;
  // Identificatore restituito dal RAG provider per questo documento
  ragDocumentId?: string;
}

interface RagWidgetConfig {
  visible: boolean;             // toggle "mostra chatbot nella landing"
  title: string;                // default: "Assistente virtuale"
  placeholder: string;          // default: "Chiedimi qualcosa..."
  primaryColor: string;         // default: ereditato da moodboard progetto o "#6366f1"
  position: 'bottom-right' | 'bottom-left';  // default: "bottom-right"
  welcomeMessage: string;       // messaggio iniziale del bot
  // Istruzioni di sistema passate al RAG provider (se supportato)
  systemPrompt?: string;
}
```

### 3.2 RagSecrets (collection: `rag_secrets`)

```typescript
interface RagSecret {
  _id: ObjectId;
  projectId: ObjectId;
  ownerId: ObjectId;
  // API key cifrata con AES-256-GCM, chiave derivata da env master key + projectId
  encryptedApiKey: string;     // base64 del ciphertext
  iv: string;                  // base64 dell'IV (generato per ogni scrittura)
  createdAt: Date;
  updatedAt: Date;
}
```

**Regola di sicurezza:** `RagSecret` non viene mai restituita nelle API response.
Il frontend vede solo `{ hasApiKey: true/false }`. La decifratura avviene solo dentro
il `RagProviderAdapter`, in memoria, per la durata della richiesta.

### 3.3 RagQueryLog (collection: `rag_query_logs`, TTL 30 giorni)

```typescript
interface RagQueryLog {
  _id: ObjectId;
  projectId: ObjectId;
  sessionId: string;           // UUID generato dal widget, non-autenticato
  questionHash: string;        // SHA-256 della domanda — PII-safe
  answeredAt: Date;
  latencyMs: number;
  providerStatus: number;      // HTTP status del RAG esterno
  // TTL index su answeredAt (30 giorni)
}
```

---

## 4. API Routes

### 4.1 Routes autenticate (owner)

```
POST   /v1/projects/:id/rag/config
       Body: { provider, endpoint, apiKey (plain, solo in input), widget? }
       → Salva RagConfig, cifra apiKey → RagSecret
       → 200 { ragConfig } (senza apiKey, con hasApiKey: true)

GET    /v1/projects/:id/rag/config
       → 200 { ragConfig } (senza apiKey, con hasApiKey: true/false)

PATCH  /v1/projects/:id/rag/widget
       Body: Partial<RagWidgetConfig>
       → 200 { widget }

POST   /v1/projects/:id/rag/ingest
       Body: { assetIds: string[] }
       → Avvia ingestione asincrona (job coda Redis / processo diretto)
       → 202 { jobId, docs: RagDocEntry[] }

GET    /v1/projects/:id/rag/ingest/status
       → 200 { docs: RagDocEntry[] }  (stato aggiornato)

DELETE /v1/projects/:id/rag/ingest/:assetId
       → Chiama RAG API per rimuovere il documento dal knowledge base
       → 204
```

### 4.2 BaaS Public Route (visitatori anonimi)

```
POST   /v1/public/svc/:projectKey/rag/query
       Headers: Origin (verificato CORS)
       Body: { question: string, sessionId: string }
       → Rate limit: 30 req/ora per sessionId (Redis sliding window)
       → Proxy verso external RAG API
       → 200 { answer: string, sources?: string[] }
       → 429 { error: "rate_limit_exceeded" }
       → 403 { error: "rag_not_enabled" }
```

---

## 5. RagProviderAdapter

Interfaccia interna comune a tutti i provider:

```typescript
interface RagProviderAdapter {
  // Ingestione di un documento (buffer + metadati)
  ingestDocument(
    config: RagConfig,
    apiKey: string,
    assetBuffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<{ ragDocumentId: string }>;

  // Rimzione di un documento dal knowledge base
  removeDocument(
    config: RagConfig,
    apiKey: string,
    ragDocumentId: string
  ): Promise<void>;

  // Query al RAG
  query(
    config: RagConfig,
    apiKey: string,
    question: string,
    sessionId: string
  ): Promise<{ answer: string; sources?: string[] }>;
}
```

Implementazioni concrete:

| Classe | Provider |
|---|---|
| `FlowiseRagAdapter` | Flowise API v1 |
| `N8nRagAdapter` | n8n AI Agent webhook |
| `GenericRagAdapter` | Qualsiasi `POST /query { question }` |

---

## 6. Widget chatbot (vanilla JS)

Il widget è un snippet HTML/JS generato dall'LLM all'interno della landing page.
Non è un file esterno: è **inline** nel bundle HTML per rispettare il principio
"zero dipendenze esterne non incluse" di Layer 1.

### 6.1 Struttura del widget

```html
<!-- RAG Chatbot Widget — generato da Andy Code Cat -->
<div id="pf-chatbot-root"></div>
<script>
(function() {
  const PF_RAG = {
    projectKey: "{{PROJECT_PUBLIC_KEY}}",    // iniettato a build time
    apiBase:    "https://api.Andy Code Cat.io",
    title:      "{{widget.title}}",
    placeholder:"{{widget.placeholder}}",
    welcome:    "{{widget.welcomeMessage}}",
    color:      "{{widget.primaryColor}}",
    position:   "{{widget.position}}"
  };

  // ... ~200 righe di vanilla JS
  // - crea bubble FAB
  // - gestisce apertura/chiusura panel
  // - invia POST al BaaS con sessionId (UUID storato in sessionStorage)
  // - mostra risposta con animazione typing
  // - gestisce errori e rate limit
})();
</script>
```

### 6.2 Injection nel prompt LLM

Quando `ragConfig.widget.visible === true` e il progetto viene (ri)generato,
il system prompt riceve un **LAYER E — RAG Widget Module**:

```
[LAYER E — RAG Chatbot Widget]
Questo progetto ha un chatbot RAG abilitato.
Al termine dell'HTML, prima di </body>, inserisci il seguente snippet
senza modificarne la struttura JS (puoi adattare i CSS al design della pagina):

{{ragWidgetSnippet}}
```

La variabile `{{ragWidgetSnippet}}` viene risolta dal backend prima dell'invio
all'LLM, con i valori reali di `projectKey`, colori, titolo, ecc.

---

## 7. UX Dashboard — Tab "Chatbot RAG"

```
┌─────────────────────────────────────────────────────────┐
│  Chatbot RAG                               [Toggle ON/OFF]│
├─────────────────────────────────────────────────────────┤
│  Provider RAG                                           │
│  [Flowise ▼]  Endpoint: [_________________________]    │
│  API Key:     [••••••••••••••]  [Cambia]               │
│                                                         │
│  Documenti indicizzati                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ✓ FAQ_servizi.pdf           indexed  [Rimuovi] │   │
│  │  ✓ Catalogo_2026.pdf         indexed  [Rimuovi] │   │
│  │  ⏳ Listino_prezzi.docx      indexing...        │   │
│  │  ✗ old_brochure.pdf          error    [Ritenta] │   │
│  └─────────────────────────────────────────────────┘   │
│  [+ Aggiungi da Asset Manager]  [Indicizza selezionati] │
│                                                         │
│  Aspetto widget                                         │
│  Titolo: [Assistente virtuale          ]               │
│  Colore: [████] #6366f1                                │
│  Posizione: [Bottom-right ▼]                           │
│  Messaggio benvenuto: [____________________________]   │
│                                                         │
│  [Salva configurazione]                                 │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Sicurezza

| Rischio | Mitigazione |
|---|---|
| API key RAG esposta nel HTML | Proxy BaaS — la chiave non lascia mai il backend |
| Abuso endpoint pubblico `/rag/query` | Rate limit Redis 30 req/ora per sessionId + IP |
| Injection di testo malevolo nella question | Sanificazione input (strip HTML, max 500 chars) |
| CORS bypass | Verifica `Origin` header contro `project.allowedOrigins` |
| Accesso cross-project alle API key | Double sandbox su tutte le route autenticate |
| Exfiltration tramite domande malevole | Monitored via `rag_query_logs` (hash PII-safe) |
| DoS verso RAG provider esterno | Rate limit Andy Code Cat + timeout 10s con circuit breaker |

---

## 9. Roadmap milestones

| Milestone | Contenuto | Dipendenza |
|---|---|---|
| **RAG-0** | RagConfig entity, routes CRUD config, cifratura secret | nessuna |
| **RAG-1** | FlowiseRagAdapter + ingest pipeline (Asset Manager → RAG API) | RAG-0 |
| **RAG-2** | BaaS public route `/rag/query` + rate limiting + proxy | RAG-1, BaaS BS0 |
| **RAG-3** | Widget snippet generator + LAYER E injection nel system prompt | RAG-2 |
| **RAG-4** | UX Dashboard Tab "Chatbot RAG" + stato indicizzazione | RAG-3 |
| **RAG-5** | GenericRagAdapter + N8nRagAdapter | RAG-1 |

---

## 10. Integrazione con architettura esistente

| Modulo esistente | Interazione |
|---|---|
| Asset Manager | `RagIngestService` legge buffer da `AssetRepository` per dato `assetId` |
| Double Sandbox | Tutte le route `/v1/projects/:id/rag/*` passano per `sandboxMiddleware` |
| BaaS Public Router | `RagService` è un `ServiceHandler` registrato come `'rag'` in `ServiceType` |
| Project entity | `ragConfig` embedded field (nullable) |
| LLM Chat Preview system prompt | Nuovo LAYER E opzionale, composto solo se `ragConfig.widget.visible === true` |
| Execution Logs | Evento `rag_ingest` e `rag_query` loggati su `execution_logs` |
| ProjectPublish | Al publish, `project.allowedOrigins` aggiornato con il nuovo dominio |
