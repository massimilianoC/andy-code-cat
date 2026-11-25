# Andy Code Cat — Typed Presets + Config Discovery + Modular Prompt

> **Revision:** 2026-04-08  
> **Status:** PROPOSAL — to be approved before implementation  
> **Dependencies:** M0-STYLE ✅ (style profiling + moodboard), M4a ✅ (asset manager)  
> **Prepares:** M2 (PrepromptEngine modular layers)

---

## Decision Lock — 2026-04-15

The preset system is now confirmed as the foundation for **project-type template models**.

### Primary product meaning of a template model

A template model is not an LLM configuration.
It is a reusable project-type definition such as:

- layout
- landing page
- website
- keynote
- casual game
- serious game
- 3D game
- VR game with A-Frame
- A4 onepager
- 70×100 cm poster
- infographic
- manifesto

Each template model must support:

- category
- tags
- short and long descriptions
- output specification
- brief starter template
- style direction template
- optimized preprompt module to inject into the existing preprompting flow
- superadmin CRUD and ordering

### Authoring policy

The superadmin must be able to create a new template model from a few natural-language instructions and then use the prompt optimizer to generate or refine:

- the brief starter template
- the style direction template
- the optimized preprompt module
- the descriptive catalog copy

### Paused parallel track

The low-level LLM model-template catalog is not the current product focus.
It should be treated as a secondary infrastructure layer kept aside for future runtime tuning.

## 0. Context and Motivation

### 0.1 Current State

| Component | Status | Problem |
|---|---|---|
| `PROJECT_PRESETS` in the dashboard | Array of labels + icons | Not connected to anything downstream. Clicking a preset → only populates the project name. |
| `ProjectConfigPopup` | Moodboard + tags + assets | The left section has no discoverable guidance per project type. Tag categories incomplete vs. user onboarding. |
| `prePromptTemplate` | Flat Nunjucks template per project | Monolithic. The "Landing Page" part is mixed in with the rest. No specialization per preset. |
| Asset thumb | Upload works, thumbnails for images | `useInProject` and `delete` hidden in a hover gear menu, not immediately visible. |
| `StyleProfileResolver` | Not implemented (deferred from M0-STYLE) | The user profile + project moodboard are never used to enrich the system prompt. |

### 0.2 Goal of This Milestone

Implement, in two incremental sub-milestones (A and B), the foundations for:

1. **Typed presets** — each preset has: technical output spec, brief template, default tags, modular prompt block.
2. **Guided Config Discovery** — the project configuration popup becomes "discoverable": pre-filled brief, tags per output type, sticky section for the selected preset.
3. **Modular prompt** — the Layer 1 (chat-preview) system prompt is split into `base + style_enrichment + preset_module`, letting M2 build on top without a refactor.
4. **Asset thumb UX polish** — `useInProject` (the "indexable" flag) always visible, delete accessible without hover.

---

## 1. Gap Analysis Against Requirements

### 1.1 Mapped User Requirements

| Request | Impacted component | Delta vs. current state |
|---|---|---|
| Preset → additional specs acting as "system" (analogous to the user moodboard) | `ProjectPreset` catalog + `project.presetId` + Layer 1 system builder | Doesn't exist. To be built. |
| Guided tag profiling per project type (like user onboarding) | `ProjectConfigPopup` left column + complete `TAG_CATEGORIES` | Partial: 7 of 10 categories. Missing `audience`, `feature`, `sector`. |
| Discoverable left section for the pre-filled brief per style | `ProjectConfigPopup` brief section + preset detection + hint template | Doesn't exist. The brief is an empty textarea. |
| Tags per section in the project configuration popup | `ProjectConfigPopup` TAG_CATEGORIES | Partially present already. To be completed with the missing categories. |
| Assets: thumbnail with visible `useInProject`, direct deletion | `AssetThumb` component | Partial: thumbnail for images ✅, but useInProject/delete inside a hover gear menu. |
| Prompting engine incorporates the preset specs | Layer 1 system prompt builder | No base/preset separation exists. `prePromptTemplate` is flat. |
| Specialize the Landing Page/Website case into a dynamic part | `prePromptTemplate` → `base_template + preset_module` | To be split. |
| A4: force `@page A4` CSS + print dimensions | `PresetOutputSpec` for A4 | To be defined in the catalog. |
| Slide: multi-section 16:9 or 3:4 as PDF pages | `PresetOutputSpec` for slideshow/keynote | To be defined in the catalog. |
| Infographic: masonry, icon-heavy, poster | `PresetOutputSpec` for infographic | To be defined in the catalog. |
| Manifesto: political/brand statement structure | `PresetOutputSpec` for manifesto | To be defined in the catalog. |
| Form: guided step-by-step construction to fill in | `PresetOutputSpec` for form | To be defined in the catalog. |

---

## 2. Proposed Architecture

### 2.1 Entity: `ProjectPreset` (static catalog, backend only)

It is not a MongoDB document. It's a static in-code catalog, like `StyleTag`. This avoids
DB overhead for an entity that doesn't change at runtime.

```typescript
// apps/api/src/domain/entities/ProjectPreset.ts

export interface PresetOutputSpec {
  /** Generated page model */
  pageModel: 'single_page' | 'multi_page' | 'slide_deck' | 'print_a4';
  
  /** Scroll/navigation model */
  sectionModel: 'scroll' | 'paginated' | 'masonry' | 'stepped_form';
  
  /** Expected number of pages/slides (null = variable) */
  recommendedPageCount?: number;
  
  /** Aspect ratio for multi-page or print output */
  aspectRatio?: '16:9' | '4:3' | 'A4_portrait' | 'A4_landscape' | 'free';
  
  /** CSS block hardcoded into the output (print constraints, slide dimensions) */
  cssConstraints?: string;  // e.g. "@page { size: A4 portrait; margin: 1.5cm; }"
  
  /** Whether the output is meant for print / PDF export */
  printReady: boolean;
  
  /**
   * Block of additional instructions for the generation system.
   * Injected into the system message BEFORE the base prePromptTemplate.
   * Max 500 tokens. Strong structural instructions (e.g. "Each section must occupy
   * exactly width 1270px × height 714px" for 16:9 slides).
   */
  systemPromptModule: string;
}

export interface PresetTagDefaults {
  /** Tags pre-selected per category when the project is created */
  visualTags?: string[];        // e.g. ["visual:minimal", "visual:corporate"]
  layoutTags?: string[];        // e.g. ["layout:hero-first"]
  toneTags?: string[];          // e.g. ["tone:formal-professional"]
  featureTags?: string[];       // e.g. ["feature:contact-form", "feature:pricing-table"]
  audienceTags?: string[];      // e.g. ["audience:b2b"]
  typographyTags?: string[];
  paletteTags?: string[];
}

export interface ProjectPreset {
  id: string;                   // slug: "landing", "a4poster", "slideshow", etc.
  label: string;                // "Landing Page"
  labelIt: string;
  labelEn: string;
  hint: string;                 // "Single page oriented toward conversion"
  icon: string;                 // lucide icon name
  
  outputSpec: PresetOutputSpec;
  defaultTags: PresetTagDefaults;
  
  /** Brief template pre-filled for the configuration popup */
  briefTemplate: string;        // max 600 chars, interpolatable with {{projectName}}
  
  /** Style notes pre-filled for the configuration popup */
  styleTemplate: string;        // max 400 chars
  
  /**
   * Guiding questions for brief discovery (left section of the configuration popup).
   * Array of strings shown as a guided placeholder/accordion.
   */
  briefGuideQuestions: string[];  // max 5 short questions
}
```

### 2.2 Preset Catalog — 9 Defined Presets

```typescript
export const PRESET_CATALOG: ProjectPreset[] = [

  // ── NEUTRAL ──────────────────────────────────────────────────────────────────
  {
    id: "neutral",
    label: "Vuoto / Neutro", labelIt: "Vuoto / Neutro", labelEn: "Blank / Neutral",
    hint: "Start from a blank canvas",
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
      "What is the main purpose of this page?",
      "Who is the target audience?",
      "What is the main message to communicate?",
    ],
  },

  // ── LANDING PAGE ─────────────────────────────────────────────────────────────
  {
    id: "landing",
    label: "Landing Page", labelIt: "Landing Page", labelEn: "Landing Page",
    hint: "Single page oriented toward conversion",
    icon: "LayoutTemplate",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'scroll',
      printReady: false,
      systemPromptModule: `OUTPUT FORMAT — LANDING PAGE:
Structure the page as a conversion-oriented landing page:
1. HERO: strong headline, subheading, primary CTA above-the-fold.
2. SOCIAL PROOF / TRUST: testimonials, client logos, key numbers.
3. FEATURES / VALUE: benefit sections with icons or images.
4. Secondary CTA or pricing table.
5. FOOTER: contacts, legal links.
Every section has a precise conversion goal. No distractions.
The primary CTA must be visible without scrolling.`,
    },
    defaultTags: {
      layoutTags: ["layout:hero-first"],
      featureTags: ["feature:contact-form"],
    },
    briefTemplate: "Conversion-oriented landing page for {{projectName}}. The main goal is to generate leads/contacts/purchases. The target audience is [...]",
    styleTemplate: "Clean layout with strong visual hierarchy. Impactful hero, clearly visible CTA.",
    briefGuideQuestions: [
      "What is the single action you want the visitor to take?",
      "What are the top 3 benefits of your product/service?",
      "Who is the ideal customer (sector, role, problem)?",
      "Do you have testimonials or proof points to include?",
      "Do you have an offer or incentive for conversion (free trial, discount, etc.)?",
    ],
  },

  // ── WEBSITE ──────────────────────────────────────────────────────────────────
  {
    id: "website",
    label: "Website", labelIt: "Website", labelEn: "Website",
    hint: "Classic multi-section site",
    icon: "Files",
    outputSpec: {
      pageModel: 'single_page',   // Layer 1 generates single-page; Layer 2 may generate multi-page
      sectionModel: 'scroll',
      printReady: false,
      systemPromptModule: `OUTPUT FORMAT — WEBSITE:
Structure as a classic multi-section website with sticky top navigation:
1. HEADER with logo, navigation (Home, About, Services, Contact).
2. HERO with identity and value proposition.
3. ABOUT.
4. SERVICES / PRODUCTS (card grid).
5. PORTFOLIO or CASE STUDY (optional).
6. TESTIMONIALS.
7. CONTACT with form.
8. Full FOOTER.
Every section has an anchor ID for internal navigation.`,
    },
    defaultTags: {
      layoutTags: ["layout:hero-first"],
      featureTags: ["feature:contact-form", "feature:testimonials"],
    },
    briefTemplate: "Institutional website for {{projectName}}. Presents the company, its services, and makes it easy for prospective clients to get in touch.",
    styleTemplate: "Classic, professional structure. Clear navigation. Well-distinct sections.",
    briefGuideQuestions: [
      "Which sections of the site are the priority?",
      "How many services/products do you want to show?",
      "Do you have a portfolio or case studies to include?",
      "How do you want visitors to contact you?",
    ],
  },

  // ── FORM ─────────────────────────────────────────────────────────────────────
  {
    id: "form",
    label: "Form", labelIt: "Form", labelEn: "Form",
    hint: "Lead and contact collection with guided steps",
    icon: "FormInput",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'stepped_form',
      printReady: false,
      systemPromptModule: `OUTPUT FORMAT — MULTI-STEP FORM:
Build a multi-step form (wizard) with these characteristics:
- STEP 1: main data (minimum necessary fields).
- STEP 2: additional details.
- STEP 3: summary + submit.
Navigation: "Next" / "Back" / "Submit" buttons.
Progress bar visible at the top.
Client-side validation for each step before proceeding.
Each step occupies the screen vertically, no horizontal scroll.
The form must be mobile-first.`,
    },
    defaultTags: {
      featureTags: ["feature:contact-form"],
      toneTags: ["tone:friendly-casual"],
    },
    briefTemplate: "Guided multi-step form for {{projectName}}. The goal is to collect [type of data] in a simple, progressive way.",
    styleTemplate: "Clean interface, few fields per step, focus on completion.",
    briefGuideQuestions: [
      "What information do you want to collect from the user?",
      "How many logical steps does the process have?",
      "What happens after the form is submitted (confirmation, redirect)?",
      "Do you have specific validation requirements?",
    ],
  },

  // ── MANIFESTO ────────────────────────────────────────────────────────────────
  {
    id: "manifesto",
    label: "Manifesto", labelIt: "Manifesto", labelEn: "Manifesto",
    hint: "Identity, values and statement of intent page",
    icon: "RectangleEllipsis",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'scroll',
      printReady: false,
      systemPromptModule: `OUTPUT FORMAT — MANIFESTO:
Structure as a brand/identity manifesto with these elements:
1. OPENING: evocative title + core claim (large, centered).
2. PROBLEM / WHY: statement of the problem you want to solve.
3. VALUES: a list of 3-7 core values, each with an explanatory line.
4. VISION: where you want to get to, the imagined future.
5. ACTION / CALL: what you're asking the reader to do (join, believe, act).
6. SIGNATURE: name/brand + date.
Strong, hierarchical typography. Lots of text, little decoration.
Sharp contrast between background and text. Solemn but energetic tone.`,
    },
    defaultTags: {
      visualTags: ["visual:bold"],
      toneTags: ["tone:inspirational", "tone:authoritative-expert"],
      typographyTags: ["typo:display-bold"],
    },
    briefTemplate: "Manifesto for {{projectName}}: a public statement of values, vision and mission. Aimed at [audience].",
    styleTemplate: "Dominant display typography. Dark or high-contrast palette. No superfluous elements.",
    briefGuideQuestions: [
      "What is the founding value or principle you want to state?",
      "Who should feel called out by this manifesto?",
      "What are the 3-5 non-negotiable values?",
      "What action are you asking the reader to take?",
    ],
  },

  // ── SLIDESHOW / PRESENTAZIONE ─────────────────────────────────────────────────
  {
    id: "slideshow",
    label: "Presentazione", labelIt: "Presentazione", labelEn: "Slideshow",
    hint: "Navigable slide deck — exportable as a 16:9 PDF",
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
      systemPromptModule: `OUTPUT FORMAT — 16:9 SLIDE PRESENTATION:
Create a presentation with navigable slides.
TECHNICAL CONSTRAINTS (NON-NEGOTIABLE):
- Each slide is a div.slide of 1270×714px.
- No content may extend beyond these dimensions.
- Navigation with left/right arrows or prev/next buttons.
- Visible slide counter (e.g. "3 / 10").
- Exportable as a 16:9 PDF (each slide = 1 page).
TYPICAL STRUCTURE:
  Slide 1: Cover (title, author, date)
  Slide 2: Agenda / Index
  Slide 3-N: Content (max 5 points per slide)
  Slide N: Conclusion + CTA
Large font (min 24px body), bullet points, never dense text.`,
    },
    defaultTags: {
      visualTags: ["visual:corporate"],
      typographyTags: ["typo:sans-serif-clean"],
    },
    briefTemplate: "Presentation for {{projectName}} in 16:9 slide format. Topic: [topic]. Audience: [who is watching the presentation].",
    styleTemplate: "Clean slides, max 5 points per slide, graphics supporting the text.",
    briefGuideQuestions: [
      "What is the presentation's goal (sales, training, pitch, report)?",
      "Roughly how many slides are you aiming for?",
      "Who is the audience and what is the context (internal meeting, client, conference)?",
      "Do you have specific content/data to include?",
    ],
  },

  // ── KEYNOTE ──────────────────────────────────────────────────────────────────
  {
    id: "keynote",
    label: "Keynote", labelIt: "Keynote", labelEn: "Keynote",
    hint: "High-impact visual presentation — conference style",
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
      systemPromptModule: `OUTPUT FORMAT — VISUAL KEYNOTE:
High visual-impact presentation for conferences or all-hands.
TECHNICAL CONSTRAINTS:
- Each slide is 1920×1080px (full HD).
- Images/visuals dominate over text.
- Max 2-3 keywords per slide (not a bullet list).
- Transitions implied in the markup (class="slide active/next").
- Keyboard-friendly navigation (arrows).
STRUCTURE:
  Spectacular cover, quote-only slide, numeric slide (a large stat),
  emotional slide (photo + claim), final summary slide.
Display typography. Fullbleed images. Text overlaid with a dark overlay.`,
    },
    defaultTags: {
      visualTags: ["visual:bold", "visual:futuristic"],
      typographyTags: ["typo:display-bold"],
    },
    briefTemplate: "Visual keynote for {{projectName}} for a high-impact presentation. Central theme: [theme]. Estimated duration: [minutes].",
    styleTemplate: "Full-bleed visuals, dominant text, strong high-contrast palette.",
    briefGuideQuestions: [
      "What is the message that should stick after the presentation?",
      "Do you have emotional images or brand icons to use?",
      "What is the tone: inspirational, technical, visionary?",
    ],
  },

  // ── A4 POSTER ────────────────────────────────────────────────────────────────
  {
    id: "a4poster",
    label: "A4 Poster", labelIt: "A4 Poster", labelEn: "A4 Poster",
    hint: "Single-page layout printable as an A4 PDF",
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
      systemPromptModule: `OUTPUT FORMAT — PRINTABLE A4 DOCUMENT (MULTI-VARIANT):

BASE TECHNICAL CONSTRAINTS (NON-NEGOTIABLE):
- Every page: div w-[210mm] h-[297mm] overflow-hidden flex flex-col bg-white (Tailwind).
- ZERO overflow, no scroll, no viewport units (no vw/vh), no position:fixed.
- Do NOT use <input>, <textarea>, <select> — they don't print correctly.
  For fillable fields use: a div with border-b-2 border-slate-200 (writable by hand on paper).
- Print-ready: every .page must have print:m-0 print:shadow-none print:border-none.
- Multi-page: every div.page has class "print:break-after-page".
- Font: Tailwind text-* (body ≥ text-[11px]; display up to text-5xl); no font in vw.

SUB-TYPE DETECTION — analyze the brief and choose the appropriate structure:

▶ A — POSTER / FLYER
  Trigger: "poster", "flyer", "invitation", "event", "announcement"
  Single decorative page. Hierarchy: dominant title > visual/image > info > footer.
  Shell: <div class="w-[210mm] h-[297mm] p-8 bg-white flex flex-col justify-between overflow-hidden print:m-0">
  Structure: HEADER (display title text-5xl font-black tracking-tighter) | BODY (visual + claim) |
             FOOTER (date, location, contacts — border-t pt-4 text-sm text-slate-500).
  Do NOT use fillable fields or data grids.

▶ B — MULTI-PAGE DOCUMENT / REPORT
  Trigger: "document", "report", "guide", "manual", "handbook", "brochure", "booklet"
  Sequence of independent div.page elements. Page 1 = cover.
  COVER: full-color background, centered title (text-4xl font-black), subtitle, date, logo.
  INNER PAGES:
    header: flex justify-between border-b pb-2 mb-6 | abbreviated title + page number text-[9px]
    body: grid grid-cols-2 gap-6 (or single-col for long text)
    sections: h2 text-lg font-bold mb-3 border-b pb-1 + paragraphs text-[11px] leading-relaxed
    footer: border-t mt-auto pt-2 flex justify-between text-[9px] text-slate-400

▶ C — PARTICIPANT CANVAS / WORKSHEET
  Trigger: "canvas", "worksheet", "form", "participant", "exercise", "brainstorming"
  Interactive page for filling out on paper. Do NOT use HTML form elements.
  Shell: <div class="w-[210mm] h-[297mm] p-8 bg-white flex flex-col gap-4 overflow-hidden print:m-0">
  ANATOMY (top to bottom):
  1. HEADER: flex items-start justify-between
     left — event title (text-3xl font-black italic tracking-tighter) + subtitle text-xs
     right — info block: border-l-4 border-{accent} pl-4 with date + location text-sm
  2. METADATA FIELDS (grid grid-cols-3 gap-4):
     each field = <div class="py-2 border-b-2 border-slate-200">
       <div class="text-[9px] uppercase font-bold text-slate-400">{label}</div>
       <div class="h-5"></div>  {/* space for handwriting */}
     </div>
  3. PROMPT CARDS (grid grid-cols-4 gap-2):
     each card = <div class="bg-{accent}-50 p-3 rounded-lg border border-{accent}-100">
       <div class="text-[9px] font-bold text-{accent}-600 uppercase mb-1">{phase}</div>
       <p class="text-[11px] text-slate-700 leading-snug">{prompt question}</p>
     </div>
  4. FREE-DRAW AREA (drawing area — takes up the remaining space):
     <div class="flex-grow border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 relative overflow-hidden"
          style="background:radial-gradient(#{accent-color} 1px,transparent 1px);background-size:20px 20px">
       {/* decorative WATERMARK — does not interfere with the drawing space */}
       <div class="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
         <span class="text-[140px] font-black text-white opacity-20">{KEYWORD}</span>
       </div>
       <div class="absolute bottom-2 left-3 text-[9px] uppercase font-bold text-{accent}-300">{area label}</div>
     </div>
  5. BOTTOM GRID (grid grid-cols-3 gap-3):
     col-span-2 — keyword area: a numbered 1/2/3 list with a border-b div for each
     col 3 — open question: div border-b h-12 (answer space)
  6. FOOTER (mt-auto border-t pt-2 flex justify-between text-[9px] text-slate-400):
     organization name | year/edition

▶ D — FACILITATOR / STAFF GUIDE
  Trigger: "facilitator", "staff", "facilitation guide", "moderator", "trainer", "staff agenda"
  Multi-page. Prominent "STAFF ONLY" badge. Distinct from the participant material.
  Shell: same as Canvas but with a prominent header badge.
  ANATOMY:
  1. HEADER: staff badge (span bg-{accent}-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase)
             + inline title text-xl font-black + subtitle italic text-xs text-slate-500
  2. PHASE TIMELINE (grid grid-cols-4 gap-2):
     normal cell: p-3 rounded-lg text-center border border-{accent}-200 bg-{accent}-50 text-{accent}-700
     ACTIVE cell: bg-{accent}-600 text-white font-bold (visually highlighted)
     cell content: time (text-xs font-bold) + phase name (text-[10px] mt-1)
  3. EXERCISE GUIDE ITEMS (for each activity):
     <div class="flex gap-4 items-start bg-slate-50/50 p-3 rounded-lg border border-slate-100">
       <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white bg-{color}-500 shrink-0 text-sm">{letter}</div>
       <div>
         <span class="font-bold text-sm text-slate-800">{title}</span>
         <p class="text-xs text-slate-600 italic mt-0.5">Goal: {goal}</p>
         <p class="text-[10px] text-slate-500 mt-1">💡 {practical tip}</p>
       </div>
     </div>
  4. TIPS CALLOUT: div bg-yellow-50 p-4 rounded-xl border border-yellow-200
     + span font-bold text-yellow-800 (warning title) + ul list-disc ml-4 text-sm text-yellow-700
  5. FOOTER: border-t mt-auto pt-2 flex items-center justify-between text-[9px] text-slate-400
     logo badge (w-8 h-8 bg-{accent}-900 rounded-lg text-white font-bold) + "Confidential document"

PRINT PALETTE (choose a coherent thematic accent):
- Cultural/creative event: cyan-600 | Corporate/institutional: blue-700 | Sustainability: emerald-600
- Use slate-800 for primary text, slate-400 for secondary, bg-white for the page.
- Aim for ink-friendly: readable even in B/W print.`,
    },
    defaultTags: {
      visualTags: ["visual:bold"],
      typographyTags: ["typo:display-bold"],
    },
    briefTemplate: "A4 poster/flyer for {{projectName}}. To be printed as a flyer or exported as a PDF. Main content: [event title / key message].",
    styleTemplate: "Printable single-sheet layout. Strong typographic hierarchy. Balanced images and text in the A4 format.",
    briefGuideQuestions: [
      "Is it for black-and-white or color printing?",
      "What is the main title or event?",
      "What essential information needs to be on the sheet (date, location, contacts)?",
      "Do you have a logo or image to include?",
    ],
  },

  // ── INFOGRAPHIC ───────────────────────────────────────────────────────────────
  {
    id: "infographic",
    label: "Infographic", labelIt: "Infografica", labelEn: "Infographic",
    hint: "Data visualization, icons, narrative sequences — rich poster/manifesto style",
    icon: "Sparkles",
    outputSpec: {
      pageModel: 'single_page',
      sectionModel: 'masonry',
      printReady: false,
      systemPromptModule: `OUTPUT FORMAT — INFOGRAPHIC (MULTI-VARIANT):

A visually dense page. Data speaks through imagery; text is concise.

SUB-TYPE DETECTION — analyze the brief and choose the structure:

▶ A — VERTICAL INFOGRAPHIC (default)
  Trigger: generic, "data", "statistics", "visual storytelling", "overview"
  Long vertical page. Top-to-bottom narrative sequence.
  STRUCTURE:
    BIG TITLE (key message, text-5xl font-black)
    → PROBLEM (icon + 1 sentence, bg-slate-800 text-white p-6)
    → DATA 1-2-3 (grid grid-cols-3: number text-6xl font-black + label text-xs uppercase)
    → PROCESS FLOW (horizontal steps: flex gap-4 items-center with → arrows)
    → RESULTS (percentage or stat in a circle or a prominent badge)
    → CONCLUSION + CTA (final section with a button or call to action)
  TECHNIQUES:
    - Alternate light/dark sections for visual rhythm.
    - Every key data point: colored box, circle, badge — NEVER inline in the text.
    - Max 30-40 words per section. Inline SVG icons or emoji as decorators.

▶ B — CARD GRID / ACTIVITIES (keywords: exercises, activities, options, cards, workshop, "choose between")
  Grid of colored cards. Ideal for: workshop exercises, option menus, comparing elements.
  CONTAINER: grid grid-cols-2 gap-4 (an optional final card col-span-2 for a dominant element).
  CARD ANATOMY:
    Wrapper:      border-2 border-{color}-300 rounded-2xl p-5 flex flex-col bg-{color}-50/30
    Letter badge: div w-8 h-8 rounded-lg flex items-center justify-center font-black text-white bg-{color}-500
    Category:     span text-xs font-bold uppercase tracking-widest text-{color}-700 mt-2
    Question:     p text-sm font-bold italic text-slate-800 mt-1
    Description:  p text-[11px] leading-relaxed text-slate-600 flex-grow mt-2
    Card footer:  div mt-auto pt-3 border-t border-{color}-100 text-[10px] italic text-slate-500
  COLOR SCHEME (a distinct palette per card, in order):
    A → cyan   (bg-cyan-50/30,   border-cyan-300,   badge: bg-cyan-500)
    B → slate  (bg-slate-50/30,  border-slate-300,  badge: bg-slate-500)
    C → red    (bg-red-50/30,    border-red-300,    badge: bg-red-500)
    D → indigo (bg-indigo-50/30, border-indigo-300, badge: bg-indigo-500)
    E → yellow (bg-yellow-50/30, border-yellow-300, badge: bg-yellow-600 — not 500)
  COL-SPAN-2 CARD: inner content as a grid grid-cols-3 gap-6.

▶ C — TIMELINE / PROCESS (trigger: phases, steps, roadmap, process, sequence, agenda, milestones)
  STRUCTURE: header with title + numeric context ("X phases") | timeline grid | phase detail.
  TIMELINE: grid grid-cols-N gap-2 (N = number of steps/phases).
    Normal cell: p-3 rounded-lg text-center border border-{color}-200 bg-{color}-50 text-{color}-700.
    ACTIVE/CURRENT cell: bg-{color}-600 text-white font-bold.
    Cell content: number/icon (text-lg font-bold) + short label (text-[10px] mt-1).
  PHASE DETAIL (card below the timeline for the active phase): title, goal, materials, duration.

▶ D — DATA DASHBOARD (trigger: KPI, metrics, statistics, performance, dashboard, key numbers)
  STRUCTURE: KPI row | chart area | summary table.
  KPI CARD (grid grid-cols-3 or 4):
    span text-4xl font-black text-{color}-600 (number)
    + p text-xs uppercase tracking-wide text-slate-500 (label)
    + span text-sm text-green-600 (change ↑ or ↓)
  CHART AREA: colored placeholder div with textual data (if no charting library is available).
  TABLE: table with thead bg-slate-100 and alternating rows bg-white/bg-slate-50 text-[11px].

COMMON TECHNIQUES:
  LETTER/ICON BADGE:   div.w-8.h-8.rounded-lg.flex.items-center.justify-center.font-black.text-white.bg-{color}-500
  WARNING CALLOUT BOX: div.bg-yellow-50.p-4.rounded-xl.border.border-yellow-200 + ul.list-disc.ml-4.text-sm.text-yellow-700
  DARK SECTION:        div.bg-slate-800.text-white.p-8 (to alternate light/dark rhythm)
  HIGHLIGHTED DATA:    span.text-5xl.font-black.text-{color}-600 on a neutral background

Think like an art director, not a copywriter. Priority: visual impact → clarity → completeness.`,
    },
    defaultTags: {
      visualTags: ["visual:bold"],
      layoutTags: ["layout:full-bleed-images", "layout:dense-info"],
    },
    briefTemplate: "Infographic for {{projectName}} about the data/concepts: [topic]. Key data to show: [data]. Audience: [who is reading].",
    styleTemplate: "High visual density. Icons, numbers, colors. Alternating vertical rhythm.",
    briefGuideQuestions: [
      "What is the main data point or message to communicate?",
      "Do you have numeric data or statistics to visualize?",
      "Is it a narrative sequence (process/timeline) or a comparative overview?",
      "Do you have brand icons or visuals to incorporate?",
    ],
  },
];

export const PRESET_MAP = new Map(PRESET_CATALOG.map(p => [p.id, p]));
export const VALID_PRESET_IDS = new Set(PRESET_CATALOG.map(p => p.id));
```

---

## 3. Sub-Milestone A — Preset Catalog + Config UX Discovery

> **Estimate:** 2–3 days  
> **Goal:** the preset selected at project creation time becomes a structured context in the moodboard and in the configuration popup.

### 3.1 Backend — M-PRESET-A

#### 3.1.1 `ProjectPreset` entity

- File: `apps/api/src/domain/entities/ProjectPreset.ts`  
- Content: interfaces + `PRESET_CATALOG` array + `PRESET_MAP` + `VALID_PRESET_IDS` (as described in §2.2).

#### 3.1.2 `presetId` field on `Project`

- Add `presetId?: string` to the Mongoose schema for `Project`.
- Add `presetId?: string` to the Zod schema in `packages/contracts/`.
- The `createProject` use-case accepts `presetId?: string` in the input; validates it is a `VALID_PRESET_ID` if provided.

#### 3.1.3 `GET /v1/presets` Endpoint

- Public route (no auth).
- Response: `{ presets: ProjectPreset[] }` from `PRESET_CATALOG`.
- No DB, pure read from the static catalog.

#### 3.1.4 `ProjectMoodboard` — Seeded From the Preset at Creation

- When a project is created with `presetId`, the moodboard is auto-seeded:
  - `visualTags`, `layoutTags`, `toneTags`, `featureTags`, `audienceTags`, `typographyTags`, `paletteTags` ← from `preset.defaultTags`
  - `projectBrief` ← `preset.briefTemplate` (with `{{projectName}}` replaced)
  - `styleNotes` ← `preset.styleTemplate`
- If `presetId` is not provided (fast-create), the moodboard remains empty as it does now.
- Implement in the `CreateProject` use-case (or in the `GetProjectMoodboard` auto-create path).

### 3.2 Frontend — M-PRESET-A

#### 3.2.1 `GET /v1/presets` → lib/api.ts

```typescript
export async function getPresets(): Promise<{ presets: ProjectPreset[] }>
```

#### 3.2.2 `ProjectPreset` TypeScript Interfaces in `lib/api.ts`

Add the `ProjectPreset`, `PresetOutputSpec`, `PresetTagDefaults` interfaces.

#### 3.2.3 Dashboard — Preset Card With a "Configure and Create" Flow

Currently: clicking a preset → `setNewProjectName(preset.label)` → opens a dialog with only a name input.
Target:

- Clicking a preset → opens `PresetCreationDialog` (or a modal) with:
  - Step 1: project name (input) + pre-filled brief (editable textarea) + pre-filled style notes
  - Step 2 (optional, accordion): pre-selected tag categories (editable)
  - "Create" button → `POST /v1/projects { name, presetId }` → redirect to the workspace
- Also keep the "Quick create →" button for a fast-create with no configuration.

Simpler alternative (no-break): keep the current dialog, but:

- Add a hidden `presetId` field to the form
- Load the brief/style template from the preset and pre-fill the fields
- Show a collapsible "Preset options" accordion with the pre-selected tags

#### 3.2.4 `ProjectConfigPopup` — Complete TAG_CATEGORIES and Preset Awareness

Add the missing categories to the `TAG_CATEGORIES` array:

```typescript
{ key: "audience",  field: "audienceTags",  label: "Audience / Target" },
{ key: "feature",   field: "featureTags",   label: "Requested features" },
{ key: "sector",    field: "sectorTags",    label: "Sector / Domain" },
```

Note: verify that the `ProjectMoodboard` entity/schema includes these fields.

Add an "active preset" badge at the top of the left section if `project.presetId` is set:

```tsx
{project.presetId && (
  <div className="flex items-center gap-2 mb-4 p-2 bg-primary/10 rounded-md border border-primary/20">
    <Badge variant="outline">{presetLabel}</Badge>
    <span className="text-xs text-muted-foreground">Active preset — the brief and tags were pre-filled from the preset.</span>
  </div>
)}
```

Improved brief section: if `moodboard.projectBrief` is empty and `project.presetId` is set, show a **"Brief guide" accordion** with the preset's `briefGuideQuestions` as a placeholder/prompt.

#### 3.2.5 `AssetThumb` — Always-visible useInProject and Delete

Currently: the `useInProject` checkbox and the delete button live inside a gear menu visible only on hover.

Target (non-invasive): the thumbnail's bottom row always shows:

- Compact `useInProject` toggle (bookmark icon or small check)
- Delete button (trash icon, small, red) always visible
- The gear menu remains for roleChange and descriptionText (unchanged)

```
┌──────────────────────┐
│  [thumbnail/icon]    │
│                      │
├──────────────────────┤
│ 📎 label (truncated) │
│ [🔖 use] ........[🗑] │
└──────────────────────┘
```

### 3.3 Testable — M-PRESET-A

```
1. GET /v1/presets → 9 presets with outputSpec, defaultTags, briefTemplate
2. POST /v1/projects { name: "Test", presetId: "landing" }
   → project.presetId === "landing"
   → GET /v1/projects/:id/moodboard → visualTags includes "layout:hero-first",
     projectBrief pre-filled, featureTags includes "feature:contact-form"
3. Dashboard: click "A4 Poster" preset → brief textarea pre-filled, style notes pre-filled
4. ProjectConfigPopup: "Audience / Target" and "Requested features" categories visible and clickable
5. AssetThumb: useInProject checkbox and delete button visible without hover
```

---

## 4. Sub-Milestone B — Modular Prompt + Style Profile Resolver

> **Estimate:** 2–3 days  
> **Goal:** the Layer 1 (chat-preview) system prompt receives structured enrichment from: user profile + project moodboard + preset module. Direct prerequisite for M2.

### 4.1 Backend — M-PRESET-B

#### 4.1.1 `StyleProfileResolver`

Implements the component deferred from M0-STYLE.

```typescript
// apps/api/src/application/services/StyleProfileResolver.ts

class StyleProfileResolver {
  async resolve(userId: string, projectId: string): Promise<ResolvedStyleProfile>
}
```

Fallback cascade logic (from spec ONBOARDING_AND_STYLE_PROFILING_SPEC.md §4.3):

- For every field: `ProjectMoodboard > UserStyleProfile > PLATFORM_DEFAULTS`

#### 4.1.2 `Layer0PromptBuilder`

Implements the component deferred from M0-STYLE.

```typescript
// apps/api/src/application/services/Layer0PromptBuilder.ts

class Layer0PromptBuilder {
  build(resolved: ResolvedStyleProfile, projectType: string, presetId?: string): Layer0Output
}

interface Layer0Output {
  systemPromptAddendum: string;  // ~200-400 tokens, style + identity + features
  designTokens: Record<string, string>;  // Nunjucks variables for the template
}
```

Output `systemPromptAddendum` structure example (compact):

```
[IDENTITY] freelancer · sector: tech-saas · audience: b2c
[VISUAL] style: minimal, dark · palette: ocean-blue (#0077B6 / #023E8A) · typo: sans-serif-clean
[LAYOUT] hero-first · whitespace-heavy
[TONE] friendly-casual · inspirational
[FEATURES] contact-form · testimonials
[BRIEF] Landing page for an SEO agency...
```

#### 4.1.3 `PresetPromptModule` Injection

In the Layer 1 system prompt builder:

```typescript
// System message composition order:
// 1. [layer0_addendum]   ← style + identity (StyleProfileResolver + Layer0PromptBuilder)
// 2. [preset_module]     ← preset's structural instructions (preset.outputSpec.systemPromptModule)
// 3. [base_template]     ← existing prePromptTemplate (Nunjucks)
```

Implementation in `apps/api/src/infra/llm/buildMessagesWithHistory.ts` (or wherever the chat-preview system message is currently built):

```typescript
async function buildSystemMessage(project, userId): Promise<string> {
  const resolved = await styleProfileResolver.resolve(userId, project.id);
  const layer0 = layer0Builder.build(resolved, project.type, project.presetId);
  
  const preset = project.presetId ? PRESET_MAP.get(project.presetId) : null;
  const presetModule = preset?.outputSpec.systemPromptModule ?? "";
  
  const baseTemplate = project.aiConfig?.prePromptTemplate ?? DEFAULT_TEMPLATE;
  
  // Ordered concatenation with separators
  return [
    layer0.systemPromptAddendum,
    presetModule ? `\n\n---\n${presetModule}` : "",
    `\n\n---\n${baseTemplate}`,
  ].filter(Boolean).join("");
}
```

#### 4.1.4 `cssConstraints` in the Layer 1 Output

When the LLM generates HTML/CSS/JS, the preset's `cssConstraints` must be injected:

- Into the generated CSS section (wrapped in a `/* preset: a4poster */` comment).
- Or as an explicit instruction in `systemPromptModule` (already included in each preset's template).

#### 4.1.5 `GET /v1/projects/:id/prompt-preview` Endpoint (optional, debug)

Returns the resolved system message for the project, for debugging:

```json
{
  "layer0Addendum": "...",
  "presetModule": "...",
  "baseTemplate": "...",
  "resolvedSystemMessage": "..."
}
```

### 4.2 Testable — M-PRESET-B

```
1. StyleProfileResolver: user with visual profile ["visual:minimal"], project with moodboard
   featureTags ["feature:contact-form"] → resolved.features includes "contact-form",
   resolved.visual.mood includes "minimal"

2. Layer0PromptBuilder: resolved → compact systemPromptAddendum (< 500 tokens)

3. Chat-preview with project presetId="a4poster":
   - system message includes the preset module "TECHNICAL CONSTRAINTS... 210×297mm..."
   - system message includes the layer0 addendum with style

4. Chat-preview with presetId="slideshow":
   - system message includes "Each slide is a div.slide of 1270×714px"
   - the LLM generates HTML with div.slide and the correct dimensions

5. GET /v1/projects/:id/prompt-preview → 200 with all 3 layers visible
```

---

## 5. Dependencies and Architectural Impact

### 5.1 Fields to Add to Existing Schemas

| Schema | Added field | Backward compat |
|---|---|---|
| `Project` (Mongoose + Zod) | `presetId?: string` | ✅ optional, defaults to undefined |
| `ProjectMoodboard` (Mongoose) | `audienceTags?: string[]`, `featureTags?: string[]`, `sectorTags?: string[]` | ✅ already partially present in the spec, add to the schema if missing |
| `Project.aiConfig` | No change — `prePromptTemplate` stays, the preset module is read from the catalog | ✅ no-break |

### 5.2 Files to Create (new)

```
apps/api/src/domain/entities/ProjectPreset.ts          [M-PRESET-A]
apps/api/src/application/services/StyleProfileResolver.ts [M-PRESET-B]
apps/api/src/application/services/Layer0PromptBuilder.ts  [M-PRESET-B]
apps/api/src/presentation/http/routes/presetRoutes.ts      [M-PRESET-A]
apps/web/components/PresetCreationDialog.tsx               [M-PRESET-A]
```

### 5.3 Files to Modify (non-break)

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

### 5.4 Relationship With M2 (PrepromptEngine)

M-PRESET-B introduces the compositional pattern (layer0 + presetModule + baseTemplate) **without** yet having M2's full LayerComposer/Nunjucks. Once M2 is implemented:

- The preset's `systemPromptModule` becomes a **Layer** in the `PrepromptProfile` (type: `constraint`, condition `project.presetId === "a4poster"`).
- `Layer0PromptBuilder` becomes the `type: system` layer injected automatically at the start.
- No radical refactor: M-PRESET-B is already the right pattern, M2 generalizes it.

---

## 6. Position in the Development Plan

```
M0-STYLE  ✅  (style profiling + onboarding + moodboard)
     │
     ├── M0.5  (focused asset control — partially completed)
     │
     └── M-PRESET-A  ← NEW (preset catalog + config UX + tag completeness)
               │
               └── M-PRESET-B  ← NEW (style resolver + modular prompt)
                         │
                         └── M1  (context bridge Layer1→Layer2)
                                   │
                                   └── M2  (PrepromptEngine — now enriched)
```

**M-PRESET-A and M0.5** are independent and can proceed in parallel.  
**M-PRESET-B** depends on M-PRESET-A (needs the catalog with `systemPromptModule`).  
**M2** conceptually depends on M-PRESET-B (pattern already defined, not to be reinvented).

---

## 7. Risks and Mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| `audienceTags`/`featureTags` not present in the Mongoose `ProjectMoodboard` schema | Medium | Verify `domain/entities/ProjectMoodboard.ts` and the schema before starting M-PRESET-A. Add if necessary. |
| An existing project's current `prePromptTemplate` conflicts with the injected preset module | Low | The preset module is injected BEFORE the baseTemplate with a `---` separator. The existing baseTemplate is not touched. |
| Token budget: layer0 + presetModule + baseTemplate exceeds the input limit | Low | Layer0 is max ~400 tokens, presetModule is max ~200 tokens. Total budget stays under 6500 tokens for the system message. |
| Thumbnail generation for PDF (server-side) not implemented | Medium | Out of scope for this milestone. PDFs show the `FileText` icon (unchanged behavior). Defer to the M4b extension. |
