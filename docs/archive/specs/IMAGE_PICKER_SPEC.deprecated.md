# DEPRECATED: Image Picker in Edit Mode

> Deprecated on 2026-05-29.  
> Superseded by `docs/specs/IMAGE_FETCH_PERSISTENCE_REFACTOR_PROPOSAL.md`.  
> Reason: this draft treated asset persistence as a manual save action after URL proposal. The current target architecture requires backend fetch + local asset persistence by default for every stock image resolution/regeneration, with explicit provider fallback policy and notifications.

---

# Legacy Spec: Image Picker in Edit Mode

**Status:** Draft — design only, not implemented  
**Scope:** Additive feature, zero refactoring of existing layers  
**Author:** System design session, May 2026

---

## 1. Problema

Le immagini generate dal pipeline LLM vengono risolte tramite API esterne (Pexels, Pixabay, Unsplash, LoremFlickr) nel momento della generazione. Questo produce due problemi:

1. **Variabilità non controllata**: LoremFlickr redirige a immagini diverse ad ogni caricamento. Pexels/Pixabay restituiscono URL stabili, ma l'utente non ha scelta su quale foto viene scelta.  
2. **Assenza di persistenza**: nessuna immagine viene salvata negli asset del progetto. Se cambia l'URL sorgente (CDN scaduto, URL modificato) la pagina si rompe.

## 2. Obiettivo

In **edit mode**, ogni elemento `<img>` nel preview iframe deve mostrare due micro-azioni:

| Icona | Azione |
|-------|--------|
| `↻` (refresh) | Interroga l'API per una proposta alternativa per la stessa query semantica |
| `✓` (save) | Scarica l'immagine corrente e la salva come asset del progetto; sostituisce l'URL nell'HTML con l'URL Minio |

Queste azioni operano sull'immagine **individualmente**, senza rigenerare l'intera pagina.

---

## 3. Architettura (layer per layer)

### 3.1 Infrastruttura esistente riutilizzata (non modificare)

| File | Cosa fornisce |
|------|---------------|
| `apps/web/app/workspace/[projectId]/iframe-scripts.ts` | `pf-inspect`, `pf-edit`, `applyMedia()`, `pf-edit-scan-media` |
| `apps/api/src/infra/image/ImageServiceOrchestrator.ts` | `resolveImage(params, keyOverrides)` — fallback chain |
| `apps/api/src/infra/image/*.ts` | Connettori Pexels, Pixabay, Unsplash, LoremFlickr |
| `apps/api/src/domain/repositories/ServiceApiKeyRepository.ts` | `findActiveByService()` — chiavi da MongoDB |
| Upload asset routes esistenti (`/v1/projects/:id/assets`) | Upload da URL o buffer |

### 3.2 Nuovi componenti (additive only)

```
API (apps/api/src/):
  presentation/http/routes/
    imagePickerRoutes.ts          ← NEW: 2 route endpoint
  application/use-cases/
    RefreshImageProposal.ts       ← NEW: chiama resolveImage con offset
    SaveImageFromUrl.ts           ← NEW: fetch + upload a Minio + return assetId

Web (apps/web/):
  app/workspace/[projectId]/
    iframe-scripts.ts             ← ADD: pf-img-overlay script block
  components/workspace/
    ImagePickerOverlay.tsx        ← NEW: React component floating overlay
  lib/api/
    imagePickerApi.ts             ← NEW: client API wrapper
```

---

## 4. API Endpoint

### `GET /v1/projects/:projectId/images/propose`

**Autenticazione:** JWT + project sandbox  
**Scopo:** Restituisce una nuova proposta immagine per una query semantica.

**Query params:**

| Param | Tipo | Required | Descrizione |
|-------|------|----------|-------------|
| `query` | `string` | ✓ | Keyword semantica (estratta dall'alt o dall'URL corrente) |
| `width` | `number` | | Default 800 |
| `height` | `number` | | Default 600 |
| `offset` | `number` | | Index di paginazione (0, 1, 2…) per scorrere risultati diversi |

**Response 200:**
```json
{
  "url": "https://images.pexels.com/photos/123456/…",
  "attribution": "Pexels — John Doe",
  "engine": "pexels",
  "width": 1200,
  "height": 600
}
```

**Use case `RefreshImageProposal`:**
- Risolve le chiavi dal `ServiceApiKeyRepository`
- Passa `perPage = offset + 1` a `searchPexels/Pixabay/Unsplash`, poi prende l'elemento `[offset]`
- LoremFlickr non supporta offset — aggiunge un seed numerico al keyword: `?lock=offset`

---

### `POST /v1/projects/:projectId/images/save-from-url`

**Autenticazione:** JWT + project sandbox  
**Scopo:** Scarica l'immagine da un URL esterno e la salva come asset Minio del progetto.

**Body:**
```json
{
  "url": "https://images.pexels.com/photos/123456/pexels-photo.jpeg",
  "alt": "modern office interior",
  "width": 1200,
  "height": 600,
  "attribution": "Pexels — John Doe"
}
```

**Response 201:**
```json
{
  "assetId": "64abc123def",
  "assetUrl": "http://localhost:4000/v1/assets/64abc123def/file",
  "mimeType": "image/jpeg",
  "bytes": 345678
}
```

**Use case `SaveImageFromUrl`:**
1. Valida URL (solo `https://`, no `data:`, no `file://`)
2. `fetch(url)` con timeout 10s, max 5MB
3. Valida `Content-Type` (solo `image/jpeg|png|webp|gif`)
4. Chiama il `StorageAdapter` (Minio) per upload buffer → genera `assetId`
5. Salva record in `ProjectAsset` collection con `{ source: "image-picker", attribution, originalUrl }`
6. Restituisce URL interno

**Sicurezza:**
- SSRF prevention: whitelist hostname pattern `*.pexels.com | *.pixabay.com | images.unsplash.com | *.flickr.com | live.staticflickr.com | *.loremflickr.com`
- Max size: 5MB (configurabile via `UPLOAD_MAX_SIZE_BYTES` esistente)
- Timeout: 10s

---

## 5. Script iframe — micro-overlay per le immagini

### Nuovo blocco `PF_IMG_PICKER_SCRIPT` in `iframe-scripts.ts`

**Attivato da:** messaggio `{ type: 'pf-img-picker', on: boolean }`  
**Non interferisce con:** `pf-inspect`, `pf-edit` — strati separati  

**Comportamento:**
1. Al mouseover su ogni `<img>`: inietta un `<div>` overlay posizionato `position:absolute` nell'angolo in basso a destra dell'immagine (`z-index: 2147483000`)
2. L'overlay contiene due bottoni: `↻` e `✓`
3. Click su `↻` → `postMessage({ type: 'pf-img-refresh', selector, query, width, height, currentOffset })` al parent
4. Click su `✓` → `postMessage({ type: 'pf-img-save', selector, src, alt, width, height })` al parent
5. L'overlay viene rimosso al mouseout (tranne se in stato `loading`)

**Estrazione query semantica:**
- Priority 1: `data-pf-query` attribute sull'elemento
- Priority 2: `alt` attribute (se ≥ 3 caratteri)
- Priority 3: parsing dell'URL corrente:
  - LoremFlickr: estrae `keyword` da `loremflickr.com/{W}/{H}/{keyword}`
  - Pexels: impossibile, usa `alt` o `"image"`
- Priority 4: fallback `"image"`

**Dimensioni:** lette da `img.naturalWidth/naturalHeight` o `img.getBoundingClientRect()`

---

## 6. Componente React — `ImagePickerOverlay.tsx`

**Posizione:** `apps/web/components/workspace/ImagePickerOverlay.tsx`  
**Montato in:** workspace page, affiancato al `GrapesJsEditorPanel` (non dentro)  
**Visibile:** solo quando `editMode === true`

### State locale del componente

```typescript
interface ImagePickerState {
  isActive: boolean;              // overlay attivo sull'iframe
  loading: { selector: string; action: 'refresh' | 'save' } | null;
  notification: { message: string; type: 'success' | 'error' } | null;
  offsets: Record<string, number>; // selector → offset corrente (per refresh ciclico)
}
```

### Gestione messaggi postMessage ricevuti dal iframe

| Messaggio tipo | Azione React |
|---|---|
| `pf-img-refresh` | chiama `GET /propose?query=...&offset=N`; invia `pf-apply-media` con nuovo URL al iframe |
| `pf-img-save` | chiama `POST /save-from-url`; invia `pf-edit-set-img-src` con URL Minio al iframe; aggiorna anche il DOM snapshot locale |

### UX di feedback

- Durante loading: bottone interessato mostra spinner inline (via messaggio al iframe `pf-img-picker-loading`)
- Successo: toast in basso a sinistra workspace `"Immagine salvata negli asset"` (3s)
- Errore: toast rosso `"Errore salvataggio: <msg>"` (5s)
- Dopo salvataggio: `✓` diventa verde per 2s poi torna normale

---

## 7. Integrazione nella workspace page

Nel file `apps/web/app/workspace/[projectId]/page.tsx` (modifiche additive minime):

```tsx
// Aggiungere nel blocco che gestisce i messaggi postMessage:
case 'pf-img-refresh': await handleImageRefresh(event.data); break;
case 'pf-img-save':    await handleImageSave(event.data);    break;

// Aggiungere nel blocco che attiva/disattiva edit mode:
iframe.contentWindow?.postMessage({ type: 'pf-img-picker', on: editMode }, '*');
```

**Nessuna modifica a `GrapesJsEditorPanel.tsx`.**

---

## 8. Client API — `imagePickerApi.ts`

```typescript
// apps/web/lib/api/imagePickerApi.ts

export interface ImageProposal {
  url: string;
  attribution: string;
  engine: string;
  width: number;
  height: number;
}

export interface SavedAsset {
  assetId: string;
  assetUrl: string;
  mimeType: string;
  bytes: number;
}

export async function proposeImage(
  projectId: string,
  query: string,
  width: number,
  height: number,
  offset: number,
): Promise<ImageProposal>

export async function saveImageFromUrl(
  projectId: string,
  url: string,
  alt: string,
  width: number,
  height: number,
  attribution: string,
): Promise<SavedAsset>
```

---

## 9. UX dei bottoni overlay (visual spec)

```
┌─────────────────────────────────────────┐
│                                         │
│           [img element]                 │
│                                         │
│                        ┌──────────────┐ │
│                        │  ↻   ✓       │ │  ← z-index: 2147483000
│                        └──────────────┘ │
└─────────────────────────────────────────┘
```

**Stile overlay** (iniettato inline nello script):
```css
position: absolute;
bottom: 6px;
right: 6px;
z-index: 2147483000;
display: flex;
gap: 4px;
padding: 3px 6px;
background: rgba(0,0,0,0.65);
backdrop-filter: blur(4px);
border-radius: 8px;
border: 1px solid rgba(255,255,255,0.15);
```

**Bottoni:**
```css
color: white;
font-size: 14px;
padding: 2px 6px;
border-radius: 5px;
cursor: pointer;
background: transparent;
border: none;
transition: background 0.15s;
/* hover: rgba(255,255,255,0.15) */
```

**⚠️ Il parent dell'img deve avere `position: relative`** — lo script lo imposta se non presente.

---

## 10. Testing provider alternativi (Pixabay, Unsplash)

### Test rapido da riga di comando

```bash
# Pixabay
node tests/test-image-connectors.mjs

# Forzare solo Pixabay (commentare Pexels nel test)
# Oppure:
node -e "
fetch('https://pixabay.com/api/?key=936076-b319fdcf3390e8bac99851969&q=office+modern&per_page=1&image_type=photo')
  .then(r=>r.json()).then(j=>console.log(j.hits?.[0]?.largeImageURL))
"

# Forzare solo Unsplash
node -e "
fetch('https://api.unsplash.com/search/photos?query=office&per_page=1', {
  headers: { Authorization: 'Client-ID l5vwF8Fsbi1XvQ219E3ZCUleZoRwmXsLfRuQYpSVzLI' }
}).then(r=>r.json()).then(j=>console.log(j.results?.[0]?.urls?.regular))
"
```

### Forzare provider specifico (dev only)

Aggiungere temporaneamente a `.env.docker` per disabilitare Pexels e testare il fallback:

```env
# Commenta PEXELS_API_KEY per forzare Pixabay come primo
# PEXELS_API_KEY=...
```

Poi `docker compose up -d --no-deps api`.

### Endpoint di diagnostica (da implementare insieme alla spec)

```
GET /v1/admin/service-keys/env-status
```

Già implementato (Wave 4) — restituisce `{ pexels: true, pixabay: true, unsplash: true, ... }`.

---

## 11. Dipendenze e prerequisiti

| Prerequisito | Stato |
|---|---|
| `resolveImage()` con `keyOverrides` | ✅ Implementato |
| `resolveImagesInHtml()` pipeline hook | ✅ Implementato |
| `ServiceApiKeyRepository.findActiveByService()` | ✅ Implementato |
| `StorageAdapter` / Minio upload | ✅ Esistente |
| iframe `postMessage` infrastruttura | ✅ Esistente (`pf-edit`, `pf-apply-media`) |
| `applyMedia()` nel iframe script | ✅ Esistente |
| `pf-edit-set-img-src` handler nel iframe | ✅ Esistente |
| `/v1/projects/:id/assets` upload route | ✅ Esistente |

**Nessun nuovo pacchetto npm richiesto.**

---

## 12. Scope fuori da questa spec

- Galleria multi-risultato (carousel di più proposte): out of scope, il `↻` cicla linearmente via `offset`
- Ricerca libera per keyword diversa: out of scope, usa sempre la query estratta dall'immagine
- Video: out of scope per ora, solo `<img>`
- Background CSS image (`background-image`): out of scope v1 (il framework esistente `applyMedia` già lo supporta ma richiederebbe detection aggiuntiva)
