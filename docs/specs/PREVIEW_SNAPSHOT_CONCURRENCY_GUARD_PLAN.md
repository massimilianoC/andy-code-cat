# Preview Snapshot — Concurrency Guard sulla versione attiva

> Status: **Proposed — in attesa di revisione**
> Data: 2026-08-10 · Release corrente: `2026.07.10.1` · Branch di partenza: `develop`
> Chiude: [TEST_COVERAGE_ROADMAP.md](../guides/TEST_COVERAGE_ROADMAP.md) §3.2 item 3
> Documenti collegati: [FOCUSED_EDIT_SPEC.md](FOCUSED_EDIT_SPEC.md) ·
> [WYSIWYG_EDIT_MODE_SPEC.md](WYSIWYG_EDIT_MODE_SPEC.md) ·
> [EXPORT_AND_PUBLISH_SPEC.md](EXPORT_AND_PUBLISH_SPEC.md) ·
> [TESTING_POLICY.md](../guides/TESTING_POLICY.md)
> Ambito: solo backend `apps/api` + contratto `packages/contracts` + workspace `apps/web`.
> Nessuna migrazione dati, nessun nuovo campo persistito, nessuna nuova collezione.

---

## 1. Risultato atteso

Oggi una modifica costruita su uno stato client **stale** sovrascrive silenziosamente la
versione realmente attiva di un progetto: nessun errore, nessun log dedicato, nessun segnale
all'utente. La versione che era attiva resta in database ma smette di essere attiva e
scompare dalla catena di lavoro — di fatto è persa dal punto di vista dell'utente.

Dopo questo lavoro:

1. Ogni creazione di snapshot **con attivazione** che parte da una convinzione client
   ("credo che la versione attiva sia X") viene rifiutata con **409** se sul server la
   versione attiva nel frattempo è diventata Y.
2. Il rifiuto è esplicito, tipizzato, loggato su `ExecutionLog` e mostrato all'utente con una
   via d'uscita (risincronizzazione automatica dello stato + invito a ripetere l'azione).
3. **Zero attrito** per tutti i flussi legittimi: prima generazione in un progetto vuoto,
   modifiche sequenziali in una singola tab, ramificazione volontaria da una versione più
   vecchia scelta nella history, flussi backend/e2e che non dichiarano alcuna precondizione.
4. La regressione è coperta da test a due livelli (use-case con fake repository + integrazione
   reale su Mongo), secondo [TESTING_POLICY.md](../guides/TESTING_POLICY.md).

Questo piano **non** introduce realtime, polling, websocket o merge automatico. Rileva il
conflitto e lo rende visibile: è il minimo che elimina la perdita silenziosa di lavoro.

---

## 2. Documenti e sorgenti da leggere prima di toccare codice

1. [AGENTS.md](../../AGENTS.md) — clean architecture, double sandbox, direzione delle dipendenze.
2. [CLAUDE.md](../../CLAUDE.md) — Gitflow, versioning, checklist di release.
3. [CODE_AGENT_INDEX.md](../agents/CODE_AGENT_INDEX.md) — mappa del codice e aree congelate.
4. [FOCUSED_EDIT_SPEC.md](FOCUSED_EDIT_SPEC.md) — catena Focus Patch → `createPreviewSnapshot()`.
5. [WYSIWYG_EDIT_MODE_SPEC.md](WYSIWYG_EDIT_MODE_SPEC.md) — sessione EDIT Light e commit.
6. [TESTING_POLICY.md](../guides/TESTING_POLICY.md) — fixture reali, mock solo ai confini.
7. [TEST_COVERAGE_ROADMAP.md](../guides/TEST_COVERAGE_ROADMAP.md) §3.2 — invariante versione attiva.
8. [GITFLOW_RELEASE_POLICY.md](../guides/GITFLOW_RELEASE_POLICY.md) e
   [AGENT_RELEASE_CHECKLIST.md](../guides/AGENT_RELEASE_CHECKLIST.md) prima di branch/commit/PR.

Riferimento esterno unico e sufficiente: semantica HTTP di `409 Conflict` e delle
precondizioni ottimistiche —
[RFC 9110 §15.5.10](https://www.rfc-editor.org/rfc/rfc9110#name-409-conflict).

---

## 3. Baseline reale verificata

Tutto ciò che segue è stato letto nel codice al commit `c878b38` (branch `develop`), non
dedotto.

### 3.1 La catena esatta del difetto

**Passo 1 — lo stato client si sincronizza una sola volta.**
`apps/web/app/workspace/[projectId]/page.tsx:745-767` definisce `loadSnapshots()`, che
popola `previewSnapshots`, `selectedBackendSnapshotId` e gli editor `editorHtml/Css/Js`.
L'unico trigger automatico è l'effetto di mount alle righe `777-784`
(`useEffect(..., [token, loadSnapshots])`). Ricerca sistematica confermata: **nessun**
`setInterval`, **nessun** listener `visibilitychange` o `focus`, **nessun** websocket/SSE sul
canale snapshot. Lo stato può quindi restare stale a tempo indefinito con la tab aperta.

**Passo 2 — il payload di modifica usa sempre lo stato locale.**
`page.tsx:1920-1938`:

```ts
const currentArtifactsSource =
    editorHtml || editorCss || editorJs
        ? { html: editorHtml, css: editorCss, js: editorJs }
        : activeBaselineSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts;
```

`editorHtml` deriva da `selectedBackendSnapshot` (`page.tsx:1676-1698`), non da una rilettura
del server.

**Passo 3 — la creazione attiva incondizionatamente.**
Quattro call site nel workspace passano `activate: true` senza alcuna precondizione
(dettaglio in §4). `parentSnapshotId`, dove presente, viene da
`selectedBackendSnapshotIdRef.current`, un ref client-side anch'esso potenzialmente stale.

**Passo 4 — il backend non confronta nulla.**
`apps/api/src/application/use-cases/CreatePreviewSnapshot.ts:44-52`:

```ts
const parentSnapshot = input.parentSnapshotId
    ? await this.previewSnapshotRepository.findById(input.projectId, input.parentSnapshotId)
    : null;
const snapshot = await this.previewSnapshotRepository.create({
    ...input,
    serviceManifest: input.serviceManifest ?? parentSnapshot?.serviceManifest,
});
```

`parentSnapshotId` serve **esclusivamente** a ereditare `serviceManifest`. Non viene mai
confrontato con la versione realmente attiva. Confermato: nessun altro uso nel use-case.
(Lo stesso `findById` è duplicato in `previewSnapshotRoutes.ts:171-173` per calcolare
`inheritedManifest` ai fini della compilazione form — anche lì, nessun confronto.)

**Passo 5 — il repository disattiva alla cieca.**
`apps/api/src/infra/repositories/MongoPreviewSnapshotRepository.ts:49-54`:

```ts
if (input.activate) {
    await col.updateMany(
        { projectId: input.projectId } as Filter<PreviewSnapshotDocument>,
        { $set: { isActive: false } }
    );
}
```

Nota critica per il design: lo sweep è su `{ projectId }`, **non** su
`{ projectId, conversationId }`. Ciò che viene sovrascritto è quindi la versione attiva
**di progetto**, attraverso tutte le conversazioni. Qualunque guardia deve confrontarsi con
`getActiveForProject()`, non con `getActive()`: usare lo scope conversazione lascerebbe
scoperto proprio il clobbering cross-conversazione.

**Conseguenza.** Due tab sullo stesso progetto, o una tab lasciata aperta mentre altrove
cambia la versione attiva: la tab stale invia una modifica costruita su contenuto vecchio, il
backend la accetta, la versione attiva del momento viene disattivata e orfanizzata. Nessun
errore, nessun evento di log dedicato, nessuna traccia per l'utente.

### 3.2 Il caso "divergenza legittima" che vieta la soluzione ingenua

`page.tsx:3709-3718` — `SnapshotHistoryPanel.onSelect`:

```ts
onSelect={(id) => {
    const snap = previewSnapshots.find((s) => s.id === id);
    if (snap?.artifacts) { setEditorHtml(...); setEditorCss(...); setEditorJs(...); }
    setSelectedBackendSnapshotId(id);
    setPreviewRefreshing(true);
}}
```

Selezionare una versione dalla history **non** la attiva (l'attivazione è un'azione separata,
`onActivate`, righe `3719-3734`). L'utente può quindi, in modo del tutto legittimo,
posizionarsi su v3 mentre v7 è attiva e modificare da lì: nasce v8 con
`parentSnapshotId = v3`, che diventa attiva. Questo è il flusso "riparti da una versione
precedente", ed è desiderato.

Dal punto di vista del server, `parentSnapshotId ≠ activeSnapshotId` in questo caso è
**indistinguibile** dal caso stale. La differenza non sta nella lineage: sta nel fatto che nel
caso legittimo il client **sa** qual è la versione attiva (la sua lista è fresca), mentre nel
caso stale **non lo sa**. Da qui la scelta di §5: la precondizione va espressa esplicitamente
e separata dalla lineage.

### 3.3 Cosa già esiste e va riusato — non duplicare

| Elemento | File | Uso in questo piano |
|---|---|---|
| `getActiveForProject()` | `apps/api/src/domain/repositories/PreviewSnapshotRepository.ts:26` + impl. `MongoPreviewSnapshotRepository.ts:107-111` | Lettura della verità server-side. Nessun nuovo metodo di repository. |
| `ActivatePreviewSnapshot` | `apps/api/src/application/use-cases/ActivatePreviewSnapshot.ts` | Precedente di guardia in use-case (placeholder media non risolti → 400 prima di mutare). Stesso schema, stessa posizione architetturale. |
| Pattern errore applicativo | `PublishProject.ts:270`, `RegenerateMediaByKey.ts:73`, `admin/AdminCreateUser.ts:20` | `Object.assign(new Error(msg), { statusCode, code, userMessage, details })`, layer-clean. |
| `normalizeHttpError` + `errorHandler` | `apps/api/src/presentation/http/errors/httpError.ts:38-70`, `middlewares/errorHandler.ts:12-27` | Serializzazione già uniforme `{ error, code, status, userMessage, details }`. |
| `ApiError` client | `apps/web/lib/api/call.ts:53-69` | Espone già `status`, `code`, `details`, `userMessage`. Nessuna modifica. |
| Precedente 409 lato UI | `apps/web/app/workspace/features/header/usePublish.ts:312` | Stile di gestione `err instanceof ApiError && err.status === 409`. |
| `ExecutionLogger` | `apps/api/src/application/services/ExecutionLogger.ts`, già usato in `previewSnapshotRoutes.ts:199-229` | Sink audit esistente per il nuovo evento di conflitto. Nessuna nuova collezione. |
| Test integrazione Mongo | `tests/api/previewSnapshot-activation.test.ts` | Pattern `MongoMemoryServer` da replicare. |
| Test use-case con fake repo | `apps/api/src/application/use-cases/__tests__/ActivatePreviewSnapshot.test.ts` | Modello di fake repository da estendere. |

### 3.4 Finding secondario bloccante — `.status` non viene mai letto

`normalizeHttpError` (`httpError.ts:59-70`) legge **solo** `candidate.statusCode`:

```ts
const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : isJwtError ? 401 : 500;
```

Ma 16 punti dell'applicazione impostano `.status` (non `.statusCode`), fra cui:

- `ActivatePreviewSnapshot.ts:12, 19, 31` → 404 / 400 / 404
- `DeletePreviewSnapshot.ts:11, 16, 23` → 404 / **409** / 404
- `CreatePreviewSnapshot.ts:29, 39` → 400 / 404
- `AddMessage.ts:17`, `GetConversation.ts:11`, `LogBackgroundTask.ts:26, 33`,
  `datasetRoutes.ts:48, 53, 58, 65`

`app.ts:106` registra `errorHandler` come unico gestore, quindi il default di Express (che
*sì* onorerebbe `err.status`) non entra mai in gioco. **Conseguenza verificata per lettura:
tutti questi errori raggiungono il client come HTTP 500**, con il messaggio corretto ma lo
status sbagliato.

Impatto su questo piano: il nuovo errore **deve** usare `statusCode`, altrimenti la guardia
409 arriverebbe al browser come 500 e la gestione frontend non scatterebbe. La correzione
generale di `normalizeHttpError` è trattata come Wave 3 opzionale (§7.3), separata e con test
propri, perché cambierebbe il comportamento osservabile di 16 call site esistenti.

---

## 4. Inventario completo dei call site di creazione-con-attivazione

Ricerca esaustiva su `activate:` e su `*.create(` del repository snapshot. Risultato: **due**
percorsi backend distinti che possono attivare, e **cinque** origini client.

### 4.1 Percorsi backend (dove la guardia può essere applicata)

| # | Percorso | File | Attiva? | Passa da `CreatePreviewSnapshot`? |
|---|---|---|---|---|
| B1 | `POST /v1/projects/:projectId/preview-snapshots` | `previewSnapshotRoutes.ts:104-250` (`execute` a `186-196`) | `body.activate`, default `true` (`contracts/src/preview.ts:44`) | Sì |
| B2 | `POST /v1/projects/:projectId/wysiwyg/sessions/:sessionId/commit` | `wysiwygRoutes.ts` → `CommitWysiwygSession.ts:31-52` | `activate: true` hardcoded | **No** — chiama `snapshotRepo.create()` direttamente |

B2 è un bypass reale del use-case: qualsiasi guardia messa solo in `CreatePreviewSnapshot`
non lo copre. Va trattato esplicitamente (§7.2).

### 4.2 Origini client

| # | Origine | File:riga | `parentSnapshotId` | Rischio stale | Trattamento |
|---|---|---|---|---|---|
| C1 | `saveMediaVersion()` — applicazione media / rigenerazione immagine | `page.tsx:1035-1041` | `selectedBackendSnapshotIdRef.current` | **Alto** — HTML derivato da `applyMediaToPreview()` sul DOM locale | Precondizione obbligatoria |
| C2 | `handleSaveEditorSnapshot()` — salvataggio manuale editor codice | `page.tsx:1426-1431` | **assente** | **Alto** — salva `editorHtml/Css/Js` puri, nessuna lineage | Precondizione obbligatoria |
| C3 | `handleCommitEditVersion()` — ramo degradato EDIT Light (nessuna sessione WYSIWYG) | `page.tsx:1598-1603` | **assente** | **Alto** | Precondizione obbligatoria |
| C4 | `handleSend()` — persistenza post-generazione LLM / Focus Patch | `page.tsx:2190-2216` | `selectedBackendSnapshotIdRef.current` | **Alto** — è il caso più frequente e più costoso (token spesi) | Precondizione obbligatoria |
| C5 | `handleCommitEditVersion()` — ramo con sessione WYSIWYG attiva | `page.tsx:1583-1595` → B2 | server-side: `session.originSnapshotId` | **Medio** — la sessione può essere stata aperta su una versione poi superata | Precondizione obbligatoria (§7.2) |

### 4.3 Call site che devono restare senza guardia

| Origine | File | Perché |
|---|---|---|
| `tests/e2e/helpers/test-user.ts:154` | Bootstrap fixture E2E | Non dichiara precondizione → guardia inattiva. Nessuna modifica ai test. |
| `tests/e2e/publish-local.spec.ts:56`, `tests/e2e/form-runtime.spec.ts:151, 276` | Setup E2E via `fetch` grezzo | Idem. |
| `PreviewSnapshotMediaResolution.test.ts` (varie righe) | Test use-case esistenti | Non passano il nuovo campo → comportamento identico a oggi. |
| Eventuali futuri job/admin server-side | — | Un chiamante che non ha una "convinzione client" non deve dichiararne una. L'assenza del campo è la scelta corretta, non una dimenticanza. |

Questa è la ragione per cui la precondizione è **opzionale nel contratto e assente per
default**: la retrocompatibilità non è un compromesso, è la semantica corretta.

---

## 5. Meccanismo di rilevamento — opzioni valutate

### Opzione A — confronto diretto `parentSnapshotId` vs `getActiveForProject()`

Nessuna modifica di contratto: il server rifiuta se `parentSnapshotId` non coincide con
l'attivo corrente.

- **Pro:** zero superficie nuova; nessun lavoro frontend per il rilevamento.
- **Contro (dirimenti):**
  1. C2 e C3 non passano affatto `parentSnapshotId` → o restano senza protezione, o ogni
     salvataggio manuale diventa un 409 spurio.
  2. Rompe la ramificazione volontaria documentata in §3.2 (`onSelect` senza attivazione):
     falso 409 su un flusso desiderato.
  3. Confonde due concetti distinti — provenienza dell'artefatto e precondizione di
     concorrenza — rendendo impossibile esprimere "so che l'attivo è v7, voglio ramificare
     da v3".
- **Esito: respinta.**

### Opzione B — campo di precondizione esplicito `expectedActiveSnapshotId` — **SCELTA**

Il client dichiara, separatamente dalla lineage, quale snapshot **crede** sia attivo sul
server. Il server confronta con `getActiveForProject(projectId)`.

Semantica a tre stati, deliberata:

| Valore inviato | Significato | Comportamento server |
|---|---|---|
| campo assente (`undefined`) | "non dichiaro alcuna precondizione" | Nessun controllo — comportamento identico a oggi |
| `null` | "credo che nessuno snapshot sia attivo" | 409 se invece esiste un attivo |
| `"<snapshotId>"` | "credo che l'attivo sia questo" | 409 se l'attivo è diverso (o assente) |

- **Pro:**
  1. Separa provenienza (`parentSnapshotId`) da precondizione: **tutti** i flussi legittimi di
     §4.3 e la ramificazione volontaria di §3.2 continuano a funzionare senza attrito, perché
     nel caso legittimo il client conosce l'attivo corretto e lo dichiara correttamente.
  2. Retrocompatibile per costruzione (assente = nessun controllo): E2E, test esistenti e
     client non aggiornati non cambiano comportamento.
  3. Nessun campo persistito nuovo, nessuna migrazione, nessun backfill: l'`id` dello
     snapshot attivo **è già** un ETag naturale, perché ogni attivazione produce o promuove un
     `_id` diverso (`randomUUID()` a `MongoPreviewSnapshotRepository.ts:58`).
  4. Esplicito e greppabile; testabile sia con fake repository sia su Mongo reale.
  5. Coerente con lo stile del codebase: guardia in use-case, errore con `statusCode`, come
     già fa `ActivatePreviewSnapshot`.
- **Contro:** la protezione è opt-in per call site — un futuro call site che dimentica il
  campo non è protetto. Mitigazione: §9 impone il campo su tutte e 5 le origini client e i
  test di accettazione lo verificano; il commento sul contratto lo dichiara esplicitamente.
- **Esito: adottata.**

### Opzione C — contatore di versione / ETag incrementale sul progetto

Un intero `activeSnapshotVersion` su `Project`, incrementato a ogni attivazione; il client
invia l'ultimo valore visto.

- **Pro:** intercetta *qualsiasi* cambio del puntatore attivo, inclusa la riattivazione dello
  **stesso** snapshot (che l'opzione B non distingue).
- **Contro:**
  1. Nuovo campo persistito su una seconda collezione, con backfill per tutti i progetti esistenti.
  2. Introduce un secondo invariante cross-documento (`projects` ↔ `preview_snapshots`) senza
     transazione: si sostituisce un problema di consistenza con un altro.
  3. Il caso che aggiunge — "stesso snapshot riattivato mentre ero via" — non produce perdita
     di lavoro, perché il contenuto attivo è identico: è esattamente il falso positivo che
     vogliamo evitare.
- **Esito: respinta.** Documentata come percorso di escalation se in futuro servisse
  rilevare anche la riattivazione idempotente.

### Opzione D — optimistic locking a livello Mongo (`findOneAndUpdate` condizionato)

Sostituire lo sweep `updateMany({projectId}, {isActive:false})` con un
`updateOne({ projectId, _id: expectedActiveId, isActive: true }, ...)` e verificare
`modifiedCount`.

- **Pro:** atomico; chiude anche la finestra TOCTOU residua fra la lettura di
  `getActiveForProject()` e la `create()` (millisecondi).
- **Contro:**
  1. Cambia l'interfaccia di dominio `PreviewSnapshotRepository.create()`, quindi tocca fake e
     test esistenti.
  2. Lo sweep incondizionato ha oggi anche una funzione **auto-riparante**: se per qualunque
     ragione esistessero due documenti attivi, li azzera entrambi. Renderlo condizionato può
     lasciare attivi orfani e indebolire l'invariante coperto da
     `tests/api/previewSnapshot-activation.test.ts`.
  3. La finestra reale di questo bug è di scala umana (minuti/ore fra tab), non di
     millisecondi: l'atomicità non è il fattore limitante.
- **Esito: respinta come meccanismo primario.** Raccomandata come irrobustimento facoltativo
  successivo (§7.3), da valutare solo se emergessero conflitti realmente concorrenti.

### Decisione

**Opzione B**, con guardia implementata nel layer applicativo (`CreatePreviewSnapshot` e
`CommitWysiwygSession`), confronto su **scope progetto** (`getActiveForProject`) per le ragioni
di §3.1 passo 5, e lettura effettuata **immediatamente prima** della `create()` per minimizzare
la finestra e non alterare la precedenza degli errori già esistenti (400 placeholder media,
404 source message).

---

## 6. Contratto di errore

### 6.1 Richiesta

`packages/contracts/src/preview.ts`, `createPreviewSnapshotSchema`:

```ts
/**
 * Optimistic concurrency precondition. The client's belief about which snapshot is
 * currently active PROJECT-WIDE — deliberately independent from parentSnapshotId,
 * which records provenance (which version this edit was derived from).
 *   undefined → no precondition asserted (server-side/background callers, E2E setup)
 *   null      → "I believe no snapshot is active yet"
 *   "<id>"    → "I believe this snapshot is the active one"
 */
expectedActiveSnapshotId: z.string().min(1).max(100).nullish(),
```

`z.nullish()` = `.nullable().optional()`: distingue i tre stati senza `.default()`, quindi
l'assenza resta assenza dopo il parse. Stesso campo, stessa semantica, in
`commitWysiwygSessionSchema` (`packages/contracts/src/wysiwyg.ts:19-22`).

### 6.2 Risposta di conflitto

Status: **409**. Corpo prodotto senza codice nuovo, dalla catena
`normalizeHttpError` → `errorHandler` già esistente:

```json
{
  "error": "La versione attiva del progetto è cambiata mentre stavi lavorando.",
  "code": "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT",
  "status": 409,
  "userMessage": "La versione attiva del progetto è cambiata mentre stavi lavorando.",
  "details": {
    "expectedActiveSnapshotId": "9f1c…",
    "actualActiveSnapshotId": "3ab7…"
  }
}
```

`details` è già `unknown` in `NormalizedHttpError` e già propagato in `ApiError.details`
(`call.ts:46, 65`): nessuna modifica al client HTTP.

**Vincolo non negoziabile:** l'errore deve esporre `statusCode` (non `status`) — vedi §3.4,
altrimenti esce come 500.

### 6.3 Evento di audit

Nella route B1, nel ramo di errore, emettere su `ExecutionLogger` (stesso stile di
`previewSnapshotRoutes.ts:199-229`):

```
domain: "snapshot", eventType: "snapshot_conflict", level: "warn", status: "error",
metadata: { expectedActiveSnapshotId, actualActiveSnapshotId, parentSnapshotId, conversationId }
```

Questo trasforma il fallimento più insidioso del sistema — quello silenzioso — in una riga
interrogabile. È il vero valore operativo del piano, oltre al 409.

---

## 7. Piano di implementazione

Ordine vincolante: contratto → dominio/applicazione → presentazione → client → i18n → test.
Ogni wave è autonomamente verde su typecheck e test.

### 7.1 Wave 1 — guardia sul percorso principale (B1 / C1–C4)

| # | File | Modifica |
|---|---|---|
| 1 | `packages/contracts/src/preview.ts` | Aggiungere `expectedActiveSnapshotId: z.string().min(1).max(100).nullish()` a `createPreviewSnapshotSchema` (dopo `parentSnapshotId`, riga ~38) con il commento di §6.1. |
| 2 | `apps/api/src/application/use-cases/CreatePreviewSnapshot.ts` | Aggiungere `expectedActiveSnapshotId?: string \| null` alla firma di `execute()` e la guardia (pseudocodice sotto), **dopo** le guardie esistenti e **immediatamente prima** di `previewSnapshotRepository.create()`. |
| 3 | `apps/api/src/presentation/http/routes/previewSnapshotRoutes.ts` | Inoltrare `expectedActiveSnapshotId: body.expectedActiveSnapshotId` nella chiamata a `createPreviewSnapshot.execute()` (righe 186-196). Aggiungere l'emissione `snapshot_conflict` in un `catch` che rilancia. |
| 4 | `apps/web/lib/api/snapshots.ts` | Aggiungere `expectedActiveSnapshotId?: string \| null` all'input di `createPreviewSnapshot()` (righe 72-117). Nessun'altra modifica. |
| 5 | `apps/web/app/workspace/[projectId]/page.tsx` | Esporre `activeSnapshotIdRef` (ref aggiornato da `previewSnapshots`, stesso pattern di `selectedBackendSnapshotIdRef`, righe 769-775). Passare `expectedActiveSnapshotId: activeSnapshotIdRef.current` nei 4 call site C1–C4. Gestire il 409 (§8). |
| 6 | `apps/web/i18n/it.json` + `en.json` | Nuove chiavi sotto `workspace.notifications.snapshot`: `conflictLabel`, `conflict`. |

Pseudocodice della guardia (punto 2), nello stile già presente in `PublishProject.ts:270`:

```ts
// Optimistic concurrency: reject an activation built on a stale client view.
// Scope is PROJECT-wide because MongoPreviewSnapshotRepository.create() clears
// isActive across the whole project, not just the conversation.
if (input.activate && input.expectedActiveSnapshotId !== undefined) {
    const currentActive = await this.previewSnapshotRepository.getActiveForProject(input.projectId);
    const actualActiveSnapshotId = currentActive?.id ?? null;
    const expectedActiveSnapshotId = input.expectedActiveSnapshotId ?? null;
    if (actualActiveSnapshotId !== expectedActiveSnapshotId) {
        throw Object.assign(
            new Error(
                `Active preview snapshot changed: expected "${expectedActiveSnapshotId ?? "none"}", found "${actualActiveSnapshotId ?? "none"}"`,
            ),
            {
                statusCode: 409,
                code: "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT",
                userMessage: "La versione attiva del progetto è cambiata mentre stavi lavorando.",
                details: { expectedActiveSnapshotId, actualActiveSnapshotId },
            },
        );
    }
}
```

Note di stile obbligate:

- `Object.assign(new Error(...), { statusCode, ... })` — **non** `HttpError`: quella classe
  vive in `presentation/http/errors/`, importarla da `application/` violerebbe la direzione
  delle dipendenze imposta da `AGENTS.md`. Il pattern scelto è già usato in
  `PublishProject.ts`, `RegenerateMediaByKey.ts`, `admin/AdminCreateUser.ts`.
- Nessuna modifica a `PreviewSnapshotRepository` (dominio) né a
  `MongoPreviewSnapshotRepository` (infra) in questa wave.

### 7.2 Wave 2 — percorso WYSIWYG (B2 / C5)

| # | File | Modifica |
|---|---|---|
| 1 | `packages/contracts/src/wysiwyg.ts` | Stesso campo `expectedActiveSnapshotId` in `commitWysiwygSessionSchema` (riga ~19). |
| 2 | `apps/api/src/application/use-cases/CommitWysiwygSession.ts` | Accettare `expectedActiveSnapshotId?: string \| null` in `execute()`; applicare **la stessa guardia**, prima di `snapshotRepo.create()` (riga 31). Per non duplicare logica, estrarre la guardia in un modulo condiviso — vedi punto 3. |
| 3 | `apps/api/src/application/use-cases/assertActiveSnapshotPrecondition.ts` (**nuovo**) | Funzione pura + repository: `assertActiveSnapshotPrecondition(repo, projectId, expected)`. Importata da entrambi i use-case. Unico punto in cui vive il messaggio, il `code` e lo `statusCode`. |
| 4 | `apps/api/src/presentation/http/routes/wysiwygRoutes.ts` | Inoltro del campo + evento `snapshot_conflict`. |
| 5 | `apps/web/lib/api/wysiwyg.ts` | Aggiungere il campo all'input di `commitWysiwygSession()` (righe 53-65). |
| 6 | `apps/web/app/workspace/[projectId]/page.tsx` | Passare il campo nel ramo C5 (righe 1583-1595) e riusare lo stesso handler 409. |

Se durante l'implementazione la Wave 2 risultasse più invasiva del previsto, è accettabile
consegnarla come PR separata: la Wave 1 copre 4 delle 5 origini e tutte quelle ad alto
rischio. **Non** è accettabile chiudere l'iniziativa senza Wave 2, perché B2 resterebbe un
bypass documentato.

### 7.3 Wave 3 — opzionale, da valutare separatamente

Due elementi deliberatamente **fuori** dal perimetro di accettazione:

1. **Correzione di `normalizeHttpError` per onorare anche `.status`** (§3.4). Una riga in
   `httpError.ts:62`, ma cambia lo status osservabile di 16 call site esistenti (404/400/409
   oggi emessi come 500). Va consegnata con test propri per ciascun call site toccato e
   verifica delle gestioni frontend esistenti. Alternativa più conservativa: normalizzare i 16
   call site su `statusCode` lasciando `normalizeHttpError` invariato.
2. **Optimistic locking Mongo** (Opzione D). Solo se il monitoraggio degli eventi
   `snapshot_conflict` mostrasse conflitti realmente concorrenti anziché di scala umana.

---

## 8. Comportamento frontend sul conflitto

Il sistema di notifiche (`apps/web/lib/notifications.tsx:22-50`) espone
`{ label, status, message }` e nessun bottone d'azione. Non si introducono primitive nuove: la
via d'uscita è **automatica**, la spiegazione è testuale.

Handler condiviso, da definire una sola volta in `page.tsx` e riusare in C1–C5:

```ts
async function handleSnapshotConflict(err: unknown): Promise<boolean> {
    if (!(err instanceof ApiError) || err.status !== 409
        || err.code !== "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT") return false;
    if (token) await loadSnapshots(token);   // risincronizza lista, selezione ed editor
    addNotification({
        label: t("workspace.notifications.snapshot.conflictLabel"),
        status: "error",
        message: t("workspace.notifications.snapshot.conflict"),
    });
    return true;
}
```

Testo proposto (it): «La versione attiva del progetto è cambiata altrove (altra scheda o
sessione). La tua modifica **non** è stata applicata per non sovrascriverla. Abbiamo ricaricato
l'ultima versione: rivedila e ripeti l'operazione.»
(en): «The project's active version changed elsewhere (another tab or session). Your change was
**not** applied, to avoid overwriting it. The latest version has been reloaded — review it and
retry.»

Regole per call site:

- **C1 `saveMediaVersion`** — oggi ritorna `false` in `catch` (righe 1044-1046): intercettare
  prima il 409, notificare, ritornare `false`. Il chiamante mostra già "media applicato senza
  versionamento": resta coerente.
- **C2 / C3 / C5** — oggi il `catch` gestisce solo il 401 e ingoia tutto il resto (righe
  1437-1440, 1611-1614): aggiungere il ramo 409 **prima**. È qui che l'utente oggi non vede
  assolutamente nulla.
- **C4 `handleSend`** — il `catch` è vuoto e non bloccante (righe 2277-2279). Caso più delicato:
  la risposta LLM è già stata salvata come messaggio e i token sono già stati spesi, ma lo
  snapshot **non** viene creato. La notifica deve dirlo esplicitamente e la risincronizzazione
  deve avvenire comunque, così l'utente può rilanciare la richiesta sulla base aggiornata.
  Non tentare alcun retry automatico: rigenererebbe costi su una base diversa da quella che
  l'utente ha visto.

Nessun conflitto è mai silenzioso: 409 → risincronizzazione → notifica esplicita.

---

## 9. Test

Convenzioni: [TESTING_POLICY.md](../guides/TESTING_POLICY.md) — co-locazione in `__tests__/`,
fixture reali, mock solo ai confini di sistema.

### 9.1 Livello use-case — `apps/api/src/application/use-cases/__tests__/CreatePreviewSnapshot.concurrency.test.ts` (nuovo)

Fake repository in-memory che replica la semantica reale di `create({activate:true})`
(azzera `isActive` su **tutto il progetto**, poi inserisce) — stesso approccio del fake in
`ActivatePreviewSnapshot.test.ts`. Nome del file per comportamento, non per sorgente, come
previsto da TESTING_POLICY §1 (esiste già `PreviewSnapshotMediaResolution.test.ts` come
precedente).

| Caso | Atteso |
|---|---|
| `expectedActiveSnapshotId` assente, esiste un attivo diverso | Creazione riuscita — **retrocompatibilità** |
| `expectedActiveSnapshotId` = id dell'attivo corrente | Creazione riuscita, nessun 409 |
| `expectedActiveSnapshotId` = id di uno snapshot non più attivo | 409 + `code` + `details.{expected,actual}` corretti |
| `expectedActiveSnapshotId: null` e nessuno snapshot attivo | Creazione riuscita — **prima generazione** |
| `expectedActiveSnapshotId: null` ma esiste un attivo | 409 |
| Conflitto rilevato | `repository.create` **mai** chiamato; nessuno snapshot inserito |
| `activate: false` + `expectedActiveSnapshotId` disallineato | Creazione riuscita — la guardia vale solo per l'attivazione |
| `expectedActiveSnapshotId ≠ parentSnapshotId`, ma expected = attivo reale | Creazione riuscita — **ramificazione volontaria** (§3.2), il caso che l'Opzione A avrebbe rotto |
| Placeholder media non risolti **e** conflitto | 400, non 409 — precedenza degli errori invariata |

Analogo per Wave 2: `CommitWysiwygSession.concurrency.test.ts`.

### 9.2 Livello integrazione reale — `tests/api/previewSnapshot-concurrency.test.ts` (nuovo)

Replica esatta del pattern di `tests/api/previewSnapshot-activation.test.ts`
(`MongoMemoryServer`, `node:test`, `MONGODB_URI` impostata prima dell'import dinamico del
repository). Esercita `MongoPreviewSnapshotRepository` reale insieme a `CreatePreviewSnapshot`
reale.

Scenario centrale — riproduzione fedele del bug:

1. Tab A e Tab B leggono lo stesso stato: attivo = `v1`.
2. Tab B crea `v2` con `expectedActiveSnapshotId = v1` → riesce; attivo = `v2`.
3. Tab A (stale) crea `v3` con `expectedActiveSnapshotId = v1` → **409**.
4. Asserzioni: `getActiveForProject()` è ancora `v2`; `listByProject()` contiene esattamente
   2 documenti (nessun `v3` inserito); esattamente 1 documento con `isActive: true`.
5. Tab A risincronizza (`getActiveForProject()` → `v2`) e riprova con
   `expectedActiveSnapshotId = v2` → riesce; attivo = `v3`; ancora esattamente 1 attivo.

Casi aggiuntivi:

- **Clobbering cross-conversazione**: attivo in `conv-a`; creazione in `conv-b` con
  `expectedActiveSnapshotId` che punta a uno snapshot di `conv-a` ormai superato → 409. Prova
  che lo scope di progetto (`getActiveForProject`) è quello giusto e che
  `getActive(projectId, conversationId)` sarebbe stato insufficiente.
- **Progetto vuoto**: prima creazione con `null` → riesce.
- **Nessuna precondizione**: creazione senza il campo su progetto con attivo diverso → riesce
  (E2E e chiamanti server-side restano validi).

Registrare il file in `package.json` → `test:e2e` (elenco esplicito, non glob — vincolo già
documentato in TEST_COVERAGE_ROADMAP §7.1) e verificarne l'esecuzione nel job `test-e2e`.

### 9.3 Non-regressione obbligatoria

Devono restare verdi **senza modifiche**:

- `apps/api/src/application/use-cases/__tests__/ActivatePreviewSnapshot.test.ts`
- `apps/api/src/application/use-cases/__tests__/PreviewSnapshotMediaResolution.test.ts`
- `tests/api/previewSnapshot-activation.test.ts`
- `tests/e2e/*.spec.ts` e `tests/e2e/helpers/test-user.ts`

Se uno di questi richiede una modifica, la modifica al contratto è sbagliata: il campo deve
essere opzionale e senza `.default()`.

---

## 10. Criteri di accettazione

1. **Il bug non si riproduce.** Lo scenario a due tab di §9.2 produce 409 e lascia intatta la
   versione attiva reale. Verificato dal test di integrazione su Mongo reale.
2. **Zero regressioni.** `npm run test --workspaces` e `npm run test:e2e` verdi; i quattro
   gruppi di §9.3 invariati; typecheck `apps/api` e `apps/web` puliti.
3. **Flussi legittimi intatti**, ciascuno con un test dedicato:
   prima creazione in progetto vuoto · modifiche sequenziali in singola tab ·
   ramificazione volontaria da versione più vecchia · chiamanti senza precondizione.
4. **Copertura di tutti i percorsi di attivazione.** B1 e B2 applicano entrambi la guardia
   tramite lo stesso modulo condiviso; tutte e 5 le origini client inviano il campo. Verifica:
   una ricerca di `activate: true` in `apps/web` e di `.create(` sul repository snapshot non
   restituisce alcun percorso privo di precondizione.
5. **L'errore arriva davvero come 409.** Test che asserisce lo status HTTP, non solo il tipo di
   eccezione — protegge dal difetto `.status` di §3.4.
6. **L'utente vede il conflitto.** In tutti e 5 i call site un 409 produce
   risincronizzazione + notifica; nessun ramo `catch` silenzioso residuo. Verifica manuale:
   due tab sullo stesso progetto, modifica in A, poi modifica in B → B mostra la notifica,
   ricarica la versione di A, e la versione di A resta attiva.
7. **Il conflitto è interrogabile.** Un evento `snapshot_conflict` compare in `ExecutionLog`
   con `expectedActiveSnapshotId` e `actualActiveSnapshotId`.
8. **Documentazione allineata.** Questo file linkato da `docs/INDEX.md`;
   `TEST_COVERAGE_ROADMAP.md` §3.2 item 3 aggiornato a "pianificato" e, alla consegna,
   spuntato nel delivery log §7.

---

## 11. Rischi, non-obiettivi, limiti noti

**Rischi**

| Rischio | Mitigazione |
|---|---|
| 409 spurio se il ref client dell'attivo non è aggiornato | Il ref si aggiorna dallo stesso `previewSnapshots` che alimenta la UI: se la UI mostra v7 come attiva, il ref dice v7. Coperto dal caso "modifiche sequenziali" in §9.1. |
| C4: token già spesi, snapshot rifiutato | Nessun retry automatico; notifica esplicita che la generazione non è stata versionata. Scelta consapevole: un retry su base diversa costerebbe di nuovo e produrrebbe un risultato che l'utente non ha visto. |
| Wave 2 dimenticata → B2 resta scoperto | Criterio di accettazione 4 la rende bloccante. |
| Il nuovo errore esce come 500 | Criterio di accettazione 5 + uso esplicito di `statusCode`. |

**Non-obiettivi espliciti**

- Nessun realtime/polling/websocket sullo stato snapshot: fuori perimetro.
- Nessun merge automatico o three-way delle modifiche in conflitto.
- Nessun locking pessimistico o "chi edita adesso".
- Nessuna modifica al modello dati persistito.
- Nessun intervento sulla catena di generazione LLM o sul Focus Patch.

**Limite noto accettato.** Resta una finestra TOCTOU di millisecondi fra
`getActiveForProject()` e `create()`. Non è la finestra in cui il bug si manifesta (che è di
minuti od ore). L'Opzione D la chiuderebbe; è documentata in §7.3 come irrobustimento
successivo, non come requisito.

---

## 12. Governance e consegna

- Branch: `fix/preview-snapshot-concurrency-guard` da `develop` (Gitflow, `CLAUDE.md`).
- Commit convenzionali; Wave 1 e Wave 2 in commit distinti, eventualmente in PR distinte.
- Prima di branch/commit/merge: `npm run gitflow:guard`, `npm run release:version:validate`,
  [AGENT_RELEASE_CHECKLIST.md](../guides/AGENT_RELEASE_CHECKLIST.md).
- Aggiornare `docs/guides/TEST_COVERAGE_ROADMAP.md` §7 (delivery log) alla consegna, non prima.
- Questo documento resta `Proposed` finché la revisione del proprietario non lo approva:
  nessuna implementazione va avviata sulla sola base di questo file.
