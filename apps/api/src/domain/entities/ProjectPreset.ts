/**
 * ProjectPreset — static catalog of typed project presets.
 * No DB storage. Read-only at runtime, same pattern as StyleTag.
 * Each preset defines structural output specs and modular prompt injection
 * for the Layer 1 system message.
 */

export interface PresetOutputSpec {
    /** Page model for generated output */
    pageModel: 'single_page' | 'multi_page' | 'slide_deck' | 'print_a4';

    /** Scroll / navigation model */
    sectionModel: 'scroll' | 'paginated' | 'masonry' | 'stepped_form';

    /** Recommended page/slide count (undefined = variable) */
    recommendedPageCount?: number;

    /** Aspect ratio for multi-page or print output */
    aspectRatio?: '16:9' | '4:3' | 'A4_portrait' | 'A4_landscape' | 'free';

    /** CSS block to be injected verbatim into generated output (print/slide size constraints) */
    cssConstraints?: string;

    /** True if output is intended for print / PDF export */
    printReady: boolean;

    /**
     * Structural instructions injected into the Layer 1 system message BEFORE
     * the base prePromptTemplate. Max ~500 tokens. Contains non-negotiable
     * format rules for this preset type.
     */
    systemPromptModule: string;
}

export interface PresetTagDefaults {
    visualTags?: string[];
    paletteTags?: string[];
    typographyTags?: string[];
    layoutTags?: string[];
    toneTags?: string[];
    featureTags?: string[];
    audienceTags?: string[];
}

export interface ProjectPreset {
    id: string;
    label: string;
    labelIt: string;
    labelEn: string;
    hint: string;
    icon: string;

    outputSpec: PresetOutputSpec;
    defaultTags: PresetTagDefaults;

    /** Pre-filled brief template for the config popup. `{{projectName}}` is interpolated. */
    briefTemplate: string;

    /** Pre-filled style notes for the config popup. */
    styleTemplate: string;

    /** Up to 5 guiding questions shown in the brief discovery section of the config popup. */
    briefGuideQuestions: string[];
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export const PRESET_CATALOG: ProjectPreset[] = [

    // ── NEUTRAL ──
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

    // ── LANDING PAGE ──
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

    // ── WEBSITE ──
    {
        id: "website",
        label: "Website", labelIt: "Website", labelEn: "Website",
        hint: "Sito multi-sezione classico",
        icon: "Files",
        outputSpec: {
            pageModel: 'single_page',
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

    // ── FORM ──
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
Ogni step occupa lo schermo verticalmente, senza scroll orizzontale.
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

    // ── MANIFESTO ──
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

    // ── SLIDESHOW ──
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
            cssConstraints: `/* SLIDE CONSTRAINTS — 16:9 */
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

    // ── KEYNOTE ──
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
            cssConstraints: `/* KEYNOTE CONSTRAINTS — 16:9 FULL BLEED */
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

    // ── A4 POSTER ──
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
            cssConstraints: `/* A4 PRINT CONSTRAINTS */
:root { --page-w: 210mm; --page-h: 297mm; }
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
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body { width: var(--page-w); height: var(--page-h); }
  .page { page-break-after: always; }
}`,
            systemPromptModule: `FORMATO OUTPUT — DOCUMENTO A4 STAMPABILE (MULTI-VARIANT):

VINCOLI TECNICI BASE (NON NEGOZIABILI):
- Ogni pagina: div w-[210mm] h-[297mm] overflow-hidden flex flex-col bg-white (Tailwind).
- ZERO overflow, nessun scroll, nessun viewport unit (no vw/vh), nessun position:fixed.
- NON usare <input>, <textarea>, <select> — non si stampano correttamente.
  Per campi compilabili: div con border-b-2 border-slate-200 (scrivibile a mano su carta).
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

▶ B — DOCUMENTO / REPORT MULTI-PAGINA
  Trigger: "documento", "report", "guida", "manuale", "relazione", "brochure", "handbook"
  Sequenza di div.page indipendenti. Pagina 1 = copertina.
  COPERTINA: sfondo colorato pieno, titolo centrato (text-4xl font-black), sottotitolo, data.
  PAGINE INTERNE:
    header: flex justify-between border-b pb-2 mb-6 | titolo abbreviato + numero pagina text-[9px]
    corpo: grid grid-cols-2 gap-6 (o single-col per testi lunghi)
    sezioni: h2 text-lg font-bold mb-3 border-b pb-1 + paragrafi text-[11px] leading-relaxed
    footer: border-t mt-auto pt-2 flex justify-between text-[9px] text-slate-400

▶ C — CANVAS / WORKSHEET PARTECIPANTE
  Trigger: "canvas", "scheda", "worksheet", "modulo", "partecipante", "esercizio", "brainstorming"
  Pagina per compilazione su carta. NON usare elementi form HTML.
  Shell: <div class="w-[210mm] h-[297mm] p-8 bg-white flex flex-col gap-4 overflow-hidden print:m-0">
  ANATOMIA (dall'alto):
  1. HEADER: flex items-start justify-between
     sinistra — titolo event (text-3xl font-black italic) + sottotitolo text-xs
     destra — blocco info: border-l-4 border-{accent} pl-4 con data + luogo text-sm
  2. METADATA FIELDS (grid grid-cols-3 gap-4):
     campo = <div class="py-2 border-b-2 border-slate-200">
       <div class="text-[9px] uppercase font-bold text-slate-400">{label}</div>
       <div class="h-5"></div>
     </div>
  3. PROMPT CARDS (grid grid-cols-4 gap-2):
     card = <div class="bg-{accent}-50 p-3 rounded-lg border border-{accent}-100">
       <div class="text-[9px] font-bold text-{accent}-600 uppercase mb-1">{fase}</div>
       <p class="text-[11px] text-slate-700 leading-snug">{domanda stimolo}</p>
     </div>
  4. FREE-DRAW AREA (flex-grow):
     <div class="flex-grow border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 relative overflow-hidden"
          style="background:radial-gradient(#{accent} 1px,transparent 1px);background-size:20px 20px">
       <div class="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
         <span class="text-[140px] font-black text-white opacity-20">{PAROLA_CHIAVE}</span>
       </div>
     </div>
  5. BOTTOM GRID (grid grid-cols-3 gap-3):
     col-span-2 — area keywords: lista numerata con div border-b per ognuna
     col 3 — domanda aperta: div border-b h-12
  6. FOOTER (mt-auto border-t pt-2 flex justify-between text-[9px] text-slate-400)

▶ D — GUIDA FACILITATORE / STAFF
  Trigger: "facilitatore", "staff", "guida facilitazione", "conduttore", "formatore"
  Multi-pagina. Badge "SOLO STAFF" prominente.
  ANATOMIA:
  1. HEADER: badge staff (span bg-{accent}-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase)
             + titolo text-xl font-black + sottotitolo italic text-xs text-slate-500
  2. TIMELINE FASI (grid grid-cols-4 gap-2):
     cella normale: p-3 rounded-lg text-center border border-{accent}-200 bg-{accent}-50
     cella ATTIVA: bg-{accent}-600 text-white font-bold
  3. EXERCISE GUIDE ITEMS:
     <div class="flex gap-4 items-start bg-slate-50/50 p-3 rounded-lg border border-slate-100">
       <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white bg-{color}-500 shrink-0 text-sm">{lettera}</div>
       <div>
         <span class="font-bold text-sm">{titolo}</span>
         <p class="text-xs text-slate-600 italic mt-0.5">Obiettivo: {obiettivo}</p>
         <p class="text-[10px] text-slate-500 mt-1">💡 {tip}</p>
       </div>
     </div>
  4. TIPS CALLOUT: div bg-yellow-50 p-4 rounded-xl border border-yellow-200
  5. FOOTER: border-t mt-auto pt-2 flex items-center justify-between text-[9px] text-slate-400

PALETTE STAMPA:
- Evento culturale/creativo: cyan-600 | Corporate: blue-700 | Sostenibilità: emerald-600
- Testi: slate-800 (primari), slate-400 (secondari), bg-white (pagina).
- Ink-friendly: leggibile anche in stampa B/N.`,
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

    // ── INFOGRAPHIC ──
    {
        id: "infographic",
        label: "Infographic", labelIt: "Infografica", labelEn: "Infographic",
        hint: "Visualizzazione dati, icone, sequenze narrative — stile poster/manifesto ricco",
        icon: "BarChart3",
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
    - Max 30-40 parole per sezione.

▶ B — CARD GRID / ATTIVITÀ
  Trigger: "esercizi", "attività", "opzioni", "schede", "workshop", "scegli tra"
  Griglia di schede colorate. Ideale per workshop, menù di opzioni, confronto elementi.
  CONTAINER: grid grid-cols-2 gap-4 (eventuale card finale col-span-2).
  ANATOMIA CARD:
    Wrapper:      border-2 border-{color}-300 rounded-2xl p-5 flex flex-col bg-{color}-50/30
    Letter badge: div w-8 h-8 rounded-lg flex items-center justify-center font-black text-white bg-{color}-500
    Categoria:    span text-xs font-bold uppercase tracking-widest text-{color}-700 mt-2
    Domanda:      p text-sm font-bold italic text-slate-800 mt-1
    Descrizione:  p text-[11px] leading-relaxed text-slate-600 flex-grow mt-2
    Footer card:  div mt-auto pt-3 border-t border-{color}-100 text-[10px] italic text-slate-500
  SCHEMA COLORI (una palette distinta per card, in ordine):
    A → cyan / B → slate / C → red / D → indigo / E → yellow
  CARD COL-SPAN-2: contenuto interno a grid grid-cols-3 gap-6.

▶ C — TIMELINE / PROCESSO
  Trigger: "fasi", "step", "roadmap", "processo", "sequenza", "agenda", "tappe"
  STRUTTURA: header con titolo + contesto numerico | timeline grid | dettaglio fasi.
  TIMELINE: grid grid-cols-N gap-2 (N = numero di step).
    Cella normale: p-3 rounded-lg text-center border border-{color}-200 bg-{color}-50
    Cella ATTIVA: bg-{color}-600 text-white font-bold
    Contenuto: numero/icona (text-lg font-bold) + etichetta breve (text-[10px] mt-1)
  DETTAGLIO FASE ATTIVA: card con titolo, obiettivo, materiali, durata.

▶ D — DASHBOARD DATI
  Trigger: "KPI", "metriche", "statistiche", "performance", "dashboard", "numeri chiave"
  STRUTTURA: riga KPI | area grafici | tabella sintetica.
  KPI CARD (grid grid-cols-3 o 4):
    span text-4xl font-black text-{color}-600 (numero chiave)
    + p text-xs uppercase tracking-wide text-slate-500 (label)
    + span text-sm text-green-600 (variazione ↑)
  TABELLA: thead bg-slate-100, righe alternate bg-white/bg-slate-50 text-[11px].

TECNICHE COMUNI:
  BADGE LETTERA: div.w-8.h-8.rounded-lg.flex.items-center.justify-center.font-black.text-white.bg-{color}-500
  CALLOUT AVVISO: div.bg-yellow-50.p-4.rounded-xl.border.border-yellow-200
  SEZIONE SCURA: div.bg-slate-800.text-white.p-8
  DATO IN EVIDENZA: span.text-5xl.font-black.text-{color}-600

Pensa come un art director: impatto visivo → chiarezza → completezza.`,
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

export const PRESET_MAP = new Map<string, ProjectPreset>(
    PRESET_CATALOG.map(p => [p.id, p])
);

export const VALID_PRESET_IDS = new Set<string>(
    PRESET_CATALOG.map(p => p.id)
);
