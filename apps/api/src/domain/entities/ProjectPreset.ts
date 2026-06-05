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
    sectorTags?: string[];
}

export interface PresetRecommendedModel {
    provider: string;
    modelId: string;
    label?: string;
}

export interface ProjectPreset {
    id: string;
    label: string;
    labelIt: string;
    labelEn: string;
    hint: string;
    icon: string;

    /** Optional governance/catalog metadata for persisted preset management. */
    category?: string;
    categoryLabel?: string;
    categoryHint?: string;
    tags?: string[];
    sortOrder?: number;
    isActive?: boolean;
    scope?: "global" | "user" | "project";
    status?: "draft" | "pending_review" | "published" | "archived";
    ownerUserId?: string;
    recommendedModel?: PresetRecommendedModel;

    outputSpec: PresetOutputSpec;
    defaultTags: PresetTagDefaults;

    /** Pre-filled brief template for the config popup. `{{projectName}}` is interpolated. */
    briefTemplate: string;

    /** Pre-filled style notes for the config popup. */
    styleTemplate: string;

    /** Up to 5 guiding questions shown in the brief discovery section of the config popup. */
    briefGuideQuestions: string[];
}

const PRESET_META_BY_ID: Record<string, Partial<ProjectPreset>> = {
    neutral: {
        category: "blank",
        categoryLabel: "Blank",
        categoryHint: "Start clean",
        tags: ["blank", "freeform"],
        sortOrder: 0,
    },
    landing: {
        category: "web",
        categoryLabel: "Web",
        categoryHint: "Sites & forms",
        tags: ["conversion", "lead-gen", "cta"],
        sortOrder: 10,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Fast start" },
    },
    website: {
        category: "web",
        categoryLabel: "Web",
        categoryHint: "Sites & forms",
        tags: ["company", "services", "multi-section"],
        sortOrder: 20,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Balanced" },
    },
    form: {
        category: "web",
        categoryLabel: "Web",
        categoryHint: "Sites & forms",
        tags: ["wizard", "contact", "lead"],
        sortOrder: 30,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Clear UX" },
    },
    manifesto: {
        category: "print-graphic",
        categoryLabel: "Print & Graphic",
        categoryHint: "Poster, print, visual",
        tags: ["brand", "statement", "editorial"],
        sortOrder: 40,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Tone-first" },
    },
    a4poster: {
        category: "print-graphic",
        categoryLabel: "Print & Graphic",
        categoryHint: "Poster, print, visual",
        tags: ["a4", "poster", "pdf"],
        sortOrder: 50,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Print-ready" },
    },
    infographic: {
        category: "print-graphic",
        categoryLabel: "Print & Graphic",
        categoryHint: "Poster, print, visual",
        tags: ["data", "storytelling", "visual"],
        sortOrder: 60,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Data visual" },
    },
    "data-dashboard": {
        category: "data-analytics",
        categoryLabel: "Data & Analytics",
        categoryHint: "Grounded dashboards",
        tags: ["dataset", "dashboard", "kpi", "analytics"],
        sortOrder: 65,
        isActive: false,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Grounded analysis" },
    },
    slideshow: {
        category: "presentation",
        categoryLabel: "Presentation",
        categoryHint: "Slides & pitch",
        tags: ["deck", "pitch", "slides"],
        sortOrder: 70,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Pitch flow" },
    },
    keynote: {
        category: "presentation",
        categoryLabel: "Presentation",
        categoryHint: "Slides & pitch",
        tags: ["conference", "visual", "impact"],
        sortOrder: 80,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "High impact" },
    },
    videogame: {
        category: "game-xr",
        categoryLabel: "Game & XR",
        categoryHint: "Playable experiences",
        tags: ["game", "interactive", "arcade"],
        sortOrder: 90,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Gameplay-first" },
    },
    freerunner: {
        category: "game-xr",
        categoryLabel: "Game & XR",
        categoryHint: "Playable experiences",
        tags: ["runner", "arcade", "mobile"],
        sortOrder: 100,
        isActive: false,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Arcade flow" },
    },
    seriousgame: {
        category: "game-xr",
        categoryLabel: "Game & XR",
        categoryHint: "Playable experiences",
        tags: ["learning", "simulation", "training"],
        sortOrder: 110,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Learning UX" },
    },
    game3d: {
        category: "game-xr",
        categoryLabel: "Game & XR",
        categoryHint: "Playable experiences",
        tags: ["3d", "interaction", "scene"],
        sortOrder: 120,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Immersive scene" },
    },
    "vr-aframe": {
        category: "game-xr",
        categoryLabel: "Game & XR",
        categoryHint: "Playable experiences",
        tags: ["vr", "aframe", "immersive"],
        sortOrder: 130,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "VR scene" },
    },
    "interactive-story": {
        category: "game-xr",
        categoryLabel: "Game & XR",
        categoryHint: "Playable experiences",
        tags: ["story", "branching", "narrative"],
        sortOrder: 140,
        recommendedModel: { provider: "siliconflow", modelId: "MiniMaxAI/MiniMax-M2.5", label: "Narrative flow" },
    },
};

function withPresetMeta(preset: ProjectPreset): ProjectPreset {
    const meta = PRESET_META_BY_ID[preset.id] ?? {};
    return {
        ...preset,
        ...meta,
        category: meta.category ?? preset.category ?? "custom",
        categoryLabel: meta.categoryLabel ?? preset.categoryLabel ?? "Custom",
        categoryHint: meta.categoryHint ?? preset.categoryHint ?? "",
        tags: meta.tags ?? preset.tags ?? [],
        sortOrder: meta.sortOrder ?? preset.sortOrder ?? 999,
        isActive: meta.isActive ?? preset.isActive ?? true,
        scope: preset.scope ?? "global",
        status: preset.status ?? "published",
    };
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

const RAW_PRESET_CATALOG: ProjectPreset[] = [

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
            systemPromptModule: `FORMATO OUTPUT - LANDING PAGE:
Genera una singola pagina orientata a una conversione primaria. Non trasformarla in un sito istituzionale.
STRUTTURA OBBLIGATORIA:
1. HERO conversion-first: nome/offerta, promessa misurabile, microcopy di fiducia e CTA primaria immediata.
2. PAIN / JOB-TO-BE-DONE: problema concreto del pubblico, costo dell'inazione, motivo per cui serve ora.
3. SOLUZIONE: 3-5 benefici espressi come risultati, non come semplici feature.
4. PROVA: testimonial, loghi, numeri, casi o garanzie; se mancano dati, crea placeholder credibili e chiaramente sostituibili.
5. OFFERTA / PROCESSO: cosa riceve l'utente, come funziona, tempi, step o pricing se rilevante.
6. OBIEZIONI: FAQ breve su prezzo, tempi, rischio, supporto o requisiti.
7. CTA FINALE: ripeti la stessa azione primaria con rassicurazione finale.
CRITERIO DI RIUSCITA:
- Ogni sezione deve ridurre attrito o aumentare desiderio verso la stessa CTA.
- La pagina deve essere leggibile anche scansionandola in 30 secondi.
- Evita sezioni generiche come "Chi siamo" se non aiutano direttamente la conversione.`,
        },
        defaultTags: {
            layoutTags: ["layout:hero-first"],
            featureTags: ["feat:contact-form"],
        },
        briefTemplate: "Landing page per {{projectName}}. Obiettivo: convertire [pubblico] verso una singola azione: [lead / acquisto / prenotazione / demo]. Problema da risolvere: [...]. Promessa principale: [...]. Prove disponibili: [testimonial, numeri, clienti, garanzia]. Offerta o incentivo: [...]. Sezioni richieste: hero, problema, benefici, prova, processo/offerta, FAQ, CTA finale.",
        styleTemplate: "Conversione prima dello stile: gerarchia forte, CTA ricorrente, blocchi brevi, proof visibile, ritmo alternato tra promessa, prova e azione.",
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
            systemPromptModule: `FORMATO OUTPUT - WEBSITE:
Genera un sito one-page completo per orientare, spiegare e creare fiducia. Non farlo sembrare una landing a una sola offerta.
STRUTTURA OBBLIGATORIA:
1. HEADER: identita, navigazione con anchor, CTA secondaria o contatto.
2. HERO ISTITUZIONALE: chi e il progetto, per chi lavora, valore principale.
3. ABOUT / POSIZIONAMENTO: storia breve, differenza competitiva, contesto.
4. SERVIZI / PRODOTTI: card chiare con problema risolto, output, destinatario.
5. METODO / PROCESSO: 3-5 step che spiegano come si lavora o come si compra.
6. PROVE / PORTFOLIO: casi, risultati, gallery o esempi sostituibili.
7. TEAM / CREDENZIALI: persone, competenze, certificazioni o partner se rilevanti.
8. FAQ / CONTATTI / FOOTER: domande pratiche, form, canali, informazioni legali.
CRITERIO DI RIUSCITA:
- La pagina deve rispondere a "chi siete", "cosa fate", "perche fidarsi", "come iniziare".
- Ogni sezione deve avere un anchor ID coerente con la navigazione.
- La CTA e importante ma non deve schiacciare la funzione informativa del sito.`,
        },
        defaultTags: {
            layoutTags: ["layout:hero-first"],
            featureTags: ["feat:contact-form", "feat:testimonials", "feat:portfolio-grid"],
        },
        briefTemplate: "Website istituzionale per {{projectName}}. Scopo: presentare identita, servizi/prodotti, metodo, prove e canali di contatto. Pubblico: [...]. Servizi principali: [...]. Differenza competitiva: [...]. Elementi da includere: [portfolio, team, FAQ, contatti, partner, gallery]. Tono desiderato: [...].",
        styleTemplate: "Sito orientato alla fiducia: navigazione chiara, sezioni riconoscibili, contenuti scansionabili, card informative e contatti facili da trovare.",
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
            systemPromptModule: `FORMATO OUTPUT - FORM / WIZARD:
Genera un flusso guidato di raccolta dati, non una pagina contatti generica.
STRUTTURA OBBLIGATORIA:
1. INTRO: cosa verra raccolto, tempo stimato, beneficio per l'utente.
2. PROGRESSO: stepper o progress bar con stato corrente sempre comprensibile.
3. STEP 1 - QUALIFICAZIONE: pochi campi essenziali per capire utente/scopo.
4. STEP 2 - DETTAGLI: informazioni specifiche, preferenze, budget, contesto o allegati simulati.
5. STEP 3 - REVIEW: riepilogo leggibile, modifica rapida, consenso/privacy se rilevante.
6. SUCCESS STATE: conferma, prossimi passi, tempi di risposta, contatto alternativo.
REGOLE UX:
- Ogni step deve avere un obiettivo chiaro e massimo 3-5 input visibili.
- Usa validazione client-side progressiva e messaggi di errore comprensibili.
- Mantieni stato locale del form durante la navigazione avanti/indietro.
- Il flusso deve funzionare anche come prototipo senza backend reale.`,
        },
        defaultTags: {
            featureTags: ["feat:contact-form"],
            toneTags: ["tone:friendly-casual"],
        },
        briefTemplate: "Form guidato per {{projectName}}. Scopo: raccogliere [lead / preventivo / iscrizione / onboarding / feedback]. Dati richiesti: [...]. Step previsti: [qualificazione, dettagli, preferenze, riepilogo]. Cosa succede dopo l'invio: [...]. Requisiti di validazione/privacy: [...].",
        styleTemplate: "Workflow chiaro e rassicurante: pochi campi per step, progresso evidente, errori leggibili, riepilogo finale e conferma operativa.",
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
            systemPromptModule: `FORMATO OUTPUT - MANIFESTO:
Genera una dichiarazione identitaria ad alto impatto. Non e una landing commerciale e non e un poster evento.
STRUTTURA OBBLIGATORIA:
1. APERTURA: titolo/claim memorabile che esprime una posizione netta.
2. TESI: cosa sostiene il brand/progetto e perche conta ora.
3. ANTAGONISTA / PROBLEMA: cosa viene rifiutato, superato o corretto.
4. PRINCIPI: 5-7 valori operativi, ciascuno con frase breve e concreta.
5. VISIONE: futuro desiderato, cambiamento promesso, conseguenza culturale o pratica.
6. IMPEGNI: cosa il progetto promette di fare e cosa chiede alla community.
7. FIRMA: nome, data o luogo simbolico, chiusura solenne.
CRITERIO DI RIUSCITA:
- Il testo deve sembrare intenzionale, non pubblicitario.
- Ogni principio deve essere azionabile, non un valore astratto isolato.
- Usa ritmo editoriale: frasi brevi, contrasti, ripetizioni controllate, climax finale.`,
        },
        defaultTags: {
            visualTags: ["visual:bold"],
            toneTags: ["tone:inspirational", "tone:authoritative-expert"],
            typographyTags: ["typo:display-bold"],
        },
        briefTemplate: "Manifesto per {{projectName}}. Posizione centrale: [...]. Pubblico chiamato in causa: [...]. Problema o mentalita da superare: [...]. Principi irrinunciabili: [...]. Visione di futuro: [...]. Azione richiesta al lettore: [aderire, cambiare comportamento, sostenere, partecipare].",
        styleTemplate: "Editoriale e assertivo: tipografia protagonista, ritmo retorico, blocchi manifesto, contrasti netti e una chiusura memorabile.",
        briefGuideQuestions: [
            "Qual è il valore o principio fondante che vuoi dichiarare?",
            "Chi deve sentirsi chiamato in causa da questo manifesto?",
            "Quali sono i 3-5 valori irrinunciabili?",
            "Qual è l'azione che chiedi al lettore?",
        ],
    },

    // ── SLIDESHOW ──
    {
        id: "data-dashboard",
        label: "Data Dashboard", labelIt: "Dashboard Dati", labelEn: "Data Dashboard",
        hint: "Dashboard grounded su dataset allegati, KPI, filtri e analisi runtime",
        icon: "ChartColumn",
        outputSpec: {
            pageModel: 'single_page',
            sectionModel: 'masonry',
            printReady: false,
            systemPromptModule: `FORMATO OUTPUT - DATA DASHBOARD:
Genera una dashboard operativa grounded su dataset allegati. Questo preset resta nascosto nel catalogo standard finche il runtime dati pubblico non e completo.
STRUTTURA OBBLIGATORIA:
1. DATA SUMMARY: nome dataset, righe/colonne note se disponibili, copertura e limiti.
2. KPI STRIP: 3-6 metriche prioritarie, con formula o origine dichiarata.
3. FILTER BAR: periodo, segmento, categoria, area o altre dimensioni filtrabili.
4. VISUAL AREA: grafici leggibili per trend, confronto, distribuzione o ranking.
5. EXPLORATION TABLE: tabella compatta con colonne chiave e stato vuoto/loading.
6. INSIGHT PANEL: anomalie, domande suggerite, azioni operative, incertezza esplicita.
VINCOLI:
- Non inventare numeri: se mancano dati, usa placeholder marcati come da collegare al runtime.
- Deve sembrare uno strumento di analisi, non una pagina marketing.
- Evidenzia sempre metrica, dimensione, filtro e origine dati di ogni visualizzazione.`,
        },
        defaultTags: {
            visualTags: ["visual:corporate"],
            layoutTags: ["layout:dense-info"],
            featureTags: [],
        },
        briefTemplate: "Dashboard dati per {{projectName}}. Dataset o fonte: [...]. Utenti: [operations / management / analyst]. Domande principali: [...]. KPI prioritari: [...]. Dimensioni di filtro: [periodo, categoria, area, canale]. Output atteso: KPI, grafici, tabella esplorativa, insight e limiti dichiarati.",
        styleTemplate: "Operativa e leggibile: KPI in alto, filtri sempre visibili, densita controllata, grafici etichettati, tabella grounded e pannello insight con incertezza esplicita.",
        briefGuideQuestions: [
            "Quali KPI o metriche sono prioritari?",
            "Qual è la tabella o entità principale del dataset?",
            "Quali filtri e segmentazioni servono agli utenti?",
            "Quali domande analitiche devono trovare risposta nella dashboard?",
        ],
    },

    {
        id: "slideshow",
        label: "Presentation / Pitch", labelIt: "Presentazione / Pitch", labelEn: "Presentation / Pitch",
        hint: "Deck ordinato per pitch, meeting e review",
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
            systemPromptModule: `FORMATO OUTPUT - PRESENTATION / PITCH 16:9:
Crea un deck argomentativo, navigabile e stampabile. Deve aiutare una riunione, un pitch o una review, non imitare una keynote da palco.
VINCOLI TECNICI:
- Ogni slide e un div.slide di 1270x714px.
- Nessun contenuto deve uscire da queste dimensioni.
- Navigazione con controlli prev/next o tastiera e slide counter visibile.
- Esportabile come PDF 16:9: una slide = una pagina.
STRUTTURA CONSIGLIATA:
1. Cover: titolo, contesto, autore/data.
2. Executive summary: 3 messaggi chiave.
3. Problema / opportunita.
4. Audience / mercato / scenario.
5. Soluzione o proposta.
6. Prove: dati, esempi, casi o benchmark.
7. Piano: step, timeline, responsabilita.
8. Rischi / tradeoff / mitigazioni.
9. Decisione richiesta o next steps.
10. Chiusura con CTA.
CRITERIO DI RIUSCITA:
- Ogni slide deve avere un unico punto principale.
- Usa titoli assertivi, non etichette vaghe.
- Massimo 5 bullet per slide, testo corpo grande e leggibile.`,
        },
        defaultTags: {
            visualTags: ["visual:corporate"],
            typographyTags: ["typo:sans-serif-clean"],
        },
        briefTemplate: "Presentazione / pitch per {{projectName}}. Obiettivo: [convincere, aggiornare, vendere, formare, decidere]. Audience: [...]. Contesto: [...]. Messaggi chiave: [...]. Dati o prove disponibili: [...]. Decisione o azione richiesta alla fine: [...]. Numero slide desiderato: [...].",
        styleTemplate: "Deck chiaro e argomentativo: una tesi per slide, titoli assertivi, visual di supporto, ritmo ordinato e conclusione orientata alla decisione.",
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
        label: "Conference Keynote", labelIt: "Keynote conferenza", labelEn: "Conference Keynote",
        hint: "Slide visuali ad alto impatto per palco o launch",
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
            systemPromptModule: `FORMATO OUTPUT - CONFERENCE KEYNOTE:
Crea una sequenza visuale da palco, launch o all-hands. Deve avere momenti memorabili, non un deck di bullet.
VINCOLI TECNICI:
- Ogni slide e 1920x1080px full HD.
- Prevalenza di visual, parole chiave, numeri grandi e ritmo scenico.
- Navigazione keyboard-friendly e slide counter discreto.
ARCO NARRATIVO:
1. Opening hook: frase o immagine che imposta tensione.
2. Context shift: perche il tema conta adesso.
3. Problem reveal: cosa non funziona piu.
4. Insight: nuova chiave di lettura.
5. Vision: dove si vuole arrivare.
6. Proof moments: dati, demo, citazioni o esempi in slide distinte.
7. Commitment: cosa cambia concretamente.
8. Closing line: chiusura breve, ricordabile, orientata all'azione.
CRITERIO DI RIUSCITA:
- Ogni slide deve sembrare un momento, non una pagina documento.
- Evita liste lunghe; usa massimo una frase dominante o un dato per slide.
- Alterna slide emotive, numeriche, citazionali e di sintesi.`,
        },
        defaultTags: {
            visualTags: ["visual:bold", "visual:futuristic"],
            typographyTags: ["typo:display-bold"],
        },
        briefTemplate: "Keynote conferenza per {{projectName}}. Tema centrale: [...]. Durata stimata: [...]. Pubblico in sala: [...]. Tensione iniziale: [...]. Insight da far ricordare: [...]. Momenti chiave: [dato, citazione, demo, reveal]. Chiusura desiderata: [...].",
        styleTemplate: "Scenica e memorabile: full-bleed visual, parole chiave grandi, contrasti netti, ritmo da palco e pochissimo testo per slide.",
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
            systemPromptModule: `FORMATO OUTPUT - DOCUMENTO A4 STAMPABILE:
Genera uno o piu fogli A4 pronti per PDF/stampa. La priorita e controllo del formato, gerarchia e assenza di overflow.
VINCOLI TECNICI:
- Ogni pagina deve usare una classe .page con dimensioni A4 portrait, margini sicuri e overflow nascosto.
- Non usare controlli form reali per campi compilabili su carta: rappresentali come linee, box vuoti o aree tratteggiate.
- Evita viewport unit, position fixed e testo troppo piccolo; il contenuto deve restare dentro il foglio.
- Se il contenuto richiede piu spazio, crea pagine A4 successive invece di comprimere illeggibilmente.
SCEGLI IL SOTTOTIPO DAL BRIEF:
1. POSTER / LOCANDINA: titolo dominante, visual o claim centrale, info evento/prodotto, contatti, QR/link e footer.
2. FLYER / SCHEDA PROMO: promessa, benefici, offerta, dettagli pratici, CTA e contatti.
3. WORKSHEET / CANVAS: intestazione, campi anagrafici, prompt guidati, aree vuote compilabili, note e riepilogo.
4. DOCUMENTO / REPORT: copertina, sezioni numerate, callout, tabelle leggere, footer con pagina.
5. GUIDA FACILITATORE: badge staff, obiettivi, timeline fasi, materiali, istruzioni operative, tips e checklist.
CRITERIO DI RIUSCITA:
- In stampa B/N la gerarchia deve restare chiara.
- Le informazioni essenziali devono essere leggibili a colpo d'occhio.
- Ogni foglio deve avere uno scopo unico: promuovere, spiegare, guidare o raccogliere.`,
        },
        defaultTags: {
            visualTags: ["visual:bold"],
            typographyTags: ["typo:display-bold"],
        },
        briefTemplate: "Documento A4 stampabile per {{projectName}}. Tipo: [locandina evento / flyer promo / scheda informativa / worksheet / guida staff]. Titolo principale: [...]. Informazioni obbligatorie: [data, luogo, prezzo, contatto, QR/link, sponsor]. Gerarchia: cosa deve vedersi per primo, secondo e terzo. Uso finale: [stampa, PDF, distribuzione, workshop].",
        styleTemplate: "Print-ready prima di tutto: gerarchia netta, margini sicuri, nessun overflow, campi compilabili come linee stampabili, informazioni essenziali leggibili anche in bianco e nero.",
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

Una pagina ad alta densità visiva. I dati e i concetti parlano per gerarchia, icone e sequenza; il testo resta sintetico.

SCEGLI SEMPRE UN ARCHETIPO PRIMA DI DISEGNARE:
- EXPLAIN: chiarire un tema complesso con blocchi progressivi.
- COMPARE: confrontare opzioni, categorie, pro/contro o performance.
- PROCESS: spiegare fasi, timeline, roadmap o workflow.
- SNAPSHOT: mostrare KPI, ranking, metriche e insight in una pagina.

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
        briefTemplate: "Infografica per {{projectName}}. Archetipo: [explain / compare / process / snapshot]. Messaggio principale: [...]. Dati o concetti chiave: [...]. Audience: [...]. Sequenza narrativa desiderata: [...]. Elementi obbligatori: [KPI, timeline, icone, confronto, callout, CTA].",
        styleTemplate: "Visual storytelling denso ma ordinato: gerarchia numerica, icone funzionali, callout, ritmo verticale e blocchi leggibili anche senza leggere tutto.",
        briefGuideQuestions: [
            "Qual è il dato o messaggio principale da comunicare?",
            "Hai dati numerici o statistiche da visualizzare?",
            "È una sequenza narrativa (processo/timeline) o una panoramica comparativa?",
            "Hai icone o visual di brand da incorporare?",
        ],
    },

    // ── VIDEOGAME EXPERIENCE ──
    {
        id: "videogame",
        label: "Videogame Experience", labelIt: "Videogioco", labelEn: "Videogame Experience",
        hint: "Qualsiasi gioco interattivo browser: arcade, platform, puzzle, action, avventura — con loop di gioco, HUD e meccaniche playable",
        icon: "Gamepad2",
        outputSpec: {
            pageModel: 'single_page',
            sectionModel: 'scroll',
            printReady: false,
            systemPromptModule: `FORMATO OUTPUT - VIDEOGAME EXPERIENCE:
Crea un prototipo giocabile browser-first con un loop completo. Non generare una landing sul gioco.
STRUTTURA OBBLIGATORIA:
1. START SCREEN: titolo, obiettivo, controlli, pulsante Play e fallback descrittivo.
2. GAME AREA: area di gioco dimensionata, visibile e stabile, adatta a desktop e touch.
3. CORE LOOP: azione ripetibile in 5-15 secondi (evita, raccogli, risolvi, colpisci, abbina).
4. HUD: score, vite/energia, timer/progresso, livello o obiettivo corrente.
5. FEEDBACK: premio, errore, collisione, progresso, game over e restart immediato.
6. COMPLETAMENTO: vittoria, sconfitta o high-score con riepilogo.
REGOLE DI DESIGN:
- Preferisci meccaniche semplici ma finite a sistemi ambiziosi incompleti.
- Lo stato del gioco resta locale alla pagina; nessun backend richiesto.
- I controlli devono essere spiegati nel gioco e funzionare almeno con tastiera; aggiungi touch se naturale.
- Se usi canvas o engine, rispetta le regole globali di container del prompt base.`,
        },
        defaultTags: {
            visualTags: ["visual:futuristic"],
            featureTags: [],
            toneTags: ["tone:playful-irreverent"],
        },
        briefTemplate: "Videogioco browser-first per {{projectName}}. Genere: [arcade / puzzle / action / educational / skill]. Core loop: [...]. Obiettivo del giocatore: [...]. Azioni disponibili: [...]. Condizione di vittoria/sconfitta: [...]. Target device: [desktop, mobile, entrambi]. Mood/ambientazione: [...].",
        styleTemplate: "Gameplay leggibile: HUD chiaro, feedback immediati, controlli evidenti, loop breve, restart rapido e asset leggeri.",
        briefGuideQuestions: [
            "Qual è il core loop di gioco da ripetere in pochi secondi?",
            "Qual è la condizione di vittoria o il punteggio massimo desiderato?",
            "Il gioco è pensato per desktop, mobile o entrambi?",
        ],
    },

    // ── FREE RUNNER ──
    {
        id: "freerunner",
        label: "Free Runner", labelIt: "Free Runner", labelEn: "Free Runner",
        hint: "Runner arcade con ostacoli, progressione e retry immediato",
        icon: "Zap",
        outputSpec: {
            pageModel: 'single_page',
            sectionModel: 'scroll',
            printReady: false,
            systemPromptModule: `FORMATO OUTPUT - FREE RUNNER:
Preset specialistico per endless runner; resta nascosto nel catalogo standard per ridurre ridondanza con Videogame Experience.
STRUTTURA OBBLIGATORIA:
1. Start screen con obiettivo, controlli e pulsante Play.
2. Personaggio o avatar che avanza automaticamente.
3. Azioni minime: salto, scivolata o cambio corsia.
4. Ostacoli leggibili, reward raccoglibili e incremento progressivo della difficolta.
5. HUD con distanza, score, velocita o combo.
6. Game over immediato con retry veloce e riepilogo high-score.
CRITERIO DI RIUSCITA:
- Il giocatore deve capire il loop entro 5 secondi.
- La difficolta cresce in modo percepibile ma non casuale.
- L'esperienza deve essere fluida, reattiva e giocabile senza asset pesanti.`,
        },
        defaultTags: {
            visualTags: ["visual:bold"],
            layoutTags: ["layout:hero-first"],
            toneTags: ["tone:playful-irreverent"],
        },
        briefTemplate: "Free runner per {{projectName}}. Ambientazione: [...]. Avatar/personaggio: [...]. Azioni disponibili: [salto, slide, corsia]. Ostacoli principali: [...]. Reward loop: [monete, combo, distanza, missioni]. Progressione difficolta: [...].",
        styleTemplate: "Arcade e leggibile: velocita percepita alta, ostacoli chiari, HUD minimale, feedback istantaneo e retry senza attrito.",
        briefGuideQuestions: [
            "Qual è l'ambientazione del percorso?",
            "Quali azioni può fare il personaggio oltre al salto?",
            "Vuoi missioni, monete o puro high-score?",
        ],
    },

    // ── SERIOUS GAME ──
    {
        id: "seriousgame",
        label: "Serious Game", labelIt: "Serious Game", labelEn: "Serious Game",
        hint: "Esperienza educativa o formativa con feedback e obiettivi",
        icon: "GraduationCap",
        outputSpec: {
            pageModel: 'single_page',
            sectionModel: 'scroll',
            printReady: false,
            systemPromptModule: `FORMATO OUTPUT - SERIOUS GAME:
Progetta un'esperienza educativa o formativa giocabile. L'apprendimento guida la meccanica.
STRUTTURA OBBLIGATORIA:
1. LEARNING OBJECTIVE: competenza, comportamento o concetto da apprendere.
2. SCENARIO: contesto realistico o simulato in cui l'utente deve decidere.
3. CHALLENGE LOOP: quiz, scelta a bivi, simulazione, task guidato o micro-missione.
4. FEEDBACK FORMATIVO: dopo ogni azione spiega perche e corretta/sbagliata e cosa migliorare.
5. PROGRESSO: punteggio, mastery, badge o completamento per obiettivi.
6. DEBRIEF FINALE: risultato, errori frequenti, consigli, prossimi passi.
CRITERIO DI RIUSCITA:
- La parte ludica deve rinforzare l'obiettivo didattico, non decorarlo.
- Ogni scelta deve avere conseguenze comprensibili.
- Evita punteggi senza spiegazione: il feedback e il vero valore del serious game.`,
        },
        defaultTags: {
            toneTags: ["tone:friendly-casual", "tone:technical-precise"],
            audienceTags: ["audience:young-adults"],
            sectorTags: ["sector:education"],
        },
        briefTemplate: "Serious game per {{projectName}}. Obiettivo formativo: [...]. Pubblico: [...]. Scenario/simulazione: [...]. Meccanica: [quiz, bivi, missione, simulazione, task]. Criteri di valutazione: [...]. Feedback desiderato: [...]. Debrief finale: [...].",
        styleTemplate: "Formativo e guidato: scenario chiaro, feedback esplicativo, progresso visibile, tono affidabile e interazioni semplici ma significative.",
        briefGuideQuestions: [
            "Quale competenza o messaggio deve apprendere l'utente?",
            "Come misuriamo progresso o completamento?",
            "Serve una simulazione, un quiz o una missione interattiva?",
        ],
    },

    // ── 3D GAME ──
    {
        id: "game3d",
        label: "3D Game", labelIt: "Gioco 3D", labelEn: "3D Game",
        hint: "Scena interattiva pseudo-3D o 3D leggera per il web",
        icon: "Box",
        outputSpec: {
            pageModel: 'single_page',
            sectionModel: 'scroll',
            printReady: false,
            systemPromptModule: `FORMATO OUTPUT - 3D GAME / 3D SCENE:
Crea una scena 3D o pseudo-3D leggera e interattiva. Non promettere un gioco complesso se il brief non lo richiede.
STRUTTURA OBBLIGATORIA:
1. INTRO OVERLAY: titolo, obiettivo, controlli e stato iniziale.
2. SCENE ROOT: area 3D dimensionata, visibile e stabile.
3. CAMERA: punto di vista comprensibile, con movimento limitato o guidato.
4. OBJECTIVES: raccolta oggetti, esplorazione, target, percorso o interazione con hotspot.
5. STATE / HUD: progresso, oggetti, tempo, score o istruzioni contestuali.
6. COMPLETION: condizione di fine, riepilogo e restart/reset.
REGOLE:
- Usa geometrie semplici, luci leggibili e pochi asset per stabilita.
- Mantieni frame e interazioni fluidi anche su dispositivi medi.
- Se usi un engine 3D, rispetta le regole globali di container e dimensionamento.
- Aggiungi fallback testuale visibile per descrivere l'esperienza se il rendering non parte.`,
        },
        defaultTags: {
            visualTags: ["visual:futuristic"],
            toneTags: ["tone:playful-irreverent"],
        },
        briefTemplate: "Esperienza 3D browser-based per {{projectName}}. Tipo: [scena esplorabile / mini game / showroom / simulazione]. Obiettivo utente: [...]. Camera: [orbitale, prima persona, isometrica, guidata]. Oggetti/interazioni: [...]. Condizione di completamento: [...]. Mood: [...].",
        styleTemplate: "3D leggero e comprensibile: scena pulita, camera stabile, obiettivi visibili, pochi asset, feedback chiaro e performance fluida.",
        briefGuideQuestions: [
            "Qual è la meccanica 3D principale?",
            "Vuoi esplorazione, corsa, raccolta oggetti o shooting leggero?",
            "Quanto deve essere realistico vs stilizzato?",
        ],
    },

    // ── VR A-FRAME ──
    {
        id: "vr-aframe",
        label: "VR A-Frame", labelIt: "VR Experience A-Frame", labelEn: "VR Experience A-Frame",
        hint: "Esperienza immersiva web VR pronta per A-Frame",
        icon: "Glasses",
        outputSpec: {
            pageModel: 'single_page',
            sectionModel: 'scroll',
            printReady: false,
            systemPromptModule: `FORMATO OUTPUT - VR EXPERIENCE A-FRAME:
Genera un'esperienza immersiva web VR con una scena precisa, non una generica pagina 3D.
STRUTTURA OBBLIGATORIA:
1. ENTRY OVERLAY: titolo, obiettivo, controlli, avviso desktop/mobile/VR.
2. A-SCENE: ambiente ordinato con camera, cursor/gaze o interazione equivalente.
3. POINTS OF INTEREST: 3-7 hotspot con label, contenuto o azione.
4. INTERACTION MODEL: gaze, click, prossimita, scelta, raccolta o navigazione.
5. GUIDED PATH: tour, showroom, exhibit, mini missione o installazione narrativa.
6. FALLBACK: istruzioni desktop/mobile e contenuto comprensibile anche senza headset.
CRITERIO DI RIUSCITA:
- L'utente deve capire dove guardare e cosa fare nei primi secondi.
- La scena deve avere profondita e orientamento spaziale, non solo oggetti sparsi.
- Usa pochi elementi ben etichettati invece di molti elementi decorativi.`,
        },
        defaultTags: {
            visualTags: ["visual:futuristic"],
            featureTags: [],
        },
        briefTemplate: "Esperienza VR A-Frame per {{projectName}}. Tipo: [tour, showroom, exhibit, training, mini missione]. Scenario immersivo: [...]. Hotspot/punti di interesse: [...]. Interazioni: [gaze, click, prossimita, scelta]. Utente finale/device: [...]. Obiettivo di completamento: [...].",
        styleTemplate: "Immersiva ma guidata: onboarding immediato, hotspot leggibili, profondita spaziale, pochi elementi chiari e fallback desktop/mobile.",
        briefGuideQuestions: [
            "Si tratta di un tour, un mini-game o uno showroom immersivo?",
            "Quali hotspot o interazioni devono essere presenti?",
            "Qual è il device target principale: desktop, mobile VR o visore?",
        ],
    },

    // ── INTERACTIVE STORY ──
    {
        id: "interactive-story",
        label: "Interactive Story", labelIt: "Storia interattiva", labelEn: "Interactive Story",
        hint: "Narrativa a scelte, scene e bivi con forte atmosfera",
        icon: "BookOpenText",
        outputSpec: {
            pageModel: 'single_page',
            sectionModel: 'paginated',
            printReady: false,
            systemPromptModule: `FORMATO OUTPUT - INTERACTIVE STORY:
Crea una narrativa a scelte giocabile, con stato e conseguenze. Non generare un racconto lineare mascherato da bottoni.
STRUTTURA OBBLIGATORIA:
1. INTRO: mondo, protagonista, posta in gioco e tono.
2. SCENE CARDS: scene brevi con testo leggibile, immagine/atmosfera e 2-4 scelte.
3. STATE: almeno una variabile visibile o implicita (energia, fiducia, risorse, reputazione, indizi).
4. CONSEQUENCES: ogni scelta modifica testo, stato, percorso o finale.
5. CHECKPOINTS: snodi narrativi che cambiano direzione o aumentano tensione.
6. ENDINGS: almeno 2 finali distinti o un finale con valutazione diversa.
CRITERIO DI RIUSCITA:
- Le scelte devono avere tradeoff reali, non sinonimi.
- Mantieni scene concise; il ritmo interattivo conta piu della prosa lunga.
- Mostra chiaramente l'effetto di una scelta senza rompere l'atmosfera.`,
        },
        defaultTags: {
            toneTags: ["tone:inspirational"],
            featureTags: [],
        },
        briefTemplate: "Storia interattiva per {{projectName}}. Genere/tono: [fantasy, sci-fi, noir, educational, horror leggero, brand story]. Ambientazione: [...]. Protagonista: [...]. Obiettivo narrativo: [...]. Variabili di stato: [...]. Scelte chiave: [...]. Finali desiderati: [...].",
        styleTemplate: "Narrativa atmosferica e leggibile: scene brevi, scelte con conseguenze, stato percepibile, transizioni morbide e finali distinti.",
        briefGuideQuestions: [
            "Qual è il tono della storia: fantasy, sci-fi, educational, horror leggero?",
            "Quali scelte cambiano davvero l'esito?",
            "Vuoi un finale unico o multipli finali?",
        ],
    },
];

export const PRESET_CATALOG: ProjectPreset[] = RAW_PRESET_CATALOG
    .map(withPresetMeta)
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

export const PRESET_MAP = new Map<string, ProjectPreset>(
    PRESET_CATALOG.map((p) => [p.id, p])
);

export const VALID_PRESET_IDS = new Set<string>(
    PRESET_CATALOG.map((p) => p.id)
);
