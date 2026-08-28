# Andy Code Cat — Onboarding, Style Profiling and Layer 0 Preprompting

> **Revision:** 2026-04-07 (updated: 2026-07-22 — Appendix A benchmark)  
> **Source:** Vision Addendum REV-01, codebase analysis, design token / moodboard industry best practices, Duolingo/Slack/Figma/Headspace benchmarks, JustInMind onboarding UX article  
> **Purpose:** Define the complete architecture for: user registration/onboarding with profiling, project moodboard with guided style, semantic-stylistic Layer 0 preprompting, MongoDB schema with double sandbox.

---

## 0. Context and Motivation

### 0.1 Problem

Currently:

- **Registration** only collects email, password, firstName, lastName — no profiling.
- **Project creation** is a simple text input with a name — no stylistic guidance.
- The **preprompt** is a monolithic Nunjucks template (`prePromptTemplate`) — it doesn't know who the user is, which style they prefer, or what their business domain is.
- The LLM receives the "naked" user prompt, with no structured semantic-stylistic context.

### 0.2 Objective

Implement a **Layer 0 preprompting** layer that:

1. Collects the **user's stylistic profile** at onboarding (who you are, what you do, what style you like).
2. Collects the **project's stylistic profile** at creation time (moodboard, palette, inspirations, audience).
3. Builds a **structured semantic-stylistic preprompt** that enriches the user prompt before passing it to Layer 1 (Chat Preview) or Layer 2 (OpenCode Pipeline).
4. Implements a **fallback/override mechanism**: project profile > user profile > platform defaults.

### 0.3 Guiding Principles

| ID | Principle | Impact |
|---|---|---|
| `P-ONB-1` | **Progressive disclosure** — non-blocking onboarding, completable across multiple sessions | The user is never forced; they can skip everything and come back later |
| `P-ONB-2` | **Deterministic tags + free text** — curated tag clouds + free field | Balances structure (for the preprompt) and freedom (for expression) |
| `P-ONB-3` | **Fallback cascade** — project → user → platform defaults | The preprompt is always complete even if the user filled in nothing |
| `P-ONB-4` | **Snapshot immutability** — every profile version is an auditable record | Traceability of choices and possible rollback |
| `P-ONB-5` | **Token economy** — the profile compiles into tags, not long text | Translation into the preprompt is efficient (few tokens, maximum context) |

---

## 1. Tag Taxonomy — StyleTag System

### 1.1 Tag Structure

Each tag is an atomic unit of profiling:

```typescript
interface StyleTag {
  id: string;             // unique slug: "palette:warm-sunset"
  category: TagCategory;  // taxonomic category
  label: string;          // multilingual display label
  labelIt: string;        // Italian label
  labelEn: string;        // English label
  icon?: string;          // emoji or icon id
  hexPreview?: string;    // color preview (for palette tags)
  imagePreview?: string;  // preview URL (for style/mood tags)
  weight: number;         // weight in the preprompt (1-10, default 5)
  incompatibleWith?: string[];  // mutually exclusive tags
}
```

### 1.2 Taxonomic Categories

| ID | Category | Description | Example Tags |
|---|---|---|---|
| `TC-IDENTITY` | **Identity / Who you are** | Type of activity, sector, size | `freelancer`, `agency`, `startup`, `enterprise`, `non-profit`, `hobbyist` |
| `TC-SECTOR` | **Sector / Domain** | Business domain | `food-beverage`, `tech-saas`, `fashion`, `health-wellness`, `education`, `real-estate`, `creative-arts`, `finance`, `travel`, `sport` |
| `TC-AUDIENCE` | **Audience / Target** | Who the audience is | `b2b`, `b2c`, `b2g`, `young-adults`, `professionals`, `families`, `luxury-clients`, `local-community` |
| `TC-VISUAL` | **Visual Style** | Mood and aesthetic approach | `minimal`, `bold`, `elegant`, `playful`, `dark`, `corporate`, `vintage`, `futuristic`, `organic`, `brutalist`, `glassmorphism` |
| `TC-PALETTE` | **Color Palette** | Preferred color group | `warm-sunset`, `ocean-blue`, `earth-tones`, `neon-vivid`, `monochrome-dark`, `pastel-soft`, `forest-green`, `royal-gold`, `coral-blush`, `ice-silver` |
| `TC-TYPO` | **Typography** | Preferred typographic style | `sans-serif-clean`, `serif-editorial`, `mono-tech`, `handwritten-casual`, `display-bold`, `mixed-contrast` |
| `TC-LAYOUT` | **Layout / Pattern** | Preferred spatial organization | `hero-first`, `card-grid`, `single-column`, `asymmetric`, `full-bleed-images`, `whitespace-heavy`, `dense-info` |
| `TC-TONE` | **Communication tone** | How the brand speaks | `formal-professional`, `friendly-casual`, `authoritative-expert`, `playful-irreverent`, `inspirational`, `technical-precise` |
| `TC-REFERENCE` | **Inspiration reference** | Known reference points | `apple-like`, `stripe-like`, `notion-like`, `airbnb-like`, `dieter-rams`, `swiss-design`, `japanese-minimal` |
| `TC-FEATURE` | **Requested features** | Desired components | `contact-form`, `pricing-table`, `testimonials`, `image-gallery`, `video-hero`, `social-feed`, `newsletter-signup`, `faq-accordion` |

### 1.3 Predefined Palettes (Composite Tags)

Each `TC-PALETTE` tag maps to a concrete palette of design tokens:

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
  gradientStops?: string[];   // for gradient backgrounds
}
```

**10 predefined palettes:**

| ID | Name | Primary | Secondary | Mood |
|---|---|---|---|---|
| `warm-sunset` | Warm Sunset | `#E07A5F` | `#3D405B` | Welcoming, Italian, food |
| `ocean-blue` | Deep Ocean | `#0077B6` | `#023E8A` | Professional, tech, trust |
| `earth-tones` | Earth and Nature | `#606C38` | `#283618` | Organic, eco, health |
| `neon-vivid` | Vivid Neon | `#7209B7` | `#F72585` | Young, startup, gaming |
| `monochrome-dark` | Dark Monochrome | `#212529` | `#495057` | Elegant, tech, minimal dark |
| `pastel-soft` | Soft Pastel | `#FFB5A7` | `#FCD5CE` | Feminine, lifestyle, wedding |
| `forest-green` | Forest Green | `#2D6A4F` | `#40916C` | Nature, outdoor, wellness |
| `royal-gold` | Royal Gold | `#C9A227` | `#1B1B2F` | Luxury, premium, jewelry |
| `coral-blush` | Coral | `#FF6B6B` | `#EE5A24` | Energy, sport, food |
| `ice-silver` | Ice Silver | `#A8DADC` | `#457B9D` | Clean, medical, SaaS |

### 1.4 Visual Style References

Each `TC-VISUAL` tag includes a reference image (300×200 hero card) served as a static asset from the platform:

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

## 2. User Onboarding — Profile Wizard

### 2.1 Flow Architecture

Onboarding is **non-blocking** and **progressive**:

```
                    ┌────────────────────────────┐
                    │    POST /auth/register      │
                    │ (email, password, name)      │
                    └────────────┬───────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────┐
                    │  Redirect → /onboarding     │
                    │  (...or /dashboard if        │
                    │   the user clicks "Skip")    │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 1: Who Are You?        │
                    │  • TC-IDENTITY tag cloud     │
                    │  • TC-SECTOR tag cloud       │
                    │  • Free field "Describe      │
                    │    your business" (opt)       │
                    │  [Next] [Skip all →]          │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 2: Your Style          │
                    │  • Visual style cards         │
                    │    (clickable TC-VISUAL)      │
                    │  • Palette selector           │
                    │    (TC-PALETTE with preview)  │
                    │  • Typography preference      │
                    │    (TC-TYPO samples)          │
                    │  [Next] [Back] [Skip]         │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 3: Inspirations        │
                    │  • URL links (max 5, opt)     │
                    │  • Image upload (max 6)       │
                    │  • TC-REFERENCE tags          │
                    │  • TC-TONE tags               │
                    │  [Complete] [Back]             │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  Onboarding complete!        │
                    │  → Redirect /dashboard       │
                    │  → "Profile completed" badge  │
                    └────────────────────────────┘
```

### 2.2 Onboarding UX Rules

| Rule | Detail |
|---|---|
| **Skippable** | Every step has "Skip" or "Skip all". The user goes to the dashboard with an empty profile (fallback to platform defaults). |
| **Resumable** | The onboarding state is persisted. If the user closes the browser and comes back, they resume from the step they were on. |
| **Editable** | The `/settings/profile` page allows reopening and editing any section of the profile at any time. |
| **Multi-select** | Tags are multi-select (the user can choose multiple styles, sectors, palettes). The system weighs and averages them. |
| **Max tags per category** | Maximum 5 tags per category (avoids noisy profiles). |
| **Completion badge** | 0-30% = "Basic", 31-70% = "Intermediate", 71-100% = "Complete". Visible on the dashboard. |

### 2.3 Resulting User Profile

```typescript
interface UserStyleProfile {
  userId: string;
  version: number;                    // autoincrements on every change
  completionScore: number;            // 0-100, calculated
  
  onboardingState: {
    status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
    currentStep: number;              // 0-2 (for resuming)
    startedAt?: Date;
    completedAt?: Date;
  };
  
  // STEP 1 — Identity
  identity: {
    tags: string[];                   // max 5, e.g. ["identity:freelancer", "sector:tech-saas"]
    freeDescription?: string;         // max 500 chars
  };
  
  // STEP 2 — Style
  style: {
    visualTags: string[];             // max 5, e.g. ["visual:minimal", "visual:dark"]
    paletteTags: string[];            // max 3, e.g. ["palette:ocean-blue"]
    typographyTags: string[];         // max 2, e.g. ["typo:sans-serif-clean"]
    layoutTags: string[];             // max 3, e.g. ["layout:hero-first", "layout:whitespace-heavy"]
  };
  
  // STEP 3 — Inspirations
  inspirations: {
    referenceTags: string[];          // max 5, e.g. ["reference:stripe-like"]
    toneTags: string[];               // max 3, e.g. ["tone:friendly-casual"]
    referenceUrls: string[];          // max 5 validated URLs
    referenceImageIds: string[];      // IDs of uploaded assets (max 6)
  };
  
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 3. Project Moodboard — Project Style Config

### 3.1 Project Creation Flow

The current flow (name input → create) is extended with an optional wizard:

```
                    ┌────────────────────────────┐
                    │  Dashboard: [+ New]          │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 1: Name and Type       │
                    │  • Project name (required)    │
                    │  • Type: landing_page |       │
                    │    mini_site | portfolio |    │
                    │    ecommerce                 │
                    │  • Language: IT | EN          │
                    │  • Prompt idea (textarea,     │
                    │    min 20 chars, optional     │
                    │    if completed in workspace)  │
                    │  [Next] [Quick create →]     │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 2: Visual Moodboard    │
                    │  • Inherit from user profile │
                    │    (pre-checked user tags)    │
                    │  • Visual style cards          │
                    │    (override or confirm)       │
                    │  • Palette picker              │
                    │    (inherit / override)        │
                    │  • Inline color customizer     │
                    │    (hex input for override)    │
                    │  • Typography preview           │
                    │  [Next] [Back] [Skip]           │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  STEP 3: Content and Refs    │
                    │  • Clickable TC-FEATURE tags │
                    │  • Image upload (max 6)        │
                    │  • Reference URLs (max 5)      │
                    │  • Document upload (PDF, etc) │
                    │  • TC-AUDIENCE tags             │
                    │  • Free project note            │
                    │  [Create Project]               │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  → Redirect /workspace/[id]  │
                    │  → Layer 0 preprompt ready    │
                    └────────────────────────────┘
```

### 3.2 Fast-Create vs. Wizard

| Path | Action | Result |
|---|---|---|
| **Fast-create** | The user enters only the project name and clicks "Quick create" | Project created with a moodboard fully inherited from the user profile. If the profile is empty → platform defaults. |
| **Full wizard** | The user completes all 3 steps | Project with a specific moodboard that overrides the user profile. |
| **Partial wizard** | The user completes step 1, skips steps 2 and 3 | Override only on the fields defined in step 1; falls back to the user profile for the rest. |

### 3.3 Resulting Project Moodboard

```typescript
interface ProjectMoodboard {
  projectId: string;
  version: number;
  
  // Explicit overrides (if null → fallback to UserStyleProfile)
  visualTags?: string[];             // visual style override
  paletteTags?: string[];            // palette override
  paletteCustomOverrides?: {         // per-color override
    primary?: string;                // hex
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
  };
  typographyTags?: string[];
  layoutTags?: string[];
  toneTags?: string[];
  featureTags?: string[];            // desired components
  audienceTags?: string[];
  
  // Content
  referenceUrls?: string[];          // inspiration URLs
  referenceImageIds?: string[];      // assets uploaded as moodboard
  attachmentIds?: string[];          // attached PDFs/docs
  freeNotes?: string;                // free note (max 1000 chars)
  
  // Resolution metadata
  inheritedFromUser: boolean;        // true if created via fast-create
  overriddenFields: string[];        // fields explicitly defined by the user
  
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 4. Layer 0 — Semantic-Stylistic Preprompt

### 4.1 Architectural Position

```
┌─────────────────────────────────────────────────────┐
│                   Prompt Pipeline                     │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ LAYER 0 — Semantic Style Enrichment           │    │
│  │                                                │    │
│  │  Input:                                        │    │
│  │    • raw user prompt (natural language)        │    │
│  │    • UserStyleProfile (resolved)               │    │
│  │    • ProjectMoodboard (resolved, with fallback)│    │
│  │    • TagTaxonomy (lookup)                      │    │
│  │                                                │    │
│  │  Process:                                      │    │
│  │    1. Tag Resolution (merge user+project)      │    │
│  │    2. Palette Resolution (concrete colors)     │    │
│  │    3. Style Context Assembly (structured)      │    │
│  │    4. Preprompt Template Rendering             │    │
│  │                                                │    │
│  │  Output:                                       │    │
│  │    • enrichedSystemPrompt (style+context)      │    │
│  │    • resolvedDesignTokens (JSON)               │    │
│  │    • styleDirectives (instructions for the LLM)│    │
│  └──────────────────┬───────────────────────────┘    │
│                      │                                │
│  ┌──────────────────▼───────────────────────────┐    │
│  │ LAYER 1 — Chat Preview (existing)              │    │
│  │  • enrichedSystemPrompt injected into the      │    │
│  │    system message before the technical         │    │
│  │    prePromptTemplate                            │    │
│  │  • resolvedDesignTokens available as a         │    │
│  │    Nunjucks variable in the template           │    │
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

### 4.2 Component: StyleProfileResolver

The **core** of Layer 0 is the resolver that merges the user profile with the project moodboard:

```typescript
interface ResolvedStyleProfile {
  // Identity (user only, not overridable by the project)
  identity: {
    type: string;           // "freelancer" | "agency" | ...
    sector: string[];       // ["tech-saas", "education"]
    description?: string;   // free text
  };
  
  // Visual style (merged with project override)
  visual: {
    mood: string[];         // ["minimal", "dark"]
    palette: ResolvedPalette;
    typography: string[];   // ["sans-serif-clean"]
    layout: string[];       // ["hero-first", "whitespace-heavy"]
  };
  
  // Communication (merged with project override)
  communication: {
    tone: string[];         // ["friendly-casual"]
    audience: string[];     // ["b2c", "young-adults"]
    language: string;       // "it" | "en"
  };
  
  // References (project only if present, otherwise user)
  references: {
    styleRefs: string[];    // ["stripe-like"]
    urls: string[];         // validated URLs
    imageDescriptions: string[];  // LLM descriptions of the reference images
    attachmentSummaries: string[]; // PDF excerpts
  };
  
  // Desired components (project only)
  features: string[];       // ["contact-form", "testimonials", "pricing-table"]
  
  // Resolution metadata
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

### 4.3 Fallback Resolution Logic

```
For each stylistic field:

  1. If ProjectMoodboard has a value → use it (override)
  2. If ProjectMoodboard is null or the field is not defined:
     a. If UserStyleProfile has a value → use it (fallback)
     b. If UserStyleProfile is null or the field is not defined:
        → use PLATFORM_DEFAULTS (final fallback)

PLATFORM_DEFAULTS:
  visual.mood = ["modern"]
  visual.palette = palette("ocean-blue")
  visual.typography = ["sans-serif-clean"]
  visual.layout = ["hero-first"]
  communication.tone = ["professional"]
  communication.audience = ["b2c"]
```

### 4.4 Component: Layer0PromptBuilder

Transforms the `ResolvedStyleProfile` into a structured system addendum:

```typescript
class Layer0PromptBuilder {
  /**
   * Generates the stylistic system prompt addendum to inject
   * BEFORE the Layer 1/2 technical prePromptTemplate.
   * Output: ~200-400 tokens (ultra-compact for token economy).
   */
  build(resolved: ResolvedStyleProfile, projectType: string): Layer0Output;
}

interface Layer0Output {
  /** 
   * Structured text block to insert into the system prompt.
   * Compact format for token economy.
   */
  systemPromptAddendum: string;
  
  /**
   * Resolved design tokens, available as variables 
   * for the technical prePromptTemplate's Nunjucks template.
   */
  designTokens: Record<string, string>;
  
  /**
   * Key stylistic directives for fast injection.
   */
  styleDirectives: string[];
}
```

### 4.5 systemPromptAddendum Output Format

The format is designed to maximize the information/token ratio:

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

**Estimated token budget: 150-350 tokens** (vs. 4000-6000 for a full generation prompt).

### 4.6 Integration with Layer 1 (Chat Preview)

The injection pipeline into the existing system:

```typescript
// In buildMessagesWithHistory() — apps/api/src/infra/llm/
// BEFORE the current system:

const layer0Output = layer0PromptBuilder.build(
  resolvedProfile,
  project.type
);

// The system prompt becomes:
const systemPrompt = [
  layer0Output.systemPromptAddendum,  // Layer 0: style and context
  renderedPrePromptTemplate,          // Layer 1: technical template
].join('\n\n---\n\n');

// The design tokens are injected into the Nunjucks template context:
const templateContext = {
  ...existingContext,
  designTokens: layer0Output.designTokens,
  styleDirectives: layer0Output.styleDirectives,
};
```

### 4.7 Integration with Layer 2 (OpenCode Pipeline)

In the PrepromptEngine flow (spec PREPROMPT_ENGINE_SPEC.md):

```
ContextBuilder.buildContext()
  └── ProjectContextLoader
       └── NEW: StyleProfileResolver.resolve(userId, projectId)
            → ResolvedStyleProfile
       └── NEW: Layer0PromptBuilder.build(resolved, projectType)
            → Layer0Output

ThemeResolver.resolveTheme()
  └── Reads Layer0Output.designTokens instead of only project.wizard.themeOverride
```

---

## 5. MongoDB Schemas

### 5.1 Collection: `style_tags` (Platform Static Data)

```typescript
// Global platform tag catalog, read-only for users.
// The seed script handles population and updates.
{
  _id: ObjectId,
  tagId: string,                     // "visual:minimal" — unique index
  category: string,                  // "TC-VISUAL" | "TC-PALETTE" | ...
  label: {
    it: string,                      // "Minimale"
    en: string                       // "Minimal"
  },
  icon: string | null,               // "✨" or null
  hexPreview: string | null,         // "#0077B6" (palette only)
  imagePreview: string | null,       // "/style-references/minimal.jpg"
  weight: number,                    // 1-10, default 5
  paletteDefinition: {               // TC-PALETTE tags only
    primary: string,
    secondary: string,
    accent: string,
    background: string,
    surface: string,
    text: string,
    textMuted: string
  } | null,
  incompatibleWith: string[],        // mutually exclusive tagId[]
  sortOrder: number,                 // display ordering
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
// One document per user. Versioned via the version field.
// Double sandbox: access only via userId = jwt.sub
{
  _id: ObjectId,
  userId: ObjectId,                  // index, ref → users._id
  version: number,                   // autoincrements on every PUT
  completionScore: number,           // 0-100, calculated server-side
  
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
    referenceImageIds: string[]      // max 6, ref → project_assets._id (in the user's own space)
  },
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// { userId: 1 } unique
```

### 5.3 Collection: `user_style_profile_history`

```typescript
// Immutable snapshot of every profile version.
// For audit trail and rollback.
{
  _id: ObjectId,
  userId: ObjectId,
  version: number,
  snapshot: { /* full copy of the user_style_profiles document */ },
  changedFields: string[],           // ["style.visualTags", "inspirations.referenceUrls"]
  changedAt: Date
}

// Indexes:
// { userId: 1, version: -1 }
// TTL: 365 days (optional, configurable)
```

### 5.4 Collection: `project_moodboards`

```typescript
// One document per project. Double sandbox: ownerUserId check.
{
  _id: ObjectId,
  projectId: ObjectId,               // index, ref → projects._id
  ownerUserId: ObjectId,             // ref → users._id, for sandboxing
  version: number,
  
  // Stylistic overrides (null = inherited from the user profile)
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
  
  // Moodboard content
  referenceUrls: string[] | null,    // max 5
  referenceImageIds: string[] | null, // max 6
  attachmentIds: string[] | null,     // max 10
  freeNotes: string | null,          // max 1000 chars
  
  // Resolution metadata
  inheritedFromUser: boolean,
  overriddenFields: string[],
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// { projectId: 1 } unique
// { ownerUserId: 1 }
```

### 5.5 Extension to the `users` Collection (additional field)

```typescript
// Add to the existing users document:
{
  // ... existing fields ...
  
  styleProfileId: ObjectId | null,    // ref → user_style_profiles._id
  onboardingStatus: string            // "not_started" | "in_progress" | "completed" | "skipped"
                                      // denormalized for fast dashboard queries
}
```

### 5.6 Extension to the `projects` Collection (additional field)

```typescript
// Add to the existing projects document:
{
  // ... existing fields ...
  
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
  Auth: JWT required (authenticated user)
  Note: no sandbox, shared platform data

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
  Body: Partial<UserStyleProfile>  (Zod-validated schema)
  Response: { profile: UserStyleProfile, version: number }
  Auth: JWT required
  Note: increments version, saves a snapshot in history
  
PUT /v1/profile/style/step/:stepNumber
  Body: { tags: string[], freeText?: string, ... } (step-specific)
  Response: { profile: UserStyleProfile, currentStep: number }
  Auth: JWT required
  Note: saves the specific onboarding step without requiring the full profile

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
  Note: the response ALSO includes the resolved profile with fallback

PUT /v1/projects/:projectId/moodboard
  Body: Partial<ProjectMoodboard>  (Zod-validated schema)
  Response: { moodboard: ProjectMoodboard, resolvedProfile: ResolvedStyleProfile }
  Auth: JWT + sandboxMiddleware

DELETE /v1/projects/:projectId/moodboard
  Response: { message: "Moodboard removed, falling back to user profile" }
  Auth: JWT + sandboxMiddleware
  Note: the project goes back to inheriting everything from the user profile
```

### 6.4 Resolved Profile (Read-only, for debugging and preview)

```
GET /v1/projects/:projectId/resolved-style
  Response: { resolved: ResolvedStyleProfile, layer0Preview: string }
  Auth: JWT + sandboxMiddleware
  Note: shows the final resolved profile AND a preview of the systemPromptAddendum
        that would be generated. Useful for debugging and for the workspace.
```

---

## 7. Domain Entities and Clean Architecture

### 7.1 New Entities (domain/entities/)

```
apps/api/src/domain/entities/
  StyleTag.ts                  ← TagCategory enum, StyleTag interface, PaletteDefinition
  UserStyleProfile.ts          ← UserStyleProfile, OnboardingState, identity/style/inspirations
  ProjectMoodboard.ts          ← ProjectMoodboard, paletteCustomOverrides
  ResolvedStyleProfile.ts      ← ResolvedStyleProfile, ResolvedPalette, Resolution metadata
```

### 7.2 New Repository Interfaces (domain/repositories/)

```
apps/api/src/domain/repositories/
  StyleTagRepository.ts        ← findAll(), findByCategory(), findByIds()
  UserStyleProfileRepository.ts ← findByUserId(), upsert(), getHistory()
  ProjectMoodboardRepository.ts ← findByProjectId(), upsert(), delete()
```

### 7.3 New Use Cases (application/use-cases/)

```
apps/api/src/application/use-cases/
  GetStyleTags.ts              ← list tags by category
  GetUserStyleProfile.ts       ← user profile with score
  UpdateUserStyleProfile.ts    ← update profile (increments version, saves history)
  UpdateOnboardingStep.ts      ← save a single onboarding step
  SkipOnboarding.ts            ← skip onboarding
  GetProjectMoodboard.ts       ← moodboard with resolved profile
  UpdateProjectMoodboard.ts    ← update moodboard
  DeleteProjectMoodboard.ts    ← remove moodboard
  ResolveStyleProfile.ts       ← merge user+project+defaults → ResolvedStyleProfile
  BuildLayer0Prompt.ts         ← ResolvedStyleProfile → Layer0Output
```

### 7.4 New Infra Implementations (infra/)

```
apps/api/src/infra/db/
  MongoStyleTagRepository.ts
  MongoUserStyleProfileRepository.ts
  MongoProjectMoodboardRepository.ts

apps/api/src/infra/style/
  StyleProfileResolver.ts      ← merge logic with fallback cascade
  Layer0PromptBuilder.ts       ← template rendering for the system prompt addendum
  PlatformDefaults.ts          ← constants with platform defaults
```

### 7.5 New Routes (presentation/http/routes/)

```
apps/api/src/presentation/http/routes/
  styleTagRoutes.ts            ← GET /style-tags, GET /style-tags/palettes
  profileRoutes.ts             ← GET/PUT /profile/style, PUT /profile/style/step/:n, PUT /profile/onboarding/skip
  moodboardRoutes.ts           ← GET/PUT/DELETE /projects/:id/moodboard, GET /projects/:id/resolved-style
```

### 7.6 New Contracts (packages/contracts/src/)

```
packages/contracts/src/
  styleTags.ts                 ← TagCategory enum, StyleTag schema, PaletteDefinition schema
  userStyleProfile.ts          ← user profile schema, step-by-step validation
  projectMoodboard.ts          ← moodboard schema, paletteCustomOverrides schema
  resolvedStyle.ts             ← resolved profile schema (output only)
```

---

## 8. Seed Script Extension

### 8.1 seed-style-tags.ts

```typescript
// Populates the style_tags collection with the complete taxonomic catalog.
// Idempotent: upsert on tagId.
// Runs at startup if STYLE_TAGS_AUTO_SEED=true (default: true).

// Content: all 10 categories × ~8-12 tags each = ~100 tags total.
// Includes the 10 predefined palettes with a complete PaletteDefinition.
```

### 8.2 seed.ts Extension

```typescript
// Adds to the default seed user:
// - UserStyleProfile with onboarding status "completed"
// - Example tags: identity:freelancer, sector:tech-saas, visual:minimal, palette:ocean-blue
// - Default project: ProjectMoodboard inherited from the user profile
```

---

## 9. Frontend — New Pages and Components

### 9.1 New Pages

```
apps/web/app/
  onboarding/
    page.tsx                   ← 3-step wizard with progress bar
  settings/
    profile/
      page.tsx                 ← Edit style profile (reopens the wizard)

apps/web/app/dashboard/
  new-project/
    page.tsx                   ← 3-step project creation wizard
```

### 9.2 New Components

```
apps/web/components/
  onboarding/
    TagCloud.tsx               ← Clickable tag cloud (multi-select, max N)
    PaletteSelector.tsx        ← Palette cards with live color preview
    TypographyPreview.tsx      ← Font samples with example text
    VisualStyleCard.tsx        ← Card with image + style name (selectable)
    OnboardingProgress.tsx     ← Step 1/2/3 progress bar
    OnboardingStepWrapper.tsx  ← Container with Next/Back/Skip/Skip all
  
  moodboard/
    MoodboardEditor.tsx        ← Moodboard editor for the project
    ColorCustomizer.tsx        ← Hex input for single color overrides
    FeatureTagSelector.tsx     ← Selector for desired features
    ReferenceUrlInput.tsx      ← Multi-URL input with preview
    MoodboardPreview.tsx       ← Visual preview of the resolved moodboard
  
  shared/
    ProfileCompletionBadge.tsx ← "Basic/Intermediate/Complete" badge
    StylePreviewCard.tsx       ← Mini-preview of the resolved style profile
```

### 9.3 Dashboard Extension

The current dashboard is extended with:

- **Profile completion badge** in the header (clickable → `/settings/profile`)
- **User style preview** in the sidebar (mini-card with palette and mood)
- **"+ New Project" button** that opens the wizard (no longer an inline input)
- **Project card** enriched with a mini-preview of the project palette

### 9.4 Workspace Extension

The workspace receives:

- A **"Style" tab** in the right-hand panel: shows the resolved profile, the design tokens, and allows quick editing of the moodboard without leaving the workspace.
- A **Layer 0 status indicator**: shows whether the profile has been injected into the current preprompt.

---

## 10. Environment Configuration

### 10.1 New Env Variables

```env
# Style profiling
STYLE_TAGS_AUTO_SEED=true              # Seed tags at bootstrap
STYLE_TAGS_SEED_LANG=it,en             # Seed languages

# Layer 0
LAYER0_ENABLED=true                    # Enable Layer 0 preprompting
LAYER0_MAX_ADDENDUM_TOKENS=400         # Token budget for the stylistic addendum
LAYER0_REFERENCE_IMAGE_DESCRIBE=true   # Use LLM vision to describe reference images
```

---

## 11. Incremental Implementation Plan

### Phase 1 — Foundation (HIGH Priority)

| Task | Component | Dependencies |
|---|---|---|
| F1.1 | `StyleTag`, `UserStyleProfile`, `ProjectMoodboard`, `ResolvedStyleProfile` entities | None |
| F1.2 | Zod contracts for all schemas | F1.1 |
| F1.3 | `style_tags` collection + `seed-style-tags.ts` seed script | F1.1 |
| F1.4 | `MongoStyleTagRepository` + `GetStyleTags` use case + route | F1.3 |
| F1.5 | `MongoUserStyleProfileRepository` + CRUD use cases | F1.1 |
| F1.6 | `MongoProjectMoodboardRepository` + CRUD use cases | F1.1 |

### Phase 2 — Onboarding UX

| Task | Component | Dependencies |
|---|---|---|
| F2.1 | Shared components: `TagCloud`, `PaletteSelector`, `VisualStyleCard` | F1.3 |
| F2.2 | `/onboarding` page with 3-step wizard | F2.1 + F1.5 |
| F2.3 | Post-register integration: redirect to `/onboarding` | F2.2 |
| F2.4 | `/settings/profile` page for editing the profile | F2.1 + F1.5 |
| F2.5 | `ProfileCompletionBadge` in the dashboard | F1.5 |

### Phase 3 — Project Moodboard

| Task | Component | Dependencies |
|---|---|---|
| F3.1 | 3-step project creation wizard (`/dashboard/new-project`) | F2.1 + F1.6 |
| F3.2 | `MoodboardEditor` with inherit/override UX | F2.1 + F1.6 |
| F3.3 | Fast-create path (name + inherit from profile) | F1.6 |
| F3.4 | "Style" tab in the workspace | F3.2 |

### Phase 4 — Layer 0 Engine

| Task | Component | Dependencies |
|---|---|---|
| F4.1 | `StyleProfileResolver` (merge with fallback cascade) | F1.5 + F1.6 |
| F4.2 | `Layer0PromptBuilder` (template → system prompt addendum) | F4.1 |
| F4.3 | `PlatformDefaults` constants | None |
| F4.4 | Integration in `buildMessagesWithHistory()` (Layer 1) | F4.2 |
| F4.5 | Integration in `ContextBuilder` (Layer 2, once implemented) | F4.2 |
| F4.6 | `GET /projects/:id/resolved-style` debug route | F4.1 + F4.2 |

---

## 12. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Profile too constraining → stereotyped LLM output | Medium | High | Tags are suggestions (weight-based), not absolute constraints. The prompt addendum uses "prefer" language, not "must". |
| Too many tags → noise in the preprompt | Low | Medium | Max 5 tags per category; weighted; only the top 3 by weight enter the prompt addendum. |
| Token economy: addendum too long | Low | High | Hard budget limit `LAYER0_MAX_ADDENDUM_TOKENS=400`; ultra-compact bullet-point format. |
| Onboarding UX too long → drop rate | Medium | High | Skip always available; only 3 steps; each step < 30 seconds; visual-first (click, not typing). |
| Predefined palettes too limited | Low | Low | `paletteCustomOverrides` allows per-color overrides; new palettes added via seed without a deploy. |
| Data migration: existing users without a profile | Low | Low | Fallback cascade guarantees operation even with an empty profile (0 tags). No breaking change. |

---

## 13. Impact on Existing Documents

| Document | Required change |
|---|---|
| `docs/INDEX.md` | Add a link to this spec |
| `docs/agents/CODE_AGENT_INDEX.md` | Add entities/routes/use-cases to the "To be built" section |
| `docs/architecture/BOOTSTRAP_ARCHITECTURE.md` | Add a Layer 0 section |
| `docs/runbooks/TESTABLE_STEPS.md` | Add testable steps for onboarding and moodboard |
| `DB_PLATFORM_SPEC.md` | Add 3 new collections + extensions to users/projects |
| `PREPROMPT_ENGINE_SPEC.md` | Add Layer 0 integration in ContextBuilder |
| `UX_SPEC.md` | Rewrite the wizard from a 3-step wizard to an onboarding + project moodboard wizard |
| `docs/vision/IMPLEMENTATION_CROSSMAP.md` | Add new Req IDs for `R-ONB-*` and `R-STY-*` |

---

## 14. Traceable Requirements (for IMPLEMENTATION_CROSSMAP)

| Req ID | Requirement | Initial status |
|---|---|---|
| `R-ONB-1` | 3-step user onboarding wizard with tag profiling | 📐 Spec defined |
| `R-ONB-2` | Skippable and resumable onboarding | 📐 Spec defined |
| `R-ONB-3` | settings/profile page for editing the profile | 📐 Spec defined |
| `R-ONB-4` | Profile completion badge in the dashboard | 📐 Spec defined |
| `R-STY-1` | Global stylistic tag catalog (10 categories, ~100 tags) | 📐 Spec defined |
| `R-STY-2` | 10 predefined color palettes with design tokens | 📐 Spec defined |
| `R-STY-3` | Visual references for styles (hero card images) | 📐 Spec defined |
| `R-MBD-1` | Project creation wizard with a 3-step moodboard | 📐 Spec defined |
| `R-MBD-2` | Fast-create with inherit from the user profile | 📐 Spec defined |
| `R-MBD-3` | Override/fallback cascade (project → user → platform) | 📐 Spec defined |
| `R-MBD-4` | "Style" tab in the workspace for quick editing | 📐 Spec defined |
| `R-L0-1` | StyleProfileResolver with merge and fallback | 📐 Spec defined |
| `R-L0-2` | Layer0PromptBuilder with a 400 token budget | 📐 Spec defined |
| `R-L0-3` | Layer 0 → Layer 1 integration (Chat Preview) | 📐 Spec defined |
| `R-L0-4` | Layer 0 → Layer 2 integration (OpenCode Pipeline) | 📐 Spec defined |
| `R-L0-5` | /resolved-style debug route for preview | 📐 Spec defined |

---

## Appendix A — Industry Best Practices & Reference Benchmarks

> **Source:** Direct analysis of Duolingo, Slack, Figma, Headspace + the JustInMind article "User onboarding: best practices and 20 good examples" + UX Collective  
> **Purpose:** Document onboarding UX patterns established in the industry and map their direct applicability to this spec's architectural choices.

### A.1 Universal Onboarding Principles (from JustInMind)

The JustInMind article identifies 11 best practices and 5 mistakes to avoid. The table maps each principle to our spec:

| # | JustInMind Best Practice | Pattern | Andy Code Cat Application | Spec Section |
|---|---|---|---|---|
| BP-1 | **Understand the user journey** — map the path from opening to the "aha" moment | User Journey Map | The 3-step wizard maps: identity → style → inspirations. The "aha moment" is the preview of the resolved profile. | §2 |
| BP-2 | **Define key milestones** — key actions that lead to product value | Milestone-driven | Milestones: (1) first tag selected, (2) palette chosen, (3) profile completed → badge. `completionScore` tracks progress. | §2.3, §5.2 |
| BP-3 | **Balance education and exploration** — guide but leave room to explore | Guided freedom | Guided wizard but every step is skippable (P-ONB-1). Clickable tags = exploration, not rigid forms. | §2.2 |
| BP-4 | **Minimize friction** — as few steps as possible | Friction reduction | Only 3 steps, each step < 30 sec, visual-first (click, not typing). Fast-create bypasses the wizard. | §2.2, §3.2 |
| BP-5 | **Personalize and contextualize** — adapt the flow to the type of user | Contextual flow | Step 1 (Who You Are) determines which tags are highlighted in Step 2 (Style). Progressive profiling. | §2.1 |
| BP-6 | **Focus on quick wins** — deliver immediate results | Quick wins | After Step 2, a live preview of the chosen palette. Instant visual feedback. | §2.1 |
| BP-7 | **Simplify the process** — essential only, nothing superfluous | Minimalism | Max 5 tags per category. No mandatory field. Only two paths (wizard or fast-create). | §1.1, §3.2 |
| BP-8 | **Use engaging visuals** — animations and images to explain without text | Visual-first | Card with a hero image for each visual style (§1.4). Palette with a live color preview. | §1.4, §9.2 |
| BP-9 | **Make it interactive** — the user acts, doesn't read | Learn by doing | Multi-select TagCloud, click-based PaletteSelector, selectable VisualStyleCard. Zero text tutorials. | §9.2 |
| BP-10 | **Provide consistent communication** — ongoing support after onboarding | Ongoing nudges | ProfileCompletionBadge in the dashboard. Ability to reopen the wizard from Settings. Layer 0 status in the workspace. | §9.3, §9.4 |
| BP-11 | **Use progress indicators** — show where you are in the flow | Progress bar | `OnboardingProgress` component (step 1/2/3). `completionScore` 0-100. | §9.2 |

### A.2 Mistakes to Avoid (from JustInMind)

| Anti-pattern | Description | How Andy Code Cat avoids it |
|---|---|---|
| **Information overload** | Too many features presented at once | Only 3 steps, each with a single focus. No technical explanation in the wizard. |
| **Ignoring user feedback** | Fixed flow with no iteration | `user_style_profile_history` records every version. The profile is always editable from Settings. |
| **Lack of personalization** | Generic onboarding for everyone | Step 1 (identity) personalizes the options in subsequent steps. Contextual profiling. |
| **Overly complex flows** | Too many steps, confusing navigation | 3 linear steps, visible progress bar, "Skip all" always accessible. |
| **No follow-up** | User abandoned after onboarding | Persistent completion badge, Style tab in the workspace, Layer 0 always active. |

### A.3 Benchmark: Duolingo

**Context:** Language-learning app. 500M+ downloads. Reference for gamification and immediate conversion.

| Duolingo Pattern | Detail | Andy Code Cat Application |
|---|---|---|
| **Immediate interaction** | The user picks a language and a goal right on the landing page — enters the core in <10 clicks | The wizard asks "Who are you?" and "What style do you like?" in 2 steps — profiling IS the product, not a pre-product obstacle. |
| **Mascot (Duo)** | Recognizable guide character, friendly tone, reduces anxiety | Andy Code Cat can introduce a visual companion in the wizard (e.g. an assistant icon/avatar). Conversational microcopy in placeholders. |
| **Goal commitment** | Asks the user to choose a goal (psychological commitment bias) | Step 1 asks "what do you want to build?" — the site type becomes a psychological commitment that drives the whole path. |
| **Starting level** | Optional placement test for experts OR start from basics | Fast-create (expert → no wizard) vs. full wizard (new user). Two parallel paths. |
| **Light gamification** | Points, streaks, progress badges | `completionScore` 0-100 with badges (Basic/Intermediate/Complete). Not aggressive, but present. |
| **Light contextual tooltips** | Tooltips appear only where needed, without a forced tutorial | VisualStyleCard with hover-preview. No blocking modal dialog. |

**Key pattern adopted:** _"Speak the user's language"_ — the wizard uses visual terminology (clicking images) rather than technical terms. The user doesn't need to know what a "hex palette" is to choose colors.

### A.4 Benchmark: Slack

**Context:** Team messaging platform. 700M+ messages/day. Reference for guided setup and anxiety reduction.

| Slack Pattern | Detail | Andy Code Cat Application |
|---|---|---|
| **"The First Meeting"** | Onboarding is structured like a first meeting: introduction → needs → setup | The wizard simulates a dialogue: Step 1 "Who are you?" → Step 2 "Your style" → Step 3 "Your inspirations". Conversational flow. |
| **Workspace identity** | Asks for the workspace name, invites members, establishes context | In Step 1 the user establishes their own professional identity. In the project moodboard they establish the site's identity. |
| **Onboarding chatbot** | The Slackbot guides interactively with questions and answers | Conversational pattern in the wizard: type-ahead placeholders, contextual suggestions, micro-feedback after each selection. |
| **Zero distractions** | No email verification, no notifications, no password setup until after onboarding | Email verification is already skippable (`SKIP_EMAIL_VERIFY=true`). The wizard is post-register, not intra-register. |
| **Progressive disclosure** | Feature popups only on key functionality, the rest left to independent exploration | Only 3 categories in the wizard (identity/style/inspirations). The full 10 tag categories live in post-onboarding settings. |
| **Explanatory microcopy** | Every field has a contextual explanation that gives context to the effort required | Every step can include an explanatory subtitle: "This helps us tailor design suggestions for your projects". |

**Key pattern adopted:** _"Reduce first-meeting anxiety"_ — don't ask for too much too soon, build trust before asking for data. The Andy Code Cat wizard never asks for mandatory information.

### A.5 Benchmark: Figma

**Context:** Collaborative design tool. Used by Duolingo, Slack, Netflix, etc. Reference for "learn by doing".

| Figma Pattern | Detail | Andy Code Cat Application |
|---|---|---|
| **Contextual tooltips** | Tooltips appear only when the user interacts with an element, not in a forced sequence | In the workspace, Layer 0 tooltips appear only when the user opens the Style tab. Never push interruptions. |
| **Example projects** | Ready-made templates that show the tool's potential without starting from scratch | The seed creates at least one demo project with a pre-filled moodboard. The user immediately sees what a "complete" project looks like. |
| **Learn by doing, not reading** | The interface invites action, not documentation reading | TagCloud and PaletteSelector are action components (click to select). No long instructional text. |
| **Templates as a starting point** | Figma offers templates for websites, apps, presentations as a starting point | The 10 predefined palette templates (ocean-blue, warm-sunset, etc.) are the visual starting point. The user "chooses" before "creating". |
| **Collaborative context** | Real-time cursors, comments — shows you're not alone | The Layer 0 status in the workspace shows that the AI "knows" your style — you're not building alone. |
| **Design systems as a foundation** | Shared libraries guarantee consistency | The `style_tags` catalog is Andy Code Cat's shared design system: consistent tags across users, projects, and the AI. |

**Key pattern adopted:** _"Don't ask people to read, ask them to do"_ — every wizard step is a visual action (select, click, drag), not a form to fill in.

### A.6 Benchmark: Headspace

**Context:** Meditation and mental wellness app. 70M+ downloads. Reference for emotional tone and mood as UX.

| Headspace Pattern | Detail | Andy Code Cat Application |
|---|---|---|
| **Emotional tone** | "Take a deep breath" as the first interaction — the app's tone IS the experience | The wizard can open with a warm welcome message: "Tell us about yourself — it'll help us create something that represents you". |
| **Calming animations** | Smooth transitions, relaxing colors, no rush | Smooth transitions between wizard steps. Palette preview with fade-in. No timer or urgency. |
| **"Mood" as UX input** | First question: "What kind of headspace are you looking for?" — the mood IS the entry point | The `TC-VISUAL` category (minimal, bold, playful, dark, etc.) is exactly the project's "mood". The mood drives everything else. |
| **Initial goal selection** | The user chooses between: stress, sleep, anxiety, focus — immediate personalization | Step 1 asks for type (freelancer, agency, brand) and sector — immediate personalization of the path. |
| **AI companion (Ebb)** | Empathetic chatbot that gives personalized recommendations based on mood | Andy Code Cat can offer tag suggestions based on the identity declared in Step 1 → "Based on your profile, we suggest...". |
| **Content as therapy** | Onboarding is not an obstacle, it's already part of the beneficial experience | The Andy Code Cat wizard is not "bureaucratic setup" — it's the first creative act. The user is already building their project. |

**Key pattern adopted:** _"Mood is UX"_ — the user's emotional/aesthetic state is not data to collect but an experience to live. The wizard must make the user feel already inside the creative process.

### A.7 Synthesis: Cross-Cutting Patterns Adopted

From the convergence of the 4 benchmarks + the JustInMind best practices, the Andy Code Cat operating model emerges:

```
┌────────────────────────────────────────────────────────────────────┐
│            Andy Code Cat ONBOARDING MODEL — 6 KEY PATTERNS           │
│                                                                    │
│  ┌─ P1. ACTION BEFORE INSTRUCTION (Figma, Duolingo)               │
│  │   → Click/select, never read. The wizard = an action interface.│
│  │                                                                 │
│  ├─ P2. CONVERSATION, NOT INTERROGATION (Slack, Headspace)         │
│  │   → Friendly tone. "Tell us" not "Fill in". Microcopy.        │
│  │                                                                 │
│  ├─ P3. MOOD AS ENTRY POINT (Headspace, Duolingo)                 │
│  │   → Style/mood is the first question. The mood drives all.   │
│  │                                                                 │
│  ├─ P4. VISUAL QUICK WIN (Duolingo, Figma)                       │
│  │   → Live palette/style preview after every selection.          │
│  │                                                                 │
│  ├─ P5. DUAL EXPERT/NOVICE PATH (Duolingo, Figma)                 │
│  │   → Fast-create (skip) for those who know what they want.    │
│  │     Wizard for those who want guidance.                       │
│  │                                                                 │
│  └─ P6. ONBOARDING = FIRST CREATIVE ACT (Headspace, all)         │
│      → Onboarding isn't setup, it's the project's first step.    │
│      → The user is already "building" during the wizard.          │
└────────────────────────────────────────────────────────────────────┘
```

### A.8 Validation Metrics

To verify the effectiveness of onboarding based on these patterns, monitor:

| Metric | Target | Benchmark source |
|---|---|---|
| **Wizard completion rate** | ≥ 60% of users who start complete all 3 steps | Duolingo: >70% complete the first lesson within 10 clicks |
| **Time-to-first-project** | < 5 minutes from registration to first project created | Slack: active workspace in <3 min, Figma: first file in <2 min |
| **Profile completion score** | Average ≥ 40/100 within the first week | Headspace: 65% choose at least one goal on first access |
| **Wizard bounce rate** | < 25% drop-off between Step 1 and Step 3 | Industry: 23% average drop rate for 3-step wizards |
| **Return-to-edit rate** | ≥ 15% of users edit their profile within 30 days | Figma: high iteration on templates after initial setup |
| **Fast-create vs. wizard** | 30-40% fast-create, 60-70% wizard | Balance between expert and novice users |

### A.9 References

| Ref | Type | URL / Description |
|---|---|---|
| REF-JM-1 | Guide article | JustInMind "User onboarding: best practices and 20 good examples" — 11 best practices, 5 anti-patterns, 20 case studies (Duolingo, Slack, Canva, Evernote, etc.) |
| REF-DUO-1 | Direct analysis | Duolingo — Duo mascot, goal commitment, optional placement test, light gamification, < 10 clicks to the core |
| REF-SLK-1 | Direct analysis | Slack — Onboarding chatbot, zero distractions, explanatory microcopy, progressive disclosure, "first meeting" paradigm |
| REF-FIG-1 | Direct analysis | Figma — Contextual tooltips, templates as a starting point, learn by doing, shared design systems |
| REF-HS-1 | Direct analysis | Headspace — Emotional tone, calming animations, "mood as UX", AI companion (Ebb), initial goal selection |
| REF-UXC-1 | Third-party source | UX Collective — Convergent patterns: immediate interaction, non-intrusive profiling, emotional design |
