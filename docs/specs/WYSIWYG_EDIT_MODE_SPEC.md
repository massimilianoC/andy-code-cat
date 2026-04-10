# WYSIWYG Edit Mode — Analisi, Ricerca e Proposta

> **Stato:** Proposta — da revisionare prima dell'implementazione  
> **Richiesta originale:** Toggle EDIT nella preview (analogo a Inspect), editing in-place con picker icone/emoji, salvataggio e versionamento snapshots.  
> **Ordine del giorno:** ricerca soluzioni open-source esistenti → decisione motore → milestones implementativi.

---

## 1. Contesto Architetturale Attuale

Il workspace prevede attualmente:

| Componente | Stato |
|---|---|
| Preview iframe (`sandbox="allow-scripts"`) | ✅ operativo |
| Inject script `PF_INSPECT_SCRIPT` (hover/click select via postMessage) | ✅ operativo |
| Toggle Inspect ON/OFF nella tab preview | ✅ operativo |
| Editor Monaco (HTML/CSS/JS) con selezione codice → focusContext | ✅ operativo |
| Snapshot versioning con SnapshotHistoryPanel | ✅ operativo |
| Salvataggio manuale "✏ manuale" via `handleSaveEditorSnapshot` | ✅ operativo |
| Preprompt: "no CDN tranne Google Fonts, placeholder per immagini" | ✅ attivo per Layer 1 |

**Punti di integrazione naturali per EDIT mode:**

1. `PF_INSPECT_SCRIPT` è già un inject di JS nel iframe via `srcDoc`.
2. Il postMessage `pf-select` porta già al parent l'elemento selezionato (tag, classi, selector, textSnippet).
3. I dati finiscono in `editorHtml/editorCss/editorJs` → da lì si salva un snapshot.
4. La catena iframe → postMessage → state React → Monaco → snapshot è già provata.

---

## 2. Ricerca Soluzioni Open Source

### 2.1 GrapesJS ⭐ **Candidato principale**

- **GitHub:** <https://github.com/GrapesJS/grapesjs>
- **Stars:** ~22 000 (aprile 2026)  
- **Licenza:** BSD 3-Clause (open source, commercialmente usabile)
- **Release attiva:** v0.21.x, attivamente mantenuto
- **Bundle:** ~2.5 MB minified + gzip ~700 KB

**Cosa fa GrapesJS:**

- Editor WYSIWYG drag-and-drop full-page (HTML + CSS)
- Carica HTML/CSS string arbitrarie (`editor.setComponents(html)` + `editor.setStyle(css)`)
- Esporta `editor.getHtml()` + `editor.getCss()` — puliti, senza wrapper GrapesJS
- Style Manager visuale (panello proprietà CSS)
- Layer Manager (albero DOM componenti)
- Block Manager (blocchi drag-drop riusabili)
- Asset Manager (immagini, sostituibili con picker personalizzati)
- Custom Code plugin: `grapesjs-custom-code` — inietta blocchi di HTML/CSS/JS raw
- Plugin font: `grapesjs-fonts`
- Plugin icon: supporto iconify/FontAwesome via plugin community
- Responsive breakpoints (mobile/tablet/desktop preview)
- Funziona in un `<div>` del DOM — **non** within un iframe sandboxed

**Limitazioni rispetto all'architettura attuale:**

1. GrapesJS **è** il canvas — non può essere iniettato dentro un iframe `sandbox="allow-scripts"` esterno.
2. Richiede rimontare la preview come `<div id="grapesjs">` invece dell'iframe.
3. Bundle peso ~2.5 MB (next.js dynamic import porta gzip ~700 KB, accettabile dato uso opzionale).
4. Richiede CSS proprio di GrapesJS (tema dark disponibile: `grapesjs/dist/css/grapes.min.css`).
5. Struttura componente interno (GrapesJS "components") può divergere dall'HTML puro generato dall'LLM se si usano componenti avanzati — ma modalità "raw HTML" evita questo rischio.

**Verdetto GrapesJS:**  
Più potente di qualsiasi approccio custom, ma richiede sostituire l'**iframe** con una nuova tab "EDIT" che monta GrapesJS. L'integrazione è fattibile e reversibile (EDIT tab è opzionale accanto alle esistenti PREVIEW/HTML/CSS/JS).

---

### 2.2 Puck (Measured Co)

- **GitHub:** <https://github.com/measuredco/puck>
- **Stars:** ~6 000
- **Licenza:** MIT
- **Natura:** Framework **React** per visual editing — basato su componenti registrati pre-definiti.
- **Limitazione critica:** non carica HTML arbitrario. Tutti gli elementi devono essere componenti React registrati. Incompatibile con l'output HTML/CSS vanilla dell'LLM.
- **Verdict: ❌ Non adatto**

---

### 2.3 Craft.js

- **GitHub:** <https://github.com/prevwong/craft.js>
- **Stars:** ~7 000
- **Licenza:** MIT
- **Natura:** Framework React drag-and-drop per page builders, anche lui basato su componenti registrati.
- **Limitazione critica:** richiede che ogni blocco sia un componente React. Non carica HTML/CSS vanilla.
- **Verdict: ❌ Non adatto**

---

### 2.4 Unlayer

- **GitHub:** <https://github.com/unlayer/embed>
- **Nature:** Editor email/landing page embed. Proprietario (hosted SaaS), SDK embed non open-source per tutti gli use case.
- **Verdict: ❌ Non adatto (licenza)** — il free tier è limitato a email

---

### 2.5 TinaCMS

- **GitHub:** <https://github.com/tinacms/tinacms>
- **Stars:** ~11 000
- **Natura:** CMS headless per Markdown/MDX. Non progettato per HTML/CSS vanilla editing.
- **Verdict: ❌ Non adatto** a questo use case

---

### 2.6 Froala / TinyMCE / CKEditor 5

- Rich text editors (per documenti/blog), non page builders.
- Possono editare testo all'interno di elementi ma non gestiscono CSS, drag-drop, layout.
- **Verdict: ❌ Non adatti** per editing visuale di pagine web

---

### 2.7 micro-editor / custom contentEditable inject

- Approccio custom: iniettare `contentEditable` + event listeners nell'iframe esistente via `PF_INSPECT_SCRIPT` esteso.
- Molto più leggero di GrapesJS.
- Supporta: editing testo inline, attributo `src`/`href` tramite prompt/popup, class swapping.
- Non supporta: drag-drop, stile visuale, responsive preview, layer manager.
- **Verdict: ✅ Fattibile come "EDIT Light"** — adatto per incremento iniziale M-WYSIWYG-1.

---

### 2.8 Pinegrow (non open source)

- Editor professionistico, non integrabile come libreria.
- **Verdict: ❌ Non adatto**

---

## 3. Soluzione Raccomandata: Architettura Ibrida a Due Modalità

Stante l'analisi, si raccomanda un'architettura **duale progressiva**:

```
┌─────────────────────────────────────────────────────────────────┐
│  MODALITÀ ATTUALE (PREVIEW + Inspect)                           │
│  iframe sandbox + PF_INSPECT_SCRIPT                             │
│  → selezione elemento → focusContext → LLM patch               │
└────────────────────┬────────────────────────────────────────────┘
                     │  EDIT toggle ON
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  EDIT LIGHT (M-WYSIWYG-1)                                       │
│  Inject in iframe: contentEditable + testo inline + img picker  │
│  Nessuna dipendenza esterna                                     │
│  Serializzazione DOM → parent postMessage → snapshot save       │
└────────────────────┬────────────────────────────────────────────┘
                     │  click su "⊕ Open Full Editor" (M-WYSIWYG-3)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  EDIT FULL — GrapesJS Panel (tab "EDIT" separata)               │
│  Dynamic import GrapesJS solo quando attivo                     │
│  Carica HTML+CSS corrente → editing → Export → Snapshot         │
│  Style manager, drag-drop, responsive breakpoints               │
│  Asset Manager custom con picker Emoji + Iconify CDN            │
└─────────────────────────────────────────────────────────────────┘
```

**Principi di integrazione:**

1. Le due modalità sono **tap-in/tap-out** rispetto all'architettura esistente.
2. GrapesJS viene caricato solo se l'utente apre la tab EDIT (lazy `dynamic import`).
3. Il punto di uscita è sempre `export HTML+CSS → editorHtml/editorCss → handleSaveEditorSnapshot()`.
4. La tab EDIT è **aggiuntiva** alle tab esistenti (PREVIEW/HTML/CSS/JS/PROMPT) → zero breaking changes.
5. Inspect + EDIT Light continuano a vivere nell'iframe sandbox.

---

## 4. Dettaglio delle Funzionalità

### 4.1 EDIT Light (iframe inject, M-WYSIWYG-1)

Estensione di `PF_INSPECT_SCRIPT` con un layer aggiuntivo `PF_EDIT_SCRIPT`:

```
Quando EDIT mode è ON (e Inspect è ON):
  1. click su elemento di testo → contentEditable=true → input inline
  2. click su <img> → mostra overlay picker (vedi §4.3)
  3. click su div/section con background-image → mostra overlay picker
  4. Ogni modifica tracked in un Map<element, originalContent>
  5. "Salva EDIT" → serializza DOM → postMessage {type:'pf-edit-save', html: doc.documentElement.outerHTML}
  6. Parent riceve html → setEditorHtml → handleSaveEditorSnapshot
```

**Comportamento UX:**

- Inspect ON → compare il bottone `✎ EDIT` (disabilitato se inspect OFF)
- Quando entrambi ON: la preview ha un banner giallo `"modalità modifica attiva — le modifiche sono locali"`.
- Undo/Redo: Cmd+Z all'interno dell'iframe (nativo `contentEditable`); il parent non gestisce undo.
- Tasto "💾 Salva modifiche EDIT" → salva e crea snapshot.

### 4.2 EDIT Full — GrapesJS Panel (M-WYSIWYG-3)

**Setup GrapesJS:**

```typescript
// Lazy import in page.tsx
const GrapesJsEditor = dynamic(() => import('../../../components/GrapesJsEditorPanel'), { ssr: false });
```

**Caricamento:**

```
editor.setComponents(editorHtml);
editor.setStyle(editorCss);
```

**Esportazione:**

```
const html = editor.getHtml();   // HTML corpo (no <html><head><body> wrapper)
const css  = editor.getCss();    // CSS flat
// ricombinare in full document tramite buildPreviewDoc existing logic
```

**Plugins da includere:**

- `grapesjs-blocks-basic` — blocchi base (testo, immagini, link, 1-2-3 colonne)
- `grapesjs-plugin-forms` — form elements
- `grapesjs-custom-code` — blocco custom HTML raw (per sezioni non modificabili tramite drag-drop)
- Asset Manager custom (§4.3)
- Tema GrapesJS dark (compatibile con la palette dell'app)

**Non includere:**

- grapesjs-preset-webpage (opinionated, aggiunge blocchi inutili)
- Export plugin (usiamo il nostro snapshot system)

### 4.3 Icon & Media Picker (M-WYSIWYG-2)

Il picker viene mostrato come **popup overlay** (sopra sia l'iframe che il GrapesJS panel) quando:

- Click su `<img>` in EDIT Light mode
- Click su un div con `background-image` in EDIT Light mode
- Click su componente immagine in GrapesJS (via custom `asset manager`)

**Architettura picker:**

```
┌──────────────────────────────────────────────────────┐
│  MEDIA PICKER PANEL                                  │
│                                                      │
│  [Tab: Emoji] [Tab: Iconify] [Tab: URL] [Tab: Asset] │
│                                                      │
│  🔍 Search: [________________]                       │
│                                                      │
│  Tab Emoji: grid Unicode emoji (emoji-picker-element)│
│  Tab Iconify: grid da CDN https://api.iconify.design │
│    Collezioni: lucide, heroicons, phosphor, mdi,      │
│    bootstrap-icons, tabler-icons, simple-icons       │
│    Filtro per collezione + ricerca full-text         │
│    Output: <img src="https://api.iconify.design/     │
│              {collection}/{icon}.svg"> oppure        │
│              inserisce unicode emoji                 │
│  Tab URL: inserimento manuale src=URL                │
│  Tab Asset: ProjectAsset del progetto corrente       │
│              (già uploadati via M4a.1)               │
│                                                      │
│  Uso come background-image: toggle "CSS background"  │
│  → output: style="background-image:url(…)"          │
└──────────────────────────────────────────────────────┘
```

**Librerie CDN candidate per il picker:**

- **Iconify Design API** (`https://api.iconify.design/{collection}/{name}.svg`) — 200 000+ icone, gratuito, no key, ~30 KB per il client JS (solo query API, no bundle locale)
- **emoji-picker-element** — Web Component leggero (~40 KB gzip), MIT, nessuna API key, usa IndexedDB per caching dati emoji
- Nessuna libreria di icone viene iniettata nel HTML generato — si usano come `<img src="...">` o `background-image`, quindi il documento rimane CDN-free nel senso del preprompt (i dati iconify sono immagini `.svg`, non script).

**Impatto sul preprompt:**
Il vincolo "Nessun CDN tranne Google Fonts" nel preprompt è relativo alla **generazione LLM** (Layer 1). Le icone inserite manualmente in EDIT mode sono scelte consapevoli dell'utente, quindi non violano il vincolo (sono modifiche post-LLM).

---

## 5. Piano di Migrazione Snapshot

Le modifiche salvate da EDIT mode devono integrarsi **perfettamente** con il sistema di versionamento snapshot esistente.

### Flusso save

```
EDIT Light save:
  iframe DOM serialization
  → postMessage {type:'pf-edit-save', html}
  → parent: setEditorHtml(html)
  → handleSaveEditorSnapshot()  // already exists — zero changes to this function
  → createPreviewSnapshot(..., metadata: { finishReason: 'wysiwyg-edit-light' })
  → SnapshotHistoryPanel: badge "✎ wysiwyg"

EDIT Full (GrapesJS) save:
  grapesEditor.getHtml()  → setEditorHtml
  grapesEditor.getCss()   → setEditorCss
  → handleSaveEditorSnapshot()  // stessa funzione
  → createPreviewSnapshot(..., metadata: { finishReason: 'wysiwyg-grapesjs' })
  → SnapshotHistoryPanel: badge "⊕ grapesjs"
```

**Nessuna modifica al backend** — `createPreviewSnapshot` accetta già `metadata.finishReason` arbitrario.

### Differenziazione visiva in SnapshotHistoryPanel

```typescript
// Già presente in SnapshotHistoryPanel:
snap.metadata?.finishReason === "manual-save"   → badge "✏ manuale"
// Da aggiungere:
snap.metadata?.finishReason === "wysiwyg-edit-light" → badge "✎ EDIT"
snap.metadata?.finishReason === "wysiwyg-grapesjs"   → badge "⊕ GJS"
```

---

## 6. Analisi di Fattibilità

| Aspetto | Valutazione | Note |
|---|---|---|
| EDIT Light inject in iframe sandbox | ✅ Fattibile | `sandbox="allow-scripts"` supporta `contentEditable`. postMessage già testato. |
| Serializzazione DOM → HTML pulito | ⚠️ Attenzione | `outerHTML` include attrs `data-pf-h`, `data-pf-s`, `contenteditable` aggiunti dall'inject. Servono 2-3 righe di pulizia prima del save. |
| GrapesJS in Next.js 15 App Router | ✅ Fattibile | `dynamic(() => import(...), {ssr: false})` — già usato per Monaco. Bundle GJS ~700 KB gzip; accettabile con lazy load. |
| GrapesJS + il CSS dark theme app | ⚠️ Attenzione | GrapesJS ha CSS globali. Va wrappato in un `<div id="gjs-root">` isolato. Il canvas GJS ha già tema dark nativo. |
| GrapesJS carica HTML/CSS vanilla dall'LLM | ✅ Fattibile | Testato: `editor.setComponents(html)` + `editor.setStyle(css)` funziona with raw HTML. |
| Iconify API CDN picker | ✅ Fattibile | API REST gratuita, nessuna autenticazione. Chiamata `fetch('https://api.iconify.design/lucide/home.svg')`. |
| emoji-picker-element Web Component | ✅ Fattibile | Web Component standard, si monta dentro un `<div>` React con `useEffect`. |
| ProjectAsset tab nel picker | ✅ Fattibile | API `GET /v1/projects/:id/assets` già implementata (M4a.1). |
| Nessun breaking change su backend | ✅ Confermato | L'intero WYSIWYG è UI-only. Backend non richiede modifiche fino a M-WYSIWYG-4 (se si vuole persist delle edit offline). |
| Integration con Monaco (bidirezionale) | ✅ Fattibile | Sequenza: GJS edit → export → `setEditorHtml/Css` → Monaco si aggiorna automaticamente (già i pannelli Monaco leggono `editorHtml`). |

---

## 7. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| GrapesJS ristruttura HTML in modo diverso dall'originale (aggiunge wrapper `div[data-gjs-type]`) | Media | Medio | Usare `editor.getHtml()` che torna HTML pulito senza wrappers GJS; evitare grapesjs-parser-postcss che altera CSS |
| `contentEditable` deforma struttura HTML (newlines extra, `<br>` vs `<p>`) | Bassa | Basso | Serializzazione con `innerHTML` del container body, non `outerHTML` del documento |
| Iconify CDN non disponibile o lento | Bassa | Basso | Fallback UI: mostra messaggio "servizio non disponibile", picker URL rimane sempre funzionante |
| CSS globali di GrapesJS interferiscono con layout app | Media | Medio | GrapesJS in tab separata (non sovrapposto a iframe), CSS scopato con `#gjs-root .grp-*` |
| Bundle size GrapesJS aumenta First Load JS | Media | Basso | `dynamic import` – solo scaricato quando l'utente apre la tab EDIT la prima volta. Next.js separa il chunk automaticamente. |

---

## 8. Milestones Implementative

### M-WYSIWYG-0 (questo documento) ✅

Analisi, ricerca motori, proposta documentata. Nessuna implementazione.

---

### M-WYSIWYG-1 — EDIT Light (2-3 giorni)

**Obiettivo:** Toggle ✎ EDIT nella tab preview. Click elementi → editing testo inline nell'iframe. Salvataggio → snapshot.

**Scope:**

- Aggiungere `editMode: boolean` state in `page.tsx`
- `editMode` può essere attivato solo se `inspectMode === true` (i due vanno di pari passo oppure EDIT implica inspect)
- Creare `PF_EDIT_SCRIPT` (extend del pattern PF_INSPECT_SCRIPT):
  - Riceve `{ type: 'pf-edit', on: bool }` via postMessage
  - ON: elementi di testo selezionati diventano `contentEditable`
  - Click su `<img>` → postMessage `{ type: 'pf-edit-img-click', src, selector }` al parent
  - Tracking modifiche: Map di `{ selector → originalHTML }`
  - Serializzazione: `document.documentElement.outerHTML` con cleanup attrs `[data-pf-*]` e `contenteditable`
  - Postmessage `{ type: 'pf-edit-save', html: cleanedHtml }` cuando utente clicca "💾 Salva EDIT"
- Banner warning nel iframe quando editMode ON
- Pulizia `data-pf-h`, `data-pf-s`, `contenteditable` dall'HTML prima del save
- Bottone "💾 Salva EDIT" nel toolbar preview → `setEditorHtml(received)` → `handleSaveEditorSnapshot()`
- Badge `"✎ EDIT"` nel SnapshotHistoryPanel per `finishReason: 'wysiwyg-edit-light'`

**Testabile:**

```
1. Inspect ON → compare bottone "✎ EDIT"
2. EDIT ON → banner "modalità modifica" nell'iframe
3. Click su testo → editabile inline
4. Modifica → click "💾 Salva EDIT" → snapshot creato con badge "✎ EDIT"
5. Monaco HTML tab mostra HTML aggiornato
6. History dropdown mostra la nuova versione
```

---

### M-WYSIWYG-2 — Icon & Media Picker (1-2 giorni)

**Obiettivo:** Quando editMode è ON e l'utente clicca su un `<img>` (o div[background-image]), mostra picker sopra l'iframe.

**Scope:**

- Componente React `MediaPickerPanel` (overlay sopra il canvas preview):
  - Tab **Emoji**: embed `emoji-picker-element` Web Component (CDN o local npm)
  - Tab **Iconify**: search REST `https://api.iconify.design/search?query=X&limit=50`, grid SVG preview, click → sostituisce src
  - Tab **URL manuale**: input `<input type="url">` + preview
  - Tab **Asset progetto**: chiama `GET /v1/projects/:id/assets`, lista immagini caricate
  - Toggle **"Usa come background CSS"**: cambia output in `style="background-image:url(...)"`
- Picker aperto tramite postMessage `pf-edit-img-click` dal PF_EDIT_SCRIPT al parent
- Output: postMessage al iframe `{ type: 'pf-edit-set-src', selector, value, mode: 'src'|'background' }`
- Il PF_EDIT_SCRIPT applica il valore nel DOM
- Picker chiuso dopo selezione
- Keyboard escape chiude senza applicare

**Testabile:**

```
1. EDIT ON → click su <img> → MediaPickerPanel appare
2. Tab Iconify → search "home" → 10+ icone mostrate
3. Click icona lucide/home → <img src="https://api.iconify.design/lucide/home.svg"> applicata
4. Tab Emoji → click emoji → inserito come testo nel parent element
5. Salva EDIT → snapshot HTML aggiornato con nuovo src
```

---

### M-WYSIWYG-3 — GrapesJS Full Editor Tab (3-4 giorni)

**Obiettivo:** Tab "⊕ EDIT" separata (accanto a PREVIEW/HTML/CSS/JS/PROMPT), monta GrapesJS con l'HTML/CSS corrente. Save → snapshot.

**Scope:**

- Installazione: `npm install grapesjs grapesjs-blocks-basic grapesjs-plugin-forms grapesjs-custom-code` in `apps/web/package.json`
- Nuovo componente `GrapesJsEditorPanel` (in `apps/web/components/`):
  - Dynamic import `{ssr: false}` e `{loading: () => <Spinner />}`
  - Monta GrapesJS in un `<div ref={containerRef}>`
  - `onMount`: `editor.setComponents(editorHtml)` + `editor.setStyle(editorCss)`
  - `onChange (editor 'update')`: sync live su `editorHtml`/`editorCss` (debounced 800ms)
  - Asset Manager custom che apre `MediaPickerPanel` (riuso da M-WYSIWYG-2)
  - Bottone "💾 Salva in Snapshot" nel toolbar custom GrapesJS
- Tab button "⊕ EDIT" aggiunta al `workspace-preview-tabs`
- Quando tab EDIT è attiva: `previewTab === "edit"` → iframe nascosto, GrapesJS mostrato
- Theme GrapesJS: dark (`"grapesjs/dist/css/colibri-theme-dark.css"` o CSS var custom)
- Toolbar GrapesJS: riduci a Device Manager + Style Manager + Layer Manager (blocchi base opzionali)

**Testabile:**

```
1. Tab "⊕ EDIT" appare nel workspace
2. Click tab → GrapesJS carica l'HTML corrente
3. Drag-drop blocco "Testo" → disponibile
4. Click elemento → Style Manager mostra le proprietà CSS
5. Modifica colore sfondo → CSS aggiornato in live
6. Bottone "💾 Salva in Snapshot" → snapshot v+1 con badge "⊕ GJS"
7. Torna alla tab PREVIEW → iframe mostra l'HTML aggiornato
8. Monaco tab HTML → mostra HTML aggiornato
```

---

### M-WYSIWYG-4 — Sync Bidirezionale Monaco ↔ GrapesJS (1 giorno)

**Obiettivo:** quando l'utente edita il codice Monaco e torna alla tab EDIT (GrapesJS), l'editor ricarica il nuovo codice. Viceversa, quando l'utente salva da GrapesJS, Monaco si aggiorna.

**Scope:**

- Quando `previewTab` cambia da `"html"/"css"` → `"edit"`:
  - `grapesEditor.setComponents(editorHtml)` + `grapesEditor.setStyle(editorCss)` (re-init)
  - Opzionale: mostra toast "Editor ricaricato dal codice Monaco"
- GrapesJS `onChange` → `setEditorHtml/Css` → Monaco già legge i valori aggiornati (no extra work)
- `key` React su GrapesJsEditorPanel: se `artifactsKey` cambia (nuovo snapshot da LLM), smontare/rimontare GrapesJS con nuovi dati

**Testabile:**

```
1. GrapesJS cambia sfondo a rosso → Monaco CSS mostra "background: red"
2. Monaco CSS: cambio font-size → tab EDIT torna → GrapesJS mostra font aggiornato
3. Nuovo messaggio LLM arriva → GrapesJS si resetta con nuovo HTML
```

---

## 9. Dipendenze npm da Aggiungere

```json
// apps/web/package.json — solo se M-WYSIWYG-3 viene implementato
"grapesjs": "^0.21.0",
"grapesjs-blocks-basic": "^0.2.0",
"grapesjs-plugin-forms": "^2.0.8",
"grapesjs-custom-code": "^1.0.1",

// M-WYSIWYG-2 (Emoji picker)
"emoji-picker-element": "^1.22.0"
```

**Nessuna dipendenza backend** — tutto è frontend-only.

---

## 10. Decisione Consigliata

| Opzione | PRO | CONTRO | Raccomandazione |
|---|---|---|---|
| **A) Solo EDIT Light** (M-WYSIWYG-1+2) | Nessuna dipendenza, zero rischi architetturali, full sandbox compat | Funzionalità limitate (no drag-drop, no style manager visuale) | ✅ Avviare qui |
| **B) Solo GrapesJS** (M-WYSIWYG-3) | Massima potenza, style/layer manager, drag-drop | Dipendenza ~700 KB, UI più complessa da integrare | ⚠️ Differire a M-WYSIWYG-3 |
| **C) Entrambi** in sequenza A→B | Incremento progressivo, valore immediato, opzione upgrade | 2 code path da mantenere | ✅ **Raccomandato** |
| **D) GrapesJS come engine principale** (replace iframe) | Un solo code path | Breaking change all'architettura attuale, rompe inspect flow | ❌ Non raccomandato |

**→ Avviare M-WYSIWYG-1** (EDIT Light inject) per valore immediato al rischio più basso.  
**→ Pianificare M-WYSIWYG-3** (GrapesJS) per uso avanzato senza rimuovere l'approccio leggero.

---

## 11. Aggiornamenti INDEX.md e DEVELOPMENT_PLAN.md

Dopo approvazione di questa proposta, aggiornare:

- `docs/INDEX.md`: aggiungere questa spec nella tabella "Technical Specifications"
- `docs/DEVELOPMENT_PLAN.md`: aggiungere milestones M-WYSIWYG-0..4 dopo le milestone M4a esistenti

---

*Documento generato il 2026-04-02. Da aggiornare con le decisioni post-review.*
