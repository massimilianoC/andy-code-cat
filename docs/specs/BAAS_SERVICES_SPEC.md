# Andy Code Cat — BaaS Services Layer: Specifiche

> **Stato:** spec approvata — differita dopo R3/R5 (Layer 1 maturo)
> **Dipendenze architetturali:** double sandbox middleware (✅ implementato), Redis rate‑limiting (✅), nginx wildcard (R5)
> **Principio guida:** le pagine statiche generate da Layer 1/2 acquisiscono comportamenti dinamici
> attraverso chiamate al BaaS di Andy Code Cat — senza che l'utente scriva codice lato server
> e senza che Andy Code Cat gestisca runtime per tenant.

---

## 1. Problema e soluzione

### 1.1 Gap tra SOL‑1 e SOL‑3

Layer 1 produce pagine statiche di alta qualità (SOL‑1). Il passo successivo nella vision originale
(SOL‑3, web app completa) richiede infrastruttura di runtime per tenant — di fatto una mini‑PaaS
da costruire da zero, costosa in ops e superficie di attacco.

**Il BaaS layer risolve il 90% dei casi d'uso SOL‑3 senza nessuna infrastruttura di runtime per tenant:**

| Cosa vuole l'utente | Soluzione SOL‑3 (scartata) | Soluzione BaaS |
|---|---|---|
| Form di contatto/iscrizione | Endpoint Express per-tenant | `PF.forms.submit()` → API condivisa |
| Checkout prodotti | Server Node.js per-tenant con Stripe | `PF.payment.checkout()` → API condivisa |
| Notifica ordine su Telegram | Bot Telegram per-tenant | `PF.telegram.notify()` → relay condiviso |
| Automazioni CRM/email | Logica custom per-tenant | `PF.webhook.trigger()` → n8n/Make relay |
| Catalogo prodotti editabile | Database per-tenant | API BaaS: `ProductService` |

### 1.2 Il 10% restante

I casi non coperti dal BaaS (dashboard analytics realtime, autenticazione utenti del sito,
chat realtime, social features) esulano dai casi d'uso target di Andy Code Cat (landing, portfolio,
e‑commerce base, siti di professionisti). Chi ne ha bisogno è servito meglio da strumenti dedicati.

---

## 2. Architettura del BaaS Layer

### 2.1 Flusso end‑to‑end

```
Pagina statica pubblicata (es. https://myshop.Andy Code Cat.io)
         │
         │  <script src="https://api.Andy Code Cat.io/sdk/v1.js?pk=PROJ_PUB_KEY"></script>
         │  (script iniettato dall'LLM durante generazione, pk dal sistema)
         │
         ▼
   Andy Code Cat Client SDK  (~6 KB gzipped, vanilla JS, zero dipendenze)
         │
         │  chiamate da visitatori anonimi del sito
         │
   ┌─────┴──────────────────────────────────────────────────────┐
   │  PF.forms.submit({ formId, data })                         │
   │  PF.payment.checkout({ items[], currency, returnUrl })     │
   │  PF.telegram.notify({ message, templateId? })              │
   │  PF.webhook.trigger({ workflowId, payload })               │
   │  PF.catalog.list({ page, filters })                        │
   └─────┬──────────────────────────────────────────────────────┘
         │
         │  POST https://api.Andy Code Cat.io/v1/public/svc/{projectKey}/{service}/{action}
         │  Origin: https://myshop.Andy Code Cat.io  ← verificato CORS server-side
         │
         ▼
   Andy Code Cat API — BaaS Public Router (Express)
         │
         ├─ Verifica projectKey → risolve project e owner
         ├─ Verifica CORS (origin ∈ project.allowedOrigins)
         ├─ Verifica service abilitato sul progetto
         ├─ Rate limiting su Redis (per projectKey)
         ├─ Dispatch al ServiceHandler appropriato
         │
         ├─ FormService    → salva submission su MongoDB, invia email conferma
         ├─ PaymentService → crea Stripe Checkout Session, restituisce URL redirect
         ├─ TelegramService → invia messaggio al bot del progetto (owner or recipient)
         ├─ WebhookService → POST verso URL n8n/Make configurato dall'owner
         └─ CatalogService → legge/scrive ProductEntry nel namespace progetto
```

### 2.2 Entità dati

#### ProjectServiceConfig (embedded in Project)

```typescript
interface ProjectServiceConfig {
  // Chiave pubblica embeddabile in HTML — non è un secret
  publicKey: string;           // UUID v4, generato alla creazione progetto
  // Origini CORS autorizzate — aggiornate automaticamente al publish
  allowedOrigins: string[];    // es: ["https://abc123.Andy Code Cat.io", "https://www.example.com"]
  enabledServices: ServiceType[];  // ["forms", "payments", "telegram", "webhook", "catalog"]
  // Configurazione per ogni servizio abilitato
  services: {
    forms?: FormsServiceConfig;
    payments?: PaymentServiceConfig;
    telegram?: TelegramServiceConfig;
    webhook?: WebhookServiceConfig;
    catalog?: CatalogServiceConfig;
  };
}

type ServiceType = 'forms' | 'payments' | 'telegram' | 'webhook' | 'catalog';
```

#### FormsServiceConfig

```typescript
interface FormsServiceConfig {
  // Destinatario email delle submission
  notificationEmail: string;
  // Template email di conferma (opzionale, Nunjucks)
  confirmationEmailTemplate?: string;
  // Lista form registrati (id → schema di validazione lato server)
  forms: Array<{
    formId: string;           // es: "contact", "newsletter", "booking"
    label: string;
    allowedFields: string[];  // campi accettati (whitelist — prevenzione injection)
    requiredFields: string[];
    maxSubmissionsPerIp?: number;  // default: 5 per 24h
  }>;
}
```

#### PaymentServiceConfig

```typescript
interface PaymentServiceConfig {
  // Modalità operativa — vedere §3 Modello di Business
  mode: 'managed' | 'byok';

  // --- BYOK: l'utente porta la propria chiave Stripe ---
  byok?: {
    stripePublishableKey: string;   // pk_live_... — pubblica, embeddabile
    stripeSecretKeyRef: string;     // ID reference alla secret vault — MAI in chiaro in DB
    stripeWebhookSecretRef: string; // ID reference alla secret vault
    currency: string;               // it: "eur"
  };

  // --- Managed: Andy Code Cat usa il proprio account Stripe ---
  managed?: {
    currency: string;          // default "eur"
    statementDescriptor: string;  // es: "Andy Code Cat*MYSHOP"
    // Stripe Connect: ogni transazione va all'account Connect dell'owner Andy Code Cat
    stripeConnectAccountId: string; // acc_... generato al setup onboarding pagamenti
  };

  returnUrl: string;            // URL di ritorno dopo checkout (relativo o assoluto)
  cancelUrl: string;            // URL di annullamento
  // Webhook Stripe → Andy Code Cat (gestito internamente, non esposto all'utente)
}
```

#### TelegramServiceConfig

```typescript
interface TelegramServiceConfig {
  // Modalità operativa
  mode: 'managed' | 'byok';

  // --- BYOK: l'utente usa il proprio bot ---
  byok?: {
    botTokenRef: string;    // ID reference alla secret vault
    chatId: string;         // ID del gruppo/canale di destinazione
  };

  // --- Managed: Andy Code Cat usa il proprio bot relay ---
  managed?: {
    relayBotId: string;     // ID del bot relay Andy Code Cat
    targetChatId: string;   // configurato durante setup nel dashboard
  };

  // Template di notifica (Nunjucks) per tipo evento
  templates: Record<string, string>;  // es: "order_created" → "Nuovo ordine: {{amount}}€"
  allowedEventTypes: string[];        // whitelist eventi che possono triggerare notifiche
}
```

#### FormSubmission (collection: `form_submissions`)

```typescript
interface FormSubmission {
  _id: ObjectId;
  projectId: ObjectId;
  ownerId: ObjectId;          // denormalizzato per query di admin
  formId: string;
  submittedAt: Date;
  ipHash: string;             // SHA-256 dell'IP — non reversibile, solo per rate limiting
  userAgent?: string;
  data: Record<string, string | number | boolean>;  // dati validati per schema
  status: 'new' | 'read' | 'archived';
  // TTL: 365 giorni (configurabile per piano)
}
```

#### PaymentOrder (collection: `payment_orders`)

```typescript
interface PaymentOrder {
  _id: ObjectId;
  projectId: ObjectId;
  ownerId: ObjectId;
  createdAt: Date;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'expired';
  amount: number;             // in centesimi
  currency: string;
  items: Array<{ name: string; quantity: number; unitAmount: number }>;
  customerEmail?: string;     // fornito da Stripe dopo pagamento
  metadata: Record<string, string>;  // custom data dal sito
  // Fee Andy Code Cat (solo modalità managed)
  platformFee?: number;       // in centesimi
  netAmount?: number;         // amount - platformFee - stripeFee
}
```

---

## 3. Modello di business per i servizi

### 3.1 Due modalità operative per ogni servizio

Andy Code Cat supporta due modalità per ogni servizio integrabile, selezionabili per progetto:

| Modalità | Chi ha l'account esterno | Chi paga le fee esterne | Andy Code Cat guadagna | Setup richiesto |
|---|---|---|---|---|
| **BYOK** — Bring Your Own Keys | L'utente/owner | L'utente | Fee mensile piano | Inserire chiavi nel dashboard |
| **Managed** — Chiave Andy Code Cat | Andy Code Cat | Andy Code Cat (scaricato su utente) | Fee transazione % | Solo onboarding semplice |

### 3.2 Analisi per servizio

#### Pagamenti (Stripe)

**BYOK:**

- L'utente ha un proprio account Stripe (richiede P.IVA o Codice Fiscale, verifica identità)
- I soldi vanno direttamente sul conto Stripe dell'utente
- Andy Code Cat non tocca mai i soldi
- Adatto per: professionisti con P.IVA, aziende, chi fa volumi significativi
- Fee Andy Code Cat: inclusa nel piano mensile

**Managed (Stripe Connect):**

- Andy Code Cat ha un account Stripe Platform
- Ogni owner Andy Code Cat che attiva i pagamenti esegue un onboarding Stripe Express (5 min, KYC semplificato)
- Stripe crea un Connected Account collegato all'account Platform Andy Code Cat
- I pagamenti avvengono tramite l'account Platform, con `transfer_data.destination` all'account Connected dell'owner
- L'owner riceve i fondi sul proprio IBAN, Andy Code Cat trattiene la fee di applicazione
- **Adatto per:** hobbyisti, piccoli venditori, chi non vuole aprire un conto Stripe standalone

**Fee struttura Managed (esempio):**

```
Transazione da 100€:
  Stripe fee (EU cards): ~1.5% + 0.25€ = 1.75€
  Andy Code Cat platform fee: 1.5% = 1.50€
  Owner riceve: 96.75€
  Totale costo per l'owner: 3.25% — competitivo con PayPal (3.49%) e Shopify Payments (2%)
```

**Considerazione fiscale IMPORTANTE:**
Andy Code Cat come platform non emette fatture per le vendite dell'owner — Stripe gestisce
la reportistica fiscale direttamente. Andy Code Cat emette solo la propria fattura di servizio
per la platform fee. L'owner è responsabile della propria contabilità.

Per i piccoli hobbyisti italiani sotto soglia IVA (€5.000/anno per attività occasionale),
il modello Managed Stripe è la via di minor resistenza: nessun conto aziendale, identità
verificata direttamente da Stripe Express, IBAN personale.

#### Telegram

**BYOK:**

- L'utente crea il proprio bot su @BotFather (1 minuto, gratis)
- Inserisce il token nel dashboard
- Il bot è di sua proprietà, Andy Code Cat è solo relay
- Raccomandato: l'utente ha più controllo, nessuna dipendenza da bot Andy Code Cat

**Managed:**

- Andy Code Cat ha un bot relay condiviso
- L'owner fa `/start` al bot Andy Code Cat, ottenendo il proprio `chatId`
- Tutte le notifiche passano dal bot relay (es. `@Andy Code CatBot`)
- Svantaggio: il bot è pingeggiabile da chiunque conosca il chatId (mitigato con token OTP per subscription)
- Raccomandato solo come fallback semplificato per utenti senza familiarità con Telegram bots

**Raccomandazione:** BYOK Telegram è talmente semplice che il Managed non aggiunge valore reale.
Offrire Managed come "default semplice" con migrazione a BYOK documentata.

#### n8n / Make / Webhook

Solo BYOK ha senso: ogni utente ha la propria istanza n8n, Make, Zapier o webhook custom.
Andy Code Cat fa solo il POST verso l'URL configurato. Nessun vantaggio nel Managed.

#### Forms

Completamente gestito da Andy Code Cat (nessun account esterno richiesto).
Le submission vengono storicizzate in MongoDB nel namespace progetto.
Email di notifica via SMTP/Resend di Andy Code Cat (inclusa nel piano base).

---

### 3.3 Proposta piani commerciali BaaS

| Piano | LLM generazione | Servizi abilitati | Pagamenti Managed | Fee transazione |
|---|---|---|---|---|
| **Free** | ✅ (crediti limitati) | Forms only | ❌ | — |
| **Starter** (€9/mese) | ✅ | Forms + Telegram BYOK + Webhook | ❌ | — |
| **Pro** (€19/mese) | ✅ | Tutti i servizi + Payments BYOK | ❌ | — |
| **Commerce** (€29/mese + fee) | ✅ | Tutti i servizi + Payments Managed | ✅ | 1.5% |
| **Agency** (€79/mese) | ✅ | Multi-progetto, white-label, Payments BYOK | ❌/BYOK | 0.8% se Managed |

> Il piano **Commerce** è il modello "reseller di servizi pagamento" — Andy Code Cat come piattaforma
> Stripe Connect consente di non richiedere all'utente un conto Stripe aziendale.
> Il piano **Pro** è rivolto a chi ha già P.IVA e preferisce portare le proprie chiavi.

---

## 4. Sicurezza — Linee Guida di Configurazione

### 4.1 Principi di sicurezza del BaaS layer

Il BaaS è esposto a richieste provenienti da visitatori anonimi del web — la superficie
di attacco è diversa da quella delle API authenticated di Andy Code Cat.

**Regola fondamentale:** nessun secret deve mai uscire dal server. Il client riceve solo
`projectPublicKey` (non segreto) e dati di risposta sanitizzati.

### 4.2 Linee guida per configurazione profilo utente/progetto

#### Livello 1 — Protezione identità e accesso (OBBLIGATORIO)

| Controllo | Implementazione | Note |
|---|---|---|
| **CORS locked** | `allowedOrigins` verificato per ogni richiesta pubblica | Aggiornato automaticamente al publish. L'owner può aggiungere domini custom. Wildcard `*` mai consentito. |
| **Rate limiting per projectKey** | Redis sliding window: 60 req/min per `projectKey`, 10 req/min per `projectKey+ipHash` | Prevenzione flood e scraping submissions |
| **HTTPS only** | Tutte le chiamate SDK via HTTPS | Il SDK rifiuta chiamate non‑SSL in produzione |
| **IP hashing** | Salted SHA‑256 dell'IP per rate limiting | L'IP reale non viene mai persisto in DB |

#### Livello 2 — Validazione input (OBBLIGATORIO)

| Attacco | Difesa |
|---|---|
| **Form injection (XSS stored)** | Tutti i dati form sono sanitizzati con DOMPurify‑equivalent lato server prima del salvataggio. Nessun campo HTML accettato nei form. Solo stringhe, numeri, booleani. |
| **Oversized payload** | Limite 16 KB per submission. Limite 50 items per checkout. Limite 1000 char per campo form. |
| **Field injection** | Solo i campi presenti in `FormsServiceConfig.forms[].allowedFields` vengono salvati. Campi extra sono ignorati silenziosamente. |
| **SQL/NoSQL injection** | MongoDB: parametri passati come valori typed, mai interpolati in query string. Mongoose schema validation prima di ogni write. |
| **Command injection** | Non applicabile: il BaaS router non esegue codice utente. |

#### Livello 3 — Protezione secrets (OBBLIGATORIO per BYOK)

| Regola | Dettaglio |
|---|---|
| **Stripe secret key mai in MongoDB** | Le secret key BYOK sono cifrate con AES‑256‑GCM con chiave di envelope (env var `SECRET_VAULT_KEY`). In DB è salvato solo il reference ID. Il plaintext viene decifrato in memoria solo al momento dell'uso. |
| **Telegram bot token** | Stesso meccanismo: envelope encryption, reference in DB. |
| **Nessun log di secrets** | Il middleware di logging esclude esplicitamente i campi `*Key`, `*Token`, `*Secret` dal logging. |
| **Secret rotation** | L'owner può ruotare le proprie chiavi BYOK dal dashboard senza downtime. Il vecchio reference viene invalidato immediatamente. |
| **Principio del minimo privilegio** | Il service worker che usa la Stripe secret key ha accesso in lettura solo a quel record specifico — non all'intera collection ProjectServiceConfig. |

#### Livello 4 — Sandbox e isolamento (OBBLIGATORIO)

| Regola | Dettaglio |
|---|---|
| **Double sandbox su ogni write** | Anche le richieste via `publicKey` vengono tracciate con `projectId + ownerId`. Nessuna submission o ordine può essere creato senza questa coppia. |
| **Cross‑project isolation** | `publicKey` risolve a un unico progetto. Impossibile accedere ai dati di un altro progetto tramite un `publicKey` altrui. |
| **Form submission visibili solo all'owner** | Le API di lettura submission (`GET /v1/projects/:id/services/forms/:formId/submissions`) sono protected da `authMiddleware` + `projectSandboxMiddleware` — identiche alle altre API progetti. |
| **Stripe webhook signature** | Ogni callback Stripe è verificato con `stripe.webhooks.constructEvent()` + webhook secret. Richieste non firmate sono rigettate con 400. |

#### Livello 5 — Audit e monitoring

| Controllo | Implementazione |
|---|---|
| **Execution logging** | Ogni chiamata al BaaS layer genera un evento in `execution_logs` (collection TTL 90gg — già implementata) con `domain: "baas"`, `eventType`, `projectId`, ipHash |
| **Anomaly detection (futuro)** | Rate anomalo di submission per un progetto → alert owner via email |
| **Abuse reporting** | Endpoint `POST /v1/public/report-abuse` per segnalare uso improprio di un sito Andy Code Cat |

---

## 5. API — Endpoints

### 5.1 Public BaaS API (no JWT — chiamate da visitatori anonimi)

```
POST /v1/public/svc/:projectKey/forms/:formId/submit
POST /v1/public/svc/:projectKey/payments/checkout
POST /v1/public/svc/:projectKey/telegram/notify
POST /v1/public/svc/:projectKey/webhook/trigger/:workflowId
GET  /v1/public/svc/:projectKey/catalog/list
GET  /v1/public/svc/:projectKey/catalog/item/:itemId
```

**Request/Response per forms:**

```typescript
// POST /v1/public/svc/:projectKey/forms/contact/submit
// Body (Content-Type: application/json, max 16KB):
{
  "name": "Mario Rossi",
  "email": "mario@example.com",
  "message": "Ciao, vorrei informazioni"
}

// Response 201:
{ "success": true, "submissionId": "uuid" }

// Response 429 (rate limit):
{ "error": "too_many_requests", "retryAfter": 3600 }

// Response 403 (origin non autorizzato):
{ "error": "origin_not_allowed" }
```

**Request/Response per payments:**

```typescript
// POST /v1/public/svc/:projectKey/payments/checkout
{
  "items": [
    { "name": "Prodotto A", "quantity": 2, "unitAmount": 2500 }  // centesimi
  ],
  "customerEmail": "mario@example.com",  // opzionale
  "metadata": { "sourceForm": "product-page" }  // max 5 kv pairs
}

// Response 201:
{
  "checkoutUrl": "https://checkout.stripe.com/pay/cs_...",
  "orderId": "uuid"
}
```

### 5.2 Owner API (JWT required — gestione servizi dal dashboard)

```
GET    /v1/projects/:id/services                  — configurazione servizi del progetto
PUT    /v1/projects/:id/services                  — aggiorna configurazione
POST   /v1/projects/:id/services/payments/onboard — avvia Stripe Connect onboarding
GET    /v1/projects/:id/services/payments/status  — stato account Stripe linked
POST   /v1/projects/:id/services/byok/stripe      — aggiunge/aggiorna Stripe BYOK keys
POST   /v1/projects/:id/services/byok/telegram    — aggiunge/aggiorna Telegram BYOK token

GET    /v1/projects/:id/services/forms/:formId/submissions   — lista submission
DELETE /v1/projects/:id/services/forms/:formId/submissions/:subId
GET    /v1/projects/:id/services/payments/orders             — lista ordini
GET    /v1/projects/:id/services/payments/orders/:orderId    — dettaglio ordine

POST   /v1/stripe-webhooks                        — Stripe webhook (firma verificata, no auth)
```

### 5.3 SDK Client — Interfaccia pubblica

```typescript
// Inizializzazione (automatica quando lo script è loadato con ?pk=...)
window.PF.ready(() => {
  // SDK pronto
});

// Form submit
const result = await PF.forms.submit('contact', {
  name: formData.get('name'),
  email: formData.get('email'),
  message: formData.get('message')
});
// result: { success: boolean, submissionId?: string, error?: string }

// Payment checkout (redirect)
await PF.payment.checkout([
  { name: 'Nome prodotto', quantity: 1, unitAmount: 4990 }
]);
// → redirect a Stripe Checkout (non torna — è un redirect)

// Telegram notify (solo se abilitato per il progetto)
await PF.telegram.notify('Nuovo contatto da form!', { template: 'contact_received' });

// Webhook trigger
await PF.webhook.trigger('send-to-crm', { email, name });

// Catalog (read-only dal client)
const items = await PF.catalog.list({ page: 1, limit: 20 });
```

---

## 6. Integrazione con il sistema prompt

### 6.1 Layer A extension (SDK injection)

Quando il progetto ha servizi BaaS abilitati, il `buildBaseConstraintsLayer()` riceve
un blocco aggiuntivo `baasContextBlock`:

```
[Andy Code Cat SERVICES SDK — iniettato solo se project.services.enabledServices.length > 0]

Il progetto usa il Andy Code Cat BaaS SDK per comportamenti dinamici.
Script già incluso: <script src="https://api.Andy Code Cat.io/sdk/v1.js?pk={projectKey}"></script>

Usa SOLO queste API per funzionalità dinamiche — non generare fetch() custom, non usare
servizi di terze parti direttamente (Stripe.js, emailjs, formspree, ecc.):

  PF.forms.submit(formId, data)      → invia un form (formId: "{formIds}")
  PF.payment.checkout(items)         → avvia checkout Stripe (se abilitato)
  PF.telegram.notify(message)        → notifica Telegram owner (se abilitato)
  PF.webhook.trigger(workflowId, data) → trigger automazione (workflowId: "{workflowIds}")

Ogni form HTML deve chiamare PF.forms.submit() nel submit handler.
Non usare action="" nei form. Gestisci il submit con JavaScript.
Mostra feedback visivo (loading, success, error) dopo ogni chiamata SDK.
```

---

## 7. Roadmap implementativa

### BS0 — Fondamenta (prerequisito tutto il resto)

- [ ] `ProjectServiceConfig` embedded in Project entity + migration
- [ ] `publicKey` UUID generato alla creazione progetto
- [ ] `allowedOrigins` auto‑popolato al publish
- [ ] Envelope encryption per BYOK secrets (`SECRET_VAULT_KEY` in env)
- [ ] BaaS public router middleware: CORS check + rate limiting + projectKey resolution
- [ ] Execution logging per domain `"baas"`

### BS1 — Forms Service (primo da implementare — zero dipendenze esterne)

- [ ] `FormsServiceConfig` + `FormSubmission` entity + Mongoose schema
- [ ] `POST /v1/public/svc/:pk/forms/:formId/submit` con validazione whitelist campi
- [ ] Email di notifica owner via Resend/SMTP (credenziali Andy Code Cat)
- [ ] `GET /v1/projects/:id/services/forms/:formId/submissions` (owner, JWT‑protected)
- [ ] SDK: `PF.forms.submit()`
- [ ] SDK injection nel prompt (Layer A extension)
- [ ] Rate limiting: 10 submission/IP/24h per form

### BS2 — Telegram Service BYOK (secondo — setup minimo)

- [ ] `TelegramServiceConfig` + envelope encryption per bot token
- [ ] `POST /v1/projects/:id/services/byok/telegram` (salva token cifrato)
- [ ] `POST /v1/public/svc/:pk/telegram/notify` (chiama Telegram API con bot token decifrato)
- [ ] Template Nunjucks per messaggi
- [ ] SDK: `PF.telegram.notify()`
- [ ] Rate limiting: 20 notify/progetto/ora

### BS3 — Payments BYOK (terzo — Stripe con chiavi utente)

- [ ] `PaymentServiceConfig` BYOK + envelope encryption per secret key
- [ ] `POST /v1/projects/:id/services/byok/stripe` (salva pk + sk cifrata + wh secret)
- [ ] `POST /v1/public/svc/:pk/payments/checkout` → `stripe.checkout.sessions.create()`
- [ ] `POST /v1/stripe-webhooks` → verifica firma + aggiorna `PaymentOrder.status`
- [ ] `PaymentOrder` entity + Mongoose schema
- [ ] `GET /v1/projects/:id/services/payments/orders` (owner)
- [ ] SDK: `PF.payment.checkout()`

### BS4 — Payments Managed (Stripe Connect)

- [ ] Stripe Connect Platform setup (account Andy Code Cat + webhook endpoint)
- [ ] `POST /v1/projects/:id/services/payments/onboard` → Stripe Express onboarding link
- [ ] Stripe Connect webhook: `account.updated`, `payment_intent.succeeded`
- [ ] Platform fee deduction nella creazione PaymentIntent
- [ ] Riepilogo pagamenti nell'owner dashboard

### BS5 — Webhook relay + Catalog

- [ ] `WebhookService`: POST verso URL configurato con HMAC signature header
- [ ] `CatalogService`: CRUD prodotti `ProductEntry`, lettura pubblica via SDK
- [ ] SDK: `PF.webhook.trigger()`, `PF.catalog.list()`, `PF.catalog.item()`

---

## 8. Dipendenze nella sequenza globale

```
Layer 1 completo (R1→R5)
         │
         ▼
BS0 — Fondamenta BaaS
         │
    ┌────┴──────────────────┐
    ▼                       ▼
BS1 (Forms)          BS2 (Telegram BYOK)
    │
    ▼
BS3 (Payments BYOK)
    │
    ▼
BS4 (Payments Managed — Stripe Connect)
         │
         ▼
BS5 (Webhook + Catalog)
```

BS1 e BS2 sono parallelizzabili dopo BS0.
BS4 richiede coordinazione con Stripe (onboarding account Platform — una tantum).

---

## 9. Decisione architetturale: BYOK prima, Managed dopo

Il percorso raccomandato è:

1. **BS1 (Forms)** — zero costo infra, 70% dei siti ne hanno bisogno, zero rischio legale
2. **BS2 (Telegram BYOK)** — richiede solo che l'utente crei un bot Telegram (1 min)
3. **BS3 (Payments BYOK)** — Stripe BYOK è usabile da chiunque abbia P.IVA; non richiede infra complessa a Andy Code Cat
4. **BS4 (Payments Managed)** — richiede: apertura account Stripe Platform, accordo con Stripe sui termini del marketplace, compliance KYC per gli utenti Connected→ Questo è il passo che richiede più lavoro legale e di compliance, non tecnico. Va pianificato separatamente con l'aspetto commerciale/legale.

> **BS4 non è solo una milestone tecnica** — richiede che Andy Code Cat sia registrata come Payment Facilitator o Marketplace sotto i termini Stripe. Questo ha implicazioni fiscali e di responsabilità. Va validato con un consulente prima di implementare.
