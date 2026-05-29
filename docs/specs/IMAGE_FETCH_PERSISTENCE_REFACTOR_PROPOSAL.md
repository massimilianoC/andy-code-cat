# Image Fetch Persistence Refactor Proposal

> ⚠️ DEPRECATED / HISTORICAL (2026-05-29): original Wave-1 analysis. The active implementation
> target is **`docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md`**, which supersedes this proposal.
> For current behavior + gap backlog see the orchestrator spec and
> `docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md`. Kept only as historical context.

> Status: DEPRECATED — historical Wave-1 analysis (superseded by ARTIFACT_MEDIA_ORCHESTRATOR_SPEC)  
> Data: 2026-05-29  
> Scope: immagini stock/placeholder risolte via servizi esterni, persistenza asset, rigenerazione in Edit mode, fallback observability  
> Non scope: modifica immediata del codice applicativo

> Implementation note, 2026-05-29: Wave 1/2/4 foundations have been implemented in code. The active backend path now supports traced provider resolution, backend download, persisted `platform_generated` assets, LLM HTML replacement with internal `/p/media/:assetId` URLs, provider status, and Edit-mode stock regeneration through the existing media inspector. Persistent backend notification storage remains a follow-up; current implementation logs fallback/persistence failures through `ExecutionLogger` and surfaces manual Edit-mode errors through the existing frontend notification panel.

---

## 1. Sintesi

La gestione immagini oggi usa due famiglie di flussi diverse:

1. immagini stock/placeholder generate nell'HTML dal LLM e risolte da `resolveImagesInHtml()`;
2. immagini AI generate dall'endpoint `POST /v1/projects/:projectId/assets/generate-image`.

Il secondo flusso e gia' orientato correttamente alla persistenza: crea un asset `platform_generated`, applica un placeholder, salva il file finale e aggiorna lo snapshot quando la generazione e' pronta.

Il primo flusso e' il punto critico: risolve URL esterni come Pexels, Pixabay, Unsplash, LoremFlickr o Picsum e li lascia nell'HTML come URL remoti. Questo crea instabilita', poca governabilita' e risultati non riproducibili, soprattutto quando il fallback arriva a LoremFlickr.

La direzione consigliata e':

- trattare ogni immagine stock risolta da provider come un asset di progetto;
- scaricarla lato backend in storage locale/MinIO;
- sostituire nell'HTML l'URL remoto con l'URL asset interno;
- rendere il fallback configurabile e osservabile;
- notificare errori e fallback degradati nel sistema notifiche e nella dashboard superadmin;
- aggiungere in Edit mode un'azione esplicita di rigenerazione/nuova proposta immagine, senza rigenerare automaticamente a ogni refresh.

---

## 2. Stato Attuale Verificato

### 2.1 Provider stock/placeholder

File principali:

- `apps/api/src/application/llm/imageUrlRewriter.ts`
- `apps/api/src/infra/image/ImageServiceOrchestrator.ts`
- `apps/api/src/infra/image/PexelsConnector.ts`
- `apps/api/src/infra/image/PixabayConnector.ts`
- `apps/api/src/infra/image/UnsplashConnector.ts`
- `apps/api/src/infra/image/LoremFlickrConnector.ts`
- `apps/api/src/domain/entities/ServiceApiKey.ts`
- `apps/api/src/infra/repositories/MongoServiceApiKeyRepository.ts`

`resolveImagesInHtml(html, keyRepo?)` intercetta solo:

- `https://loremflickr.com/{width}/{height}/{keyword}`
- `https://picsum.photos/seed/{keyword}/{width}/{height}`

Per ogni placeholder estrae keyword e dimensioni, poi chiama `resolveImage()`.

`resolveImage()` usa una catena fissa:

1. Pexels, se esiste chiave;
2. Pixabay, se esiste chiave e non e' video;
3. Unsplash, se esiste chiave e non e' video;
4. LoremFlickr, sempre disponibile per photo;
5. Picsum, come ultima risorsa deterministica non semantica.

Le chiavi sono risolte in ordine:

1. `ServiceApiKeyRepository.findActiveByService()`, quando passato;
2. env vars `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`;
3. provider no-key.

### 2.2 Prompt HTML

`apps/api/src/application/use-cases/GetLlmPromptConfig.ts` contiene gia' regole che indicano LoremFlickr come sorgente semantica e Picsum come fallback deterministico. Il riferimento a `source.unsplash.com` e' esplicitamente vietato perche' deprecato.

Questa impostazione pero' spinge ancora il LLM a produrre URL placeholder esterni. Anche se il backend li riscrive, il risultato finale resta un URL esterno e non un asset locale.

### 2.3 Persistenza asset esistente

Il framework asset esistente e' gia' adeguato:

- `ProjectAsset` supporta `source: "platform_generated"`;
- `SavePlatformAsset` salva buffer in storage e crea record asset;
- `StorageFactory` seleziona local/MinIO;
- `projectAssetRoutes` espone upload, listing, download, URL reference e generate-image;
- `getPublicAssetUrl(assetId)` lato web consente di usare un URL media interno.

Quindi non serve introdurre un sistema media parallelo.

### 2.4 Generazione immagini AI

`GenerateProjectImage`:

- crea subito un asset placeholder SVG;
- salva `generationStatus: "queued"`;
- genera asincronamente via SiliconFlow se disponibile;
- in caso di fallback locale salva SVG placeholder;
- in caso di errore imposta `generationStatus: "failed"`;
- emette `ExecutionLogger` con `image_generation_completed` o `image_generation_failed`;
- il frontend usa `useNotifications()` per mostrare avanzamento, errori e completamento.

Questo flusso e' coerente con l'obiettivo di persistenza. Va riusato come modello concettuale anche per le immagini stock.

### 2.5 Notifiche

Il frontend ha gia':

- `apps/web/lib/notifications.tsx`
- `apps/web/components/NotificationPanel.tsx`
- `useNotifications()` nella workspace

Oggi le notifiche sono client-local: non esiste ancora un canale persistente server -> UI per eventi operativi come fallback provider o errore risoluzione stock image.

Il backend ha `ExecutionLogger`, ma non un motore notifiche persistente leggibile dal pannello in alto a destra.

---

## 3. Criticita'

### 3.1 Fallback non governabile

La catena provider e' hardcoded. Il superadmin puo' salvare chiavi, ma non risulta un vero controllo operativo su:

- provider stock predefinito;
- fallback abilitato/disabilitato;
- comportamento `fail-fast` vs `fallback`;
- severita' del fallback;
- notifica obbligatoria quando si degrada a LoremFlickr o Picsum.

Risultato: in produzione si puo' finire su LoremFlickr senza che l'operatore lo sappia.

### 3.2 Fallback silenzioso

I connector ritornano `null` su non-200 e `resolveImage()` cattura gli errori senza propagare dettagli. `imageUrlRewriter` al massimo scrive `console.info` o `console.warn`.

Manca una traccia strutturata con:

- provider tentati;
- motivo fallimento;
- provider finale usato;
- se il risultato e' degraded;
- correlazione con projectId/userId/snapshot/conversation.

### 3.3 Inconsistenza visiva a ogni refresh

LoremFlickr produce URL semantici ma non un'immagine stabile. Un URL come:

```text
https://loremflickr.com/1200/600/office
```

puo' restituire immagini diverse su refresh successivi.

Se l'HTML contiene ancora URL LoremFlickr, la preview e il sito pubblicato non sono riproducibili.

### 3.4 Nessuna acquisizione locale per stock image

`resolveImagesInHtml()` sostituisce placeholder con un URL provider, ma non scarica il file e non crea un `ProjectAsset`.

Conseguenze:

- CDN o provider esterno possono cambiare o rompere URL;
- licenza/attribution non e' tracciata come metadata asset;
- non c'e' storico di immagini proposte;
- non si puo' tornare facilmente a una immagine precedente;
- l'archivio progetto non si arricchisce.

### 3.5 Edit mode senza rigenerazione esplicita completa

La workspace ha gia' selezione media in Edit mode e generazione AI tramite pannello media, ma manca un controllo specifico sopra l'immagine per:

- chiedere "scarica un'altra immagine dal provider stock attivo";
- vedere quale provider stock e' attivo;
- salvare la nuova immagine come asset;
- applicarla al solo elemento selezionato senza rigenerare la pagina.

La precedente spec `docs/archive/specs/IMAGE_PICKER_SPEC.deprecated.md` descriveva una parte di questa direzione, ma e' stata deprecata perche' la persistenza deve essere default, non solo azione manuale "save".

---

## 4. Decisioni Proposte

### 4.1 Nessun URL stock esterno persistente nell'HTML finale

Ogni immagine risolta da provider stock deve diventare un asset interno.

Regola:

```text
Provider URL -> backend fetch controllato -> SavePlatformAsset -> HTML usa /p/media/:assetId o URL asset equivalente
```

Eccezione ammessa solo per errore degradato esplicito in sviluppo, mai come comportamento silenzioso in produzione.

### 4.2 Provider policy configurabile

Introdurre una policy runtime, gestita da superadmin:

```ts
interface ImageProviderPolicy {
  defaultProvider: "pexels" | "pixabay" | "unsplash" | "loremflickr" | "picsum";
  fallbackMode: "disabled" | "notify" | "silent";
  fallbackProviders: string[];
  failOnProviderError: boolean;
  persistResolvedImages: boolean;
  notifyOnFallback: boolean;
  notifyOnPersistenceFailure: boolean;
}
```

Default consigliato per produzione:

```text
defaultProvider = pexels
fallbackMode = notify
fallbackProviders = pixabay, unsplash
failOnProviderError = true se nessun fallback configurato
persistResolvedImages = true
notifyOnFallback = true
notifyOnPersistenceFailure = true
```

LoremFlickr e Picsum devono essere fallback espliciti, non fallback nascosti.

### 4.3 Fail-fast preferito quando non configurato

Se il provider configurato non ha chiave valida o fallisce:

- se fallback e' disabilitato: errore esplicito;
- se fallback e' abilitato: usa fallback ma crea evento `image_provider_fallback`;
- se si arriva a LoremFlickr/Picsum: evento di severita' almeno `warning`.

Questo soddisfa il requisito: meglio un errore visibile che un fallback non dichiarato.

### 4.4 Persistenza come parte del resolver

`resolveImagesInHtml()` dovrebbe evolvere in un use-case applicativo, non restare una funzione stateless che riscrive stringhe.

Nuovo use-case proposto:

```text
ResolveAndPersistHtmlImages
```

Input:

```ts
{
  projectId: string;
  userId: string;
  html: string;
  sourceContext: {
    conversationId?: string;
    snapshotId?: string;
    route: "chat-preview" | "stream" | "edit-regenerate" | "publish";
  };
}
```

Output:

```ts
{
  html: string;
  assets: ProjectAsset[];
  events: ImageResolutionEvent[];
}
```

Responsabilita':

1. estrarre placeholder e URL stock esterni rilevanti;
2. risolvere provider secondo policy;
3. scaricare l'immagine scelta;
4. validare MIME, dimensione, host e timeout;
5. salvare con `SavePlatformAsset`;
6. aggiornare `ProjectAsset.generationMetadata`;
7. sostituire l'HTML con URL interno;
8. emettere log/notifiche su fallback o errori.

### 4.5 Metadata asset per immagini stock

Estendere `AssetGenerationMetadata` o usare `providerResponse` in modo strutturato:

```ts
generationMetadata: {
  provider: "pexels",
  model: "stock-search",
  requestedAt,
  completedAt,
  finishReason: "stock-image-persisted",
  sourceUrl: "https://images.pexels.com/...",
  width,
  height,
  outputMimeType: "image/jpeg",
  providerResponse: {
    query: "office",
    attribution: "Pexels - Author Name",
    fallbackUsed: false,
    attemptedProviders: [
      { provider: "pexels", status: "success" }
    ],
    licenseHint: "provider-attribution"
  }
}
```

Per fallback:

```ts
providerResponse: {
  query: "office",
  fallbackUsed: true,
  fallbackFrom: "pexels",
  fallbackTo: "pixabay",
  attemptedProviders: [
    { provider: "pexels", status: "failed", reason: "401" },
    { provider: "pixabay", status: "success" }
  ]
}
```

### 4.6 Rigenerazione in Edit mode

In Edit mode, per ogni immagine selezionata:

- mostrare una micro-azione "Regenerate stock image";
- usare il provider stock attivo configurato dal superadmin;
- mostrare nel popup/pannello il provider attivo, esempio `Provider stock attivo: Pexels`;
- inviare query, dimensioni e asset corrente al backend;
- il backend scarica e salva una nuova immagine come nuovo asset;
- il frontend applica il nuovo URL interno all'elemento;
- lo snapshot viene salvato con metadati `finishReason: "stock-image-regenerated"`.

La rigenerazione non deve modificare l'immagine a ogni refresh. Deve avvenire solo su comando utente o pipeline esplicita.

---

## 5. Architettura Target

### 5.1 Backend

Nuovi/modificati componenti consigliati:

```text
apps/api/src/domain/entities/
  ImageProviderPolicy.ts
  SystemNotification.ts

apps/api/src/domain/repositories/
  ImageProviderPolicyRepository.ts
  SystemNotificationRepository.ts

apps/api/src/application/use-cases/
  ResolveAndPersistHtmlImages.ts
  RegenerateStockProjectImage.ts
  DownloadExternalImageAsProjectAsset.ts
  EmitSystemNotification.ts

apps/api/src/infra/image/
  ImageProviderRegistry.ts
  ImageProviderPolicyResolver.ts
  ExternalImageDownloader.ts

apps/api/src/presentation/http/routes/
  projectImageRoutes.ts
  notificationRoutes.ts
```

Note architetturali:

- le route non devono accedere direttamente a MongoDB;
- ogni operazione mutabile deve passare da JWT + project sandbox;
- il download esterno e' infrastruttura, ma la decisione di persistenza e policy resta nell'application layer;
- `SavePlatformAsset` va riusato, non duplicato.

### 5.2 API proposte

#### Risoluzione/persistenza interna

Non necessariamente endpoint pubblico. Da usare da `llmRoutes`.

```ts
ResolveAndPersistHtmlImages.execute({
  projectId,
  userId,
  html,
  sourceContext
})
```

#### Rigenerazione stock immagine

```http
POST /v1/projects/:projectId/images/regenerate-stock
```

Body:

```json
{
  "query": "modern office",
  "width": 1200,
  "height": 600,
  "targetSelector": "[data-pf-id='hero-img']",
  "currentAssetId": "optional",
  "provider": "default"
}
```

Response:

```json
{
  "asset": { "...": "ProjectAssetDto" },
  "assetUrl": "/p/media/<assetId>",
  "provider": "pexels",
  "fallbackUsed": false,
  "attribution": "Pexels - Author"
}
```

#### Provider status/config per UI

```http
GET /v1/projects/:projectId/images/provider-status
```

Response:

```json
{
  "activeProvider": "pexels",
  "fallbackMode": "notify",
  "fallbackProviders": ["pixabay", "unsplash"],
  "persistenceEnabled": true
}
```

#### Notifiche sistema

```http
GET /v1/notifications
PATCH /v1/notifications/:id/read
```

Per superadmin:

```http
GET /v1/admin/notifications?severity=warning&domain=image
```

### 5.3 Frontend

Componenti/aree:

- workspace image generation popup/panel: mostra provider stock attivo;
- Edit mode image overlay: pulsante rigenera stock;
- `NotificationPanel`: integra notifiche persistenti dal backend oltre a quelle client-local;
- superadmin dashboard: card o tab per eventi provider immagini.

Regole UI da rispettare:

- usare `Button`, `Input`, `Label`, `Card`, `Badge`, `Dialog`;
- usare icone `lucide-react`;
- niente raw `<button>`, `<input>`, `<label>` in nuovi componenti;
- niente inline style in nuovo codice.

---

## 6. Sicurezza Download Esterno

Il download immagini deve essere backend-only e controllato.

Controlli minimi:

- solo `https://`;
- blocco `file:`, `data:`, `ftp:`, IP privati e localhost;
- allowlist host per provider supportati;
- timeout 10 secondi;
- max size da `UPLOAD_MAX_SIZE_BYTES` o limite piu' basso per stock image;
- MIME consentiti: `image/jpeg`, `image/png`, `image/webp`, eventualmente `image/gif`;
- content sniffing minimo, non fidarsi solo dell'header;
- redirect limitato e rieseguito con allowlist;
- niente log di API key.

---

## 7. Observability e Notifiche

### 7.1 Eventi ExecutionLogger

Nuovi event type:

```text
image_provider_resolution_started
image_provider_resolution_completed
image_provider_resolution_failed
image_provider_fallback_used
image_provider_persistence_failed
stock_image_regenerated
```

Metadata richiesti:

```ts
{
  projectId,
  assetId,
  query,
  requestedProvider,
  finalProvider,
  fallbackUsed,
  attemptedProviders,
  sourceContext,
  latencyMs,
  error
}
```

### 7.2 SystemNotification persistente

Proposta entity:

```ts
interface SystemNotification {
  id: string;
  userId?: string;
  projectId?: string;
  audience: "user" | "superadmin" | "both";
  domain: "image" | "llm" | "export" | "publish" | "system";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  status: "unread" | "read";
  sourceEventType: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  readAt?: Date;
}
```

Regole:

- fallback a LoremFlickr/Picsum in produzione: `warning`;
- provider configurato fallito senza fallback: `error`;
- download/persistenza fallita: `error`;
- fallback a provider configurato secondario: `warning` o `info` in base alla policy.

### 7.3 UX pannello notifiche

Nel pannello in alto a destra:

- mostrare errori provider immagine;
- mostrare fallback usato con provider finale;
- linkare asset/progetto se disponibile;
- mantenere le notifiche client-local per task in corso;
- aggiungere polling leggero o endpoint refresh per notifiche persistenti.

---

## 8. Stato Documentale Consolidato

### 8.1 Spec attiva

Questa e' la fonte attiva per:

- provider stock/placeholder;
- policy default/fallback;
- fail-fast vs fallback notify;
- backend fetch e persistenza locale;
- notifiche su fallback/errori;
- rigenerazione stock in Edit mode;
- integrazione con media asset di progetto.

### 8.2 Spec deprecate e archiviate

| Documento archiviato | Motivo |
|---|---|
| `docs/archive/specs/IMAGE_PICKER_SPEC.deprecated.md` | Trattava la persistenza come azione manuale successiva alla proposta URL. La nuova policy richiede persistenza backend di default. |
| `docs/archive/specs/EXTERNAL_API_KEYS_PLATFORM_SPEC.deprecated.md` | Mescolava gestione generale API key e fallback immagini permissivo. Resta storico per idee BYOK/crypto, ma non governa piu' la pipeline immagini. |

### 8.3 Spec complementare ancora valida

`docs/specs/IMAGE_PROMPTING_PIPELINE_SPEC.md` resta valida solo per immagini generate da modello AI: prompt enrichment, optimizer, trace e coerenza visuale. Non governa provider stock come Pexels/Pixabay/Unsplash/LoremFlickr.

---

## 9. Piano di Implementazione

### Wave 0 - Consolidamento decisione e test di regressione

Obiettivo: nessun cambio runtime, solo preparazione.

- Approvare questa proposta.
- Mantenere archiviate le spec legacy deprecate.
- Aggiungere test unitari attorno a `imageUrlRewriter` per fotografare comportamento attuale.
- Definire policy desiderata per produzione: fail-fast o fallback notify.

### Wave 1 - Provider policy e tracciamento fallback

Obiettivo: rendere visibile il problema senza ancora cambiare HTML finale.

- Introdurre `ImageProviderPolicyResolver`.
- Sostituire catena hardcoded con provider order da policy.
- Far ritornare da `resolveImage()` un trace completo, non solo URL.
- Emettere `ExecutionLogger` per fallback e fallimenti.
- Se fallback disabilitato, propagare errore esplicito.

### Wave 2 - Download e persistenza stock image

Obiettivo: eliminare URL stock esterni dal risultato persistito.

- Creare `ExternalImageDownloader`.
- Creare `DownloadExternalImageAsProjectAsset`.
- Creare `ResolveAndPersistHtmlImages`.
- Sostituire in `llmRoutes` le chiamate a `resolveImagesInHtml()` con il nuovo use-case.
- Salvare attribution/sourceUrl nei metadata asset.
- Sostituire HTML con URL asset interno.

### Wave 3 - Notifiche persistenti

Obiettivo: notificare all'utente e al superadmin.

- Introdurre `SystemNotification` e repository.
- Creare use-case `EmitSystemNotification`.
- Aggiungere endpoint lettura notifiche.
- Integrare `NotificationPanel` con notifiche backend.
- Aggiungere filtro superadmin per domain `image`.

### Wave 4 - Rigenerazione stock in Edit mode

Obiettivo: controllo manuale sull'immagine selezionata.

- Aggiungere endpoint `POST /v1/projects/:projectId/images/regenerate-stock`.
- Aggiungere client API web.
- Aggiungere pulsante overlay in Edit mode.
- Mostrare provider attivo nella popup/pannello media.
- Applicare nuovo asset al DOM e salvare snapshot.
- Aggiungere storico asset generati nel media library.

### Wave 5 - Superadmin provider governance

Obiettivo: configurazione completa da dashboard.

- UI per provider stock default/fallback.
- Toggle fallback mode.
- Stato chiavi e test provider.
- Vista errori/fallback recenti.
- Documentare procedura operativa in runbook.

---

## 10. Test Minimi

Backend:

- `resolveImage` rispetta provider order configurato.
- fallback disabled produce errore.
- fallback notify produce event + risultato.
- downloader blocca host non consentiti e URL non HTTPS.
- immagine Pexels/Pixabay viene salvata come `platform_generated`.
- HTML finale non contiene `loremflickr.com`, `picsum.photos`, `pexels.com`, `pixabay.com`, `unsplash.com` quando persistenza e' attiva.
- double sandbox su rigenerazione stock.

Frontend:

- pannello media mostra provider attivo.
- rigenerazione immagine selezionata crea notifica running/done/error.
- errore fallback appare nel `NotificationPanel`.
- snapshot Edit mode usa asset URL interno.

Smoke test:

- progetto nuovo con chiave Pexels valida: placeholder -> asset interno.
- chiave Pexels invalida + fallback Pixabay: notifica warning, asset interno Pixabay.
- fallback disabilitato + chiave invalida: errore visibile, nessun LoremFlickr silenzioso.
- refresh preview/sito pubblicato: stessa immagine, perche' URL interno persistito.

---

## 11. Rischi e Scelte Aperte

1. Quota provider e costi  
   Persistendo immagini al momento della generazione si consumano chiamate provider subito. Serve rate limiting e retry controllato.

2. Licenze e attribution  
   Ogni provider ha regole diverse. Salvare attribution nei metadata e renderla consultabile e' necessario.

3. Storage growth  
   Ogni rigenerazione arricchisce l'archivio. Serve policy futura di cleanup o quota per asset `platform_generated`.

4. Migrazione contenuti esistenti  
   Snapshot gia' salvati con URL esterni resteranno instabili finche' non si introduce un comando di backfill.

5. Notifiche persistenti  
   Il pannello notifiche oggi e' client-local. L'integrazione backend va progettata senza rompere export/publish/image generation gia' funzionanti.

6. Provider "active"  
   L'entita' `ServiceApiKey` attuale ha `isDefault`, ma non una policy fallback completa. Si puo' evolvere senza sostituire subito la collection.

---

## 12. Raccomandazione Finale

La priorita' non e' aggiungere un altro provider, ma cambiare il contratto del flusso stock image:

```text
la generazione/risoluzione produce asset persistenti, non URL remoti casuali
```

La sequenza consigliata e':

1. policy provider + trace fallback;
2. persistenza obbligatoria delle immagini risolte;
3. notifiche persistenti per fallback/errori;
4. rigenerazione manuale in Edit mode;
5. dashboard superadmin per governance completa.

Questo riduce l'inconsistenza di LoremFlickr, rende gli errori visibili, conserva lo storico delle immagini e usa il framework asset gia' presente invece di introdurre un sistema parallelo.
