# External API Key Management — Platform Integration Hub

> **Status:** Planned — Milestone M-APIKEYS  
> **Date:** 2026-05-13  
> **Scope:** Gestione centralizzata delle API key di terze parti a livello platform (superadmin), con architettura BYOK-ready per override utente futuro; integrazione con image services e LLM providers; policy di fallback immagini iniettata nel prompt base.  
> **Backward compatibility:** massima — nessuna breaking change sulle entity esistenti, nessun cambiamento obbligatorio alla pipeline LLM attiva.

---

## 1. Motivazione

### 1.1 Problema attuale

Il sistema gestisce le API key esclusivamente tramite variabili d'ambiente (`SILICONFLOW_API_KEY`, `OPEN_ROUTER_API_KEY`, `LLM_PROVIDER_API_KEYS_JSON`). Questo approccio:

- non è gestibile dall'UI admin senza accesso SSH/deploy
- non supporta rotazione delle chiavi senza restart del container
- non supporta override per-utente (BYOK)
- non ha audit trail di chi ha inserito/modificato una chiave
- non copre i servizi immagine (LoremFlickr, Unsplash, Pexels, Pixabay)
- non ha una politica di fallback dichiarativa per i servizi

### 1.2 Problema immagini placeholder

La sezione `## IMAGES` del `DEFAULT_PRE_PROMPT` (in `GetLlmPromptConfig.ts`) ha due difetti critici:

1. **`source.unsplash.com` è deprecato** dall'aprile 2023 — produce redirect rotti o errori 404
2. **`picsum.photos/seed/<keyword>`** non è semantico: il parametro `seed` è un hash puro, produce immagini casuali fisse indipendenti dalla keyword — completamente decontestualizzato

La sezione IMAGES deve essere sostituita con fonti che supportano ricerca per keyword e con una policy di fallback automatica.

---

## 2. Obiettivi di questa milestone

1. **`ServiceApiKey` collection** — nuova entità MongoDB per API key esterne, scope platform + scaffold BYOK utente futuro
2. **Crittografia** — AES-256-GCM con IV randomico; il raw key non viene mai salvato; fingerprint SHA-256 (8 hex chars) visibile in UI
3. **Seeding da env** — al primo avvio, le chiavi in env vengono migrated automaticamente nella collection (non-destructive)
4. **Admin UI — tab "Integrations"** — pannello dedicato nel layout `/admin/` con gestione per categoria (LLM, Image, Notification, ...)
5. **Image service registry** — servizi immagine pre-cablati con policy primary/fallback; bypass API key per servizi che non la richiedono (LoremFlickr, LMStudio)
6. **Policy fallback immagini** — se il servizio primario risponde non-200, il sistema tenta automaticamente il fallback
7. **Iniezione nel prompt base** — `DEFAULT_PRE_PROMPT` diventa dinamico: la sezione `## IMAGES` viene generata a runtime leggendo la config DB, con primary + fallback effettivi
8. **Architettura BYOK-ready** — la struttura dati prevede `scope: "platform" | "user"` e `ownerUserId` opzionale per override futuro per-utente; l'UI è attiva solo per superadmin ora
9. **Fix urgente** — rimozione di `source.unsplash.com` (morto) e aggiunta di LoremFlickr come fonte no-key-required di fallback

---

## 3. Architettura dati

### 3.1 Entità `ServiceApiKey`

```typescript
// apps/api/src/domain/entities/ServiceApiKey.ts

/**
 * Categoria del servizio esterno.
 * Estendibile senza breaking change aggiungendo valori.
 */
export type ServiceCategory =
  | "llm"           // LLM text generation providers
  | "image"         // Stock/placeholder image services
  | "image_gen"     // AI image generation (es. FLUX via SiliconFlow)
  | "notification"  // Telegram, email, etc.
  | "payment"       // Stripe, etc.
  | "analytics"     // Google Analytics, etc.
  | "storage"       // S3-compatible, MinIO overrides
  | "other";

/**
 * Policy di autenticazione del servizio.
 * "none" = servizio accessibile senza chiave (es. LoremFlickr, LMStudio local)
 */
export type ServiceKeyPolicy = "api-key" | "bearer" | "none";

/**
 * Scope della chiave.
 * "platform" = installazione globale, gestita dal superadmin.
 * "user"     = override per-utente BYOK (UI non ancora attiva, struttura pronta).
 */
export type ServiceKeyScope = "platform" | "user";

export interface ServiceApiKey {
  id: string;                    // UUID stabile

  /** Identificatore tecnico del servizio: "siliconflow", "unsplash", "pexels", "loremflickr", ... */
  serviceId: string;

  category: ServiceCategory;

  /** Label human-readable mostrato in UI */
  label: string;

  /** Policy auth: se "none", encryptedKey è null e il servizio non viene escluso anche senza chiave */
  keyPolicy: ServiceKeyPolicy;

  /**
   * Chiave cifrata con AES-256-GCM.
   * Formato: base64("<iv:12B>:<tag:16B>:<ciphertext>")
   * Null se keyPolicy === "none".
   */
  encryptedKey?: string | null;

  /**
   * SHA-256 dei primi 32 byte della chiave raw, in lowercase hex.
   * Usato come fingerprint visivo in UI (si mostra solo il prefisso: es. "a3f9c1b2...").
   * Null se keyPolicy === "none".
   */
  keyFingerprint?: string | null;

  /** Base URL di override. Se null, si usa il default hard-coded del connettore. */
  baseUrl?: string | null;

  /** Chiave attiva (inclusa nella risoluzione a runtime) */
  isActive: boolean;

  /**
   * Servizio primario per la categoria.
   * Esattamente 1 record per (category + scope + ownerUserId) dovrebbe avere isDefault=true.
   * Gestito dall'upsert del use-case.
   */
  isDefault: boolean;

  /**
   * Servizio di fallback per la categoria.
   * Usato se la chiamata al primario restituisce non-200.
   * Esattamente 1 record per (category + scope + ownerUserId) dovrebbe avere isFallback=true.
   */
  isFallback: boolean;

  /** Scope: platform (superadmin) | user (BYOK futuro) */
  scope: ServiceKeyScope;

  /** Null per scope=platform. UserId del proprietario per scope=user (BYOK futuro). */
  ownerUserId?: string | null;

  /** Metadati aggiuntivi estensibili (es: rate limit per-chiave, region, org ID, ...) */
  metadata?: Record<string, unknown> | null;

  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  updatedByUserId?: string | null;
}
```

### 3.2 Indici MongoDB (collection: `service_api_keys`)

```
{ serviceId: 1, scope: 1, ownerUserId: 1 }   — unique per combinazione
{ category: 1, scope: 1, isActive: 1 }        — query per categoria
{ scope: 1, ownerUserId: 1 }                   — BYOK lookup per utente
```

### 3.3 Entità `ServiceApiKeyPublic` (DTO senza chiave)

```typescript
// packages/contracts/src/serviceApiKeys.ts

export interface ServiceApiKeyPublicDto {
  id: string;
  serviceId: string;
  category: ServiceCategory;
  label: string;
  keyPolicy: ServiceKeyPolicy;
  hasKey: boolean;                // true se encryptedKey presente
  keyFingerprint?: string | null; // primi 8 hex del SHA-256
  baseUrl?: string | null;
  isActive: boolean;
  isDefault: boolean;
  isFallback: boolean;
  scope: ServiceKeyScope;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
```

> **Regola di sicurezza:** il raw key e l'`encryptedKey` non vengono **mai** restituiti via API. Solo `hasKey` e `keyFingerprint`.

---

## 4. Registro servizi pre-cablati

### 4.1 LLM Providers

| serviceId | label | keyPolicy | baseUrl default | Note |
|-----------|-------|-----------|-----------------|------|
| `siliconflow` | SiliconFlow | `api-key` | `https://api.siliconflow.cn/v1` | Provider primario |
| `openrouter` | OpenRouter | `api-key` | `https://openrouter.ai/api/v1` | Provider alternativo |
| `lmstudio` | LM Studio (local) | `none` | `http://lmstudio:1234/v1` | No API key — bypass automatico |

### 4.2 Image Services (stock photo / placeholder)

| serviceId | label | keyPolicy | URL pattern | Note |
|-----------|-------|-----------|-------------|------|
| `pexels` | Pexels | `api-key` | `https://api.pexels.com/v1/search?query={kw}&per_page=1` | Keyword search; 200 req/h free |
| `unsplash` | Unsplash | `api-key` | `https://api.unsplash.com/photos/random?query={kw}` | 50 req/h free |
| `pixabay` | Pixabay | `api-key` | `https://pixabay.com/api/?key={k}&q={kw}&image_type=photo` | CC0, 100 req/min free |
| `loremflickr` | LoremFlickr | `none` | `https://loremflickr.com/{w}/{h}/{kw}` | No key — keyword semantico da Flickr CC0 |
| `picsum` | Lorem Picsum | `none` | `https://picsum.photos/seed/{kw}/{w}/{h}` | No key — deterministico non semantico, solo fallback |

**Policy default per immagini:**

- **Primary**: `pexels` se API key presente, altrimenti `loremflickr` (no-key bypass)
- **Fallback**: `loremflickr` (sempre disponibile, no key richiesta)

### 4.3 Connettori futuri (scaffold categoria)

| serviceId | categoria | keyPolicy | Note |
|-----------|-----------|-----------|------|
| `telegram` | `notification` | `api-key` | Bot token |
| `stripe` | `payment` | `api-key` | Secret key |
| `asana` | `other` | `bearer` | Personal Access Token |
| `ga4` | `analytics` | `api-key` | Measurement ID + API secret |

---

## 5. Crittografia

### 5.1 Schema AES-256-GCM

```
ENCRYPTION_MASTER_KEY = HKDF-SHA256(
  inputKeyMaterial = env.JWT_ACCESS_SECRET,
  salt             = SHA256(env.MONGODB_DB_NAME + "service-api-keys"),
  info             = "service-api-key-encryption-v1",
  length           = 32 bytes
)
```

Il master key è **derivato da variabili già in env** — nessuna nuova variabile obbligatoria.

```
encrypt(rawKey: string):
  iv          = crypto.randomBytes(12)
  cipher      = createCipheriv("aes-256-gcm", masterKey, iv)
  ciphertext  = cipher.update(rawKey) + cipher.final()
  authTag     = cipher.getAuthTag()
  stored      = base64url(iv + authTag + ciphertext)   // 12 + 16 + len(rawKey) bytes

fingerprint(rawKey: string):
  SHA256(rawKey)[0..4].toString("hex")   // 8 caratteri hex
```

### 5.2 Decryption flow (server-side only)

La decryption avviene **esclusivamente** all'interno del `ServiceApiKeyResolver` — adapter infrastrutturale che non espone mai il raw key al di fuori dello strato infra.

---

## 6. Seeding da env (migrazione non-destructive)

Al bootstrap dell'API (o su chiamata superadmin `POST /admin/service-keys/seed-from-env`), il servizio:

1. Legge `env.SILICONFLOW_API_KEY`, `env.OPEN_ROUTER_API_KEY`, `env.LLM_PROVIDER_API_KEYS_JSON`
2. Per ogni chiave trovata: se esiste già un record `{ serviceId, scope: "platform" }` → skip; altrimenti → inserisce
3. Non elimina mai record esistenti — è **additive only**
4. Logga in modo sicuro: "seeded X service keys from env (no values logged)"

Questo garantisce che i deploy esistenti continuino a funzionare identicamente.

---

## 7. Runtime key resolution

### 7.1 Priorità di risoluzione (runtime)

```
1. scope=user, ownerUserId=<currentUser>   (BYOK utente — futuro)
2. scope=platform, isDefault=true          (chiave platform superadmin)
3. env.providerApiKeys[serviceId]          (fallback env — retrocompatibilità)
4. nessuna chiave → servizio con keyPolicy="none" → bypass
5. nessuna chiave → servizio con keyPolicy="api-key" → skip/log warning
```

La priorità `env` come step 3 garantisce **zero breaking change**: i deploy che usano solo env continuano a funzionare senza toccare MongoDB.

### 7.2 `ServiceApiKeyResolver` (infra adapter)

```typescript
// apps/api/src/infra/adapters/ServiceApiKeyResolver.ts

export interface ResolvedServiceKey {
  serviceId: string;
  apiKey: string | null;     // null se keyPolicy="none" o nessuna chiave trovata
  baseUrl: string;
  keyPolicy: ServiceKeyPolicy;
  source: "db" | "env" | "none"; // audit trail interno
}

export interface ServiceApiKeyResolver {
  resolve(serviceId: string, scope?: ServiceKeyScope, userId?: string): Promise<ResolvedServiceKey>;
  resolveDefault(category: ServiceCategory, scope?: ServiceKeyScope, userId?: string): Promise<ResolvedServiceKey | null>;
  resolveFallback(category: ServiceCategory, scope?: ServiceKeyScope, userId?: string): Promise<ResolvedServiceKey | null>;
}
```

---

## 8. Fallback policy immagini

### 8.1 Comportamento

```
1. Risolvi serviceId primario per category="image" dal DB
2. Se keyPolicy="none" → usa sempre (no API call needed for resolution)
   Se keyPolicy="api-key" → risolvi apiKey; se nessuna chiave → skip al fallback
3. Chiama servizio primario con keyword + dimensioni
4. Se risponde 200 → usa URL ritornata
5. Se risponde non-200, timeout (3s), o nessuna chiave → chiama fallback
6. Fallback: loremflickr (sempre disponibile, no key, keyword semantica)
7. Se anche fallback fallisce → usa picsum deterministico (never fails)
```

### 8.2 Image service connector interface

```typescript
// apps/api/src/infra/adapters/imageServices/IImageService.ts

export interface ImageServiceQuery {
  keyword: string;
  width: number;
  height: number;
}

export interface ImageServiceResult {
  url: string;
  sourceServiceId: string;
  isPlaceholder: boolean;  // true per picsum/loremflickr
}

export interface IImageService {
  serviceId: string;
  requiresApiKey: boolean;
  getImageUrl(query: ImageServiceQuery, apiKey?: string): Promise<ImageServiceResult>;
}
```

Implementazioni concrete:

- `PexelsImageService` — GET `/v1/search`, restituisce `photos[0].src.large`
- `UnsplashImageService` — GET `/photos/random?query=`, restituisce `urls.regular`
- `PixabayImageService` — GET `/?key=&q=&image_type=photo`, restituisce `hits[0].largeImageURL`
- `LoremFlickrImageService` — costruisce URL diretto (no HTTP call), keyPolicy=none
- `PicsumImageService` — costruisce URL diretto (no HTTP call), keyPolicy=none, deterministico

---

## 9. Iniezione dinamica nel prompt base

### 9.1 Problema attuale

La sezione `## IMAGES` in `DEFAULT_PRE_PROMPT` (`GetLlmPromptConfig.ts`) è:

- hardcoded con `source.unsplash.com` (endpoint morto dal 2023)
- non riflette la configurazione effettiva del sistema

### 9.2 Soluzione

La sezione `## IMAGES` diventa **generata a runtime** dalla funzione:

```typescript
// apps/api/src/application/llm/buildImageSourcesBlock.ts

export async function buildImageSourcesBlock(
  resolver: ServiceApiKeyResolver,
  scope: ServiceKeyScope = "platform",
  userId?: string
): Promise<string>
```

Questa funzione:

1. Risolve il servizio primario (`category="image"`, `isDefault=true`)
2. Risolve il servizio fallback (`category="image"`, `isFallback=true`)
3. Costruisce la sezione `## IMAGES` con esempi URL per il servizio attivo
4. Inietta la policy: "se non disponibile, usa fallback"

### 9.3 Integrazione nel pipeline

`GetLlmPromptConfig.execute()` chiama `buildImageSourcesBlock()` e sostituisce la sezione IMAGES statica nel template.

In alternativa (più pulita architetturalmente), il `DEFAULT_PRE_PROMPT` contiene un marker `{{IMAGE_SOURCES_BLOCK}}` che viene sostituito dalla funzione nel composer.

### 9.4 Fix urgente (pre-requisito)

**Rimozione immediata** di `source.unsplash.com/random` dal `DEFAULT_PRE_PROMPT` e sostituzione con LoremFlickr come fonte no-key semantica contestuale.

Questa fix è separata dall'implementazione DB e può essere eseguita in Wave 0 (fix rapido senza infrastruttura).

---

## 10. Admin API — Nuove routes

Tutte protette da `authMiddleware + requireSuperAdmin`:

```
GET    /admin/service-keys                          — lista tutte le service keys (no raw key)
GET    /admin/service-keys/:id                      — dettaglio singola key
POST   /admin/service-keys                          — crea/aggiorna service key
PUT    /admin/service-keys/:id                      — aggiorna label/baseUrl/flags
DELETE /admin/service-keys/:id                      — elimina (soft delete: isActive=false)
POST   /admin/service-keys/seed-from-env            — seeding non-destructivo da env
GET    /admin/service-keys/defaults                 — restituisce primary+fallback per categoria
PATCH  /admin/service-keys/:id/set-default          — imposta come default per categoria
PATCH  /admin/service-keys/:id/set-fallback         — imposta come fallback per categoria
PATCH  /admin/service-keys/:id/toggle               — attiva/disattiva
```

### Schema validazione (Zod) — `packages/contracts/src/serviceApiKeys.ts`

```typescript
export const createServiceApiKeySchema = z.object({
  serviceId: z.string().min(1).max(64),
  category: z.enum(["llm","image","image_gen","notification","payment","analytics","storage","other"]),
  label: z.string().min(1).max(120),
  keyPolicy: z.enum(["api-key", "bearer", "none"]),
  rawKey: z.string().min(1).optional(),  // solo in create/update, mai in response
  baseUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  isFallback: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const updateServiceApiKeySchema = createServiceApiKeySchema.partial().omit({ rawKey: true }).extend({
  rotateKey: z.string().min(1).optional(),  // nuovo raw key per rotazione
});
```

---

## 11. Admin UI — Tab "Integrations"

### 11.1 Collocazione nel layout admin

```typescript
// apps/web/app/admin/layout.tsx — aggiungere alla nav:
{ href: "/admin/integrations", label: "Integrations", icon: "plug" }
```

### 11.2 Struttura pagina `/admin/integrations`

```
┌─────────────────────────────────────────────────────┐
│ Integration Hub                                      │
│ Manage API keys and connectors for external services │
├─────────────────────────────────────────────────────┤
│ [LLM Providers] [Image Services] [Notifications]    │  ← Tabs per categoria
│                 [Payments]       [Other]             │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │  SiliconFlow                    [Default] ● ON  │ │  ← ServiceKeyCard
│ │  api-key • ••••••••a3f9c1b2    [Edit] [Delete]  │ │
│ │  Base URL: https://api.siliconflow.cn/v1         │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │  OpenRouter                     [Fallback] ● ON │ │
│ │  api-key • ••••••••b7e2f0c5    [Edit] [Delete]  │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │  LM Studio (local)              [Inactive] ● ON │ │
│ │  no-key-required • bypass       [Edit]           │ │
│ └─────────────────────────────────────────────────┘ │
│                                        [+ Add key]  │
└─────────────────────────────────────────────────────┘
```

### 11.3 Modal aggiunta/modifica chiave

Campi: Service (select da registro), Label, API Key (password input, placeholder "••••••••"), Base URL override (opzionale), Default (checkbox), Fallback (checkbox), Active (toggle).

**Regola UI:** L'API key è mostrata solo nel momento dell'inserimento. Dopo il salvataggio, l'input mostra solo `••••••••` + fingerprint ultimi 8 hex.

---

## 12. Piano di implementazione a wave

### Dipendenze

```
Wave 0 → nessuna dipendenza (fix standalone)
Wave 1 → Wave 0 completata
Wave 2 → Wave 1 completata
Wave 3 → Wave 1 + Wave 2 completati
Wave 4 → Wave 3 completata
Wave 5 → Wave 4 completata
Wave 6 → Wave 1 completata (può avanzare in parallelo a Wave 4-5)
```

---

### Wave 0 — Fix urgente prompt (no-infra, standalone)

**Obiettivo:** rimuovere il riferimento a `source.unsplash.com` (morto) e aggiungere LoremFlickr.  
**Impatto:** 1 file, ~20 righe, zero rischi di regressione.  
**Durata stimata:** 1 sessione.

**File da modificare:**

- `apps/api/src/application/use-cases/GetLlmPromptConfig.ts` — sezione `## IMAGES` nel `DEFAULT_PRE_PROMPT`

**Cambiamento:**

```
RIMUOVERE:
  ### Unsplash — high-quality topical photos
  URL pattern: https://source.unsplash.com/random/<W>x<H>?<keyword>   ← DEPRECATED
  
SOSTITUIRE CON:
  ### LoremFlickr — keyword-based contextual images (primary free source)
  URL pattern: https://loremflickr.com/<W>/<H>/<keyword>
  Multi-keyword: https://loremflickr.com/<W>/<H>/<keyword1>,<keyword2>
  Examples:
    Hero yoga:    <img src='https://loremflickr.com/1200/600/yoga,wellness' alt='yoga studio'>
    Food card:    <img src='https://loremflickr.com/400/300/food,organic' alt='product'>
    Tech hero:    <img src='https://loremflickr.com/1200/600/technology,office' alt='tech'>
    Avatar:       <img src='https://loremflickr.com/200/200/portrait,professional' alt='team'>
  Use 1-2 keywords derived from the page brief topic — not generic section names.
  No API key required. Returns semantically relevant photos from Flickr CC0.

MANTENERE (come secondo fallback):
  ### Lorem Picsum — deterministic fallback (use only if LoremFlickr unavailable)
  URL pattern: https://picsum.photos/seed/<word>/<W>/<H>
  Note: seed is a hash, not a semantic search. Use only for decorative/non-topic images.
```

---

### Wave 1 — Entity + Repository + Crittografia (backend core)

**Obiettivo:** fondamenta dati. Nessuna UI, nessun cambio al pipeline esistente.  
**Backward compatible:** sì, è tutto additive.

**File da creare:**

- `apps/api/src/domain/entities/ServiceApiKey.ts`
- `apps/api/src/domain/repositories/ServiceApiKeyRepository.ts`
- `apps/api/src/infra/crypto/serviceApiKeyCrypto.ts` — encrypt/decrypt/fingerprint con AES-256-GCM
- `apps/api/src/infra/repositories/MongoServiceApiKeyRepository.ts` — collection `service_api_keys`
- `apps/api/src/infra/adapters/ServiceApiKeyResolver.ts` — priority resolution (db → env → none)
- `packages/contracts/src/serviceApiKeys.ts` — DTO e Zod schemas
- `apps/api/src/application/use-cases/SeedServiceKeysFromEnv.ts` — migrazione non-destructiva

**File da modificare:**

- `apps/api/src/config.ts` — aggiungere variabili opzionali immagini (`PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `PIXABAY_API_KEY`) come optional nel Zod schema
- `apps/api/src/infra/db/mongooseSchemas.ts` (o equivalente) — aggiungere schema `service_api_keys`
- `apps/api/src/container.ts` (o bootstrap) — registrare i nuovi repository/adapter

**Test:**

- Unit test `serviceApiKeyCrypto.ts` — encrypt→decrypt roundtrip, fingerprint deterministico
- Unit test `SeedServiceKeysFromEnv` — verifica che non sovrascriva chiavi esistenti

---

### Wave 2 — Admin API routes

**Obiettivo:** CRUD backend per gestione chiavi da UI.

**File da creare:**

- `apps/api/src/application/use-cases/ManageServiceApiKeys.ts` — use-cases: create, update, delete, setDefault, setFallback
- `apps/api/src/presentation/http/routes/adminServiceKeyRoutes.ts`

**File da modificare:**

- `apps/api/src/presentation/http/routes/adminRoutes.ts` — mount dei nuovi route handler
- `packages/contracts/src/admin.ts` — import e re-export dei nuovi schema

**Deliverable:** endpoint `GET /admin/service-keys` funzionante e testabile con curl/Postman.

---

### Wave 3 — Image service connectors + fallback policy

**Obiettivo:** connettori concreti per i servizi immagine con fallback automatico.

**File da creare:**

- `apps/api/src/infra/adapters/imageServices/IImageService.ts`
- `apps/api/src/infra/adapters/imageServices/PexelsImageService.ts`
- `apps/api/src/infra/adapters/imageServices/UnsplashImageService.ts`
- `apps/api/src/infra/adapters/imageServices/PixabayImageService.ts`
- `apps/api/src/infra/adapters/imageServices/LoremFlickrImageService.ts` — no HTTP call, URL builder
- `apps/api/src/infra/adapters/imageServices/PicsumImageService.ts` — no HTTP call, URL builder
- `apps/api/src/infra/adapters/imageServices/ImageServiceRegistry.ts` — factory + fallback orchestrator

**Behavior fallback:**

```
resolve(keyword, w, h) {
  primary = resolver.resolveDefault("image")
  if (primary && primary.keyPolicy != "none" && !primary.apiKey) → skip to fallback
  try { result = await primary.getImageUrl(query, primary.apiKey); return result; }
  catch/non-200 → try fallback
  fallback = resolver.resolveFallback("image")
  return fallback.getImageUrl(query)  // LoremFlickr o Picsum — always succeeds
}
```

---

### Wave 4 — Iniezione dinamica nel prompt

**Obiettivo:** la sezione `## IMAGES` del pre-prompt riflette la configurazione DB effettiva.

**File da creare:**

- `apps/api/src/application/llm/buildImageSourcesBlock.ts`

**File da modificare:**

- `apps/api/src/application/use-cases/GetLlmPromptConfig.ts` — `DEFAULT_PRE_PROMPT` usa `{{IMAGE_SOURCES_BLOCK}}` come marker; la sostituzione avviene in `execute()`
- `apps/api/src/application/llm/systemPromptComposer.ts` — o alternativamente, la sostituzione avviene qui

**Note:** se il resolver DB non è disponibile (startup cold path), `buildImageSourcesBlock()` torna alla versione statica con LoremFlickr (Wave 0 output).

---

### Wave 5 — Admin UI tab "Integrations"

**Obiettivo:** gestione visuale delle API key per il superadmin.

**File da creare:**

- `apps/web/app/admin/integrations/page.tsx`
- `apps/web/components/admin/integrations/ServiceKeyCard.tsx`
- `apps/web/components/admin/integrations/ServiceKeyModal.tsx`
- `apps/web/components/admin/integrations/ServiceKeyCategoryTabs.tsx`
- `apps/web/lib/api/serviceKeys.ts` — client API hooks

**File da modificare:**

- `apps/web/app/admin/layout.tsx` — aggiungere voce "Integrations" alla nav
- `apps/web/lib/api/admin.ts` (o equivalente) — aggiungere chiamate al nuovo endpoint

**UI rules (da AGENTS.md):**

- Usare `Card`, `Button`, `Input`, `Badge`, `Dialog` da `@/components/ui/`
- Usare token semantici (`bg-card`, `text-muted-foreground`, `border-border`)
- No inline styles

---

### Wave 6 — LLM provider resolution via DB (parallelo a Wave 4-5)

**Obiettivo:** la risoluzione della API key LLM legge dal DB prima dell'env.  
**Questo completa il cerchio:** aggiungere una chiave SiliconFlow dall'admin UI → funziona immediatamente nella generazione.

**File da modificare:**

- `apps/api/src/infra/llm/` — ovunque si chiama `env.providerApiKeys[provider]`, sostituire con `ServiceApiKeyResolver.resolve(provider)` che applica la priorità db→env
- Retrocompatibilità: step 3 del resolver è sempre `env.providerApiKeys[provider]`, quindi i deploy env-only continuano a funzionare

---

## 13. Retrocompatibilità — garanzie

| Comportamento esistente | Impatto di questa milestone |
|-------------------------|----------------------------|
| API key solo in env | Continua a funzionare — step 3 del resolver |
| LLM generation con env key | Nessun cambiamento fino a Wave 6 |
| `DEFAULT_PRE_PROMPT` statico | Wave 0 fix, Wave 4 upgrade opzionale |
| `PlatformConfig` esistente | Non modificata — nuova collection separata |
| `LlmProviderCatalog` esistente | Non modificata — i provider mantengono la struttura attuale |
| Deploy senza DB delle service keys | Funziona — il resolver ha fallback env |
| Utenti senza BYOK | Non impattati — scope="user" non visibile nell'UI ancora |

---

## 14. Note di sicurezza

- **Mai loggare raw API key** — nemmeno in debug mode
- **Mai restituire `encryptedKey`** via API — solo `hasKey` + `keyFingerprint`
- **Rotazione chiave**: aggiorna il record con `rotateKey` — il vecchio encrypted value viene sovrascritto
- **Master key derivation** usa `JWT_ACCESS_SECRET` — se questo secret cambia, le chiavi in DB non sono più decriptabili: documentare questo rischio nella runbook
- **Audit log**: ogni create/update/delete logga userId + serviceId + timestamp (no key value)
- **Endpoint rate limit**: le route `/admin/service-keys` condividono il rate limit admin globale

---

## 15. Aggiornamenti documentazione richiesti

Al completamento di ogni wave:

- `docs/INDEX.md` — aggiungere riferimento a questo spec
- `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` — aggiungere sezione sulla collection `service_api_keys`
- `docs/runbooks/TESTABLE_STEPS.md` — aggiungere step di smoke test per il nuovo endpoint
- `.env.example` — aggiungere le variabili opzionali immagini commentate (Wave 1)
- `docs/agents/CODE_AGENT_INDEX.md` — aggiornare con nuovi file path di questa feature

---

## 16. Checklist deliverable per milestone chiusa

- [ ] Wave 0: `source.unsplash.com` rimosso, LoremFlickr aggiunto nel DEFAULT_PRE_PROMPT
- [ ] Wave 1: `ServiceApiKey` entity + repository + crypto + resolver funzionanti
- [ ] Wave 1: `SeedServiceKeysFromEnv` non-destructivo funzionante
- [ ] Wave 2: tutti gli endpoint admin CRUD funzionanti e testabili
- [ ] Wave 3: connettori immagine con fallback policy testati (primario non-200 → fallback)
- [ ] Wave 3: LoremFlickr e Picsum bypass no-key funzionante
- [ ] Wave 4: `buildImageSourcesBlock()` inietta sezione IMAGES dinamica nel pre-prompt
- [ ] Wave 5: tab "Integrations" visibile e funzionale per superadmin
- [ ] Wave 5: API key non visibile dopo salvataggio (solo fingerprint)
- [ ] Wave 6: LLM generation usa DB key se presente, env come fallback
- [ ] Tutti i deploy env-only continuano a funzionare senza modifiche
