# Zero Effort — Evoluzione Media, Feedback Visivo e Generazione Asincrona

> Status: proposta operativa  
> Data: 2026-04-22  
> Scope: modalità Zero Effort + generalizzazione media management cross-modale + async job con notifiche + auto-publish preview e deeplink landing  
> Audience: maintainer, agenti di implementazione, operatori

---

## 1. Contesto e motivazione

La modalità Zero Effort esiste già con un wizard a 3 step, ottimizzazione del prompt e generazione SSE.
Tuttavia presenta quattro criticità strutturali:

1. **Nessun feedback visivo durante la generazione**: il flusso SSE è attivo ma l'UI non mostra lo stream di thinking/risposta come fa la workspace. L'ottimizzazione del prompt non ha nemmeno il contatore token.

2. **Nessun caricamento di media**: a differenza della workspace (GodMode) non è possibile caricare immagini, loghi o materiali visivi nel progetto prima della generazione. Questo impoverisce il prompt e impedisce al sistema di sapere dove posizionare immagini reali.

3. **Nessuna gestione asincrona**: la generazione è sincrona (SSE con timeout 20 min). Se l'utente chiude la tab, il lavoro è perso. Non esiste un meccanismo "torna più tardi" né notifiche via mail o Telegram.

4. **Nessuna pubblicazione automatica del risultato**: quando la generazione termina, il sito non è immediatamente accessibile via link pubblico. L'utente deve aprire manualmente la workspace e attivare la pubblicazione. Questo rompe il loop zero-effort: generare → link condivisibile → iterare.

Questo documento analizza ogni gap, stabilisce la fattibilità, definisce le onde di implementazione e propone l'architettura unificata.

---

## 2. Analisi dello stato attuale

### 2.1 Cosa esiste già (punti di forza)

| Componente | Stato |
|---|---|
| SSE streaming in zero-effort (`streamLlmChatPreview`) | Attivo — `genStreamTokens` già aggiornato in stato |
| Variante streaming dell'ottimizzazione (`/llm/optimize-prompt/stream`) | Endpoint backend già implementato |
| Upload asset (`POST /v1/projects/:projectId/assets`) | Completo con quota, MIME check, storage adapter |
| Entity `ProjectAsset` con `styleRole`, `descriptionText`, `useInProject` | Presente — campo `descriptionText` già libero |
| `systemPromptComposer` con layer A–E | Estendibile senza breaking change |
| `ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md` | Piano già scritto — Layer F è già pensato |
| Adapter storage locale + MinIO | Pronto |
| Frontend notification system (`useNotifications`) | React context già globale |
| MongoDB come unico datastore | Coerente — nessun Redis richiesto |

### 2.2 Cosa manca (gap)

| Gap | Impatto |
|---|---|
| UI zero-effort non mostra thinking/answer stream | Esperienza povera durante la generazione |
| Ottimizzazione senza streaming e senza contatore token | Attesa opaca |
| Nessuno step di caricamento media nel wizard | Prompt privo di riferimenti visivi reali |
| `ProjectAsset` manca di campo `usageHint` semantico | Non si può indicare "logo → header/footer" |
| Nessun URL pubblico per gli asset | Non iniettabile nel prompt LLM come riferimento |
| Nessun Layer F (media context block) nel system prompt | Il LLM non sa che esistono le immagini |
| Nessun job DB-backed per tracciare la generazione | Nessun "torna più tardi" |
| Nessun email sender (Nodemailer o equivalente) | Notifica al completamento impossibile |
| Nessun Telegram bot | Notifica alternativa assente |
| Nessuna pubblicazione automatica al termine della generazione | Il sito generato non è subito condivisibile — l'utente deve entrare in workspace e pubblicare manualmente |
| Nessuna pagina di atterraggio deeplink | Il link inviato via email porta direttamente al workspace, non a una preview pulita con scelta guidata |

---

## 3. Cosa è fattibile e cosa no

### Fattibile con impatto basso–medio

| Feature | Note |
|---|---|
| Streaming visivo in zero-effort | Solo frontend — riuso component già presenti in workspace |
| Ottimizzazione con streaming + token counter | Già esiste `/llm/optimize-prompt/stream`, manca il wiring UI |
| Step 4 drag-and-drop upload | Frontend nuovo + riuso endpoint upload già esistente |
| Campo `usageHint` su `ProjectAsset` | Aggiunta additive a entity + Mongo — nessuna migrazione distruttiva |
| Layer F nel system prompt | Additive — layer vuoto = nessun effetto |
| URL pubblici firmati per asset | Nuovo endpoint con signed token JWT breve durata — sicuro |
| Generalizzazione media context su tutte le modalità | Layer F aggiunto una volta in `composeSystemPrompt` |
| MongoDB-backed job tracking (async job) | Nuova collection semplice — nessuna dipendenza da Redis o Bull |
| Frontend polling + "torna più tardi" | Pattern semplice — polling su `/v1/jobs/:jobId` |
| Email via Nodemailer + SMTP config | Dipendenza semplice, configurabile via env |
| Auto-publish al completamento (path UUID) | Riusa `PublishProject` già spec'd in `UX_REVIEW_AND_PUBLISH_SPEC.md` — aggiunta di `source` e `ttlDays` |
| Pagina deeplink `/preview/[publishId]` | Nuova route Next.js pubblica, nessuna dipendenza backend nuova |

### Fattibile con impatto medio-alto (Wave 4+)

| Feature | Note |
|---|---|
| Telegram bot | Richiede `node-telegram-bot-api` + bot token + webhook o polling — separabile |
| Preferenze notifiche per utente | Schema `UserNotificationPrefs` aggiuntivo |
| Selezione modello async separata | Potrebbe usare modello più lento/economico di notte |

### Non fattibile o non raccomandato ora

| Feature | Motivazione |
|---|---|
| URL permanentemente pubblici per gli asset | Conflitto con doppio sandbox e isolamento tenant — usare signed token |
| Base64 inline di immagini nel prompt | Token cost esplosivo per immagini ad alta risoluzione |
| Queue esterna (BullMQ/Redis) | Eccessiva complessità infrastrutturale — MongoDB job è sufficiente per MVP |
| WebSocket bidirezionale per job status | SSE esistente è sufficiente; aggiungere WS richiederebbe upgrade infrastruttura |

---

## 4. Architettura proposta

### 4.1 Campo `usageHint` su `ProjectAsset`

Aggiunta additive all'entity esistente:

```typescript
// apps/api/src/domain/entities/ProjectAsset.ts
usageHint?: string;
// Es: "logo del brand — inserire in header e footer"
// Es: "foto hero principale — sezione above the fold"
// Es: "immagine prodotto — galleria e card prodotto"
```

Il campo è libero ma il sistema ne suggerisce il valore all'upload tramite auto-classify (già presente con `MEDIA_AUTO_CLASSIFY_UPLOADS`) o tramite input utente esplicito.

### 4.2 URL pubblici con firma JWT (breve durata)

Nuovo endpoint:

```
GET /v1/projects/:projectId/assets/:assetId/signed-url
```

Restituisce:

```json
{
  "url": "https://app.example.com/public/assets/:assetId?token=<jwt>",
  "expiresAt": "2026-04-22T13:00:00Z"
}
```

Il token JWT è firmato con `ASSET_SIGNING_SECRET` (env), dura 2 ore (configurabile), include `{ assetId, projectId, userId }`.

Endpoint pubblico (no auth header):

```
GET /public/assets/:assetId?token=<jwt>
```

Verifica il JWT, serve il file. Nessuna autenticazione Bearer richiesta — token è l'autenticazione.

Sicurezza: token è monouso per IP? No per MVP. Scadenza breve è la guardrail principale.

### 4.3 Layer F — Media Context Block nel system prompt

Nuovo layer additive in `composeSystemPrompt`:

```typescript
// apps/api/src/application/llm/systemPromptComposer.ts
export function composeSystemPrompt(opts: {
  // ... esistente
  mediaContextBlock?: string; // NUOVO Layer F
}): string {
  return [
    buildBaseConstraintsLayer(),
    opts.presetLayer ?? buildPresetLayer(opts.presetId),
    opts.styleBlock ?? "",
    opts.prePromptTemplate ?? "",
    opts.governanceSystemPrompt ?? "",
    opts.mediaContextBlock ?? "",  // inserito dopo governance, prima di budget
    opts.outputBudgetPolicy ?? "",
    opts.requestSystemPrompt ?? "",
  ]
    .filter(Boolean)
    .join(LAYER_SEPARATOR)
    .trim();
}
```

Il block viene costruito da:

```typescript
// apps/api/src/application/llm/mediaContextBuilder.ts
export function buildMediaContextBlock(assets: ProjectAsset[], baseUrl: string): string {
  const usable = assets.filter(a => a.usageHint && a.useInProject);
  if (usable.length === 0) return "";
  
  const lines = usable.map(a =>
    `- **${a.label ?? a.originalName}** → ${a.usageHint}\n  URL: ${baseUrl}/public/assets/${a.id}?token=SIGNED`
  );
  
  return [
    "## Media e risorse visive del progetto",
    "",
    "I seguenti asset sono disponibili e devono essere integrati nel sito generato usando i rispettivi URL:",
    "",
    ...lines,
    "",
    "Usa gli URL sopra come `src` di tag `<img>`, `<video>`, background CSS, ecc. Non inventare placeholder generici se un asset reale è disponibile.",
  ].join("\n");
}
```

Questo layer viene risolto in `llmRoutes.ts` (`resolveContext()`) caricando gli asset del progetto prima di comporre il system prompt. Impatta tutti i call LLM — zero-effort, workspace, ottimizzazione.

### 4.4 Async Job — MongoDB Collection

Nuova collection `async_jobs`:

```typescript
interface AsyncJob {
  id: string;
  projectId: string;
  userId: string;
  type: "zero_effort_generation" | "workspace_generation";
  status: "queued" | "running" | "done" | "failed";
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  resultConversationId?: string;
  resultSnapshotId?: string;
  errorMessage?: string;
  notificationSent: boolean;
  notificationChannels: Array<"email" | "telegram">;
  userEmail?: string;
  telegramChatId?: string;
}
```

Endpoint:

```
POST /v1/projects/:projectId/jobs          → crea job, ritorna { jobId }
GET  /v1/projects/:projectId/jobs/:jobId   → polling status
```

Il job viene aggiornato dal worker (il `setTimeout` attuale evolve in una funzione con `updateJobStatus(jobId, patch)`).

### 4.5 Auto-publish al completamento — "Zero Effort Preview"

Al termine della generazione (snapshot creato in MongoDB), il backend esegue automaticamente la pubblicazione al path UUID già definito in `UX_REVIEW_AND_PUBLISH_SPEC.md` (`/p/{publishId}`).

#### Estensione dell'entity `SiteDeployment`

```typescript
// campo aggiuntivo additive
source: "user_initiated" | "zero_effort_auto";
ttlDays?: number;          // null = permanente, 7 = auto-preview TTL
expiresAt?: Date;          // calcolato da createdAt + ttlDays
```

Il deployment di tipo `zero_effort_auto` ha un TTL di 7 giorni (configurabile via `ZERO_EFFORT_PREVIEW_TTL_DAYS`). Alla scadenza il cleanup lo rimuove come gli altri temporanei.

#### Estensione dell'entity `AsyncJob`

```typescript
resultPublishUrl?: string;    // es. "https://app.example.com/p/a1b2c3d4"
resultPublishId?: string;     // es. "a1b2c3d4" — per costruire il deeplink
resultDeploymentId?: string;  // ref a SiteDeployment
```

#### Sequenza backend al completamento

```
[GenerazioneCompletata]
  → creaSnapshot() → snapshotId
  → PublishProject.execute({
        projectId, userId, snapshotId,
        type: "random",         // path UUID — no nginx necessario
        source: "zero_effort_auto",
        ttlDays: 7
    })
  → SiteDeployment.status = "live", url = "/p/{publishId}"
  → updateJobStatus("done", {
        resultConversationId,
        resultSnapshotId,
        resultPublishUrl: absoluteUrl("/p/{publishId}"),
        resultPublishId
    })
  → EmailNotifier.send({ to: userEmail, previewUrl: resultPublishUrl, ... })
```

#### Comportamento se la pubblicazione fallisce

La pubblicazione è best-effort: se fallisce, il job viene comunque segnato `done` con `resultPublishUrl: null`. L'email invia il link diretto alla workspace invece del preview. Il fallimento è loggato in `ExecutionLogger` ma non blocca la notifica.

---

### 4.6 Pagina deeplink — `/preview/[publishId]`

Nuova route Next.js pubblica (no auth richiesta per visualizzare):

```
apps/web/app/preview/[publishId]/page.tsx
```

#### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  🐱 Andy Code Cat                          [Accedi / Registrati] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Il sito di [Nome Brand] è pronto                                │
│  Generato automaticamente con Zero Effort · Anteprima valida 7g  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │              IFRAME — sito generato                        │  │
│  │              (viewport desktop, interattivo)               │  │
│  │                                                            │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Cosa vuoi fare?                                                  │
│                                                                  │
│  [ Modifica in GodMode ]    [ Pubblica con il tuo dominio ]      │
│                                                                  │
│  Condividi anteprima: [https://app.../p/a1b2c3d4]  [Copia link] │
└──────────────────────────────────────────────────────────────────┘
```

#### Comportamento CTA

| Azione | Utente autenticato | Utente non autenticato |
|---|---|---|
| "Modifica in GodMode" | Redirect a `/workspace/{projectId}?conv={convId}` | Redirect a `/login?next=/preview/{publishId}` |
| "Pubblica con il tuo dominio" | Apre modal publish (subdomain o custom domain) | Redirect a `/login?next=/preview/{publishId}` |
| Iframe preview | Sempre visibile — nessuna auth | Sempre visibile — nessuna auth |
| Link "Copia link" | Sempre disponibile | Sempre disponibile |

Dopo il login, il `?next=` ripristina la pagina preview con le CTA ora cliccabili.

#### Dati caricati dalla preview page

```typescript
// SSR: GET /v1/public/previews/:publishId
// Endpoint pubblico (no auth) che ritorna:
{
  projectName: string;
  brandName: string;
  generatedAt: string;
  expiresAt: string;
  previewUrl: string;           // URL per l'iframe = /p/{publishId}
  projectId: string;            // per costruire link workspace (auth-gated)
  conversationId: string;       // per deep-link al conversation corretto
  isExpired: boolean;
}
```

Se `isExpired: true`, la pagina mostra un messaggio "Anteprima scaduta" con CTA per accedere alla workspace.

#### Nota su GodMode e futuro tutorial

Quando l'utente arriva in GodMode da questa pagina preview (via `?from=zero_effort_preview`), in futuro potrà essere mostrato un tutorial layer UI/UX contestuale ("Benvenuto in GodMode — ecco come modificare il sito"). Questo è un concern separato da implementare come layer React in workspace, senza modifiche architetturali al backend.

---

### 4.7 Notifiche email con preview URL

```typescript
// apps/api/src/infra/notifications/EmailNotifier.ts
// Usa Nodemailer con trasporto SMTP configurabile via env:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
```

Template email MVP (testo + HTML semplice):

```
Oggetto: Il tuo sito "[Nome Brand]" è pronto su Andy Code Cat

Il sito è stato generato con successo.

Visualizza l'anteprima:
→ {previewUrl}      ← link /p/{publishId} direttamente visibile senza login

L'anteprima sarà disponibile per 7 giorni.

Dalla pagina di anteprima puoi:
• Modificare il sito in GodMode
• Pubblicarlo con un tuo dominio o link personalizzato

Team Andy Code Cat
```

Il link `{previewUrl}` punta a `https://app.example.com/preview/{publishId}` (la landing page deeplink), non all'iframe direttamente. Questo garantisce che l'utente veda le CTA e non solo l'iframe nudo.

---

## 5. Wizard Zero Effort — Nuovo Step 4 (Media Visivi)

### Posizione nel flusso

```
Step 1: Identità (brand, tipo sito, obiettivo)
Step 2: Target & Dati (audience, contatti)
Step 3: Stile visivo (attributi, tone, CTA)
Step 4: Media (NUOVO — carica immagini, assegna utilizzo)   ← INSERITO QUI
Step 5: Generazione (era Step 4 — brief, ottimizzazione, stream)
```

### UX Step 4

```
┌─────────────────────────────────────────────────────────────┐
│  Aggiungi elementi visivi al tuo progetto                   │
│                                                             │
│  Carica logo, foto hero, immagini prodotto o qualsiasi      │
│  materiale visivo. Il sistema li inserirà automaticamente   │
│  nel sito generato.                                         │
│                                                             │
│  ┌───────────────────────────────────────────┐              │
│  │  Trascina qui i file o clicca per caricare │              │
│  │  PNG, JPG, SVG, WebP — max 20 MB ciascuno  │              │
│  └───────────────────────────────────────────┘              │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [thumbnail]  logo-brand.svg           ×               │ │
│  │              Descrivi l'utilizzo:                      │ │
│  │              [Logo del brand _____________________ ]   │ │
│  │              Suggerimento: header, footer               │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [thumbnail]  hero-photo.jpg           ×               │ │
│  │              Descrivi l'utilizzo:                      │ │
│  │              [Foto principale hero _______________ ]   │ │
│  │              Suggerimento: sezione hero, above the fold │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  [Salta questo step]          [Avanti →]                    │
└─────────────────────────────────────────────────────────────┘
```

### Logica di auto-suggerimento per `usageHint`

Al termine dell'upload, il frontend propone un hint precompilato basato sul nome file e MIME:

| Regola (nome file) | Hint suggerito |
|---|---|
| contiene "logo" | Logo del brand — header e footer |
| contiene "hero" / "banner" / "cover" | Immagine principale — sezione hero |
| contiene "prodotto" / "product" / "item" | Immagine prodotto |
| contiene "bg" / "background" | Sfondo / background decorativo |
| SVG generico | Icona o elemento decorativo |
| default | Elemento visivo del progetto |

L'utente può modificare liberamente il testo suggerito.

### Flusso dati Step 4

1. Utente carica file → `POST /v1/projects/:projectId/assets` → asset salvato
2. Utente inserisce hint → `PATCH /v1/projects/:projectId/assets/:assetId` con `{ usageHint, useInProject: true }`
3. Alla generazione, `buildMediaContextBlock()` legge gli asset con `usageHint && useInProject`
4. Per ogni asset viene generato e incluso il signed URL (valido per la durata della sessione di generazione + buffer)

---

## 6. Feedback visivo streaming in Zero Effort

### Problema attuale

Il componente `page.tsx` in `/launch/[projectId]` chiama `streamLlmChatPreview()` e aggiorna `genStreamTokens`, ma non mostra il contenuto dello stream testuale (thinking + answer) durante la fase `generating`.

### Fix — Wave 1

Aggiungere nell'area "review/generating" la stessa UI di streaming già presente in workspace:

```tsx
// Nuovi state nella phase "generating"
const [thinkingText, setThinkingText] = useState("");
const [draftAnswer, setDraftAnswer] = useState("");

// Nel callback SSE già esistente, aggiungere:
case "thinking": setThinkingText(prev => prev + event.delta); break;
case "answer":   setDraftAnswer(prev => prev + event.delta); break;
```

UI da aggiungere:

```tsx
{genPhase === "generating" && (
  <div className="space-y-3">
    {thinkingText && (
      <div className="rounded-md border border-border/50 bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Ragionamento in corso…</p>
        <p className="text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap">
          {thinkingText}
        </p>
      </div>
    )}
    {draftAnswer && (
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
        <p className="text-xs font-medium text-primary mb-1">Generazione HTML…</p>
        <p className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-foreground/80">
          {draftAnswer.slice(-800)}
        </p>
      </div>
    )}
    <p className="text-xs text-muted-foreground text-right">
      {genStreamTokens} token generati
    </p>
  </div>
)}
```

### Fix — Ottimizzazione con streaming

Sostituire la chiamata `optimizePrompt()` con `streamOptimizePrompt()` (endpoint `/llm/optimize-prompt/stream` già esistente) per mostrare il testo ottimizzato in arrivo con contatore token.

---

## 7. Gestione asincrona — "Torna più tardi"

### Flusso proposto

```
Utente clicca "Genera"
  → Frontend: POST /v1/projects/:projectId/jobs { type: "zero_effort_generation", ... }
  → Backend: crea AsyncJob con status "queued", ritorna { jobId }
  → Backend: avvia generazione in background (setTimeout 50ms pattern ma con DB tracking)
  → Frontend: mostra banner "Generazione avviata"

Utente può:
  A) Rimanere sulla pagina → SSE stream normale (esperienze invariata)
  B) Chiudere la tab → job continua in background

Se utente chiude la tab e torna:
  → Frontend: GET /v1/projects/:projectId/jobs/:jobId (polling ogni 5s)
  → Quando status = "done": mostra link "Apri in GodMode"

Al completamento del job (backend):
  → updateJobStatus("done", { resultConversationId, resultSnapshotId })
  → Se notificationChannels include "email": EmailNotifier.send(...)
  → Se notificationChannels include "telegram": TelegramNotifier.send(...)
```

### UX "Torna più tardi"

```
┌─────────────────────────────────────────────────────────────┐
│  Generazione avviata                                        │
│                                                             │
│  Il tuo sito è in fase di generazione. Puoi:               │
│  • Restare qui e seguire il progresso in tempo reale        │
│  • Chiudere questa finestra e tornare più tardi             │
│                                                             │
│  Ti notificheremo quando è pronto.                          │
│                                                             │
│  Notifica via:  [✓] Email (massimiliano@...)                │
│                 [ ] Telegram (configura →)                  │
│                                                             │
│  [Chiudi e torna più tardi]   [Segui in diretta]            │
└─────────────────────────────────────────────────────────────┘
```

### Persistenza del risultato generato

Attualmente la generazione produce `conversationId` e `snapshotId` che vengono già salvati in MongoDB. Il job record li salva come `resultConversationId` e `resultSnapshotId`. L'utente può riaprire la workspace in qualsiasi momento anche dopo la chiusura del browser.

---

## 8. Generalizzazione media management cross-modale

### Principio

Il Layer F (media context block) è costruito **una sola volta** in `resolveContext()` (già usato da tutti i route LLM) e iniettato in **tutte** le chiamate:

- Zero Effort generation
- Zero Effort prompt optimization  
- Workspace chat-preview stream
- Focused edit (quando `useInProject` asset esistono)

### Asset manager in workspace (GodMode)

Aggiunta nella sidebar o nel pannello asset:

- Per ogni asset, campo editabile `usageHint` (input testo, salva via PATCH)
- Toggle `useInProject` per includere o escludere l'asset dal Layer F
- Badge "Attivo nel prompt" quando `useInProject: true && usageHint`

### Sezione "Media nel prompt" (debug/visibility)

Nel pannello debug del workspace (già esistente via `/llm/prompt-preview`) aggiungere una sezione che mostra il Layer F renderizzato così com'è iniettato nel system prompt.

---

## 9. Piano a onde

### Wave 1 — Feedback visivo (2–3 giorni)

**Nessuna regressione possibile — solo additive frontend.**

File coinvolti:

- `apps/web/app/launch/[projectId]/page.tsx` — aggiunta stati `thinkingText`, `draftAnswer`, UI stream
- `apps/web/lib/api/llm.ts` — wiring `streamOptimizePrompt` (endpoint già esiste)

Deliverable:

- Stream thinking + answer visibile durante la generazione zero-effort
- Ottimizzazione con testo in arrivo e contatore token
- Nessun cambio backend

---

### Wave 2 — Media upload step + Layer F (5–7 giorni)

**Impatto medio — backend additive, nessun breaking change.**

File backend:

- `apps/api/src/domain/entities/ProjectAsset.ts` — aggiunta `usageHint?: string`
- `apps/api/src/infra/db/mongo/MongoProjectAssetRepository.ts` — persistenza `usageHint`
- `apps/api/src/application/llm/mediaContextBuilder.ts` — **nuovo file** `buildMediaContextBlock()`
- `apps/api/src/application/llm/systemPromptComposer.ts` — Layer F additive
- `apps/api/src/presentation/http/routes/llmRoutes.ts` — caricamento asset in `resolveContext()`
- `apps/api/src/presentation/http/routes/projectAssetRoutes.ts` — nuovo endpoint `/signed-url`
- `apps/api/src/infra/security/AssetSignedUrlService.ts` — **nuovo file** JWT signing

File frontend:

- `apps/web/app/launch/[projectId]/page.tsx` — nuovo Step4Content, spostamento step generazione a Step5
- `apps/web/lib/api/assets.ts` — funzioni upload, patch usageHint, get signed-url
- `apps/web/components/launch/MediaUploadStep.tsx` — **nuovo componente** drag-drop + usage input

Deliverable:

- Step 4 funzionante con upload, hint, preview thumbnail
- Asset con `usageHint` e `useInProject: true` iniettati nel prompt
- URL firmati funzionanti e accessibili dal LLM
- Layer F in tutte le chiamate LLM

---

### Wave 3 — Generalizzazione workspace (3–4 giorni)

**Impatto basso — UI additive sul pannello asset esistente.**

File coinvolti:

- `apps/web/app/workspace/[projectId]/page.tsx` — aggiunta campo usageHint nell'asset panel
- `apps/web/components/workspace/` — update UI asset list
- Nessun cambio backend (Layer F già attivo da Wave 2)

Deliverable:

- Workspace mostra e permette editing di `usageHint` per ogni asset
- Badge "Attivo nel prompt" visibile
- Sezione Layer F nel pannello debug prompt

---

### Wave 4 — Async job + auto-publish + notifiche email (7–9 giorni)

**Impatto medio — nuova collection MongoDB, estensione PublishProject, nuova dipendenza Nodemailer.**

File backend:

- `apps/api/src/domain/entities/AsyncJob.ts` — **nuovo** (include `resultPublishUrl`, `resultPublishId`)
- `apps/api/src/infra/db/mongo/MongoAsyncJobRepository.ts` — **nuovo**
- `apps/api/src/presentation/http/routes/asyncJobRoutes.ts` — **nuovo** (`POST /v1/projects/:id/jobs`, `GET /v1/projects/:id/jobs/:jobId`)
- `apps/api/src/infra/notifications/EmailNotifier.ts` — **nuovo** (Nodemailer + template preview URL)
- `apps/api/src/application/use-cases/LaunchZeroEffortProject.ts` — integrazione job tracking + auto-publish
- `apps/api/src/domain/entities/SiteDeployment.ts` — aggiunta `source`, `ttlDays`, `expiresAt` (additive)
- `apps/api/src/application/use-cases/PublishProject.ts` — gestione `source: "zero_effort_auto"` + TTL
- `apps/api/src/presentation/http/routes/publicRoutes.ts` — **nuovo** `GET /v1/public/previews/:publishId` (no auth)

File frontend:

- `apps/web/app/launch/[projectId]/page.tsx` — banner "torna più tardi", polling, preferenza notifica
- `apps/web/app/preview/[publishId]/page.tsx` — **nuova route** deeplink landing (SSR pubblica)
- `apps/web/lib/api/jobs.ts` — **nuovo** client polling

Dipendenze nuove:

- `nodemailer` (backend)
- ENV: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ZERO_EFFORT_PREVIEW_TTL_DAYS` (default: 7)

Deliverable:

- Generazione avviata → job tracciato in DB
- Al completamento: sito auto-pubblicato al path UUID (`/p/{publishId}`)
- Preview URL incluso nell'email di notifica
- Pagina deeplink `/preview/{publishId}` pubblica con iframe + CTA guidate
- Utente può chiudere tab e tornare — trova il sito già pubblicato
- Polling frontend ogni 5s con aggiornamento automatico

---

### Wave 5 — Telegram (opzionale, 3–4 giorni)

**Impatto basso — dipendenza aggiuntiva, nessuna regressione.**

File backend:

- `apps/api/src/infra/notifications/TelegramNotifier.ts` — **nuovo**
- ENV: `TELEGRAM_BOT_TOKEN`

UX:

- Settings utente: inserisci Telegram Chat ID (o collega via deep link bot)
- Notifica al completamento con link diretto

---

## 10. Analisi rischio e regressioni

| Wave | Rischio regressione | Mitigazione |
|---|---|---|
| Wave 1 | Nessuno | Solo stati React aggiuntivi, nessun cambio API |
| Wave 2 — Layer F | Basso | Layer F è stringa vuota se nessun asset con usageHint — comportamento identico all'attuale |
| Wave 2 — Step 4 | Nessuno | Step aggiuntivo — lo step generazione si sposta ma non cambia |
| Wave 2 — signed URL | Basso | Nuovo endpoint isolato — non tocca endpoint esistenti |
| Wave 3 | Nessuno | UI additive |
| Wave 4 — job tracking | Medio | Il path SSE sincrono deve rimanere funzionante in parallelo al path async |
| Wave 4 — auto-publish | Basso | Best-effort: se fallisce, il job è comunque `done` e l'email invia il link workspace invece del preview |
| Wave 4 — SiteDeployment | Basso | I campi `source`, `ttlDays`, `expiresAt` sono additive — i deploy esistenti hanno `source: "user_initiated"` per default |
| Wave 4 — preview page | Nessuno | Route nuova, non tocca workspace né dashboard |
| Wave 4 — email | Basso | Se SMTP non configurato, email silenziosamente skippata (no crash) |
| Wave 5 | Nessuno | Dipendenza opzionale, notifica best-effort |

### Regola generale

Tutti i layer aggiunti sono **additive e opt-in**:

- Layer F: attivo solo se esistono asset con `usageHint && useInProject`
- Async job: attivo solo se l'utente clicca "chiudi e torna più tardi"
- Auto-publish: best-effort, mai bloccante per la generazione
- Email: inviata solo se SMTP configurato E utente ha selezionato il canale
- Step 4: skippabile con "Salta questo step"
- Preview page: pubblica e leggera — non impatta workspace né login flow

---

## 11. Stima complessiva

| Wave | Giorni stimati | Dipendenze esterne |
|---|---|---|
| Wave 1 | 2–3 | Nessuna |
| Wave 2 | 5–7 | Nessuna (JWT già disponibile con jose/jsonwebtoken) |
| Wave 3 | 3–4 | Nessuna |
| Wave 4 | 7–9 | Nodemailer + SMTP account + `PublishProject` use case stabile (già spec'd) |
| Wave 5 | 3–4 | Telegram Bot API token |
| **Totale (Wave 1–4)** | **17–23 giorni** | Solo SMTP account + `PublishProject` completato |

Le Wave 1 e Wave 2 sono indipendenti e parallelizzabili (frontend vs backend). Wave 3 dipende da Wave 2. Wave 4 dipende da Wave 2 (Layer F stabile) e dalla presenza del `PublishProject` use case (già spec'd in `UX_REVIEW_AND_PUBLISH_SPEC.md`, da completare se non già implementato).

---

## 12. Relazione con specifiche esistenti

| Spec esistente | Relazione con questo documento |
|---|---|
| `ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md` | Layer F è l'implementazione del "media context block" descritto in quella spec. Questo documento lo applica concretamente alla modalità zero-effort e generalizza cross-modale. |
| `MULTIMODE_UX_MVP_EXECUTION_SPEC.md` | Lo step 4 media è un'estensione additive del wizard zero-effort già pianificato — non in conflitto. |
| `IMAGE_PROMPTING_PIPELINE_SPEC.md` | Complementare — quella spec riguarda la generazione di immagini AI. Questo riguarda l'uso di immagini caricate dall'utente come contesto. |
| `PREPROMPT_ENGINE_SPEC.md` | Il Layer F si inserisce nella catena del preprompt engine — compatibile. |
| `UX_REVIEW_AND_PUBLISH_SPEC.md` | L'auto-publish (Wave 4) riusa direttamente il `PublishProject` use case e il path UUID `/p/{publishId}` già spec'd in quel documento. Estende `SiteDeployment` con `source` e `ttlDays` in modo additive. La pagina deeplink `/preview/[publishId]` è una nuova route Next.js che wrappa l'iframe del path UUID con CTA guidate. |
| `EXPORT_AND_PUBLISH_SPEC.md` | Il sistema di subdomain random (M4b) è il target futuro. Per MVP si usa path UUID (già implementabile senza nginx). La struttura `SubdomainAllocation` resta per il publish permanente su subdomain custom. |

---

## 13. Raccomandazione operativa

**Sequenza consigliata:**

1. Iniziare da Wave 1 (2–3 giorni) — visibilità immediata per l'utente senza nessun rischio.
2. Avviare Wave 2 backend e Wave 2 frontend in parallelo — team o agenti separati.
3. Wave 3 dopo Wave 2 completata — minimo effort.
4. Wave 4 pianificata dopo stabilizzazione Wave 2/3, richiede decisione su provider SMTP.
5. Wave 5 opzionale — valutare in base al feedback utenti su Wave 4.

**Da non fare:**

- Non implementare async job (Wave 4) prima che il Layer F (Wave 2) sia stabile — il job tracking non ha senso se il prompt non è ancora arricchito correttamente.
- Non rendere gli asset URL permanentemente pubblici — usare sempre il signed URL pattern.
- Non forzare l'utente a passare per lo Step 4 — il salto deve essere sempre possibile.
- Non usare il subdomain nginx (M4b) per l'auto-publish in Wave 4 — il path UUID è sufficiente e non richiede infrastruttura aggiuntiva. Nginx resta il target per il publish permanente custom (M4b futuro).
- Non puntare l'email direttamente all'iframe `/p/{publishId}` — usare sempre `/preview/{publishId}` come deeplink, così l'utente vede le CTA guidate e non un sito nudo senza contesto.
- Non bloccare la generazione se l'auto-publish fallisce — trattare sempre come best-effort.

---

> Documento creato: 2026-04-22  
> Aggiornato: 2026-04-22 — aggiunta sezione auto-publish, deeplink landing page, integrazione con PublishProject e SiteDeployment  
> Aggiornare questo documento se cambiano le decisioni architetturali su job store, URL strategy, publish TTL o struttura step wizard.
