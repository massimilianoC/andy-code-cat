# Andy Code Cat — Preset Tipizzati + Config Discovery + Prompt Modulare

> **Revisione:** 2026-04-08  
> **Stato:** PROPOSTA — da approvare prima dell'implementazione  
> **Dipendenze:** M0-STYLE ✅ (style profiling + moodboard), M4a ✅ (asset manager)  
> **Prepara:** M2 (PrepromptEngine modular layers)

---

## 0. Contesto e Motivazione

### 0.1 Stato attuale

| Componente | Stato | Problema |
|---|---|---|
| `PROJECT_PRESETS` in dashboard | Array di label + icona | Non connesso a nulla downstream. Click preset → popola solo il nome del progetto. |
| `ProjectConfigPopup` | Moodboard + tag + assets | La sezione sinistra non ha guida scopribile per tipo di progetto. Categorie tag incomplete vs. onboarding utente. |
| `prePromptTemplate` | Template Nunjucks flat per progetto | Monolitico. La parte "Landing Page" è mescolata al resto. Nessuna specializzazione per preset. |
| Asset thumb | Upload funziona, thumb per immagini | `useInProject` e `delete` nascosti in gear menu hover, non immediatamente visibili. |
| `StyleProfileResolver` | Non implementato (rinviato da M0-STYLE) | Il profilo utente + moodboard progetto non vengono mai usati per arricchire il system prompt. |

### 0.2 Obiettivo di questa milestone

Implementare in due sub-milestone incrementali (A e B) le basi per:

1. **Preset tipizzati** — ogni preset ha: output spec tecnica, brief template, tag defaults, blocco prompt modulare.
2. **Config Discovery guidata** — la popup di configurazione progetto diventa "discoverable": brief pre-compilato, tag per tipo di output, sezione sticky del preset selezionato.
3. **Prompt modulare** — il system prompt Layer 1 (chat-preview) viene spezzato in `base + style_enrichment + preset_module`, permettendo a M2 di costruire sopra senza refactoring.
4. **Asset thumb UX polish** — `useInProject` (flag "indicepabile") visibile sempre, delete accessibile senza hover.

---

## 1. Analisi Gap rispetto alle Richieste

### 1.1 Richieste utente mappate

| Richiesta | Componente impattato | Delta rispetto allo stato attuale |
|---|---|---|
| Preset → specifiche aggiuntive come "system" (analoghe a moodboard utente) | `ProjectPreset` catalog + `project.presetId` + Layer 1 system builder | Non esiste. Da costruire. |
| Profilazione guidata tag per tipo progetto (come onboarding utente) | `ProjectConfigPopup` left column + `TAG_CATEGORIES` completo | Parziale: 7 categorie su 10. Mancano `audience`, `feature`, `sector`. |
| Sezione sinistra discoverable per il brief pre-compilato per ogni stile | `ProjectConfigPopup` brief section + preset detection + hint template | Non esiste. Il brief è un textarea vuoto. |
| Tag per sezione nella popup di configurazione progetto | `ProjectConfigPopup` TAG_CATEGORIES | Già presenti in parte. Da completare con categorie mancanti. |
| Asset: thumbnail con `useInProject` visibile, eliminazione diretta | `AssetThumb` component | Parziale: thumb per immagini ✅, ma useInProject/delete dentro gear menu hover. |
| Motore di prompting incorpora le spec preset | Layer 1 system prompt builder | Non esiste separazione base/preset. Il prePromptTemplate è flat. |
| Specializzare il caso Landing Page/Website in parte dinamica | `prePromptTemplate` → `base_template + preset_module` | Da spezzare. |
| A4: forza CSS `@page A4` + dimensioni print | `PresetOutputSpec` per A4 | Da definire nel catalog. |
| Slide: multi-section 16:9 o 3:4 come pagine PDF | `PresetOutputSpec` per slideshow/keynote | Da definire nel catalog. |
| Infografica: masonry, icon-heavy, poster | `PresetOutputSpec` per infographic | Da definire nel catalog. |
| Manifesto: struttura comunicato politico/brand | `PresetOutputSpec` per manifesto | Da definire nel catalog. |
| Form: costruzione step guidato da compilare | `PresetOutputSpec` per form | Da definire nel catalog. |

---

## 2. Architettura Proposta

### 2.1 Entità: `ProjectPreset` (static catalog, solo backend)

Non è un documento MongoDB. È un catalogo statico in-code, come `StyleTag`. Evita
overhead DB per entity che non cambiano a runtime.

```typescript
// apps/api/src/domain/entities/ProjectPreset.ts

export interface PresetOutputSpec {
  /** Modello di pagina generata */
  pageModel: 'single_page' | 'multi_page' | 'slide_deck' | 'print_a4';
  
  /** Modello di scorrimento/navigazione */
  sectionModel: 'scroll' | 'paginated' | 'masonry' | 'stepped_form';
  
  /** Numero di pagine/slide previste (null = variabile) */
  recommendedPageCount?: number;
  
  /** Aspect ratio per output multi-pagina o stampa */
  aspectRatio?: '16:9' | '4:3' | 'A4_portrait' | 'A4_landscape' | 'free';
  
  /** Blocco CSS da iniettare hardcoded nell'output (vincoli di stampa, dimensioni slide) */
  cssConstraints?: string;  // es. "@page { size: A4 portrait; margin: 1.5cm; }"
  
  /** L'output è pensato per la stampa / esportazione PDF */
  printReady: boolean;
  
  /**
   * Blocco di istruzioni aggiuntive per il sistema di generazione.
   * Iniettato nel system message PRIMA del prePromptTemplate base.
   * Max 500 token. Istruzioni strutturali forti (es. "Ogni sezione deve occupare
   * esattamente larghezza 1270px × altezza 714px" per le slide 16:9).
   */
  systemPromptModule: string;
}

export interface PresetTagDefaults {
  /** Tag pre-selezionati per categoria alla creazione del progetto */
  visualTags?: string[];        // es. ["visual:minimal", "visual:corporate"]
  layoutTags?: string[];        // es. ["layout:hero-first"]
  toneTags?: string[];          // es. ["tone:formal-professional"]
  featureTags?: string[];       // es. ["feature:contact-form", "feature:pricing-table"]
  audienceTags?: string[];      // es. ["audience:b2b"]
  typographyTags?: string[];
  paletteTags?: string[];
}

export interface ProjectPreset {
  id: string;                   // slug: "landing", "a4poster", "slideshow", etc.
  label: string;                // "Landing Page"
  labelIt: string;
  labelEn: string;
  hint: string;                 // "Singola pagina orientata conversione"
  icon: string;                 // lucide icon name
  
  outputSpec: PresetOutputSpec;
  defaultTags: PresetTagDefaults;
  
  /** Brief template pre-compilato per la popup di configurazione */
  briefTemplate: string;        // max 600 chars, interpolabile con {{projectName}}
  
  /** Note di stile pre-compilate per la popup di configurazione */
  styleTemplate: string;        // max 400 chars
  
  /**
   * Domande guida per il brief discovery (sezione sinistra popup configurazione).
   * Array di stringhe mostrate come placeholder/accordion guidato.
   */
  briefGuideQuestions: string[];  // max 5 domande brevi
}
```

### 2.2 Catalogo Preset — 9 Preset Definiti

```typescript
export const PRESET_CATALOG: ProjectPreset[] = [

  // ── NEUTRAL ──────────────────────────────────────────────────────────────────
  {
    id: "neutral",
    label: "Vuoto / Neutro", labelIt: "Vuoto / Neutro", labelEn: "Blank / Neutral",
    hint: "Parti da una tela bianca",
    icon: "Sparkles",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'scroll',
      printReady: false,
      systemPromptModule: "",
    },
    defaultTags: {},
    briefTemplate: "",
    styleTemplate: "",
    briefGuideQuestions: [
      "Qual è lo scopo principale di questa pagina?",
      "Chi è il pubblico target?",
      "Qual è il messaggio principale da comunicare?",
    ],
  },

  // ── LANDING PAGE ─────────────────────────────────────────────────────────────
  {
    id: "landing",
    label: "Landing Page", labelIt: "Landing Page", labelEn: "Landing Page",
    hint: "Singola pagina orientata conversione",
    icon: "LayoutTemplate",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'scroll',
      printReady: false,
      systemPromptModule: `FORMATO OUTPUT — LANDING PAGE:
Struttura la pagina come landing page a conversione:
1. HERO: headline forte, subheading, CTA primaria above-the-fold.
2. SOCIAL PROOF / TRUST: testimonial, loghi clienti, numeri chiave.
3. FEATURES / VALORE: sezioni benefit con icone o immagini.
4. CTA secondaria o pricing table.
5. FOOTER: contatti, legal links.
Ogni sezione ha un obiettivo di conversione preciso. Niente distrazioni.
La CTA primaria deve essere visibile senza scroll.`,
    },
    defaultTags: {
      layoutTags: ["layout:hero-first"],
      featureTags: ["feature:contact-form"],
    },
    briefTemplate: "Landing page orientata alla conversione per {{projectName}}. L'obiettivo principale è generare lead/contatti/acquisti. Il pubblico target è [...]",
    styleTemplate: "Layout pulito con gerarchia visiva forte. Hero impattante, CTA ben visibile.",
    briefGuideQuestions: [
      "Qual è la singola azione che vuoi che il visitatore compia?",
      "Quali sono i 3 principali benefici del tuo prodotto/servizio?",
      "Chi è il cliente ideale (settore, ruolo, problema)?",
      "Hai testimonianze o dati di prova da includere?",
      "Hai un'offerta o incentivo per la conversione (prova gratuita, sconto, ecc.)?",
    ],
  },

  // ── WEBSITE ──────────────────────────────────────────────────────────────────
  {
    id: "website",
    label: "Website", labelIt: "Website", labelEn: "Website",
    hint: "Sito multi-sezione classico",
    icon: "Files",
    outputSpec: {
      pageModel: 'single_page',   // Layer 1 genera single-page; Layer 2 potrà multi-page
      sectionModel: 'scroll',
      printReady: false,
      systemPromptModule: `FORMATO OUTPUT — WEBSITE:
Struttura come sito web classico multi-sezione con navigazione sticky in cima:
1. HEADER con logo, navigazione (Home, Chi siamo, Servizi, Contatti).
2. HERO con identità e proposta di valore.
3. ABOUT / CHI SIAMO.
4. SERVIZI / PRODOTTI (card grid).
5. PORTFOLIO o CASE STUDY (opzionale).
6. TESTIMONIAL.
7. CONTATTI con form.
8. FOOTER completo.
Ogni sezione ha un anchor ID per la navigazione interna.`,
    },
    defaultTags: {
      layoutTags: ["layout:hero-first"],
      featureTags: ["feature:contact-form", "feature:testimonials"],
    },
    briefTemplate: "Sito web istituzionale per {{projectName}}. Presenta l'azienda, i servizi e facilita il contatto con i potenziali clienti.",
    styleTemplate: "Struttura classica, professionale. Navigazione chiara. Sezioni ben distinte.",
    briefGuideQuestions: [
      "Quali sezioni del sito sono prioritarie?",
      "Quanti servizi/prodotti vuoi mostrare?",
      "Hai un portfolio o casi studio da includere?",
      "Come vuoi che i visitatori ti contattino?",
    ],
  },

  // ── FORM ─────────────────────────────────────────────────────────────────────
  {
    id: "form",
    label: "Form", labelIt: "Form", labelEn: "Form",
    hint: "Raccolta lead e contatti con step guidati",
    icon: "FormInput",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'stepped_form',
      printReady: false,
      systemPromptModule: `FORMATO OUTPUT — FORM MULTI-STEP:
Costruisci un form multi-step (wizard) con queste caratteristiche:
- STEP 1: dati principali (minimo campi necessari).
- STEP 2: dettagli aggiuntivi.
- STEP 3: riepilogo + invio.
Navigation: bottoni "Avanti" / "Indietro" / "Invia".
Progress bar visibile in cima.
Validazione client-side per ogni step prima di procedere.
Ogni step occupi lo schermo verticalmente, senza scroll orizzontale.
Il form deve essere mobile-first.`,
    },
    defaultTags: {
      featureTags: ["feature:contact-form"],
      toneTags: ["tone:friendly-casual"],
    },
    briefTemplate: "Form guidato multi-step per {{projectName}}. Lo scopo è raccogliere [tipo di dati] in modo semplice e progressivo.",
    styleTemplate: "Interfaccia pulita, pochi campi per step, focus sul completamento.",
    briefGuideQuestions: [
      "Quali informazioni vuoi raccogliere dall'utente?",
      "Quanti step logici ha il processo?",
      "Cosa succede dopo l'invio del form (conferma, reindirizzamento)?",
      "Hai requisiti di validazione particolari?",
    ],
  },

  // ── MANIFESTO ────────────────────────────────────────────────────────────────
  {
    id: "manifesto",
    label: "Manifesto", labelIt: "Manifesto", labelEn: "Manifesto",
    hint: "Pagina identità, valori e dichiarazione d'intenti",
    icon: "RectangleEllipsis",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'scroll',
      printReady: false,
      systemPromptModule: `FORMATO OUTPUT — MANIFESTO:
Struttura come manifesto brand/identitario con questi elementi:
1. APERTURA: titolo evocativo + claim fondamentale (grande, centrato).
2. PROBLEMA / PERCHÉ: dichiarazione del problema che si vuole risolvere.
3. VALORI: lista di 3-7 valori fondamentali, ognuno con una riga esplicativa.
4. VISIONE: dove si vuole arrivare, il futuro immaginato.
5. AZIONE / CALL: cosa chiedi al lettore (unirsi, credere, agire).
6. FIRMA: nome/brand + data.
Tipografia forte e gerarchica. Molto testo, poco decorativismo.
Contrasto netto tra sfondo e testo. Tono solenne ma energico.`,
    },
    defaultTags: {
      visualTags: ["visual:bold"],
      toneTags: ["tone:inspirational", "tone:authoritative-expert"],
      typographyTags: ["typo:display-bold"],
    },
    briefTemplate: "Manifesto di {{projectName}}: una dichiarazione pubblica di valori, visione e missione. Rivolto a [pubblico].",
    styleTemplate: "Tipografia display dominante. Palette scura o a forte contrasto. Nessun elemento superfluo.",
    briefGuideQuestions: [
      "Qual è il valore o principio fondante che vuoi dichiarare?",
      "Chi deve sentirsi chiamato in causa da questo manifesto?",
      "Quali sono i 3-5 valori irrinunciabili?",
      "Qual è l'azione che chiedi al lettore?",
    ],
  },

  // ── SLIDESHOW / PRESENTAZIONE ─────────────────────────────────────────────────
  {
    id: "slideshow",
    label: "Presentazione", labelIt: "Presentazione", labelEn: "Slideshow",
    hint: "Deck navigabile a slide — esportabile come PDF 16:9",
    icon: "Presentation",
    outputSpec: {
      pageModel: 'slide_deck',
      sectionModel: 'paginated',
      recommendedPageCount: 10,
      aspectRatio: '16:9',
      printReady: true,
      cssConstraints: `
/* SLIDE CONSTRAINTS — 16:9 */
:root { --slide-w: 1270px; --slide-h: 714px; }
.slide {
  width: var(--slide-w);
  height: var(--slide-h);
  overflow: hidden;
  page-break-after: always;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 60px 80px;
  box-sizing: border-box;
}
@page { size: 1270px 714px; margin: 0; }
@media print { body { margin: 0; } .slide { page-break-after: always; } }`,
      systemPromptModule: `FORMATO OUTPUT — PRESENTAZIONE SLIDE 16:9:
Crea una presentazione con slide navigabili.
VINCOLI TECNICI (NON NEGOZIABILI):
- Ogni slide è un div.slide di 1270×714px.
- Nessun contenuto deve uscire da queste dimensioni.
- Navigazione con frecce sinistra/destra o pulsanti prev/next.
- Slide counter visibile (es. "3 / 10").
- Esportabile come PDF 16:9 (ogni slide = 1 pagina).
STRUTTURA TIPICA:
  Slide 1: Cover (titolo, autore, data)
  Slide 2: Agenda / Indice
  Slide 3-N: Contenuto (max 5 punti per slide)
  Slide N: Conclusione + CTA
Font grande (min 24px corpo), bullet points, mai testo denso.`,
    },
    defaultTags: {
      visualTags: ["visual:corporate"],
      typographyTags: ["typo:sans-serif-clean"],
    },
    briefTemplate: "Presentazione di {{projectName}} in formato slide 16:9. Argomento: [argomento]. Audience: [chi vede la presentazione].",
    styleTemplate: "Slide pulite, massimo 5 punti per slide, grafica di supporto al testo.",
    briefGuideQuestions: [
      "Qual è l'obiettivo della presentazione (vendita, formazione, pitch, report)?",
      "A quante slide punti circa?",
      "Chi è l'audience e qual è il contesto (riunione interna, cliente, conferenza)?",
      "Hai contenuti/dati specifici da includere?",
    ],
  },

  // ── KEYNOTE ──────────────────────────────────────────────────────────────────
  {
    id: "keynote",
    label: "Keynote", labelIt: "Keynote", labelEn: "Keynote",
    hint: "Presentazione visuale ad alto impatto — stile conferenza",
    icon: "GalleryVertical",
    outputSpec: {
      pageModel: 'slide_deck',
      sectionModel: 'paginated',
      recommendedPageCount: 15,
      aspectRatio: '16:9',
      printReady: true,
      cssConstraints: `
/* KEYNOTE CONSTRAINTS — 16:9 FULL BLEED */
:root { --slide-w: 1920px; --slide-h: 1080px; }
.slide {
  width: var(--slide-w);
  height: var(--slide-h);
  overflow: hidden;
  page-break-after: always;
  position: relative;
  box-sizing: border-box;
}
@page { size: 1920px 1080px; margin: 0; }`,
      systemPromptModule: `FORMATO OUTPUT — KEYNOTE VISUALE:
Presentazione ad alto impatto visivo per conferenze o all-hands.
VINCOLI TECNICI:
- Ogni slide è 1920×1080px (full HD).
- Prevalenza immagini/visual su testo.
- Max 2-3 parole chiave per slide (non lista punti).
- Transizioni implicate nel markup (class="slide active/next").
- Navigazione keyboard-friendly (frecce).
STRUTTURA:
  Cover spettacolare, slide di solo-citazione, slide numerica (dato in grande),
  slide emotiva (foto + claim), slide di sintesi finale.
Tipografia display. Immagini fullbleed. Testo in sovrapposizione con overlay scuro.`,
    },
    defaultTags: {
      visualTags: ["visual:bold", "visual:futuristic"],
      typographyTags: ["typo:display-bold"],
    },
    briefTemplate: "Keynote visuale di {{projectName}} per una presentazione ad alto impatto. Tema centrale: [tema]. Durata stimata: [minuti].",
    styleTemplate: "Full-bleed visuals, testo dominante, palette forte e contrastata.",
    briefGuideQuestions: [
      "Qual è il messaggio che rimane in testa dopo la presentazione?",
      "Hai immagini emotive o icone di brand da usare?",
      "Qual è il tono: ispirazionale, tecnico, visionario?",
    ],
  },

  // ── A4 POSTER ────────────────────────────────────────────────────────────────
  {
    id: "a4poster",
    label: "A4 Poster", labelIt: "A4 Poster", labelEn: "A4 Poster",
    hint: "Layout singola pagina stampabile come PDF A4",
    icon: "FileImage",
    outputSpec: {
      pageModel: 'print_a4',
      sectionModel: 'scroll',
      aspectRatio: 'A4_portrait',
      printReady: true,
      cssConstraints: `
/* A4 PRINT CONSTRAINTS */
:root {
  --page-w: 210mm;
  --page-h: 297mm;
}
body {
  width: var(--page-w);
  height: var(--page-h);
  margin: 0 auto;
  overflow: hidden;
  box-sizing: border-box;
  font-size: 12pt;
}
.page {
  width: var(--page-w);
  height: var(--page-h);
  padding: 1.5cm;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}
@page {
  size: A4 portrait;
  margin: 0;
}
@media print {
  html, body { width: var(--page-w); height: var(--page-h); }
  .page { page-break-after: always; }
}`,
      systemPromptModule: `FORMATO OUTPUT — DOCUMENTO A4 STAMPABILE (MULTI-VARIANT):

VINCOLI TECNICI BASE (NON NEGOZIABILI):
- Ogni pagina: div w-[210mm] h-[297mm] overflow-hidden flex flex-col bg-white (Tailwind).
- ZERO overflow, nessun scroll, nessun viewport unit (no vw/vh), nessun position:fixed.
- NON usare <input>, <textarea>, <select> — non si stampano correttamente.
  Per campi compilabili usare: div con border-b-2 border-slate-200 (scrivibile a mano su carta).
- Print-ready: ogni .page deve avere print:m-0 print:shadow-none print:border-none.
- Multi-pagina: ogni div.page ha class "print:break-after-page".
- Font: Tailwind text-* (body ≥ text-[11px]; display fino a text-5xl); no font in vw.

RILEVAMENTO SUB-TIPO — analizza il brief e scegli la struttura appropriata:

▶ A — POSTER / LOCANDINA
  Trigger: "poster", "locandina", "flyer", "invito", "evento", "annuncio"
  Singola pagina decorativa. Gerarchia: titolo dominante > visual/immagine > info > footer.
  Shell: <div class="w-[210mm] h-[297mm] p-8 bg-white flex flex-col justify-between overflow-hidden print:m-0">
  Struttura: HEADER (titolo display text-5xl font-black tracking-tighter) | CORPO (visual + claim) |
             FOOTER (data, luogo, contatti — border-t pt-4 text-sm text-slate-500).
  NON usare campi compilabili o griglie dati.

▶ B — DOCUMENTO / REPORT MULTI-PAGINA
  Trigger: "documento", "report", "guida", "manuale", "relazione", "brochure", "handbook", "fascicolo"
  Sequenza di div.page indipendenti. Pagina 1 = copertina.
  COPERTINA: sfondo colorato pieno, titolo centrato (text-4xl font-black), sottotitolo, data, logo.
  PAGINE INTERNE:
    header: flex justify-between border-b pb-2 mb-6 | titolo abbreviato + numero pagina text-[9px]
    corpo: grid grid-cols-2 gap-6 (o single-col per testi lunghi)
    sezioni: h2 text-lg font-bold mb-3 border-b pb-1 + paragrafi text-[11px] leading-relaxed
    footer: border-t mt-auto pt-2 flex justify-between text-[9px] text-slate-400

▶ C — CANVAS / WORKSHEET PARTECIPANTE
  Trigger: "canvas", "scheda", "worksheet", "modulo", "partecipante", "esercizio", "brainstorming"
  Pagina interattiva per compilazione su carta. NON usare elementi form HTML.
  Shell: <div class="w-[210mm] h-[297mm] p-8 bg-white flex flex-col gap-4 overflow-hidden print:m-0">
  ANATOMIA (in ordine dall'alto):
  1. HEADER: flex items-start justify-between
     sinistra — titolo event (text-3xl font-black italic tracking-tighter) + sottotitolo text-xs
     destra — blocco info: border-l-4 border-{accent} pl-4 con data + luogo text-sm
  2. METADATA FIELDS (grid grid-cols-3 gap-4):
     ogni campo = <div class="py-2 border-b-2 border-slate-200">
       <div class="text-[9px] uppercase font-bold text-slate-400">{label}</div>
       <div class="h-5"></div>  {/* spazio per scrittura a mano */}
     </div>
  3. PROMPT CARDS (grid grid-cols-4 gap-2):
     ogni card = <div class="bg-{accent}-50 p-3 rounded-lg border border-{accent}-100">
       <div class="text-[9px] font-bold text-{accent}-600 uppercase mb-1">{fase}</div>
       <p class="text-[11px] text-slate-700 leading-snug">{domanda stimolo}</p>
     </div>
  4. FREE-DRAW AREA (area disegno — occupa lo spazio rimanente):
     <div class="flex-grow border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 relative overflow-hidden"
          style="background:radial-gradient(#{accent-color} 1px,transparent 1px);background-size:20px 20px">
       {/* WATERMARK decorativo — non interferisce con lo spazio di disegno */}
       <div class="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
         <span class="text-[140px] font-black text-white opacity-20">{PAROLA_CHIAVE}</span>
       </div>
       <div class="absolute bottom-2 left-3 text-[9px] uppercase font-bold text-{accent}-300">{label area}</div>
     </div>
  5. BOTTOM GRID (grid grid-cols-3 gap-3):
     col-span-2 — area keywords: lista numerata 1/2/3 con div border-b per ognuna
     col 3 — domanda aperta: div border-b h-12 (spazio di risposta)
  6. FOOTER (mt-auto border-t pt-2 flex justify-between text-[9px] text-slate-400):
     nome organizzazione | anno/edizione

▶ D — GUIDA FACILITATORE / STAFF
  Trigger: "facilitatore", "staff", "guida facilitazione", "conduttore", "formatore", "agenda staff"
  Multi-pagina. Badge "SOLO STAFF" prominente. Distinta dal materiale partecipante.
  Shell: stessa del Canvas ma con badge header prominente.
  ANATOMIA:
  1. HEADER: badge staff (span bg-{accent}-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase)
             + titolo inline text-xl font-black + sottotitolo italic text-xs text-slate-500
  2. TIMELINE FASI (grid grid-cols-4 gap-2):
     cella normale: p-3 rounded-lg text-center border border-{accent}-200 bg-{accent}-50 text-{accent}-700
     cella ATTIVA: bg-{accent}-600 text-white font-bold (evidenziata visivamente)
     contenuto cella: orario (text-xs font-bold) + nome fase (text-[10px] mt-1)
  3. EXERCISE GUIDE ITEMS (per ogni attività):
     <div class="flex gap-4 items-start bg-slate-50/50 p-3 rounded-lg border border-slate-100">
       <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white bg-{color}-500 shrink-0 text-sm">{lettera}</div>
       <div>
         <span class="font-bold text-sm text-slate-800">{titolo}</span>
         <p class="text-xs text-slate-600 italic mt-0.5">Obiettivo: {obiettivo}</p>
         <p class="text-[10px] text-slate-500 mt-1">💡 {tip pratico}</p>
       </div>
     </div>
  4. TIPS CALLOUT: div bg-yellow-50 p-4 rounded-xl border border-yellow-200
     + span font-bold text-yellow-800 (titolo avviso) + ul list-disc ml-4 text-sm text-yellow-700
  5. FOOTER: border-t mt-auto pt-2 flex items-center justify-between text-[9px] text-slate-400
     logo badge (w-8 h-8 bg-{accent}-900 rounded-lg text-white font-bold) + "Documento riservato"

PALETTE STAMPA (scegli un accent tematico coerente):
- Evento culturale/creativo: cyan-600 | Corporate/istituzionale: blue-700 | Sostenibilità: emerald-600
- Usa slate-800 per testi primari, slate-400 per secondario, bg-white per pagina.
- Punta a ink-friendly: leggibile anche in stampa B/N.`,
    },
    defaultTags: {
      visualTags: ["visual:bold"],
      typographyTags: ["typo:display-bold"],
    },
    briefTemplate: "Poster/locandina A4 per {{projectName}}. Da stampare come volantino o esportare come PDF. Contenuto principale: [titolo evento / messaggio chiave].",
    styleTemplate: "Layout a foglio singolo stampabile. Gerarchia tipografica forte. Immagini e testo bilanciati nel formato A4.",
    briefGuideQuestions: [
      "È per stampa in bianco/nero o a colori?",
      "Qual è il titolo principale o evento?",
      "Quali informazioni essenziali devono stare nel foglio (data, luogo, contatti)?",
      "Hai un logo o immagine da includere?",
    ],
  },

  // ── INFOGRAPHIC ───────────────────────────────────────────────────────────────
  {
    id: "infographic",
    label: "Infographic", labelIt: "Infografica", labelEn: "Infographic",
    hint: "Visualizzazione dati, icone, sequenze narrative — stile poster/manifesto ricco",
    icon: "Sparkles",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'masonry',
      printReady: false,
      systemPromptModule: `FORMATO OUTPUT — INFOGRAFICA (MULTI-VARIANT):

Una pagina ad alta densità visiva. I dati parlano per immagini; il testo è sintetico.

RILEVAMENTO SUB-TIPO — analizza il brief e scegli la struttura:

▶ A — INFOGRAFICA VERTICALE (default)
  Trigger: generico, "dati", "statistiche", "storytelling visivo", "panoramica"
  Pagina verticale lunga. Sequenza narrativa dall'alto verso il basso.
  STRUTTURA:
    TITOLO GRANDE (messaggio chiave, text-5xl font-black)
    → PROBLEMA (icona + 1 frase, bg-slate-800 text-white p-6)
    → DATI 1-2-3 (grid grid-cols-3: numero text-6xl font-black + label text-xs uppercase)
    → PROCESSO FLOW (step orizzontali: flex gap-4 items-center con frecce →)
    → RISULTATI (percentuale o stat in cerchio o badge prominente)
    → CONCLUSIONE + CTA (sezione finale con bottone o invito all'azione)
  TECNICHE:
    - Alternanza sezioni chiare/scure per ritmo visivo.
    - Ogni dato chiave: box colorato, cerchio, badge — MAI inline nel testo.
    - Max 30-40 parole per sezione. Icone SVG inline o emoji come decoratori.

▶ B — CARD GRID / ATTIVITÀ (parole chiave: esercizi, attività, opzioni, schede, workshop, "scegli tra")
  Griglia di schede colorate. Ideale per: esercizi workshop, menù di opzioni, confronto elementi.
  CONTAINER: grid grid-cols-2 gap-4 (eventuale card finale col-span-2 per elemento dominante).
  ANATOMIA CARD:
    Wrapper:      border-2 border-{color}-300 rounded-2xl p-5 flex flex-col bg-{color}-50/30
    Letter badge: div w-8 h-8 rounded-lg flex items-center justify-center font-black text-white bg-{color}-500
    Categoria:    span text-xs font-bold uppercase tracking-widest text-{color}-700 mt-2
    Domanda:      p text-sm font-bold italic text-slate-800 mt-1
    Descrizione:  p text-[11px] leading-relaxed text-slate-600 flex-grow mt-2
    Footer card:  div mt-auto pt-3 border-t border-{color}-100 text-[10px] italic text-slate-500
  SCHEMA COLORI (una palette distinta per card, in ordine):
    A → cyan   (bg-cyan-50/30,   border-cyan-300,   badge: bg-cyan-500)
    B → slate  (bg-slate-50/30,  border-slate-300,  badge: bg-slate-500)
    C → red    (bg-red-50/30,    border-red-300,    badge: bg-red-500)
    D → indigo (bg-indigo-50/30, border-indigo-300, badge: bg-indigo-500)
    E → yellow (bg-yellow-50/30, border-yellow-300, badge: bg-yellow-600 — non 500)
  CARD COL-SPAN-2: contenuto interno a grid grid-cols-3 gap-6.

▶ C — TIMELINE / PROCESSO (trigger: fasi, step, roadmap, processo, sequenza, agenda, tappe)
  STRUTTURA: header con titolo + contesto numerico ("X fasi") | timeline grid | dettaglio fasi.
  TIMELINE: grid grid-cols-N gap-2 (N = numero di step/fasi).
    Cella normale: p-3 rounded-lg text-center border border-{color}-200 bg-{color}-50 text-{color}-700.
    Cella ATTIVA/CORRENTE: bg-{color}-600 text-white font-bold.
    Contenuto cella: numero/icona (text-lg font-bold) + etichetta breve (text-[10px] mt-1).
  DETTAGLIO FASE (card sotto la timeline per la fase attiva): titolo, obiettivo, materiali, durata.

▶ D — DASHBOARD DATI (trigger: KPI, metriche, statistiche, performance, dashboard, numeri chiave)
  STRUTTURA: riga KPI | area grafici | tabella sintetica.
  KPI CARD (grid grid-cols-3 o 4):
    span text-4xl font-black text-{color}-600 (numero)
    + p text-xs uppercase tracking-wide text-slate-500 (label)
    + span text-sm text-green-600 (variazione ↑ o ↓)
  AREA GRAFICI: placeholder div colorato con dati testuali (se nessuna libreria grafica disponibile).
  TABELLA: table con thead bg-slate-100 e righe alternate bg-white/bg-slate-50 text-[11px].

TECNICHE COMUNI:
  BADGE LETTERA/ICONA: div.w-8.h-8.rounded-lg.flex.items-center.justify-center.font-black.text-white.bg-{color}-500
  CALLOUT BOX AVVISO:  div.bg-yellow-50.p-4.rounded-xl.border.border-yellow-200 + ul.list-disc.ml-4.text-sm.text-yellow-700
  SEZIONE SCURA:       div.bg-slate-800.text-white.p-8 (per alternare ritmo chiaro/scuro)
  DATO IN EVIDENZA:    span.text-5xl.font-black.text-{color}-600 su sfondo neutro

Pensa come un art director, non come un copywriter. Priorità: impatto visivo → chiarezza → completezza.`,
    },
    defaultTags: {
      visualTags: ["visual:bold"],
      layoutTags: ["layout:full-bleed-images", "layout:dense-info"],
    },
    briefTemplate: "Infografica per {{projectName}} sui dati/concetti: [argomento]. Dati chiave da mostrare: [dati]. Audience: [chi legge].",
    styleTemplate: "Alta densità visiva. Icone, numeri, colori. Ritmo alternante verticale.",
    briefGuideQuestions: [
      "Qual è il dato o messaggio principale da comunicare?",
      "Hai dati numerici o statistiche da visualizzare?",
      "È una sequenza narrativa (processo/timeline) o una panoramica comparativa?",
      "Hai icone o visual di brand da incorporare?",
    ],
  },
];

export const PRESET_MAP = new Map(PRESET_CATALOG.map(p => [p.id, p]));
export const VALID_PRESET_IDS = new Set(PRESET_CATALOG.map(p => p.id));
```

---

## 3. Sub-Milestone A — Preset Catalog + Config UX Discovery

> **Stima:** 2–3 giorni  
> **Obiettivo:** il preset selezionato al momento della creazione progetto diventa un contesto strutturato nel moodboard e nella popup di configurazione.

### 3.1 Backend — M-PRESET-A

#### 3.1.1 `ProjectPreset` entity

- File: `apps/api/src/domain/entities/ProjectPreset.ts`  
- Contenuto: interfacce + `PRESET_CATALOG` array + `PRESET_MAP` + `VALID_PRESET_IDS` (come descritto in §2.2).

#### 3.1.2 Campo `presetId` in `Project`

- Aggiungere `presetId?: string` allo schema Mongoose di `Project`.
- Aggiungere `presetId?: string` al Zod schema in `packages/contracts/`.
- `createProject` use-case accetta `presetId?: string` nell'input; valida che sia un `VALID_PRESET_ID` se fornito.

#### 3.1.3 Endpoint `GET /v1/presets`

- Route pubblica (no auth).
- Risposta: `{ presets: ProjectPreset[] }` dal `PRESET_CATALOG`.
- No DB, pura lettura dal catalog statico.

#### 3.1.4 `ProjectMoodboard` — seed da preset alla creazione

- Quando si crea un progetto con `presetId`, il moodboard viene auto-seeded:
  - `visualTags`, `layoutTags`, `toneTags`, `featureTags`, `audienceTags`, `typographyTags`, `paletteTags` ← da `preset.defaultTags`
  - `projectBrief` ← `preset.briefTemplate` (con `{{projectName}}` rimpiazzato)
  - `styleNotes` ← `preset.styleTemplate`
- Se `presetId` non è fornito (fast-create), moodboard rimane vuoto come ora.
- Implementare in `CreateProject` use-case (o in `GetProjectMoodboard` auto-create path).

### 3.2 Frontend — M-PRESET-A

#### 3.2.1 `GET /v1/presets` → lib/api.ts

```typescript
export async function getPresets(): Promise<{ presets: ProjectPreset[] }>
```

#### 3.2.2 `ProjectPreset` TypeScript interfaces in `lib/api.ts`

Aggiungere le interfacce `ProjectPreset`, `PresetOutputSpec`, `PresetTagDefaults`.

#### 3.2.3 Dashboard — preset card con "configura e crea" flow

Attualmente: click preset → `setNewProjectName(preset.label)` → apre dialog solo con input nome.  
Target:

- Click preset → apre `PresetCreationDialog` (o modal) con:
  - Step 1: nome progetto (input) + brief pre-compilato (textarea editabile) + style notes pre-compilate
  - Step 2 (opzionale, accordion): tag categories pre-selezionati (modificabili)
  - Bottone "Crea" → `POST /v1/projects { name, presetId }` → redirect workspace
- Mantenere anche il bottone "Crea veloce →" per fast-create senza configurazione.

Alternativa più semplice (no-break): mantenere il dialog corrente, ma:

- Aggiungere campo `presetId` hidden al form
- Caricare brief/style template dal preset e pre-compilare i campi
- Mostrare accordion collassabile "Opzioni preset" con i tag pre-selezionati

#### 3.2.4 `ProjectConfigPopup` — completare TAG_CATEGORIES e preset awareness

Aggiungere le categorie mancanti all'array `TAG_CATEGORIES`:

```typescript
{ key: "audience",  field: "audienceTags",  label: "Audience / Target" },
{ key: "feature",   field: "featureTags",   label: "Funzionalità richieste" },
{ key: "sector",    field: "sectorTags",    label: "Settore / Ambito" },
```

Nota: verificare che `ProjectMoodboard` entity/schema includa questi campi.

Aggiungere badge "preset attivo" in cima alla sezione sinistra se `project.presetId` è valorizzato:

```tsx
{project.presetId && (
  <div className="flex items-center gap-2 mb-4 p-2 bg-primary/10 rounded-md border border-primary/20">
    <Badge variant="outline">{presetLabel}</Badge>
    <span className="text-xs text-muted-foreground">Preset attivo — brief e tag sono stati pre-compilati dal preset.</span>
  </div>
)}
```

Brief section migliorata: se `moodboard.projectBrief` è vuoto e `project.presetId` valorizzato, mostrare un **accordion "Guida al brief"** con le `briefGuideQuestions` del preset come placeholder/spunto.

#### 3.2.5 `AssetThumb` — useInProject e delete sempre visibili

Attualmente: `useInProject` checkbox e delete button sono dentro un gear menu visibile solo su hover.

Target (non-invasivo): la riga inferiore della thumb mostra sempre:

- Toggle compatto `useInProject` (icona bookmark o check piccolo)
- Bottone delete (icona cestino, small, rosso) sempre visibile
- Gear menu rimane per roleChange e descriptionText (invariato)

```
┌──────────────────────┐
│  [thumbnail/icon]    │
│                      │
├──────────────────────┤
│ 📎 label (truncated) │
│ [🔖 usa] ........[🗑] │
└──────────────────────┘
```

### 3.3 Testabile — M-PRESET-A

```
1. GET /v1/presets → 9 preset con outputSpec, defaultTags, briefTemplate
2. POST /v1/projects { name: "Test", presetId: "landing" }
   → project.presetId === "landing"
   → GET /v1/projects/:id/moodboard → visualTags include "layout:hero-first",
     projectBrief pre-compilato, featureTags include "feature:contact-form"
3. Dashboard: click preset "A4 Poster" → brief textarea pre-compilato, style notes pre-compilate
4. ProjectConfigPopup: categorie "Audience / Target" e "Funzionalità richieste" visibili e cliccabili
5. AssetThumb: checkbox useInProject e pulsante delete visibili senza hover
```

---

## 4. Sub-Milestone B — Prompt Modulare + Style Profile Resolver

> **Stima:** 2–3 giorni  
> **Obiettivo:** il system prompt Layer 1 (chat-preview) riceve arricchimento strutturato da: profilo utente + moodboard progetto + modulo preset. Prerequisito diretto per M2.

### 4.1 Backend — M-PRESET-B

#### 4.1.1 `StyleProfileResolver`

Implementa il componente rimandato da M0-STYLE.

```typescript
// apps/api/src/application/services/StyleProfileResolver.ts

class StyleProfileResolver {
  async resolve(userId: string, projectId: string): Promise<ResolvedStyleProfile>
}
```

Logica fallback cascade (da spec ONBOARDING_AND_STYLE_PROFILING_SPEC.md §4.3):

- Per ogni campo: `ProjectMoodboard > UserStyleProfile > PLATFORM_DEFAULTS`

#### 4.1.2 `Layer0PromptBuilder`

Implementa il componente rimandato da M0-STYLE.

```typescript
// apps/api/src/application/services/Layer0PromptBuilder.ts

class Layer0PromptBuilder {
  build(resolved: ResolvedStyleProfile, projectType: string, presetId?: string): Layer0Output
}

interface Layer0Output {
  systemPromptAddendum: string;  // ~200-400 token, stile + identità + features
  designTokens: Record<string, string>;  // variabili Nunjucks per template
}
```

Output `systemPromptAddendum` structure example (compact):

```
[IDENTITY] freelancer · settore: tech-saas · audience: b2c
[VISUAL] stile: minimal, dark · palette: ocean-blue (#0077B6 / #023E8A) · typo: sans-serif-clean
[LAYOUT] hero-first · whitespace-heavy
[TONE] friendly-casual · inspirational
[FEATURES] contact-form · testimonials
[BRIEF] Landing page per agenzia SEO...
```

#### 4.1.3 `PresetPromptModule` injection

Nel Layer 1 system prompt builder:

```typescript
// Ordine di composizione del system message:
// 1. [layer0_addendum]   ← stile + identità (StyleProfileResolver + Layer0PromptBuilder)
// 2. [preset_module]     ← istruzioni strutturali del preset (preset.outputSpec.systemPromptModule)
// 3. [base_template]     ← prePromptTemplate esistente (Nunjucks)
```

Implementazione in `apps/api/src/infra/llm/buildMessagesWithHistory.ts` (o dove attualmente si costruisce il system message per chat-preview):

```typescript
async function buildSystemMessage(project, userId): Promise<string> {
  const resolved = await styleProfileResolver.resolve(userId, project.id);
  const layer0 = layer0Builder.build(resolved, project.type, project.presetId);
  
  const preset = project.presetId ? PRESET_MAP.get(project.presetId) : null;
  const presetModule = preset?.outputSpec.systemPromptModule ?? "";
  
  const baseTemplate = project.aiConfig?.prePromptTemplate ?? DEFAULT_TEMPLATE;
  
  // Concatenazione ordinata con separatori
  return [
    layer0.systemPromptAddendum,
    presetModule ? `\n\n---\n${presetModule}` : "",
    `\n\n---\n${baseTemplate}`,
  ].filter(Boolean).join("");
}
```

#### 4.1.4 `cssConstraints` nel Layer 1 output

Quando l'LLM genera HTML/CSS/JS, il `cssConstraints` del preset deve essere iniettato:

- Nella sezione CSS generata (wrappato in commento `/* preset: a4poster */`).
- O come istruzione esplicita nel `systemPromptModule` (già incluso nel template di ogni preset).

#### 4.1.5 Endpoint `GET /v1/projects/:id/prompt-preview` (opzionale, debug)

Restituisce il system message risolto per il progetto, per debugging:

```json
{
  "layer0Addendum": "...",
  "presetModule": "...",
  "baseTemplate": "...",
  "resolvedSystemMessage": "..."
}
```

### 4.2 Testabile — M-PRESET-B

```
1. StyleProfileResolver: utente con profile visual ["visual:minimal"], progetto con moodboard
   featureTags ["feature:contact-form"] → resolved.features include "contact-form",
   resolved.visual.mood include "minimal"

2. Layer0PromptBuilder: resolved → systemPromptAddendum compatto (< 500 token)

3. Chat-preview con progetto presetId="a4poster":
   - system message include il preset module "VINCOLI TECNICI... 210×297mm..."
   - system message include layer0 addendum con stile

4. Chat-preview con presetId="slideshow":
   - system message include "Ogni slide è un div.slide di 1270×714px"
   - L'LLM genera HTML con div.slide e dimensioni corrette

5. GET /v1/projects/:id/prompt-preview → 200 con tutti e 3 i layer visibili
```

---

## 5. Dipendenze e Impatto Architetturale

### 5.1 Campi da aggiungere a schemi esistenti

| Schema | Campo aggiunto | Backward compat |
|---|---|---|
| `Project` (Mongoose + Zod) | `presetId?: string` | ✅ opzionale, default undefined |
| `ProjectMoodboard` (Mongoose) | `audienceTags?: string[]`, `featureTags?: string[]`, `sectorTags?: string[]` | ✅ già parzialmente presenti in spec, da aggiungere allo schema se mancanti |
| `Project.aiConfig` | Nessun cambio — `prePromptTemplate` rimane, il modulo preset viene letto dal catalog | ✅ no-break |

### 5.2 File da creare (nuovi)

```
apps/api/src/domain/entities/ProjectPreset.ts          [M-PRESET-A]
apps/api/src/application/services/StyleProfileResolver.ts [M-PRESET-B]
apps/api/src/application/services/Layer0PromptBuilder.ts  [M-PRESET-B]
apps/api/src/presentation/http/routes/presetRoutes.ts      [M-PRESET-A]
apps/web/components/PresetCreationDialog.tsx               [M-PRESET-A]
```

### 5.3 File da modificare (non-break)

```
apps/api/src/domain/entities/Project.ts          + presetId field
apps/api/src/infra/db/schemas/project.schema.ts  + presetId
packages/contracts/src/project.ts               + presetId in schema
apps/api/src/infra/llm/buildMessagesWithHistory.ts  + layer0 + preset injection
apps/web/lib/api.ts                              + getPresets(), ProjectPreset types
apps/web/app/dashboard/page.tsx                  + preset dialog flow
apps/web/components/ProjectConfigPopup.tsx       + TAG_CATEGORIES, preset badge, brief guide
apps/web/components/ProjectConfigPopup.tsx       + AssetThumb useInProject/delete visible
```

### 5.4 Relazione con M2 (PrepromptEngine)

M-PRESET-B introduce il pattern compositivo (layer0 + presetModule + baseTemplate) **senza** ancora il pieno LayerComposer/Nunjucks di M2. Quando M2 verrà implementato:

- `systemPromptModule` del preset diventa un **Layer** nel `PrepromptProfile` (type: `constraint`, condizione `project.presetId === "a4poster"`).
- `Layer0PromptBuilder` diventa il layer `type: system` iniettato automaticamente all'inizio.
- Nessun refactoring radicale: M-PRESET-B è già il pattern giusto, M2 lo generalizza.

---

## 6. Posizionamento nel Development Plan

```
M0-STYLE  ✅  (style profiling + onboarding + moodboard)
     │
     ├── M0.5  (focused asset control — parzialmente completato)
     │
     └── M-PRESET-A  ← NUOVO (preset catalog + config UX + tag completeness)
               │
               └── M-PRESET-B  ← NUOVO (style resolver + prompt modulare)
                         │
                         └── M1  (context bridge Layer1→Layer2)
                                   │
                                   └── M2  (PrepromptEngine — ora enriched)
```

**M-PRESET-A e M0.5** sono indipendenti e possono procedere in parallelo.  
**M-PRESET-B** dipende da M-PRESET-A (serve il catalog con `systemPromptModule`).  
**M2** dipende concettualmente da M-PRESET-B (pattern già definito, non da reinventare).

---

## 7. Rischi e Mitigazioni

| Rischio | Probabilità | Mitigazione |
|---|---|---|
| `audienceTags`/`featureTags` non presenti nello schema Mongoose `ProjectMoodboard` | Medio | Verificare `domain/entities/ProjectMoodboard.ts` e schema prima di iniziare M-PRESET-A. Aggiungere se necessario. |
| Il `prePromptTemplate` attuale di un progetto esistente confligge con il preset module iniettato | Basso | Il preset module è iniettato PRIMA del baseTemplate con separatore `---`. Il baseTemplate esistente non viene toccato. |
| Token budget: layer0 + presetModule + baseTemplate supera il limite di input | Basso | Layer0 è max ~400 token, presetModule è max ~200 token. Budget totale rimane sotto 6500 token per il system message. |
| Thumbnail generation per PDF (server-side) non implementata | Medio | Fuori scope per questa milestone. PDF mostrano icona `FileText` (comportamento invariato). Rimandare a M4b extension. |
