# Andy Code Cat — Prompt Optimizer: Detailed Specification

> **Version:** 1.1.0 — 2026-04-15
> **Author:** product architecture
> **Scope:** interactive UX and backend architecture for the "Optimize Prompt" service
> **Architectural dependencies:** LLM Catalog (✅), UserStyleProfile (✅), ProjectMoodboard (✅), Asset Manager (✅)
> **Milestone:** R0 — in `docs/DEVELOPMENT_PLAN.md`
>
> **Note:** the authoritative English implementation plan for the reusable internal prompting platform is in `docs/specs/PROMPTING_SERVICE_PLATFORM_SPEC.md`.
>
> **Superseded integration rule (2026-08-18):** optimization is an explicit user action. It MUST
> NOT be invoked implicitly for a pipeline run whose persisted policy is skip; see
> [SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md](SSOT_PROMPTING_AND_MODEL_ROUTING_IMPLEMENTATION_PROGRAM_2026-08-18.md).
>
> **Decision lock — 2026-04-15:**
>
> - project type must be resolved from the active project preset/catalog
> - prompt rewriting must preserve intent while enriching domain and content direction
> - tone should stay modern, fresh, vivid, professional, and coherent with user preferences
> - superadmin must control provider, model, and template for this layer
> - default fallback is SiliconFlow + MiniMaxAI/MiniMax-M2.5

---

## 0. Motivation and Problem

### 0.1 The Current Gap

Today the user must **manually** bring their own context to external AI tools to get an elaborate prompt:

1. Opens an external AI editor (ChatGPT, Claude, Gemini)
2. Pastes brief, attachments, project specs
3. Asks "prepare me a prompt to generate the website"
4. Copies the result into the Andy Code Cat workspace
5. Sends it to the generation engine

This flow is **slow, disjointed and lacks structured context** (the user profile, the project moodboard, and the output type are not passed automatically to the external AI).

### 0.2 Goal

Bring this activity in-house, into the workspace. The Prompt Optimizer must:

1. Read the user's raw input (free text, short or long)
2. Read the available structured context: user profile + project moodboard + attachments
3. Call a dedicated LLM with **content-only** instructions
4. Return an enriched, structured prompt that **replaces** the user's text in the textarea
5. Let the user review, edit, and submit

### 0.3 Scope — What It Optimizes and What It Doesn't

| Area | Included in the Prompt Optimizer | Handled by another layer |
|---|---|---|
| Page business goals | ✅ | — |
| Target audience characterization | ✅ | — |
| Main message and call-to-action | ✅ | — |
| Content structure and direction | ✅ | — |
| Use of media (images, video, icons) | ✅ | — |
| Communication tone of the text | ✅ | — |
| Content elements from attachments/PDFs | ✅ | — |
| Color palette, typography, fonts | ❌ | Layer C (Style Context Block) |
| CSS framework (Tailwind, Bootstrap) | ❌ | Layer A (Base Constraints) |
| HTML structure, technical sections | ❌ | Layer B (Preset Output Module) |
| Grid layout, responsive breakpoints | ❌ | Layer A + Layer B |
| Output type (landing page, A4, slide) | ❌ | Preset selection (Layer B) |

> **Key principle:** the Prompt Optimizer works on the **user's message**, not on the technical system prompt. It does not know, and does not need to know, how the HTML/CSS output will be produced.

---

## 1. Architectural Position

```
┌──────────────────────────────────────────────────────────────────┐
│                   Workspace Chat Input                            │
│                                                                   │
│  The user writes: "I want a page for my law firm"                │
│  [📎 attachments: logo.png, brochure.pdf]                        │
│                                                                   │
│  [✨ Optimize prompt]  ← NEW BUTTON                               │
│                │                                                  │
│                ▼                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  PROMPT OPTIMIZER (new service)                          │     │
│  │                                                          │     │
│  │  Input:                                                  │     │
│  │    • rawPrompt: "I want a page for the law firm..."      │     │
│  │    • UserStyleProfile → identity, sector, tone           │     │
│  │    • ProjectMoodboard → audience, features, free notes   │     │
│  │    • Attachments → PDF text, image descriptions          │     │
│  │                                                          │     │
│  │  Optimizer LLM (configurable model, content-only)        │     │
│  │  System Instruction: "You are a content strategist..."   │     │
│  │                                                          │     │
│  │  Output:                                                 │     │
│  │    • enhancedPrompt (replaces the textarea)              │     │
│  └──────────────────────────┬──────────────────────────────┘     │
│                              │                                    │
│  Textarea updated with the enriched prompt                        │
│  The user reads, edits if desired → [Send]                       │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
          ┌────────────────────────────────────────┐
          │  Existing system prompt pipeline         │
          │                                          │
          │  Layer A — Base Architectural Constraints│
          │  Layer B — Preset Output Module          │
          │  Layer C — Style Context Block           │
          │  Layer D — prePromptTemplate             │
          │                                          │
          │  + enhancedPrompt as USER message        │
          └──────────────────────────────────────────┘
```

The Prompt Optimizer operates **on the user side** of the conversation, not on the system prompt. Its output becomes the user message that enters the existing layers A–D.

---

## 2. UX Flow — "Optimize Prompt"

### 2.1 Button States

| User state | UI behavior |
|---|---|
| Empty textarea | Button not visible |
| The user starts typing (≥ 10 characters) | The `[✨ Optimize]` button appears inline below the textarea |
| The user has attachments with no text | Button visible with label `[✨ Describe with AI]` |
| Optimization in progress | Button disabled, spinner + "Processing…" |
| Optimization completed | Textarea updated, button returns to normal state |
| LLM error | Error toast, textarea unchanged, button restored |

### 2.2 Detailed Flow

```
1. USER WRITES
   Textarea: "I'd like a site for my restaurant, I have the menu and photos"
   Attachments: [menu.pdf] [interior.jpg] [signature-dish.jpg]

   ↓ [✨ Optimize prompt] appears

2. USER CLICKS [✨ Optimize prompt]
   → POST /v1/projects/:id/llm/optimize-prompt
   → Loading indicator + "Enriching your prompt…"
   → Textarea disabled during the call

3. BACKEND
   a. Loads ProjectMoodboard + UserStyleProfile
   b. Extracts text from menu.pdf (pdf-parse, max 5000 chars)
   c. Describes images via vision LLM if the model supports it
      (otherwise uses only filename/metadata if no vision)
   d. Calls the optimizer LLM with a content-only system instruction
   e. Receives the enriched prompt

4. FRONTEND UPDATES
   Textarea replaced with:
   ────────────────────────────────────────────
   Create the web page for [name from PDF/moodboard] Restaurant.

   Main goal: attract local customers and let them browse the menu
   online, with a call-to-action for phone or form-based reservations.

   Key sections to communicate:
   - Hero section with an appetizing photo of the signature dish
     (use the attached photos as a visual reference)
   - Menu presentation with starters, first courses, main courses,
     desserts sections (text from the attached menu)
   - Restaurant storytelling: atmosphere, history, values
     (tone: warm, Italian, tradition with a modern twist)
   - Reservations section with a phone number and a simple form
   - Photo gallery with 3-4 images of the interior and the dishes

   Target audience: local families and couples, tourists in the area,
   people looking for traditional Italian restaurants.

   Media content to include:
   - Hero image: photo of the signature dish (attached)
   - Gallery: interior and dish photos (attached)
   - Decorative icons: cutlery, stars, map pin for directions
   ────────────────────────────────────────────

5. USER READS, EDITS IF NEEDED → [Send]
   The enriched prompt enters the system as a USER message.
```

### 2.3 UX Rules

| Rule | Detail |
|---|---|
| **Non-destructive** | The button never silently replaces — the user always sees the result before sending. |
| **Editable afterward** | The textarea remains editable after optimization. The user can always correct it. |
| **Undoable** | A "Restore" (undo) button to revert to the original text, available for X seconds after the replacement. |
| **Not mandatory** | The normal flow (write → send) always works without optimization. |
| **Attachments preserved** | Attachments remain attached to the session even after optimization. |
| **Iterable** | The user can click "Optimize" again on an already-optimized prompt for another pass. |

---

## 3. Backend — PromptOptimizer Service

### 3.1 Service Architecture

```
apps/api/src/
  application/
    llm/
      promptOptimizer/
        PromptOptimizerService.ts       ← main orchestrator
        OptimizerContextBuilder.ts      ← assembles context from profile + attachments
        OptimizerSystemInstruction.ts   ← generates the instruction for the optimizer LLM
        OptimizerAttachmentProcessor.ts ← extracts content from attachments for context
        OptimizerModelResolver.ts       ← resolves which model to use
```

### 3.2 Interfaces

```typescript
// Service input
interface PromptOptimizerInput {
  rawPrompt: string;                    // raw user text (can be short)
  attachmentIds?: string[];             // asset IDs to include as content context
  projectId: string;                    // to load moodboard + preset
  userId: string;                       // to load the user profile
  modelOverride?: string;               // per-call override of the optimizer model
}

// Service output
interface PromptOptimizerOutput {
  enhancedPrompt: string;               // enriched prompt to show in the textarea
  contentSignals: {                     // meta-info (not shown to the user, useful for debugging)
    detectedObjective?: string;         // objective inferred from the input
    suggestedMediaTypes: string[];      // e.g. ["hero-image", "gallery", "icon-set"]
    toneDetected?: string;              // inferred tone
    attachmentsProcessed: number;       // how many attachments were included
    contextTokensUsed: number;          // tokens used for context
  };
  processingTimeMs: number;
}

// Public service interface
interface PromptOptimizerService {
  optimize(input: PromptOptimizerInput): Promise<PromptOptimizerOutput>;
}
```

### 3.3 OptimizerContextBuilder

Assembles the structured context to pass to the optimizer LLM:

```typescript
interface OptimizerContext {
  // Project identity (extracted from moodboard + preset)
  project: {
    type?: string;               // landing_page, mini_site, etc. (from the preset)
    audienceTags?: string[];     // target audience
    featureTags?: string[];      // desired components
    toneTags?: string[];         // communication style
    freeNotes?: string;          // moodboard free notes
    brief?: string;              // project brief
  };

  // User identity (extracted from UserStyleProfile)
  user: {
    identityTags?: string[];     // who they are (freelancer, agency, etc.)
    sectorTags?: string[];       // business sector
    freeDescription?: string;    // free description of the business
  };

  // Attached material (extracted from the Asset Manager)
  attachments: {
    pdfs: Array<{
      filename: string;
      extractedText: string;     // max 5000 chars per file
      truncated: boolean;
    }>;
    images: Array<{
      filename: string;
      visualDescription?: string;  // from LLM vision, if available
    }>;
    other: Array<{
      filename: string;
      mimeType: string;
    }>;
  };
}
```

**Context resolution rules:**

```
ProjectMoodboard present      → use moodboard fields (user override)
ProjectMoodboard absent       → use UserStyleProfile
Both absent                   → rawPrompt + attachments only (minimal context)
Attachments present           → process and include as content context
```

### 3.4 OptimizerAttachmentProcessor

```typescript
class OptimizerAttachmentProcessor {

  // For PDFs: extracts text with pdf-parse
  // Limit: 5000 chars per file (soft cap — optimized for LLM input)
  // Note: lower limit than PrepromptEngine (50,000 chars) because
  // the context is only meant to identify the content, not reproduce it
  async extractPdfContent(assetPath: string): Promise<string> { ... }

  // For images: uses LLM vision if available in the selected model
  // If not available: uses only filename + EXIF metadata (dimensions, date, etc.)
  // The goal is to understand "what's in the image" — not describe it in detail
  async describeImage(assetPath: string, projectAiConfig: AiConfig): Promise<string> { ... }

  // Safety limits
  readonly MAX_PDF_FILES = 3;      // max 3 PDFs per single optimizer call
  readonly MAX_IMAGE_FILES = 6;    // max 6 images per single optimizer call
  readonly MAX_PDF_CHARS = 5000;   // chars per single PDF
  readonly MAX_TOTAL_CONTEXT = 8000;  // total chars of attachment context
}
```

---

## 4. Optimizer System Instruction

### 4.1 Instruction Principles

The system instruction for the optimizer LLM must:

1. **Stay content-only** — no technical instructions (HTML, CSS, framework, layout)
2. **Be context-aware** — use the user profile + moodboard + attachments
3. **Produce readable output** — a natural-language prompt, not JSON
4. **Include the three key dimensions**: objective, content, media
5. **Respect the tone and identity** inferred from the profile

### 4.2 System Instruction Template (Nunjucks)

```nunjucks
You are a content strategist expert at writing briefs for web pages.

Your task is to turn the user's raw idea into a structured, rich content
prompt, ready to be passed to a web page generator.

FUNDAMENTAL RULES:
- Write ONLY content instructions: goals, key messages, sections, tone
- NEVER include: framework names (Bootstrap, Tailwind), CSS properties, HTML tags
- NEVER specify: hex color palette, font names, breakpoints, grid system
- NEVER decide: the page type (landing vs site vs presentation) — that is already set elsewhere
- KEEP the user's language (Italian if they write in Italian, English if in English)
- Output prompt length: between 150 and 400 words — concise but complete

{% if project.brief %}
PROJECT BRIEF:
{{ project.brief }}
{% endif %}

{% if project.freeNotes %}
ADDITIONAL PROJECT NOTES:
{{ project.freeNotes }}
{% endif %}

{% if user.freeDescription %}
USER PROFILE (use it to understand the business context):
{{ user.freeDescription }}
{% endif %}

{% if project.audienceTags.length > 0 or user.identityTags.length > 0 %}
IDENTITY CONTEXT:
{% if user.identityTags.length > 0 %}- Who: {{ user.identityTags | join(', ') }}{% endif %}
{% if user.sectorTags.length > 0 %}- Sector: {{ user.sectorTags | join(', ') }}{% endif %}
{% if project.audienceTags.length > 0 %}- Target audience: {{ project.audienceTags | join(', ') }}{% endif %}
{% endif %}

{% if project.toneTags.length > 0 %}
PREFERRED COMMUNICATION TONE: {{ project.toneTags | join(', ') }}
{% endif %}

{% if attachments.pdfs.length > 0 %}
ATTACHED DOCUMENTS (use them to extract key content):
{% for pdf in attachments.pdfs %}
--- FILE: {{ pdf.filename }} ---
{{ pdf.extractedText }}
{% if pdf.truncated %}[... content truncated for brevity]{% endif %}
{% endfor %}
{% endif %}

{% if attachments.images.length > 0 %}
ATTACHED IMAGES (use them as a reference to suggest media):
{% for img in attachments.images %}
- {{ img.filename }}{% if img.visualDescription %}: {{ img.visualDescription }}{% endif %}
{% endfor %}
{% endif %}

STRUCTURE OF THE PROMPT TO PRODUCE:
Your output must be a natural-language prompt that includes:
1. Main goal of the page (what the user needs to achieve)
2. Characterized target audience (who will read it, motivations, expected language)
3. Key content organized into sections (with guidance on what to say in each)
4. Media usage suggestions (when to use images, video, icons — essential for communication)
5. Communication tone (how the visitor should feel reading the text)
6. Any references to the attached materials (what to use from the provided documents/images)

Do NOT include in your output:
- Words like "HTML", "CSS", "JavaScript", "React", "div", "section"
- Technical layout, color, or font specifications
- The output format type (landing page, site, poster) — it is already configured elsewhere
```

### 4.3 Optimizer Model Configuration

```typescript
interface OptimizerModelConfig {
  // Primary source: dedicated env variable
  // LLM_OPTIMIZER_MODEL_ID=siliconflow::Qwen/Qwen2.5-7B-Instruct
  // If absent: uses the project's default model (project.aiConfig)
  // If that is also absent: uses the catalog default
  modelId?: string;

  // Optimization-specific parameters
  maxTokens: number;       // default: 800 (short but rich output)
  temperature: number;     // default: 0.7 (creative but coherent)
}

// Priority resolution:
// 1. modelOverride in the request (per-call override)
// 2. LLM_OPTIMIZER_MODEL_ID (env, platform-wide)
// 3. project.aiConfig.modelId (project's model)
// 4. catalog default model
```

---

## 5. API Endpoint

### 5.1 Route

```
POST /v1/projects/:id/llm/optimize-prompt
```

**Authentication:** JWT + sandbox check (user + project ownership)

### 5.2 Request Body

```typescript
interface OptimizePromptRequest {
  rawPrompt: string;           // required, min 1 char
  attachmentIds?: string[];    // asset IDs already uploaded to the project
  modelOverride?: string;      // optional: force a specific model
}
```

**Zod validation** (in `packages/contracts`):

```typescript
export const OptimizePromptRequestSchema = z.object({
  rawPrompt: z.string().min(1).max(2000),
  attachmentIds: z.array(z.string()).max(9).optional(),
  modelOverride: z.string().optional(),
});
```

### 5.3 Response

```typescript
// 200 OK
interface OptimizePromptResponse {
  enhancedPrompt: string;
  meta: {
    attachmentsProcessed: number;
    contextTokensUsed: number;
    processingTimeMs: number;
    modelUsed: string;         // which model answered
  };
}

// 400 Bad Request — missing rawPrompt
// 401 Unauthorized — missing JWT
// 403 Forbidden — sandbox check failed
// 429 Too Many Requests — rate limit (max 10 optimizations/hour per user)
// 500 Internal Server Error — LLM failure
```

### 5.4 Rate Limiting

The Prompt Optimizer does not count toward the main LLM usage (it is not generation).
It has a separate, permissive rate limit: **10 calls/hour per user**.
It is not charged against the credit system (if implemented in M5), or is charged at a reduced rate.

---

## 6. Integration With the Existing Pipeline

### 6.1 How the Optimized Prompt Enters the Flow

The optimized prompt requires no changes to the existing generation system.
It simply enters as `message.content` in the conversation's user message,
exactly as if the user had typed it by hand.

```typescript
// No changes needed to buildMessagesWithHistory()
// The optimized prompt is a normal user message

// In ConversationService.addMessage():
await conversation.addUserMessage({
  content: enhancedPrompt,  // already optimized
  attachments: [...],       // attachments unchanged
  metadata: {
    optimized: true,        // optional flag for analytics
    originalPrompt: rawPrompt  // keep the original for audit
  }
});
```

### 6.2 Relationship With Layers A–D (R1)

The Prompt Optimizer is **orthogonal** to R1 (Prompt Architecture Layer):

| Layer | What it controls | Who writes it |
|---|---|---|
| Layer A | Architectural technical constraints (static HTML, nginx-ready) | System (static) |
| Layer B | Output format (landing, slide, A4 — from the preset) | System (from the preset) |
| Layer C | Stylistic context (palette, style, tone — from the profile) | System (from the profile) |
| Layer D | Per-project pre-prompting template | System (from config) |
| **User Message** | **Content goal, sections, media (from the user)** | **User (optimized by R0)** |

R0 (this spec) and R1 can be developed in parallel with no conflicts.

### 6.3 Preserving the Original

The original rawPrompt is preserved in two places:

1. **Message metadata** — `message.metadata.originalPrompt` (for debug/audit)
2. **Frontend state** — in-memory undo buffer for X seconds (no persistence)

---

## 7. Attachment Handling — Dual Strategy

### 7.1 Two Approaches to Attachments

For the Prompt Optimizer, attachments are processed differently than in the PrepromptEngine (Layer 2):

| Approach | When used | Logic |
|---|---|---|
| **Direct serialization** | Small files (PDF < 20KB, images with vision) | Content extracted/described and passed as text in the context |
| **Abbreviated synthesis** | Large files (PDF > 20KB) | Only the first 5000 chars + an automatic summary |

The goal here is **not** to reproduce the document's content in the final prompt, but to **extract signals** (what the restaurant sells, who the customer is, what visual style the logo had...) to enrich the content direction.

### 7.2 RAG vs Serialization — Architectural Note

For future cases with large document bases (product catalog, company manual, extensive portfolio):

```
Current scenario (R0):
  Attached PDF/image → text extraction → inject into context → optimizer LLM
  Suitable for: brochures, menus, briefs, company profiles (1-5 pages)

Future scenario (later milestone, not in R0 scope):
  Large document corpus → chunking → embedding → vector DB → RAG retrieval
  Suitable for: a 200-product catalog, company knowledge base
```

The `OptimizerAttachmentProcessor` module is designed to be extended with RAG
in the future without modifying the service's public interface.

---

## 8. Implementation Plan — R0

### R0.1 — Contract and Backend Service

- [ ] `packages/contracts/src/promptOptimizer.ts` — `OptimizePromptRequestSchema`, `OptimizePromptResponseSchema`
- [ ] `apps/api/src/application/llm/promptOptimizer/PromptOptimizerService.ts` — interface + implementation
- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerContextBuilder.ts` — resolves context from profile + moodboard
- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerSystemInstruction.ts` — Nunjucks template + renderer
- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerAttachmentProcessor.ts` — text extraction + vision

### R0.2 — API Route

- [ ] `apps/api/src/presentation/http/routes/optimizePromptRoutes.ts` — POST route with sandbox middleware
- [ ] Register the route in `app.ts` under `/v1/projects/:id/llm/`
- [ ] Rate limiter: 10 req/hour/user on Redis (key: `optimizer:{userId}:hour`)

### R0.3 — Model Resolution

- [ ] `apps/api/src/application/llm/promptOptimizer/OptimizerModelResolver.ts`:
  - Reads `LLM_OPTIMIZER_MODEL_ID` from env
  - Falls back to `project.aiConfig.modelId`
  - Falls back to the catalog default
- [ ] Additions to `.env.example` and `.env.docker`: `LLM_OPTIMIZER_MODEL_ID=`

### R0.4 — Frontend: "Optimize Prompt" Button

- [ ] Add `optimizePrompt(projectId, body)` in `apps/web/lib/api.ts`
- [ ] `PromptOptimizerButton.tsx` component in `apps/web/components/`:
  - Visibility logic: appears after 10+ chars in the textarea, or if attachments are present
  - Loading state with a spinner
  - Undo buffer to restore the original (5 seconds)
- [ ] Integration into the `WorkspaceChat` component (chat input area)
- [ ] Error toast on failure

### R0.5 — Frontend: Visual Feedback

- [ ] "Prompt optimized" indicator in the textarea (e.g. an `AI ✨` badge)
- [ ] Optional diff highlight (shows what was changed) — nice-to-have, not blocking
- [ ] Tooltip on the button: "Enrich your prompt with AI using the project's context"

### R0.6 — Env and Config

- [ ] `LLM_OPTIMIZER_MODEL_ID` in `.env.example` and `.env.docker` (empty = use the project's model)
- [ ] `LLM_OPTIMIZER_RATE_LIMIT_PER_HOUR` in `.env.example` (default: 10)

---

## 9. Testable Steps

```
Test 1 — Basic backend (no attachments, no profile)
  POST /v1/projects/:id/llm/optimize-prompt
  body: { rawPrompt: "I want a site for my restaurant" }
  → 200 OK, enhancedPrompt contains goal + sections + suggested media
  → enhancedPrompt does NOT contain the words "HTML", "CSS", "Tailwind", "div", "section"

Test 2 — User profile context
  User with sectorTags: ["sector:food-beverage"], toneTags: ["tone:friendly-casual"]
  → enhancedPrompt reflects the food sector and friendly tone
  → "pizzeria", "trattoria", "osteria" appears naturally if present in the profile

Test 3 — Project moodboard context
  ProjectMoodboard with brief: "Fashion photography studio"
  → enhancedPrompt mentions portfolio, gallery, shoots, fashion clients
  → overrides the generic user identity

Test 4 — PDF attachment
  Attachment: menu.pdf with starters, first courses, main courses
  → enhancedPrompt includes instructions to present the menu with real sections
  → does not copy the PDF verbatim, but extracts its structure

Test 5 — Image attachment (vision available)
  Attachment: logo.jpg + interior.jpg
  → enhancedPrompt mentions using the attached images for hero and gallery

Test 6 — No vision model available
  Optimizer model without vision
  → the process does not fail — skips the image description, uses only the filename

Test 7 — Sandbox check
  user_B's JWT → /v1/projects/:id (owned by user_A)
  → 403 Forbidden

Test 8 — Rate limit
  11 calls in 1 hour from the same user
  → 429 Too Many Requests on call 11

Test 9 — Full integration flow
  Use enhancedPrompt as input → send chat-preview → verify that Layers A-D
  compose correctly (no conflict between the optimized prompt and the system prompt)

Test 10 — Frontend: undo
  Optimize → textarea updated → click "Restore" within 5 seconds
  → textarea reverts to the original text
```

---

## 10. Open Questions and Future Decisions

| Question | Suggested default | Notes |
|---|---|---|
| Should the optimized prompt be saved as a separate snapshot? | No (message metadata only) | Adds complexity with no immediate value |
| Can the user see that the call costs credits? | Not for now (R0) | In M5 (Credit System) a reduced or zero cost can be decided |
| Should the button be present in Refine mode (not just first generation)? | Yes, in refine too | The user can also optimize later edits |
| Handle rate limit differently for free vs pro plans? | In M5 with the Credit System | For R0: a flat rate limit for everyone |
| Support streaming of the optimized prompt (typing effect)? | Nice-to-have R0.5 | Improves UX but not blocking for release |
| Can the optimizer model be configured per-project (not just via env)? | Future roadmap | Add to `project.aiConfig` in a later milestone |

---

## 11. Integration Notes in the Prompt Pipeline

Summary of the full flow with R0 integrated:

```
User input area
  │
  ├─ rawPrompt (optional: 1 char min)
  ├─ attachments (optional)
  └─ [✨ Optimize Prompt] → PromptOptimizerService → enhancedPrompt
                                 └─ reads: UserStyleProfile
                                          ProjectMoodboard
                                          Attachments (PDF text + image desc)
  │
  ▼
enhancedPrompt → user message → Chat Preview API
                                         │
                              System Message composed of:
                              [Layer A: architectural constraints]
                              [Layer B: preset output spec]
                              [Layer C: style context block]
                              [Layer D: prePromptTemplate]
                                         │
                                         ▼
                                    Generator LLM
                                    → HTML + CSS + JS
```

The Prompt Optimizer is a **content-quality accelerator** that inserts itself as an optional step between the user's thinking and the technical generation, with no tight coupling to any other system component.
