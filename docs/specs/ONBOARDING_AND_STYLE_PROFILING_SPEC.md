# Andy Code Cat — Onboarding, Style Profiling e Layer 0 Preprompting

> **Revisione:** 2026-04-07 (aggiornamento: 2026-07-22 — Appendice A benchmark)  
> **Fonte:** Addendum Vision REV-01, analisi codebase, best practice design token / moodboard industry, benchmark Duolingo/Slack/Figma/Headspace, articolo JustInMind onboarding UX  
> **Scopo:** Definire architettura completa per: registrazione/onboarding utente con profilazione, moodboard progetto con stile guidato, Layer 0 di preprompting semantico-stilistico, schema MongoDB con double sandbox.

---

## 0. Contesto e Motivazione

### 0.1 Problema

Attualmente:

- La **registrazione** raccoglie solo email, password, firstName, lastName — nessuna profilazione.
- La **creazione progetto** è una semplice text input con nome — nessuna guida stilistica.
- Il **preprompt** è un template Nunjucks monolitico (`prePromptTemplate`) — non conosce chi è l'utente, quale stile preferisce, qual è il dominio di business.
- L'LLM riceve il prompt utente "nudo", senza contesto semantico-stilistico strutturato.

### 0.2 Obiettivo

Implementare un **Layer 0 di preprompting** che:

1. Raccoglie il **profilo stilistico dell'utente** all'onboarding (chi sei, cosa fai, che stile ti piace).
2. Raccoglie il **profilo stilistico del progetto** alla creazione (moodboard, palette, inspirazioni, audience).
3. Costruisce un **preprompt semantico-stilistico strutturato** che arricchisce il prompt utente prima di passarlo al Layer 1 (Chat Preview) o Layer 2 (OpenCode Pipeline).
4. Implementa un **meccanismo di fallback/override**: profilo progetto > profilo utente > defaults piattaforma.

### 0.3 Principi Guida

| ID | Principio | Impatto |
|---|---|---|
| `P-ONB-1` | **Progressive disclosure** — onboarding non bloccante, completabile in più sessioni | L'utente non è mai forzato; può saltare tutto e tornare dopo |
| `P-ONB-2` | **Deterministic tags + free text** — nuvole di tag curate + campo libero | Bilancia struttura (per preprompt) e libertà (per espressione) |
| `P-ONB-3` | **Fallback cascade** — project → user → platform defaults | Il preprompt è sempre completo anche se l'utente non ha compilato nulla |
| `P-ONB-4` | **Immutabilità snapshot** — ogni versione del profilo è un record auditabile | Tracciabilità delle scelte e rollback possibile |
| `P-ONB-5` | **Token economy** — il profilo si compila in tag, non in testi lunghi | La traduzione in preprompt è efficiente (pochi token, massimo contesto) |

---

## 1. Tassonomia Tag — StyleTag System

### 1.1 Struttura del Tag

Ogni tag è un'unità atomica di profilazione:

```typescript
interface StyleTag {
  id: string;             // slug univoco: "palette:warm-sunset"
  category: TagCategory;  // categoria tassonomica
  label: string;          // etichetta display multilingua
  labelIt: string;        // label italiano
  labelEn: string;        // label inglese
  icon?: string;          // emoji o icon id
  hexPreview?: string;    // anteprima colore (per palette tags)
  imagePreview?: string;  // URL anteprima (per style/mood tags)
  weight: number;         // peso nel preprompt (1-10, default 5)
  incompatibleWith?: string[];  // tag mutuamente esclusivi
}
```

### 1.2 Categorie Tassonomiche

| ID | Categoria | Descrizione | Esempi Tag |
|---|---|---|---|
| `TC-IDENTITY` | **Identità / Chi sei** | Tipo di attività, settore, dimensione | `freelancer`, `agency`, `startup`, `enterprise`, `non-profit`, `hobbyist` |
| `TC-SECTOR` | **Settore / Ambito** | Dominio di business | `food-beverage`, `tech-saas`, `fashion`, `health-wellness`, `education`, `real-estate`, `creative-arts`, `finance`, `travel`, `sport` |
| `TC-AUDIENCE` | **Audience / Target** | Chi è il pubblico | `b2b`, `b2c`, `b2g`, `young-adults`, `professionals`, `families`, `luxury-clients`, `local-community` |
| `TC-VISUAL` | **Stile Visivo** | Mood e approccio estetico | `minimal`, `bold`, `elegant`, `playful`, `dark`, `corporate`, `vintage`, `futuristic`, `organic`, `brutalist`, `glassmorphism` |
| `TC-PALETTE` | **Palette Colori** | Gruppo cromatico preferito | `warm-sunset`, `ocean-blue`, `earth-tones`, `neon-vivid`, `monochrome-dark`, `pastel-soft`, `forest-green`, `royal-gold`, `coral-blush`, `ice-silver` |
| `TC-TYPO` | **Tipografia** | Stile tipografico preferito | `sans-serif-clean`, `serif-editorial`, `mono-tech`, `handwritten-casual`, `display-bold`, `mixed-contrast` |
| `TC-LAYOUT` | **Layout / Pattern** | Organizzazione spaziale preferita | `hero-first`, `card-grid`, `single-column`, `asymmetric`, `full-bleed-images`, `whitespace-heavy`, `dense-info` |
| `TC-TONE` | **Tono comunicativo** | Come parla il brand | `formal-professional`, `friendly-casual`, `authoritative-expert`, `playful-irreverent`, `inspirational`, `technical-precise` |
| `TC-REFERENCE` | **Riferimento ispirativo** | Punti di riferimento noti | `apple-like`, `stripe-like`, `notion-like`, `airbnb-like`, `dieter-rams`, `swiss-design`, `japanese-minimal` |
| `TC-FEATURE` | **Feature richieste** | Componenti desiderati | `contact-form`, `pricing-table`, `testimonials`, `image-gallery`, `video-hero`, `social-feed`, `newsletter-signup`, `faq-accordion` |

### 1.3 Palette Predefinite (Tag Composti)

Ogni tag `TC-PALETTE` mappa a una palette concreta di design tokens:

```typescript
interface PaletteDefinition {
  tagId: string;            // "palette:warm-sunset"
  primary: string;          // "#E07A5F"
  secondary: string;        // "#3D405B"
  accent: string;           // "#F4A261"
  background: string;       // "#F7F0E8"
  surface: string;          // "#FFFFFF"
  text: string;             // "#2B2D42"
  textMuted: string;        // "#6B7280"
  success: string;          // "#81B29A"
  error: string;            // "#E63946"
  gradientDirection?: string;  // "135deg"
  gradientStops?: string[];   // per sfondi gradient
}
```

**10 Palette predefinite:**

| ID | Nome | Primary | Secondary | Mood |
|---|---|---|---|---|
| `warm-sunset` | Tramonto Caldo | `#E07A5F` | `#3D405B` | Accogliente, italiano, food |
| `ocean-blue` | Oceano Profondo | `#0077B6` | `#023E8A` | Professionale, tech, trust |
| `earth-tones` | Terra e Natura | `#606C38` | `#283618` | Organico, eco, salute |
| `neon-vivid` | Neon Vivace | `#7209B7` | `#F72585` | Giovane, startup, gaming |
| `monochrome-dark` | Monocromo Scuro | `#212529` | `#495057` | Elegante, tech, minimal dark |
| `pastel-soft` | Pastello Morbido | `#FFB5A7` | `#FCD5CE` | Femminile, lifestyle, wedding |
| `forest-green` | Verde Foresta | `#2D6A4F` | `#40916C` | Natura, outdoor, wellness |
| `royal-gold` | Oro Regale | `#C9A227` | `#1B1B2F` | Lusso, premium, gioielli |
| `coral-blush` | Corallo | `#FF6B6B` | `#EE5A24` | Energia, sport, food |
| `ice-silver` | Ghiaccio Argento | `#A8DADC` | `#457B9D` | Pulito, medico, SaaS |

### 1.4 Riferimenti Stilistici Visivi

Ogni tag `TC-VISUAL` include un'immagine di riferimento (hero card 300×200) servita come asset statico dalla piattaforma:

```
/public/style-references/
  minimal.jpg
  bold.jpg
  elegant.jpg
  playful.jpg
  dark.jpg
  corporate.jpg
  vintage.jpg
  futuristic.jpg
  organic.jpg
  brutalist.jpg
  glassmorphism.jpg
```

---

## 2. Onboarding Utente — Profile Wizard

### 2.1 Architettura del Flusso

L'onboarding è **non-bloccante** e **progressivo**:

```
                    ┌────────────────────────────┐
                    │    POST /auth/register      │
                    │ (email, password, nome)      │
                    └────────────┬───────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────┐
                    │  Redirect → /onboarding     │
                    │  (...oppure /dashboard se    │
                    │   l'utente clicca "Skip")    │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 1: Chi Sei?            │
                    │  • Tag cloud TC-IDENTITY     │
                    │  • Tag cloud TC-SECTOR       │
                    │  • Campo libero "Descrivi    │
                    │    la tua attività" (opt)     │
                    │  [Avanti] [Salta tutto →]     │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 2: Il Tuo Stile        │
                    │  • Visual style cards         │
                    │    (TC-VISUAL clickabili)     │
                    │  • Palette selector           │
                    │    (TC-PALETTE con preview)   │
                    │  • Typography preference      │
                    │    (TC-TYPO samples)          │
                    │  [Avanti] [Indietro] [Salta] │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 3: Ispirazioni         │
                    │  • Link URL (max 5, opz)     │
                    │  • Upload immagini (max 6)    │
                    │  • Tag TC-REFERENCE           │
                    │  • Tag TC-TONE                │
                    │  [Completa] [Indietro]         │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  Onboarding completo!        │
                    │  → Redirect /dashboard       │
                    │  → Badge "Profilo completato" │
                    └────────────────────────────┘
```

### 2.2 Regole UX Onboarding

| Regola | Dettaglio |
|---|---|
| **Skipabile** | Ogni step ha "Salta" o "Salta tutto". L'utente va in dashboard con profilo vuoto (fallback a defaults piattaforma). |
| **Riprendibile** | Lo stato dell'onboarding è persistito. Se l'utente chiude il browser e torna, riprende dallo step in cui era. |
| **Modificabile** | Pagina `/settings/profile` permette di riaprire e modificare ogni sezione del profilo in qualsiasi momento. |
| **Multi-select** | I tag sono multi-selezione (l'utente può scegliere più stili, più settori, più palette). Il sistema li pesa e media. |
| **Max tag per categoria** | Massimo 5 tag per categoria (evita profili rumorosi). |
| **Badge completamento** | 0-30% = "Base", 31-70% = "Intermedio", 71-100% = "Completo". Visibile in dashboard. |

### 2.3 Profilo Utente Risultante

```typescript
interface UserStyleProfile {
  userId: string;
  version: number;                    // autoincrement ad ogni modifica
  completionScore: number;            // 0-100 calcolato
  
  onboardingState: {
    status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
    currentStep: number;              // 0-2 (per ripresa)
    startedAt?: Date;
    completedAt?: Date;
  };
  
  // STEP 1 — Identità
  identity: {
    tags: string[];                   // max 5, es. ["identity:freelancer", "sector:tech-saas"]
    freeDescription?: string;         // max 500 chars
  };
  
  // STEP 2 — Stile
  style: {
    visualTags: string[];             // max 5, es. ["visual:minimal", "visual:dark"]
    paletteTags: string[];            // max 3, es. ["palette:ocean-blue"]
    typographyTags: string[];         // max 2, es. ["typo:sans-serif-clean"]
    layoutTags: string[];             // max 3, es. ["layout:hero-first", "layout:whitespace-heavy"]
  };
  
  // STEP 3 — Ispirazioni
  inspirations: {
    referenceTags: string[];          // max 5, es. ["reference:stripe-like"]
    toneTags: string[];               // max 3, es. ["tone:friendly-casual"]
    referenceUrls: string[];          // max 5 URL validati
    referenceImageIds: string[];      // ID di asset uploadati (max 6)
  };
  
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 3. Moodboard Progetto — Project Style Config

### 3.1 Flusso Creazione Progetto

Il flusso attuale (input nome → crea) viene esteso con un wizard opzionale:

```
                    ┌────────────────────────────┐
                    │  Dashboard: [+ Nuovo]        │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 1: Nome e Tipo         │
                    │  • Nome progetto (required)   │
                    │  • Tipo: landing_page |       │
                    │    mini_site | portfolio |    │
                    │    ecommerce                 │
                    │  • Lingua: IT | EN            │
                    │  • Prompt idea (textarea,     │
                    │    min 20 chars, opzionale    │
                    │    se completato in workspace) │
                    │  [Avanti] [Crea veloce →]    │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 2: Moodboard Visivo    │
                    │  • Eredita da profilo utente │
                    │    (pre-check dei tag user)   │
                    │  • Visual style cards          │
                    │    (override o conferma)       │
                    │  • Palette picker              │
                    │    (inherit / override)        │
                    │  • Color customizer inline     │
                    │    (hex input per override)    │
                    │  • Typography preview           │
                    │  [Avanti] [Indietro] [Salta]    │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 3: Contenuto e Refs     │
                    │  • Tag TC-FEATURE cliccabili  │
                    │  • Upload immagini (max 6)     │
                    │  • URL di riferimento (max 5)  │
                    │  • Upload documenti (PDF, etc) │
                    │  • Tag TC-AUDIENCE              │
                    │  • Nota libera progetto         │
                    │  [Crea Progetto]                │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  → Redirect /workspace/[id]  │
                    │  → Layer 0 preprompt pronto   │
                    └────────────────────────────┘
```

### 3.2 Fast-Create vs. Wizard

| Percorso | Azione | Risultato |
|---|---|---|
| **Fast-create** | Utente inserisce solo nome progetto e clicca "Crea veloce" | Progetto creato con moodboard ereditato interamente da profilo utente. Se profilo vuoto → defaults piattaforma. |
| **Wizard completo** | Utente completa tutti e 3 gli step | Progetto con moodboard specifico che fa override su profilo utente. |
| **Wizard parziale** | Utente completa step 1, salta step 2 e 3 | Override solo sui campi definiti nello step 1; fallback su profilo utente per il resto. |

### 3.3 Moodboard Progetto Risultante

```typescript
interface ProjectMoodboard {
  projectId: string;
  version: number;
  
  // Override espliciti (se null → fallback a UserStyleProfile)
  visualTags?: string[];             // override stile visivo
  paletteTags?: string[];            // override palette
  paletteCustomOverrides?: {         // override colore per colore
    primary?: string;                // hex
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
  };
  typographyTags?: string[];
  layoutTags?: string[];
  toneTags?: string[];
  featureTags?: string[];            // componenti desiderati
  audienceTags?: string[];
  
  // Contenuti
  referenceUrls?: string[];          // URL di ispirazione
  referenceImageIds?: string[];      // asset uploadati come moodboard
  attachmentIds?: string[];          // PDF/doc allegati
  freeNotes?: string;                // nota libera (max 1000 chars)
  
  // Metadata resoluzione
  inheritedFromUser: boolean;        // true se creato via fast-create
  overriddenFields: string[];        // campi esplicitamente definiti dall'utente
  
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 4. Layer 0 — Preprompt Semantico-Stilistico

### 4.1 Posizione Architetturale

```
┌─────────────────────────────────────────────────────┐
│                   Prompt Pipeline                     │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ LAYER 0 — Semantic Style Enrichment           │    │
│  │                                                │    │
│  │  Input:                                        │    │
│  │    • raw user prompt (linguaggio naturale)     │    │
│  │    • UserStyleProfile (resolved)               │    │
│  │    • ProjectMoodboard (resolved, con fallback) │    │
│  │    • TagTaxonomy (lookup)                      │    │
│  │                                                │    │
│  │  Processo:                                     │    │
│  │    1. Tag Resolution (merge user+project)      │    │
│  │    2. Palette Resolution (concrete colors)     │    │
│  │    3. Style Context Assembly (structured)      │    │
│  │    4. Preprompt Template Rendering             │    │
│  │                                                │    │
│  │  Output:                                       │    │
│  │    • enrichedSystemPrompt (stile+contesto)     │    │
│  │    • resolvedDesignTokens (JSON)               │    │
│  │    • styleDirectives (istruzioni per LLM)      │    │
│  └──────────────────┬───────────────────────────┘    │
│                      │                                │
│  ┌──────────────────▼───────────────────────────┐    │
│  │ LAYER 1 — Chat Preview (existing)              │    │
│  │  • enrichedSystemPrompt iniettato nel system   │    │
│  │    message prima del prePromptTemplate tecnico │    │
│  │  • resolvedDesignTokens disponibili come       │    │
│  │    variabile Nunjucks nel template             │    │
│  └──────────────────┬───────────────────────────┘    │
│                      │                                │
│  ┌──────────────────▼───────────────────────────┐    │
│  │ LAYER 2 — OpenCode Pipeline (existing spec)    │    │
│  │  • enrichedSystemPrompt in ContextBuilder      │    │
│  │  • resolvedDesignTokens in ThemeResolver       │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 4.2 Componente: StyleProfileResolver

Il **cuore** del Layer 0 è il resolver che merge profilo utente + moodboard progetto:

```typescript
interface ResolvedStyleProfile {
  // Identità (solo da user, non overridabile da progetto)
  identity: {
    type: string;           // "freelancer" | "agency" | ...
    sector: string[];       // ["tech-saas", "education"]
    description?: string;   // free text
  };
  
  // Stile visivo (merge con override progetto)
  visual: {
    mood: string[];         // ["minimal", "dark"]
    palette: ResolvedPalette;
    typography: string[];   // ["sans-serif-clean"]
    layout: string[];       // ["hero-first", "whitespace-heavy"]
  };
  
  // Comunicazione (merge con override progetto)
  communication: {
    tone: string[];         // ["friendly-casual"]
    audience: string[];     // ["b2c", "young-adults"]
    language: string;       // "it" | "en"
  };
  
  // Riferimenti (solo progetto se presenti, altrimenti user)
  references: {
    styleRefs: string[];    // ["stripe-like"]
    urls: string[];         // URL validati
    imageDescriptions: string[];  // descrizioni LLM delle immagini reference
    attachmentSummaries: string[]; // estratti PDF
  };
  
  // Componenti desiderati (solo progetto)
  features: string[];       // ["contact-form", "testimonials", "pricing-table"]
  
  // Metadata risoluzione
  resolution: {
    source: 'project_only' | 'user_only' | 'merged' | 'platform_defaults';
    overriddenByProject: string[];
    fallbackFromUser: string[];
    defaultsApplied: string[];
  };
}

interface ResolvedPalette {
  source: 'tag' | 'custom' | 'default';
  tagId?: string;           // "palette:ocean-blue"
  primary: string;          // "#0077B6"
  secondary: string;        // "#023E8A"  
  accent: string;           // "#00B4D8"
  background: string;       // "#F8F9FA"
  surface: string;          // "#FFFFFF"
  text: string;             // "#212529"
  textMuted: string;        // "#6B7280"
}
```

### 4.3 Logica di Risoluzione Fallback

```
Per ogni campo stilistico:

  1. Se ProjectMoodboard ha un valore → usa quello (override)
  2. Se ProjectMoodboard è null o il campo non è definito:
     a. Se UserStyleProfile ha un valore → usa quello (fallback)
     b. Se UserStyleProfile è null o il campo non è definito:
        → usa PLATFORM_DEFAULTS (fallback finale)

PLATFORM_DEFAULTS:
  visual.mood = ["modern"]
  visual.palette = palette("ocean-blue")
  visual.typography = ["sans-serif-clean"]
  visual.layout = ["hero-first"]
  communication.tone = ["professional"]
  communication.audience = ["b2c"]
```

### 4.4 Componente: Layer0PromptBuilder

Trasforma il `ResolvedStyleProfile` in un addendum di sistema strutturato:

```typescript
class Layer0PromptBuilder {
  /**
   * Genera il system prompt addendum stilistico da iniettare
   * PRIMA del prePromptTemplate tecnico del Layer 1/2.
   * Output: ~200-400 token (ultra-compatto per token economy).
   */
  build(resolved: ResolvedStyleProfile, projectType: string): Layer0Output;
}

interface Layer0Output {
  /** 
   * Blocco di testo strutturato da inserire nel system prompt.
   * Formato compatto per token economy.
   */
  systemPromptAddendum: string;
  
  /**
   * Design tokens risolti, disponibili come variabili 
   * per il template Nunjucks del prePromptTemplate tecnico.
   */
  designTokens: Record<string, string>;
  
  /**
   * Direttive stilistiche chiave per injection rapida.
   */
  styleDirectives: string[];
}
```

### 4.5 Formato Output systemPromptAddendum

Il formato è progettato per massimizzare il rapporto informazione/token:

```
## Client Context
- Identity: freelance web designer, tech-saas sector
- Audience: B2C, young professionals
- Tone: friendly, casual, technically aware

## Visual Style Directives
- Mood: minimal + dark mode
- Colors: primary #0077B6, secondary #023E8A, accent #00B4D8, bg #0F172A, text #E2E8F0
- Typography: sans-serif clean (Inter/DM Sans family)
- Layout: hero-first, generous whitespace, card-based sections

## Reference Inspirations
- Stripe.com aesthetic: clean gradients, plenty of whitespace, code-forward
- Emphasis on data visualization and clear CTAs

## Requested Features
- Hero with animated gradient
- Pricing table (3 tiers)
- Testimonials carousel
- Contact form with validation
```

**Budget token stimato: 150-350 token** (vs. 4000-6000 per full generation prompt).

### 4.6 Integrazione con Layer 1 (Chat Preview)

La pipeline di iniezione nel sistema esistente:

```typescript
// In buildMessagesWithHistory() — apps/api/src/infra/llm/
// PRIMA del sistema corrente:

const layer0Output = layer0PromptBuilder.build(
  resolvedProfile,
  project.type
);

// Il system prompt diventa:
const systemPrompt = [
  layer0Output.systemPromptAddendum,  // Layer 0: stile e contesto
  renderedPrePromptTemplate,          // Layer 1: template tecnico
].join('\n\n---\n\n');

// I design tokens sono iniettati nel template Nunjucks context:
const templateContext = {
  ...existingContext,
  designTokens: layer0Output.designTokens,
  styleDirectives: layer0Output.styleDirectives,
};
```

### 4.7 Integrazione con Layer 2 (OpenCode Pipeline)

Nel flusso PrepromptEngine (spec PREPROMPT_ENGINE_SPEC.md):

```
ContextBuilder.buildContext()
  └── ProjectContextLoader
       └── NEW: StyleProfileResolver.resolve(userId, projectId)
            → ResolvedStyleProfile
       └── NEW: Layer0PromptBuilder.build(resolved, projectType)
            → Layer0Output

ThemeResolver.resolveTheme()
  └── Legge Layer0Output.designTokens anziché solo project.wizard.themeOverride
```

---

## 5. MongoDB Schemas

### 5.1 Collection: `style_tags` (Platform Static Data)

```typescript
// Catalogo tag globale della piattaforma, readonly per utenti.
// Seed script gestisce popolazione e aggiornamento.
{
  _id: ObjectId,
  tagId: string,                     // "visual:minimal" — unique index
  category: string,                  // "TC-VISUAL" | "TC-PALETTE" | ...
  label: {
    it: string,                      // "Minimale"
    en: string                       // "Minimal"
  },
  icon: string | null,               // "✨" o null
  hexPreview: string | null,         // "#0077B6" (solo per palette)
  imagePreview: string | null,       // "/style-references/minimal.jpg"
  weight: number,                    // 1-10, default 5
  paletteDefinition: {               // solo per TC-PALETTE tags
    primary: string,
    secondary: string,
    accent: string,
    background: string,
    surface: string,
    text: string,
    textMuted: string
  } | null,
  incompatibleWith: string[],        // tagId[] mutuamente esclusivi
  sortOrder: number,                 // ordinamento display
  isActive: boolean,                 // soft-disable
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// { tagId: 1 } unique
// { category: 1, sortOrder: 1 }
// { isActive: 1 }
```

### 5.2 Collection: `user_style_profiles`

```typescript
// Un documento per utente. Versioning via campo version.
// Double sandbox: accesso solo tramite userId = jwt.sub
{
  _id: ObjectId,
  userId: ObjectId,                  // index, ref → users._id
  version: number,                   // autoincrement ad ogni PUT
  completionScore: number,           // 0-100, calcolato server-side
  
  onboarding: {
    status: string,                  // "not_started" | "in_progress" | "completed" | "skipped"
    currentStep: number,             // 0-2
    startedAt: Date | null,
    completedAt: Date | null
  },
  
  identity: {
    tags: string[],                  // max 5 tagId
    freeDescription: string | null   // max 500 chars
  },
  
  style: {
    visualTags: string[],            // max 5 tagId
    paletteTags: string[],           // max 3 tagId  
    typographyTags: string[],        // max 2 tagId
    layoutTags: string[]             // max 3 tagId
  },
  
  inspirations: {
    referenceTags: string[],         // max 5 tagId
    toneTags: string[],              // max 3 tagId
    referenceUrls: string[],         // max 5, validated URLs
    referenceImageIds: string[]      // max 6, ref → project_assets._id (su spazio utente)
  },
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// { userId: 1 } unique
```

### 5.3 Collection: `user_style_profile_history`

```typescript
// Snapshot immutabile di ogni versione del profilo.
// Per audit trail e rollback.
{
  _id: ObjectId,
  userId: ObjectId,
  version: number,
  snapshot: { /* copia completa del documento user_style_profiles */ },
  changedFields: string[],           // ["style.visualTags", "inspirations.referenceUrls"]
  changedAt: Date
}

// Indexes:
// { userId: 1, version: -1 }
// TTL: 365 giorni (opzionale, configurabile)
```

### 5.4 Collection: `project_moodboards`

```typescript
// Un documento per progetto. Double sandbox: ownerUserId check.
{
  _id: ObjectId,
  projectId: ObjectId,               // index, ref → projects._id
  ownerUserId: ObjectId,             // ref → users._id, per sandbox
  version: number,
  
  // Override stilistici (null = ereditato da profilo utente)
  visualTags: string[] | null,
  paletteTags: string[] | null,
  paletteCustomOverrides: {
    primary: string | null,
    secondary: string | null,
    accent: string | null,
    background: string | null,
    text: string | null
  } | null,
  typographyTags: string[] | null,
  layoutTags: string[] | null,
  toneTags: string[] | null,
  featureTags: string[] | null,
  audienceTags: string[] | null,
  
  // Contenuti moodboard
  referenceUrls: string[] | null,    // max 5
  referenceImageIds: string[] | null, // max 6
  attachmentIds: string[] | null,     // max 10
  freeNotes: string | null,          // max 1000 chars
  
  // Metadata risoluzione
  inheritedFromUser: boolean,
  overriddenFields: string[],
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// { projectId: 1 } unique
// { ownerUserId: 1 }
```

### 5.5 Estensione Collection `users` (campo aggiuntivo)

```typescript
// Aggiungere al documento users esistente:
{
  // ... campi esistenti ...
  
  styleProfileId: ObjectId | null,    // ref → user_style_profiles._id
  onboardingStatus: string            // "not_started" | "in_progress" | "completed" | "skipped"
                                      // denormalizzato per query rapida da dashboard
}
```

### 5.6 Estensione Collection `projects` (campo aggiuntivo)

```typescript
// Aggiungere al documento projects esistente:
{
  // ... campi esistenti ...
  
  moodboardId: ObjectId | null,       // ref → project_moodboards._id
  projectType: string,                // "landing_page" | "mini_site" | "portfolio" | "ecommerce"
  lang: string                        // "it" | "en", default "it"
}
```

---

## 6. API Routes

### 6.1 Style Tags (Public/Read-only)

```
GET /v1/style-tags
  Query: ?category=TC-VISUAL&lang=it
  Response: { tags: StyleTag[] }
  Auth: JWT required (utente autenticato)
  Note: nessun sandbox, dati piattaforma condivisi

GET /v1/style-tags/palettes
  Response: { palettes: PaletteDefinition[] }
  Auth: JWT required
```

### 6.2 User Style Profile (User Sandbox)

```
GET /v1/profile/style
  Response: { profile: UserStyleProfile, completionScore: number }
  Auth: JWT required (userId = jwt.sub)

PUT /v1/profile/style
  Body: Partial<UserStyleProfile>  (schema Zod validato)
  Response: { profile: UserStyleProfile, version: number }
  Auth: JWT required
  Note: incrementa version, salva snapshot in history
  
PUT /v1/profile/style/step/:stepNumber
  Body: { tags: string[], freeText?: string, ... } (specifico per step)
  Response: { profile: UserStyleProfile, currentStep: number }
  Auth: JWT required
  Note: salva lo step specifico dell'onboarding senza richiedere l'intero profilo

PUT /v1/profile/onboarding/skip
  Response: { profile: UserStyleProfile, status: "skipped" }
  Auth: JWT required

GET /v1/profile/style/history
  Query: ?limit=10
  Response: { versions: StyleProfileHistoryEntry[] }
  Auth: JWT required
```

### 6.3 Project Moodboard (Double Sandbox)

```
GET /v1/projects/:projectId/moodboard
  Response: { moodboard: ProjectMoodboard, resolvedProfile: ResolvedStyleProfile }
  Auth: JWT + sandboxMiddleware (ownerUserId check)
  Note: il response include ANCHE il profilo risolto con fallback

PUT /v1/projects/:projectId/moodboard
  Body: Partial<ProjectMoodboard>  (schema Zod validato)
  Response: { moodboard: ProjectMoodboard, resolvedProfile: ResolvedStyleProfile }
  Auth: JWT + sandboxMiddleware

DELETE /v1/projects/:projectId/moodboard
  Response: { message: "Moodboard removed, falling back to user profile" }
  Auth: JWT + sandboxMiddleware
  Note: il progetto torna a ereditare tutto dal profilo utente
```

### 6.4 Resolved Profile (Read-only, per debug e preview)

```
GET /v1/projects/:projectId/resolved-style
  Response: { resolved: ResolvedStyleProfile, layer0Preview: string }
  Auth: JWT + sandboxMiddleware
  Note: mostra il profilo risolto finale E un'anteprima del systemPromptAddendum
        che verrebbe generato. Utile per debug e per il workspace.
```

---

## 7. Domain Entities e Clean Architecture

### 7.1 Nuove Entity (domain/entities/)

```
apps/api/src/domain/entities/
  StyleTag.ts                  ← TagCategory enum, StyleTag interface, PaletteDefinition
  UserStyleProfile.ts          ← UserStyleProfile, OnboardingState, identity/style/inspirations
  ProjectMoodboard.ts          ← ProjectMoodboard, paletteCustomOverrides
  ResolvedStyleProfile.ts      ← ResolvedStyleProfile, ResolvedPalette, Resolution metadata
```

### 7.2 Nuove Repository Interfaces (domain/repositories/)

```
apps/api/src/domain/repositories/
  StyleTagRepository.ts        ← findAll(), findByCategory(), findByIds()
  UserStyleProfileRepository.ts ← findByUserId(), upsert(), getHistory()
  ProjectMoodboardRepository.ts ← findByProjectId(), upsert(), delete()
```

### 7.3 Nuovi Use Cases (application/use-cases/)

```
apps/api/src/application/use-cases/
  GetStyleTags.ts              ← lista tag per categoria
  GetUserStyleProfile.ts       ← profilo utente con score
  UpdateUserStyleProfile.ts    ← aggiorna profilo (incrementa version, salva history)
  UpdateOnboardingStep.ts      ← salva singolo step onboarding
  SkipOnboarding.ts            ← salta onboarding
  GetProjectMoodboard.ts       ← moodboard con profilo risolto
  UpdateProjectMoodboard.ts    ← aggiorna moodboard
  DeleteProjectMoodboard.ts    ← rimuovi moodboard
  ResolveStyleProfile.ts       ← merge user+project+defaults → ResolvedStyleProfile
  BuildLayer0Prompt.ts         ← ResolvedStyleProfile → Layer0Output
```

### 7.4 Nuove Infra Implementations (infra/)

```
apps/api/src/infra/db/
  MongoStyleTagRepository.ts
  MongoUserStyleProfileRepository.ts
  MongoProjectMoodboardRepository.ts

apps/api/src/infra/style/
  StyleProfileResolver.ts      ← logica merge con fallback cascade
  Layer0PromptBuilder.ts       ← template rendering per system prompt addendum
  PlatformDefaults.ts          ← costanti con default piattaforma
```

### 7.5 Nuove Routes (presentation/http/routes/)

```
apps/api/src/presentation/http/routes/
  styleTagRoutes.ts            ← GET /style-tags, GET /style-tags/palettes
  profileRoutes.ts             ← GET/PUT /profile/style, PUT /profile/style/step/:n, PUT /profile/onboarding/skip
  moodboardRoutes.ts           ← GET/PUT/DELETE /projects/:id/moodboard, GET /projects/:id/resolved-style
```

### 7.6 Nuovi Contracts (packages/contracts/src/)

```
packages/contracts/src/
  styleTags.ts                 ← TagCategory enum, StyleTag schema, PaletteDefinition schema
  userStyleProfile.ts          ← profilo utente schema, step-by-step validation
  projectMoodboard.ts          ← moodboard schema, paletteCustomOverrides schema
  resolvedStyle.ts             ← resolved profile schema (output only)
```

---

## 8. Seed Script Estensione

### 8.1 seed-style-tags.ts

```typescript
// Popola style_tags collection con il catalogo tassonomico completo.
// Idempotente: upsert su tagId.
// Eseguito a startup se flag STYLE_TAGS_AUTO_SEED=true (default: true).

// Contenuto: tutte le 10 categorie × ~8-12 tag ciascuna = ~100 tag totali.
// Include le 10 palette predefinite con PaletteDefinition completa.
```

### 8.2 Estensione seed.ts

```typescript
// Aggiunge al seed utente default:
// - UserStyleProfile con onboarding status "completed"
// - Tag esempio: identity:freelancer, sector:tech-saas, visual:minimal, palette:ocean-blue
// - Progetto default: ProjectMoodboard ereditato da profilo utente
```

---

## 9. Frontend — Nuove Pagine e Componenti

### 9.1 Nuove Pagine

```
apps/web/app/
  onboarding/
    page.tsx                   ← Wizard 3 step con progress bar
  settings/
    profile/
      page.tsx                 ← Modifica profilo stile (riapre wizard)

apps/web/app/dashboard/
  new-project/
    page.tsx                   ← Wizard creazione progetto 3 step
```

### 9.2 Nuovi Componenti

```
apps/web/components/
  onboarding/
    TagCloud.tsx               ← Nuvola tag cliccabili (multi-select, max N)
    PaletteSelector.tsx        ← Palette cards con preview colore live
    TypographyPreview.tsx      ← Font samples con testo di esempio
    VisualStyleCard.tsx        ← Card con immagine + nome stile (selezionabile)
    OnboardingProgress.tsx     ← Barra di progresso step 1/2/3
    OnboardingStepWrapper.tsx  ← Container con Avanti/Indietro/Salta/Salta tutto
  
  moodboard/
    MoodboardEditor.tsx        ← Editor moodboard per progetto
    ColorCustomizer.tsx        ← Input hex per override colori singoli
    FeatureTagSelector.tsx     ← Selettore feature desiderate
    ReferenceUrlInput.tsx      ← Input multiplo URL con preview
    MoodboardPreview.tsx       ← Anteprima visiva del moodboard risolto
  
  shared/
    ProfileCompletionBadge.tsx ← Badge "Base/Intermedio/Completo"
    StylePreviewCard.tsx       ← Mini-preview del profilo stile risolto
```

### 9.3 Estensione Dashboard

Il dashboard attuale viene esteso con:

- **Profilo completamento badge** nell'header (cliccabile → `/settings/profile`)
- **Preview stile utente** nel sidebar (mini-card con palette e mood)
- **Bottone "+ Nuovo Progetto"** che apre il wizard (non più inline input)
- **Card progetto** arricchita con mini-preview della palette progetto

### 9.4 Estensione Workspace

Il workspace riceve:

- **Tab "Style"** nel pannello destro: mostra il profilo risolto, i design tokens, e permette modifica rapida del moodboard senza uscire dal workspace.
- **Layer 0 status indicator**: mostra se il profilo è stato iniettato nel preprompt corrente.

---

## 10. Configurazione Ambiente

### 10.1 Nuove Env Variables

```env
# Style profiling
STYLE_TAGS_AUTO_SEED=true              # Seed tag al bootstrap
STYLE_TAGS_SEED_LANG=it,en             # Lingue seed

# Layer 0
LAYER0_ENABLED=true                    # Attiva Layer 0 preprompting
LAYER0_MAX_ADDENDUM_TOKENS=400         # Budget token per addendum stilistico
LAYER0_REFERENCE_IMAGE_DESCRIBE=true   # Usa LLM vision per descrivere immagini reference
```

---

## 11. Piano di Implementazione Incrementale

### Fase 1 — Foundation (Priorità ALTA)

| Task | Componente | Dipendenze |
|---|---|---|
| F1.1 | Entity `StyleTag`, `UserStyleProfile`, `ProjectMoodboard`, `ResolvedStyleProfile` | Nessuna |
| F1.2 | Contracts Zod per tutti gli schema | F1.1 |
| F1.3 | `style_tags` collection + seed script `seed-style-tags.ts` | F1.1 |
| F1.4 | `MongoStyleTagRepository` + `GetStyleTags` use case + route | F1.3 |
| F1.5 | `MongoUserStyleProfileRepository` + use cases CRUD | F1.1 |
| F1.6 | `MongoProjectMoodboardRepository` + use cases CRUD | F1.1 |

### Fase 2 — Onboarding UX

| Task | Componente | Dipendenze |
|---|---|---|
| F2.1 | Componenti shared: `TagCloud`, `PaletteSelector`, `VisualStyleCard` | F1.3 |
| F2.2 | Pagina `/onboarding` con wizard 3 step | F2.1 + F1.5 |
| F2.3 | Integrazione post-register: redirect a `/onboarding` | F2.2 |
| F2.4 | Pagina `/settings/profile` per modifica profilo | F2.1 + F1.5 |
| F2.5 | `ProfileCompletionBadge` in dashboard | F1.5 |

### Fase 3 — Project Moodboard

| Task | Componente | Dipendenze |
|---|---|---|
| F3.1 | Wizard creazione progetto 3 step (`/dashboard/new-project`) | F2.1 + F1.6 |
| F3.2 | `MoodboardEditor` con inherit/override UX | F2.1 + F1.6 |
| F3.3 | Fast-create path (nome + inherit da profilo) | F1.6 |
| F3.4 | Tab "Style" nel workspace | F3.2 |

### Fase 4 — Layer 0 Engine

| Task | Componente | Dipendenze |
|---|---|---|
| F4.1 | `StyleProfileResolver` (merge con fallback cascade) | F1.5 + F1.6 |
| F4.2 | `Layer0PromptBuilder` (template → system prompt addendum) | F4.1 |
| F4.3 | `PlatformDefaults` costanti | Nessuna |
| F4.4 | Integrazione in `buildMessagesWithHistory()` (Layer 1) | F4.2 |
| F4.5 | Integrazione in `ContextBuilder` (Layer 2, quando implementato) | F4.2 |
| F4.6 | Route `GET /projects/:id/resolved-style` per debug | F4.1 + F4.2 |

---

## 12. Rischi e Mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| Profilo troppo vincolante → output LLM stereotipato | Media | Alto | I tag sono suggerimenti (weight-based), non vincoli assoluti. Il prompt addendum usa linguaggio "prefer" non "must". |
| Troppi tag → rumore nel preprompt | Bassa | Medio | Max 5 tag per categoria; peso ponderato; solo i top-3 per peso entrano nel prompt addendum. |
| Token economy: addendum troppo lungo | Bassa | Alto | Budget hard limit `LAYER0_MAX_ADDENDUM_TOKENS=400`; formato ultra-compatto bullet-point. |
| UX onboarding troppo lungo → drop rate | Media | Alto | Skip sempre disponibile; 3 step soli; ogni step < 30 secondi; visual-first (click, non typing). |
| Palette predefinite troppo limitate | Bassa | Basso | `paletteCustomOverrides` permette override colore per colore; nuove palette aggiunte via seed senza deploy. |
| Migrazione dati: utenti esistenti senza profilo | Bassa | Basso | Fallback cascade garantisce funzionamento anche con profilo vuoto (0 tags). Nessuna breaking change. |

---

## 13. Impatto su Documenti Esistenti

| Documento | Modifica richiesta |
|---|---|
| `docs/INDEX.md` | Aggiungere link a questa spec |
| `docs/agents/CODE_AGENT_INDEX.md` | Aggiungere entities/routes/use-cases nella sezione "Da costruire" |
| `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` | Aggiungere sezione Layer 0 |
| `docs/runbooks/TESTABLE_STEPS.md` | Aggiungere step testabili per onboarding e moodboard |
| `DB_PLATFORM_SPEC.md` | Aggiungere 3 nuove collection + estensioni users/projects |
| `PREPROMPT_ENGINE_SPEC.md` | Aggiungere integrazione Layer 0 in ContextBuilder |
| `UX_SPEC.md` | Riscrivere wizard da 3-step a wizard onboarding + moodboard progetto |
| `docs/vision/IMPLEMENTATION_CROSSMAP.md` | Aggiungere nuovi Req ID per `R-ONB-*` e `R-STY-*` |

---

## 14. Requisiti Tracciabili (per IMPLEMENTATION_CROSSMAP)

| Req ID | Requisito | Stato iniziale |
|---|---|---|
| `R-ONB-1` | Wizard onboarding utente 3 step con profilazione tag | 📐 Spec definita |
| `R-ONB-2` | Onboarding skipabile e riprendibile | 📐 Spec definita |
| `R-ONB-3` | Pagina settings/profile per modifica profilo | 📐 Spec definita |
| `R-ONB-4` | Badge completamento profilo in dashboard | 📐 Spec definita |
| `R-STY-1` | Catalogo tag stilistici globale (10 categorie, ~100 tag) | 📐 Spec definita |
| `R-STY-2` | 10 palette colori predefinite con design tokens | 📐 Spec definita |
| `R-STY-3` | Riferimenti visivi per stili (immagini hero card) | 📐 Spec definita |
| `R-MBD-1` | Wizard creazione progetto con moodboard 3 step | 📐 Spec definita |
| `R-MBD-2` | Fast-create con inherit da profilo utente | 📐 Spec definita |
| `R-MBD-3` | Override/fallback cascade (progetto → utente → piattaforma) | 📐 Spec definita |
| `R-MBD-4` | Tab "Style" nel workspace per modifica rapida | 📐 Spec definita |
| `R-L0-1` | StyleProfileResolver con merge e fallback | 📐 Spec definita |
| `R-L0-2` | Layer0PromptBuilder con budget token 400 | 📐 Spec definita |
| `R-L0-3` | Integrazione Layer 0 → Layer 1 (Chat Preview) | 📐 Spec definita |
| `R-L0-4` | Integrazione Layer 0 → Layer 2 (OpenCode Pipeline) | 📐 Spec definita |
| `R-L0-5` | Route debug /resolved-style per preview | 📐 Spec definita |

---

## Appendice A — Industry Best Practices & Benchmark di Riferimento

> **Fonte:** Analisi diretta di Duolingo, Slack, Figma, Headspace + articolo JustInMind "User onboarding: best practices and 20 good examples" + UX Collective  
> **Scopo:** Documentare pattern UX di onboarding consolidati nel settore e mappare l'applicabilità diretta alle scelte architetturali di questa spec.

### A.1 Principi Universali di Onboarding (da JustInMind)

L'articolo JustInMind identifica 11 best practice e 5 errori da evitare. La tabella mappa ogni principio alla nostra spec:

| # | Best Practice JustInMind | Pattern | Applicazione Andy Code Cat | Sezione Spec |
|---|---|---|---|---|
| BP-1 | **Understand the user journey** — mappare il percorso dall'apertura al momento "aha" | User Journey Map | Il wizard 3-step mappa: identità → stile → ispirazioni. L'"aha moment" è la preview del profilo risolto. | §2 |
| BP-2 | **Define key milestones** — azioni chiave che portano al valore del prodotto | Milestone-driven | Milestones: (1) primo tag selezionato, (2) palette scelta, (3) profilo completato → badge. `completionScore` traccia il progresso. | §2.3, §5.2 |
| BP-3 | **Balance education and exploration** — guidare ma lasciare esplorare | Guided freedom | Wizard guidato ma ogni step è skipabile (P-ONB-1). Tag cliccabili = esplorazione, non form rigidi. | §2.2 |
| BP-4 | **Minimize friction** — meno passaggi possibili | Friction reduction | 3 step soli, ogni step < 30 sec, visual-first (click non typing). Fast-create bypassa il wizard. | §2.2, §3.2 |
| BP-5 | **Personalize and contextualize** — adattare il flusso al tipo di utente | Contextual flow | Step 1 (Chi Sei) determina quali tag vengono evidenziati nello Step 2 (Stile). Profiling progressivo. | §2.1 |
| BP-6 | **Focus on quick wins** — dare risultati immediati | Quick wins | Dopo Step 2, preview live della palette scelta. Feedback visivo istantaneo. | §2.1 |
| BP-7 | **Simplify the process** — essenziale, niente di superfluo | Minimalism | Max 5 tag per categoria. Nessun campo obbligatorio. Due soli percorsi (wizard o fast-create). | §1.1, §3.2 |
| BP-8 | **Use engaging visuals** — animazioni e immagini per spiegare senza testo | Visual-first | Card con immagine hero per ogni stile visivo (§1.4). Palette con anteprima colore live. | §1.4, §9.2 |
| BP-9 | **Make it interactive** — l'utente agisce, non legge | Learn by doing | TagCloud multi-select, PaletteSelector con click, VisualStyleCard selezionabili. Zero tutorial testuali. | §9.2 |
| BP-10 | **Provide consistent communication** — supporto continuo post-onboarding | Ongoing nudges | ProfileCompletionBadge nel dashboard. Possibilità di riaprire wizard da Settings. Layer 0 status nel workspace. | §9.3, §9.4 |
| BP-11 | **Use progress indicators** — mostrare dove si è nel flusso | Progress bar | `OnboardingProgress` component (step 1/2/3). `completionScore` 0-100. | §9.2 |

### A.2 Errori da Evitare (da JustInMind)

| Anti-pattern | Descrizione | Come Andy Code Cat lo evita |
|---|---|---|
| **Information overload** | Troppi feature presentati subito | Solo 3 step, ognuno con un focus singolo. Nessuna spiegazione tecnica nel wizard. |
| **Ignorare feedback utente** | Flusso fisso senza iterazione | `user_style_profile_history` registra ogni versione. Profilo sempre modificabile da Settings. |
| **Mancanza di personalizzazione** | Onboarding generico per tutti | Step 1 (identità) personalizza le opzioni degli step successivi. Profiling contextuale. |
| **Flussi troppo complessi** | Troppi step, navigazione confusa | 3 step lineari, barra progresso visibile, "Salta tutto" sempre accessibile. |
| **Nessun follow-up** | Utente abbandonato dopo l'onboarding | Badge completamento persistente, tab Style nel workspace, Layer 0 sempre attivo. |

### A.3 Benchmark: Duolingo

**Contesto:** App di language learning. 500M+ download. Riferimento per gamification e conversione immediata.

| Pattern Duolingo | Dettaglio | Applicazione Andy Code Cat |
|---|---|---|
| **Interazione immediata** | L'utente sceglie lingua e obiettivo nella landing page — entra nel core in <10 click | Il wizard chiede "Chi sei?" e "Che stile ti piace?" in 2 step — la profilazione è già il prodotto, non un ostacolo pre-prodotto. |
| **Mascotte (Duo)** | Personaggio guida riconoscibile, tono amichevole, riduce ansia | Andy Code Cat può introdurre un companion visivo nel wizard (es. icona/avatar assistente). Microcopy conversazionale nei placeholder. |
| **Goal commitment** | Chiede all'utente di scegliere un obiettivo (commitment bias psicologico) | Lo Step 1 chiede "cosa vuoi costruire?" — il tipo di sito diventa un commitment psicologico che guida tutto il percorso. |
| **Livello di partenza** | Placement test opzionale per esperti OR start from basics | Fast-create (esperto → nessun wizard) vs. wizard completo (nuovo utente). Due percorsi paralleli. |
| **Gamification leggera** | Punti, streaks, badge di progresso | `completionScore` 0-100 con badge (Base/Intermedio/Completo). Non aggressivo, ma presente. |
| **Tooltip contestuali leggeri** | Tooltip appaiono solo dove serve, senza tutorial forzato | VisualStyleCard con hover-preview. Nessun dialog modale bloccante. |

**Pattern chiave adottato:** _"Parla la lingua dell'utente"_ — il wizard usa terminologia visiva (click su immagini) non tecnica. L'utente non deve sapere cosa sia una "palette hex" per scegliere i colori.

### A.4 Benchmark: Slack

**Contesto:** Piattaforma di team messaging. 700M+ messaggi/giorno. Riferimento per setup guidato e riduzione ansia.

| Pattern Slack | Dettaglio | Applicazione Andy Code Cat |
|---|---|---|
| **"The First Meeting"** | L'onboarding è strutturato come un primo incontro: presentazione → esigenze → setup | Il wizard simula un dialogo: Step 1 "Chi sei?" → Step 2 "Il tuo stile" → Step 3 "Le tue ispirazioni". Flusso conversazionale. |
| **Identità del workspace** | Chiede nome workspace, invita membri, stabilisce il contesto | Nello Step 1 l'utente stabilisce la propria identità professionale. Nel moodboard progetto stabilisce l'identità del sito. |
| **Chatbot onboarding** | Slackbot guida interattivamente con domande e risposte | Pattern conversazionale nel wizard: placeholder type-ahead, suggerimenti contestuali, micro-feedback dopo ogni selezione. |
| **Zero distrazioni** | Nessun email verification, nessuna notifica, nessun setup password fino a dopo l'onboarding | L'email verification è già bypassabile (`SKIP_EMAIL_VERIFY=true`). Il wizard è post-register, non intra-register. |
| **Progressive disclosure** | Popup feature solo sulle funzionalità chiave, il resto lasciato ad esplorazione autonoma | Solo 3 categorie nel wizard (identità/stile/ispirazioni). Le 10 categorie tag complete sono nel settings post-onboarding. |
| **Microcopy esplicativa** | Ogni campo ha una spiegazione contestuale che dà contesto allo sforzo richiesto | Ogni step può includere subtitle esplicativo: "Questo ci aiuta a personalizzare le proposte di design per i tuoi progetti". |

**Pattern chiave adottato:** _"Riduci l'ansia del primo incontro"_ — non chiedere troppo subito, stabilire fiducia prima di chiedere dati. Il wizard Andy Code Cat non chiede mai informazioni obbligatorie.

### A.5 Benchmark: Figma

**Contesto:** Tool di design collaborativo. Usato da Duolingo, Slack, Netflix etc. Riferimento per "learn by doing".

| Pattern Figma | Dettaglio | Applicazione Andy Code Cat |
|---|---|---|
| **Tooltip contestuali** | Tooltip appaiono solo quando l'utente interagisce con un elemento, non in sequenza forzata | Nel workspace, i tooltip per Layer 0 appaiono solo quando l'utente apre la tab Style. Mai interruzioni push. |
| **Progetti esempio** | Template pronti che mostrano il potenziale del tool senza partire da zero | Seed crea almeno un progetto demo con moodboard precompilato. L'utente vede subito come appare un progetto "completo". |
| **Learn by doing, not reading** | L'interfaccia invita ad agire, non a leggere documentazione | TagCloud e PaletteSelector sono componenti di azione (click per selezionare). Nessun testo istruttivo lungo. |
| **Template come starting point** | Figma offre template per website, app, presentation come punto di partenza | I 10 template di palette predefinite (ocean-blue, warm-sunset, etc.) sono il punto di partenza visivo. L'utente "sceglie" prima di "creare". |
| **Collaborative context** | Real-time cursors, commenti — mostra che non sei solo | Il Layer 0 status nel workspace mostra che l'AI "conosce" il tuo stile — non sei solo a costruire. |
| **Design systems come base** | Libraries condivise garantiscono coerenza | Il catalogo `style_tags` è la design system condivisa di Andy Code Cat: tag consistenti tra utenti, progetti e AI. |

**Pattern chiave adottato:** _"Non chiedere di leggere, chiedi di fare"_ — ogni step del wizard è un'azione visiva (seleziona, clicca, trascina) non un form da compilare.

### A.6 Benchmark: Headspace

**Contesto:** App di meditazione e wellness mentale. 70M+ download. Riferimento per tono emotivo e mood come UX.

| Pattern Headspace | Dettaglio | Applicazione Andy Code Cat |
|---|---|---|
| **Tono emotivo** | "Take a deep breath" come prima interazione — il tono dell'app è l'esperienza | Il wizard può aprirsi con un messaggio di benvenuto caldo: "Raccontaci di te — ci aiuterà a creare qualcosa che ti rappresenta". |
| **Animazioni calming** | Transizioni fluide, colori rilassanti, nessuna fretta | Transizioni smooth tra step del wizard. Palette preview con fade-in. Nessun timer o urgenza. |
| **"Mood" come input UX** | Prima domanda: "What kind of headspace are you looking for?" — il mood è l'entry point | La categoria `TC-VISUAL` (minimal, bold, playful, dark, etc.) è esattamente il "mood" del progetto. Il mood guida tutto il resto. |
| **Goal selection iniziale** | L'utente sceglie tra: stress, sleep, anxiety, focus — personalizzazione immediata | Step 1 chiede tipo (freelancer, agency, brand) e settore — personalizzazione immediata del percorso. |
| **AI companion (Ebb)** | Chatbot empatico che dà raccomandazioni personalizzate in base al mood | Andy Code Cat può offrire suggerimenti tag basati sull'identità dichiarata nello Step 1 → "Basandoci sul tuo profilo, ti suggeriamo...". |
| **Contenuto come terapia** | L'onboarding non è un ostacolo, è già parte dell'esperienza benefica | Il wizard di Andy Code Cat non è "setup burocratico" — è il primo atto creativo. L'utente sta già costruendo il suo progetto. |

**Pattern chiave adottato:** _"Il mood è UX"_ — lo stato emotivo/estetico dell'utente non è un dato da raccogliere ma un'esperienza da vivere. Il wizard deve far sentire l'utente già dentro al processo creativo.

### A.7 Sintesi: Pattern Trasversali Adottati

Dalla convergenza dei 4 benchmark + le best practice JustInMind emerge il modello operativo Andy Code Cat:

```
┌────────────────────────────────────────────────────────────────────┐
│           MODELLO ONBOARDING Andy Code Cat — 6 PATTERN CHIAVE         │
│                                                                    │
│  ┌─ P1. AZIONE PRIMA DI ISTRUZIONE (Figma, Duolingo)             │
│  │   → Click/select, mai leggere. Wizard = interfaccia d'azione. │
│  │                                                                 │
│  ├─ P2. CONVERSAZIONE NON INTERROGATORIO (Slack, Headspace)       │
│  │   → Tono amichevole. "Raccontaci" non "Compila". Microcopy.   │
│  │                                                                 │
│  ├─ P3. MOOD COME ENTRY POINT (Headspace, Duolingo)               │
│  │   → Lo stile/mood è la prima domanda. Il mood guida tutto.    │
│  │                                                                 │
│  ├─ P4. QUICK WIN VISIVO (Duolingo, Figma)                       │
│  │   → Preview live palette/stile dopo ogni selezione.            │
│  │                                                                 │
│  ├─ P5. DOPPIO PERCORSO ESPERTO/NOVIZIO (Duolingo, Figma)         │
│  │   → Fast-create (skip) per chi sa cosa vuole. Wizard per chi  │
│  │     vuole essere guidato.                                       │
│  │                                                                 │
│  └─ P6. ONBOARDING = PRIMO ATTO CREATIVO (Headspace, tutti)      │
│      → L'onboarding non è setup, è il primo passo del progetto.  │
│      → L'utente sta già "costruendo" durante il wizard.           │
└────────────────────────────────────────────────────────────────────┘
```

### A.8 Metriche di Validazione

Per verificare l'efficacia dell'onboarding basato su questi pattern, monitorare:

| Metrica | Target | Fonte benchmark |
|---|---|---|
| **Wizard completion rate** | ≥ 60% degli utenti che iniziano completano tutti e 3 gli step | Duolingo: >70% completa il primo lesson entro 10 click |
| **Time-to-first-project** | < 5 minuti da registrazione a primo progetto creato | Slack: workspace attivo in <3 min, Figma: primo file in <2 min |
| **Profile completion score** | Media ≥ 40/100 entro prima settimana | Headspace: 65% sceglie almeno un goal al primo accesso |
| **Bounce rate wizard** | < 25% abbandono tra Step 1 e Step 3 | Industria: 23% drop rate medio per wizard 3-step |
| **Return-to-edit rate** | ≥ 15% utenti modificano profilo entro 30 giorni | Figma: alta iterazione su template dopo setup iniziale |
| **Fast-create vs. wizard** | 30-40% fast-create, 60-70% wizard | Equilibrio tra utenti esperti e novizi |

### A.9 Riferimenti

| Ref | Tipo | URL / Descrizione |
|---|---|---|
| REF-JM-1 | Articolo guida | JustInMind "User onboarding: best practices and 20 good examples" — 11 best practice, 5 anti-pattern, 20 case study (Duolingo, Slack, Canva, Evernote, etc.) |
| REF-DUO-1 | Analisi diretta | Duolingo — Mascotte Duo, goal commitment, placement test opzionale, gamification leggera, < 10 click al core |
| REF-SLK-1 | Analisi diretta | Slack — Chatbot onboarding, zero distrazioni, microcopy esplicativa, progressive disclosure, "first meeting" paradigm |
| REF-FIG-1 | Analisi diretta | Figma — Tooltip contestuali, template come starting point, learn by doing, design systems condivise |
| REF-HS-1 | Analisi diretta | Headspace — Tono emotivo, animazioni calming, "mood as UX", AI companion (Ebb), goal selection iniziale |
| REF-UXC-1 | Fonte terza | UX Collective — Pattern convergenti: interazione immediata, profiling non intrusivo, emotional design |
