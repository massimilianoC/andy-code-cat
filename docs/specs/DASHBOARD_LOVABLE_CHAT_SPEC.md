# Dashboard VibeCore — Feature Specification

**Status**: Draft v2  
**Priority**: High  
**Last updated**: 2026-05-14  
**Depends on**: DCL (Document Context Layer) — fully implemented; PrepromptEngine  
**Target branch**: `feat/dashboard-lovable-chat` from `develop`  
**Internal codename**: `VibeCore` (do not surface to users)

---

## 1. Overview

Transform the dashboard landing into a single-prompt, full-screen creation experience inspired by
Lovable, Claude.ai, and ChatGPT's start screens. The user lands on a visually immersive page
dominated by one question and one input:

> *"Cosa vuoi realizzare oggi?"*

Beneath that experience — partially visible as a scroll invitation — lives the existing dashboard
(project list, template catalog, recent activity).

This is an **additive** feature. All existing flows (Zero Effort form, God Mode workspace, manual
"New Project") remain unchanged.

---

## 2. Design Philosophy & Partner References

| Principle | Reference | Implementation |
| --- | --- | --- |
| One job per screen | Linear, Notion AI | Single prominent input, no sidebar |
| Radical simplicity | Perplexity, Claude.ai | No visible settings until needed |
| Depth on demand | Raycast, Arc | Mode selector reveals more power |
| Motion with purpose | Framer, iOS 17 | Blur scroll transition, not decorative spin |
| Glassmorphism (restrained) | macOS Sonoma, Figma AI | One glass surface, not stacked |
| Dark-first | Vercel, Linear | Dark default, light optional |
| Glow as affordance | GitHub Copilot Chat, Cursor | Glow = interactive surface, not decoration |

---

## 3. Visual Design System

### 3.1 Background

**Tech**: inline SVG + CSS `filter: blur()` + subtle CSS animation.  
No canvas, no JS-driven particle systems — pure CSS for performance and SSR safety.

```svg
<!-- Background blob set (place in public/bg-vibecore.svg or inline) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
  <filter id="blur"><feGaussianBlur stdDeviation="80"/></filter>
  <g filter="url(#blur)" opacity="0.55">
    <!-- Blob 1: deep indigo -->
    <ellipse cx="200"  cy="200" rx="420" ry="340" fill="#3730a3" class="blob-1"/>
    <!-- Blob 2: violet -->
    <ellipse cx="1200" cy="150" rx="380" ry="300" fill="#7c3aed" class="blob-2"/>
    <!-- Blob 3: rose -->
    <ellipse cx="900"  cy="750" rx="350" ry="250" fill="#be185d" class="blob-3"/>
    <!-- Blob 4: teal accent -->
    <ellipse cx="350"  cy="700" rx="280" ry="200" fill="#0d9488" class="blob-4"/>
  </g>
</svg>
```

**CSS animation** (slow, imperceptible drift — 30–60 s cycle):

```css
@keyframes blob-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%       { transform: translate(12px, -18px) scale(1.03); }
  66%       { transform: translate(-8px, 10px) scale(0.97); }
}

.blob-1 { animation: blob-drift 45s ease-in-out infinite; }
.blob-2 { animation: blob-drift 60s ease-in-out infinite 10s; }
.blob-3 { animation: blob-drift 50s ease-in-out infinite 5s; }
.blob-4 { animation: blob-drift 55s ease-in-out infinite 20s; }
```

**Tailwind overlay**: `bg-[#0a0a12]/90` on top of the SVG for darkness control.

### 3.2 Chat Box — the Glass Card

Single centered card, max-width 680px.

```
┌─────────────────────────────────────────────────────┐
│  border: 1px solid rgba(255,255,255,0.08)            │
│  background: rgba(255,255,255,0.03)                  │
│  backdrop-filter: blur(24px) saturate(180%)          │
│  border-radius: 20px                                 │
│  box-shadow:                                         │
│    0 0 0 1px rgba(139,92,246,0.25),   ← glow ring    │
│    0 0 60px rgba(139,92,246,0.08),    ← ambient glow │
│    0 24px 48px rgba(0,0,0,0.5);       ← depth        │
│                                                      │
│  ON FOCUS (input active):                            │
│    0 0 0 1px rgba(139,92,246,0.5),                   │
│    0 0 80px rgba(139,92,246,0.15),                   │
│    0 24px 48px rgba(0,0,0,0.5);                      │
└─────────────────────────────────────────────────────┘
```

Glow color follows mode:
- EASY (VibeCore): `#8b5cf6` (violet)
- MEDIUM (Zero Effort): `#3b82f6` (blue)
- HARD (God Mode): `#10b981` (emerald)

### 3.3 Typography

```
Heading "Cosa vuoi realizzare oggi?"
  font-size: clamp(1.5rem, 3vw, 2.25rem)
  font-weight: 600
  color: rgba(255,255,255,0.92)
  letter-spacing: -0.02em

Subtitle / hint
  font-size: 0.9rem
  color: rgba(255,255,255,0.4)
  font-weight: 400

Input placeholder
  color: rgba(255,255,255,0.25)
  font-style: italic
```

### 3.4 Dark Mode

Dark mode is the **default**. Light mode support via `class="dark"` on `<html>` (Tailwind `darkMode: 'class'`).
The background SVG is always dark; in light mode, reduce blob opacity to 0.3 and use a
`bg-white/80` overlay instead of dark.

### 3.5 Motion & Transitions

| Event | Animation |
| --- | --- |
| Page load | `opacity: 0 → 1`, `translateY(16px → 0)`, 400ms ease-out, 100ms delay |
| Input focus | glow ring fade-in 200ms ease |
| Phase change (classifying → creating) | text crossfade 300ms |
| Scroll down | blur + fade overlay on VibeCore section, 250ms, `will-change: opacity` |
| Scroll back to top | reverse fade, chat fully restored |
| Mode change | card border color transition 400ms ease |

Use `framer-motion` for React-side animations (already in the stack). Keep CSS-only for background.

### 3.6 Attachment Area

- Default: paperclip icon + "Allega file" label inside input row
- Drag-over state: dashed border on card (`border-dashed border-violet-500/50`), subtle pulse ring
- File pill after upload: filename + size + remove × icon — compact, inline below textarea
- Accepted types: PDF, DOCX, PNG, JPG, SVG (matches DCL pipeline)
- Max size: 10 MB per file, 3 files max (configurable via `PlatformConfig`)

---

## 4. Layout Architecture

### 4.1 Full-Screen Entry (100dvh)

```
┌──────────────────────────────────────────────┐  ← 100dvh viewport
│                                              │
│   [SVG Blob Background — fixed, full-bleed]  │
│                                              │
│   ┌─────────┐  (mode selector top-right)     │
│   │  EASY ▾ │                                │
│   └─────────┘                                │
│                                              │
│      "Cosa vuoi realizzare oggi?"            │  ← ~40vh from top
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │  [Textarea — min 3 rows, auto-grow]  │   │  ← glass card
│   │                                      │   │
│   │  [📎 Allega]          [Crea con AI →]│   │
│   └──────────────────────────────────────┘   │
│                                              │
│   ──── scorri per i tuoi progetti ↓ ────    │  ← 90–95dvh
└──────────────────────────────────────────────┘
   ↕ 15–20% peek of dashboard below
```

### 4.2 Scroll Reveal

```
ScrollY = 0         → VibeCore fully visible, dashboard hidden
ScrollY = 80–100px  → blur + fade overlay on VibeCore (opacity 0→0.9, blur 0→8px)
ScrollY = 200px+    → VibeCore faded out, dashboard fully visible
ScrollY back to 0   → natural reverse, VibeCore restores
```

Implementation: `IntersectionObserver` on a sentinel element + `backdrop-filter` on a
`position: sticky` overlay div. No scroll-jacking; native browser scroll is preserved.

```tsx
// ScrollBlurOverlay — sticky div that sits over the VibeCore section
<div
  style={{
    opacity: scrollRatio,            // 0–1 mapped from scrollY 80–200
    backdropFilter: `blur(${scrollRatio * 8}px)`,
    background: `rgba(10,10,18,${scrollRatio * 0.7})`,
  }}
  className="fixed inset-0 pointer-events-none z-10 transition-none"
/>
```

`scrollRatio` computed with a lightweight `useScrollRatio` hook — no library needed.

---

## 5. Mode Selector — EASY / MEDIUM / HARD

The user can switch between three interaction modes from a compact pill selector in the top-right
corner of the VibeCore section.

| Label | Internal name | UX |
| --- | --- | --- |
| EASY | `VibeCore` | One-shot: write + attach + send. AI handles everything. |
| MEDIUM | `ZeroEffort` | Guided multi-step form (existing Zero Effort flow). |
| HARD | `GodMode` | Full workspace with preview, iteration, granular controls. |

**Persistence**: `localStorage` key `vibe_mode` — restored on next visit.

**UI element**: segmented control (3-part pill button), not a dropdown.  
Active segment uses `bg-white/10` + glow accent color border.

```tsx
<ModeSelector value={mode} onChange={setMode} />
// renders: [ EASY ] [ MEDIUM ] [ HARD ]
```

On MEDIUM: VibeCore chat disappears, Zero Effort form fades in (existing component).  
On HARD: navigates directly to `/workspace/new` (existing God Mode blank workspace).

---

## 6. VibeCore Pipeline — Pre-run LLM Layers

The pipeline triggered by submitting the VibeCore chat runs **before** the main generation job.
It passes through two sequential LLM calls and one policy check.

```
User submits (prompt + attachments)
        │
        ▼
┌─────────────────────────────┐
│  Layer Ω: Prompt Optimizer  │  ← existing task: optimize_user_prompt
│  Model: Qwen3-30B-A3B       │
│  Output: enrichedPrompt     │
└─────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────┐
│  Layer Φ: Pre-run Intent & Format Classifier │  ← NEW (Sub-task E)
│  Model: Qwen3-8B (fast, low-cost)            │
│  Inputs: enrichedPrompt + attachment meta    │
│  Outputs:                                    │
│    templateId: string | null                 │
│    formatHint: FormatHint | null             │
│    confidence: number                        │
└──────────────────────────────────────────────┘
        │
        ├── templateId ≠ null → inject template preprompt layer
        │
        ├── formatHint ≠ null → inject canonical format rules (see §6.1)
        │
        └── both null → generate ad-hoc style guidance in preprompt
        │
        ▼
┌───────────────────────────────────┐
│  Cost Policy Gate                 │  ← existing: check project budget
│  Fail fast if over limit          │
└───────────────────────────────────┘
        │
        ▼
   Create project → redirect to /launch/{id}?autoPrompt=...
```

### 6.1 FormatHint Catalog

Canonical format categories with their pre-prompt rule sets. Admin-configurable via `PlatformConfig`.

| FormatHint | Trigger keywords (examples) | Canonical rules injected |
| --- | --- | --- |
| `one_pager` | one pager, una pagina, landing, hero | Single scroll, hero + 3 sections, CTA above fold |
| `a3_document` | A3, presentazione, documento, slide | 297×420mm layout, print-safe margins, grid-based |
| `ratio_1_1` | quadrato, social, instagram, 1:1 | 1:1 viewport, square-first breakpoints |
| `ratio_16_9` | widescreen, presentazione, slide, 16:9 | Slide-like proportions, full-bleed sections |
| `interactive_form` | form, modulo, prenotazione, compilazione | Multi-step form pattern, validation states |
| `portfolio` | portfolio, lavori, galleria, creativo | Grid or masonry layout, lightbox-ready |
| `brochure` | brochure, depliant, 3 colonne | Column-based, print-friendly typography |

**Contract** (`packages/contracts/src/vibecore.ts`):

```typescript
export type FormatHint =
  | "one_pager" | "a3_document" | "ratio_1_1" | "ratio_16_9"
  | "interactive_form" | "portfolio" | "brochure";

export interface VibeClassifyResponse {
  templateId: string | null;
  formatHint: FormatHint | null;
  confidence: number;          // 0.0–1.0
  reasoning: string;
  skipped: boolean;
}
```

### 6.2 Pre-prompt Layer Composition

When `formatHint` is set, the PrepromptEngine's **Layer Φ slot** is populated with the
corresponding canonical rule block from `PlatformConfig.formatHintRules[hint]`.  
When `templateId` is set, Layer Φ loads the template's full preprompt (existing logic).  
When both are null, Layer Φ is filled by an ad-hoc style summary generated inline by the
optimizer LLM call (short, max 200 tokens).

The two paths are not mutually exclusive — a template match can also carry a format hint; in that
case, the template preprompt takes priority and the format rules are appended as a secondary block.

### 6.3 New Prompt Task Config

```typescript
// Append to DEFAULT_PROMPT_TASK_SETTINGS
vibe_intent_classify: {
  enabled: true,
  provider: "siliconflow",
  model: "Qwen/Qwen3-8B",          // fast, cheap — latency < 800ms target
  temperature: 0.0,
  maxCompletionTokens: 256,
  systemTemplate: "",               // loaded from PlatformConfig.systemTemplates
},
```

---

## 7. Sub-tasks

### A — `ChatPanel` Reusable Component

**Scope**: Refactor  
**Risk**: Low  
**File**: `apps/web/components/chat/ChatPanel.tsx`

Extract the chat UI from `apps/web/app/workspace/[projectId]/page.tsx` into a standalone,
parameterizable component. No behavior change — pure extraction.

```tsx
interface ChatPanelProps {
  projectId: string;
  conversationId?: string;
  className?: string;
  onConversationCreated?: (conversationId: string) => void;
  onAssetUploaded?: (assetId: string) => void;
  disableAttachment?: boolean;
  placeholder?: string;             // NEW: custom placeholder text
  variant?: "workspace" | "entry";  // NEW: controls visual density
}
```

**What moves into ChatPanel**:
- Message list rendering (user + assistant bubbles)
- Input field + send button
- Paperclip button → `uploadProjectAsset()` + `onAssetUploaded` callback
- Drag-and-drop zone for files
- Loading / streaming state
- Auto-scroll to last message

**What stays in the workspace page**:
- `useParams` / routing
- Sidebar / split-panel layout
- Preview iframe

---

### B — `VibeCoreEntry` Dashboard Component

**Scope**: New feature  
**Risk**: Medium  
**Files**:
- `apps/web/app/dashboard/page.tsx` — add `<VibeCoreEntry />`
- `apps/web/components/dashboard/VibeCoreEntry.tsx` — new component
- `apps/web/components/dashboard/ModeSelector.tsx` — new component
- `apps/web/components/dashboard/ScrollBlurOverlay.tsx` — new component
- `apps/web/hooks/useScrollRatio.ts` — new hook

#### State machine

```typescript
type EntryPhase =
  | "idle"          // input ready
  | "optimizing"    // Layer Ω prompt optimizer running
  | "classifying"   // Layer Φ intent classifier running
  | "policy_check"  // cost gate
  | "creating"      // project creation
  | "redirecting";  // router.push in progress

const PHASE_LABELS: Record<EntryPhase, string> = {
  idle:          "",
  optimizing:    "Ottimizzazione del prompt…",
  classifying:   "Analisi della richiesta…",
  policy_check:  "Verifica limiti di progetto…",
  creating:      "Creazione del workspace…",
  redirecting:   "Apertura…",
};
```

#### Full UX flow

```
User opens dashboard (mode = EASY by default)
  │
  ▼
VibeCoreEntry section occupies ~80dvh
  │
  ├── User types prompt + optionally drags/attaches files
  │     └── Drag-over: card border pulses, dashed ring
  │
  ├── User presses Enter or clicks "Crea con AI →"
  │     │
  │     ├── phase → "optimizing"  (Layer Ω)
  │     ├── phase → "classifying" (Layer Φ)
  │     ├── phase → "policy_check"
  │     ├── phase → "creating"
  │     └── phase → "redirecting"
  │           │
  │           ├── templateId ≠ null → /launch/{id}?autoPrompt=...&templateId=...
  │           └── templateId = null → /workspace/{id}?autoPrompt=...
  │
  └── User scrolls down
        └── blur overlay fades in → existing dashboard visible
              ├── Project cards
              ├── Template catalog
              └── Scroll back to top → VibeCoreEntry fully restored
```

#### Key behaviors

- **Enter to submit**: `Shift+Enter` = newline, bare `Enter` = submit (standard chat UX).
- **Keyboard shortcut**: `Cmd/Ctrl + K` focuses the VibeCore input from anywhere on the page.
- **File pills**: uploaded files shown as compact chips below textarea; removable before submit.
- **Phase progress**: single animated status line below the button, no spinner modal.
- **Error recovery**: on any pipeline error, phase resets to `idle` with an inline error toast.

---

### C — LLM Template Classifier (existing, refined)

**Scope**: New API endpoint  
**Risk**: Medium  
**Files**:
- `apps/api/src/application/prompting/ClassifyProjectIntent.ts`
- `apps/api/src/presentation/http/routes/projectRoutes.ts`
- `packages/contracts/src/vibecore.ts`
- `apps/web/lib/api/vibecore.ts`

This sub-task is now merged into the unified **Layer Φ** endpoint. The original
`/v1/projects/intent-classify` is renamed to `/v1/vibecore/classify` and extended to return
both `templateId` and `formatHint` in a single call.

```
POST /v1/vibecore/classify
Authorization: Bearer <token>

Body: {
  prompt: string (max 2000),
  attachmentMeta?: { filename: string; mimeType: string; sizeBytes: number }[]
}

Response: VibeClassifyResponse   ← see §6.1
```

Confidence threshold for template match: **0.65** (raise from original 0.6 — reduces false
positives that land users in the wrong template).

---

### D — VibeCore Visual Layer

**Scope**: New UI infrastructure  
**Risk**: Low  
**Files**:
- `apps/web/app/globals.css` — blob keyframes + layer-specific custom properties
- `public/vibecore-bg.svg` — background blob set (or inline in component)
- `apps/web/components/dashboard/VibeCoreBackground.tsx`
- `apps/web/hooks/useScrollRatio.ts`

#### `VibeCoreBackground` component

```tsx
export function VibeCoreBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[#0a0a12]" />
      <svg /* blob set */ className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0a12]/80" />
    </div>
  );
}
```

**Performance requirements**:
- No `requestAnimationFrame` loops; CSS-only animation
- `will-change: transform` only on animated blob elements
- `content-visibility: auto` on the below-fold dashboard section
- Prefers-reduced-motion: `@media (prefers-reduced-motion: reduce)` kills blob animation

---

### E — Layer Φ: Pre-run Intent & Format Classifier

**Scope**: New use case  
**Risk**: Medium  
**Files**:
- `apps/api/src/application/use-cases/VibeClassify.ts`
- `apps/api/src/application/prompting/formatHintRules.ts`
- `apps/api/src/domain/entities/PlatformConfig.ts` — add `formatHintRules` field

#### Classifier prompt (system)

```
You are a document-type and template classifier.
Given a user prompt and optional file metadata, return a JSON object:
{
  "templateId": "<id from catalog or null>",
  "formatHint": "<one of: one_pager|a3_document|ratio_1_1|ratio_16_9|interactive_form|portfolio|brochure|null>",
  "confidence": 0.0–1.0,
  "reasoning": "<one sentence>"
}

Rules:
- Set templateId only if confidence ≥ 0.65 against the template catalog below.
- Set formatHint independently of templateId; it can be non-null even when templateId is null.
- If neither signal is clear, return both as null.
- Return valid JSON only.

Available templates:
{{templateList}}
```

---

### F — Mode Selector Component

**Scope**: New UI component  
**Risk**: Low  
**File**: `apps/web/components/dashboard/ModeSelector.tsx`

```tsx
type Mode = "easy" | "medium" | "hard";

interface ModeSelectorProps {
  value: Mode;
  onChange: (mode: Mode) => void;
}

const MODE_CONFIG: Record<Mode, { label: string; color: string; description: string }> = {
  easy:   { label: "EASY",   color: "#8b5cf6", description: "Un prompt, tutto il resto lo fa l'AI" },
  medium: { label: "MEDIUM", color: "#3b82f6", description: "Guida guidata passo passo"            },
  hard:   { label: "HARD",   color: "#10b981", description: "Controllo completo"                    },
};
```

Tooltip on hover shows `description`.  
Mode persisted in `localStorage("vibe_mode")`.  
On MEDIUM: transitions to existing Zero Effort form with fade (200ms).  
On HARD: `router.push("/workspace/new")`.

---

### G — Scroll Experience

**Scope**: New UI behavior  
**Risk**: Low  
**Files**:
- `apps/web/hooks/useScrollRatio.ts`
- `apps/web/components/dashboard/ScrollBlurOverlay.tsx`

```typescript
// useScrollRatio.ts
export function useScrollRatio(startPx: number, endPx: number): number {
  const [ratio, setRatio] = useState(0);
  useEffect(() => {
    const handler = () => {
      const y = window.scrollY;
      setRatio(Math.min(1, Math.max(0, (y - startPx) / (endPx - startPx))));
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [startPx, endPx]);
  return ratio;
}
```

ScrollBlurOverlay reads `ratio` and applies inline styles:
```tsx
style={{
  opacity: ratio,
  backdropFilter: `blur(${ratio * 8}px)`,
  background: `rgba(10,10,18,${ratio * 0.7})`,
}}
```

**No scroll-jacking**. Native scroll is fully preserved. The overlay is `pointer-events: none`.

---

## 8. Accessibility & WCAG

| Requirement | Implementation |
| --- | --- |
| Contrast AA (dark mode) | Text on glass card: min 4.5:1; hint text: min 3:1 |
| Keyboard navigation | Tab order: mode selector → textarea → attach → send |
| `prefers-reduced-motion` | blob animation disabled; overlay instant |
| `aria-live` | Phase label region: `aria-live="polite"` |
| Focus management | On redirect, no focus trap issues (full navigation) |
| Screen reader | Background SVG has `aria-hidden` |

---

## 9. Compatibility

- All existing project creation flows remain unchanged.
- `ChatPanel` refactor is backward-compatible; workspace page wraps it with identical props.
- The `/v1/vibecore/classify` endpoint is new; no changes to existing project routes.
- Mode selector defaults to EASY on first visit; existing users see no disruption.
- The background SVG is scoped to the dashboard route only — other routes unaffected.

> Full retrocompatibility analysis and integration map: see **§13**.

---

## 10. Feature Flags & Environment

```bash
# .env.example additions
VIBE_CLASSIFIER_ENABLED=true     # set false to bypass Layer Φ (returns null/null)
VIBE_OPTIMIZER_ENABLED=true      # set false to bypass Layer Ω (pass prompt raw)
```

Both flags checked in `VibeClassify.ts` before LLM calls. When both false, the pipeline
degrades to the legacy `classifyIntent` behavior (direct project creation, no optimization).

---

## 11. Implementation Order

| Step | Sub-task | Rationale |
| --- | --- | --- |
| 1 | D — Visual Layer | No API dependency; unblocks design validation |
| 2 | G — Scroll Experience | Pairs with D; pure frontend |
| 3 | F — Mode Selector | Pure UI; needed by B |
| 4 | A — ChatPanel refactor | Pure refactor; zero regression risk |
| 5 | §14 — Layer T slot in PrepromptEngine | Foundation for all template injection |
| 6 | §15 — UserTemplate entity + repository | Required before auto-save |
| 7 | E — Layer Φ classifier use-case | Requires Layer T slot |
| 8 | C — `/v1/vibecore/classify` | Requires E |
| 9 | §16 — Cross-mode Layer Φ service | Wires ZeroEffort + GodMode |
| 10 | B — VibeCoreEntry | Requires A, C, D, F, G |
| 11 | §17 — Auto-save & promotion flow | Post-generation; requires §15 |

---

## 12. Open Questions

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Blank project from VibeCore → God Mode or Zero Effort? | God Mode; user already saw the AI's plan via Layer Φ |
| 2 | `confidence < 0.65`: disambiguation step or straight to blank? | Straight to blank — minimal friction, no extra modal |
| 3 | Should VibeCore support multi-turn before project creation? | No in MVP — one-shot is the brand promise; revisit post-launch |
| 4 | Should format hint rules be editable by tenant admins or only superadmin? | Superadmin only in MVP; tenant override as a v2 feature |
| 5 | Mobile: scroll reveal appropriate or replace with tab/drawer? | Tab/drawer on `< sm` breakpoint — scroll reveal is desktop-only |
| 6 | "VibeCore" naming visible to end user? | No — expose only EASY/MEDIUM/HARD labels |

---

## 13. Retrocompatibility Analysis

This section maps every new component introduced by this spec against the existing system and
documents the exact integration contract for each touch-point.

### 13.1 Existing Pipeline Entry Points

| Entry point | Current behavior | Impact of this spec |
| --- | --- | --- |
| Dashboard → "New Project" button | Opens `ProjectConfigPopup` → manual config → `prePromptTemplate` (flat, monolithic) | **None.** Button and popup unchanged. Layer T enrichment is opt-in per job. |
| Zero Effort form submit | `DraftProjectTemplate` use-case → `PrepromptEngine` → Layer 2 generation | Layer Φ runs before `DraftProjectTemplate` when `VIBE_CLASSIFIER_ENABLED=true`. See §16.2. |
| God Mode workspace — first chat message | Layer 1 (chat preview) using `prePromptTemplate` inline | Layer Φ runs silently on blank-profile projects. Layer T slot populated before Layer 1 system prompt build. See §16.3. |
| `/launch/{projectId}?autoPrompt=` | Existing launch page runs generation with stored prompt | No change. `templateResolution` is already resolved and stored in the Job by the time `/launch` receives it. |
| POST `/v1/projects/:id/generate` | Stage A PrepromptEngine → Stage B GenerationWorker | PrepromptEngine gains an optional `templateResolution` input field. When absent: exact current behavior. |

### 13.2 PrepromptEngine — Before vs After

```
BEFORE (current)
────────────────
PrepromptInput {
  job, project, prepromptProfile, workspaceDir
}
  │
  ▼
LayerComposer
  ├── system layer     (base platform instructions)
  ├── context layer    (project + iteration context)
  ├── constraint layer (output constraints)
  ├── format layer     (Nunjucks prePromptTemplate)
  └── persona layer    (style, tone)
  │
  ▼
resolvedPrompt

AFTER (this spec)
─────────────────
PrepromptInput {
  job, project, prepromptProfile, workspaceDir,
  templateResolution?: TemplateResolution   ← NEW, optional
}
  │
  ▼
LayerComposer
  ├── system layer     (unchanged)
  ├── [Layer T] template module   ← NEW, injected only if templateResolution ≠ null
  │     └── source: ProjectPreset.systemPromptModule
  │              OR UserTemplate.prepromptBlock
  │              OR ad-hoc FormatHint canonical rules
  ├── context layer    (unchanged)
  ├── constraint layer (unchanged)
  ├── format layer     (unchanged)
  └── persona layer    (unchanged)
  │
  ▼
resolvedPrompt
```

**Invariant**: if `templateResolution` is `null` or absent, `LayerComposer` produces byte-for-byte
identical output to the current system. No existing test can fail from this change.

### 13.3 `ProjectPreset` Catalog — Before vs After

The existing `ProjectPreset` entity (static in-code catalog, `PRESET_TYPED_SPECS.md`) already
defines `systemPromptModule` on each preset. Layer Φ now provides the automated path to
**select** a preset from natural language — the preset itself is unchanged.

| Aspect | Before | After |
| --- | --- | --- |
| How a preset is selected | User clicks preset in `ProjectConfigPopup` | User clicks (existing) OR Layer Φ classifies (new) |
| How `systemPromptModule` is injected | Manual — `ProjectConfigPopup` sets `project.presetId` → PrepromptEngine reads it | Same path OR via `TemplateResolution.presetId` — same resolver, same injection point |
| Preset catalog | Superadmin-managed static catalog | Unchanged |

### 13.4 Feature Flag Degradation Matrix

| `VIBE_CLASSIFIER_ENABLED` | `VIBE_OPTIMIZER_ENABLED` | Behavior |
| --- | --- | --- |
| `true` | `true` | Full pipeline: Layer Ω + Layer Φ + Layer T injection |
| `true` | `false` | Layer Φ only (no prompt optimization before classify) |
| `false` | `true` | Layer Ω only (prompt optimized, no classify, no Layer T) |
| `false` | `false` | Exact current behavior — no regression possible |

### 13.5 Database Schema — Additive Changes Only

All MongoDB schema changes are additive (new optional fields or new collections). No existing
field is renamed, removed, or type-changed.

| Collection | Change | Type |
| --- | --- | --- |
| `jobs` | Add `templateResolution?: TemplateResolution` | New optional field |
| `jobs` | Add `templateDraft?: string` | New optional field (auto-save staging area) |
| `projects` | Add `userTemplateId?: ObjectId` | New optional ref |
| `user_templates` | New collection | See §15 |
| `platform_config` | Add `formatHintRules: Record<FormatHint, string>` | New optional field |

---

## 14. Layer T — Template Module

Layer T is the new named layer inside `LayerComposer`. It sits between the `system` layer and
the `context` layer and is populated by the output of Layer Φ (or manually via `presetId`).

### 14.1 Layer T Contract

```typescript
// apps/api/src/application/llm/systemPromptLayers.ts — extend existing layers

export interface LayerTInput {
  /** Resolution produced by Layer Φ or by the user manually selecting a preset */
  templateResolution: TemplateResolution | null;
}

export interface TemplateResolution {
  /** A ProjectPreset id from the static catalog */
  presetId?: string;
  /** A UserTemplate id from MongoDB */
  userTemplateId?: string;
  /** A FormatHint key — used when neither preset nor userTemplate is matched */
  formatHint?: FormatHint;
  /** Confidence score from Layer Φ — stored for audit/learning */
  confidence: number;
  /** One-sentence reasoning from the classifier */
  reasoning: string;
  /** Source of this resolution */
  source: "layer_phi" | "user_explicit" | "zero_effort_form";
}
```

### 14.2 Layer T Resolution Priority

```
templateResolution.presetId ≠ null
  → load ProjectPreset from catalog
  → inject preset.systemPromptModule as Layer T block

else if templateResolution.userTemplateId ≠ null
  → load UserTemplate from MongoDB
  → inject userTemplate.prepromptBlock as Layer T block

else if templateResolution.formatHint ≠ null
  → load PlatformConfig.formatHintRules[formatHint]
  → inject as Layer T block
  → mark job.templateDraft = block  (see §17 for auto-save)

else
  → Layer T block = ""  (empty — no injection, full backward compat)
```

### 14.3 Layer T Block Format

The injected block is a plain string (Nunjucks-rendered, same as other layers) wrapped with
a sentinel comment so it can be identified in audit logs:

```
<!-- LAYER_T_START source={{source}} preset={{presetId}} format={{formatHint}} -->
{{layerTContent}}
<!-- LAYER_T_END -->
```

Sentinels are stripped before passing to the generation model. They are preserved in
`Job.resolvedPromptDebug` for audit only.

### 14.4 Nunjucks Variables Available in Layer T

Layer T templates receive the same `TemplateContext` as all other layers:

```
{{ project.name }}, {{ project.type }}, {{ project.lang }}
{{ iteration.number }}, {{ iteration.isFirstGeneration }}
{{ theme.primaryColor }}, {{ theme.mood }}
{{ input.attachments.summary }}
```

This allows UserTemplate blocks to reference project-specific data without hardcoding.

---

## 15. UserTemplate Entity & Lifecycle

### 15.1 MongoDB Schema

```typescript
// apps/api/src/domain/entities/UserTemplate.ts

export interface UserTemplate {
  _id:              ObjectId;
  ownerId:          ObjectId;        // user who created it
  tenantId:         ObjectId;        // tenant scope (multi-domain support)
  name:             string;          // user-assigned or auto-generated
  description:      string;          // auto-generated summary (≤ 120 chars)
  formatHint:       FormatHint | null;
  sectorKeywords:   string[];        // extracted keywords for future matching
  prepromptBlock:   string;          // the Layer T content (Nunjucks string, ≤ 2000 chars)
  sourceJobId:      ObjectId;        // job that generated the ad-hoc rules
  isSystem:         boolean;         // promoted to system-wide template by superadmin
  status:           "draft" | "active" | "archived";
  usageCount:       number;
  lastUsedAt:       Date | null;
  expiresAt:        Date | null;     // set to +30d for "draft"; null for "active"
  createdAt:        Date;
  updatedAt:        Date;
}
```

**Indexes**:

- `{ ownerId: 1, status: 1 }` — user template catalog query
- `{ tenantId: 1, isSystem: 1, status: 1 }` — system template catalog query
- `{ expiresAt: 1 }` with TTL index — auto-expire drafts after 30 days

### 15.2 Lifecycle States

```
                  ┌──────────┐
  Layer Φ runs    │          │
  ad-hoc rules ──►│  draft   │────────────────────────► (auto-deleted after 30d)
  generated       │          │
                  └──────────┘
                       │
                  User accepts
                  "Salva template?"
                       │
                       ▼
                  ┌──────────┐
                  │  active  │◄──── superadmin can set isSystem=true
                  │          │
                  └──────────┘
                       │
                  User or admin
                  archives it
                       │
                       ▼
                  ┌──────────┐
                  │ archived │  (soft delete, never purged)
                  └──────────┘
```

### 15.3 Repository Interface

```typescript
// apps/api/src/domain/repositories/UserTemplateRepository.ts

export interface UserTemplateRepository {
  findByOwner(ownerId: string, status?: UserTemplateStatus): Promise<UserTemplate[]>;
  findSystemTemplates(tenantId: string): Promise<UserTemplate[]>;
  findById(id: string): Promise<UserTemplate | null>;
  create(data: Omit<UserTemplate, "_id" | "createdAt" | "updatedAt">): Promise<UserTemplate>;
  activate(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  promoteToSystem(id: string): Promise<void>;    // superadmin only
  incrementUsage(id: string): Promise<void>;
}
```

### 15.4 Layer Φ Integration with UserTemplate Catalog

When Layer Φ classifies a prompt, it queries **three** catalogs in priority order:

```
1. ProjectPreset (static system catalog)          → templateId / presetId
2. UserTemplate { isSystem: true, status: "active" }  → system-promoted user templates
3. UserTemplate { ownerId: currentUser, status: "active" }  → user's own templates
```

The catalog passed to the classifier LLM includes all three sources, formatted as:

```
[SYSTEM PRESET] landing_page — "Landing page professionale, single scroll, hero + CTA"
[SYSTEM TEMPLATE] portfolio_creativo — "Portfolio per studi creativi con griglia masonry"
[MY TEMPLATE] mio_studio_legale — "Sito per studio legale: tono formale, struttura A3 + modulo contatto"
```

The `templateId` returned can reference any of the three sources. The `source` field in
`TemplateResolution` distinguishes them for the Layer T resolver.

---

## 16. Layer Φ as Cross-Mode Service

Layer Φ is **not** exclusive to VibeCore. It is a platform-level pre-run service callable by
all three interaction modes. The service is a standalone use-case
(`apps/api/src/application/use-cases/VibeClassify.ts`) invoked by each mode's own orchestration.

### 16.1 Service Interface

```typescript
// apps/api/src/application/use-cases/VibeClassify.ts

export interface VibeClassifyInput {
  prompt:          string;
  attachmentMeta?: AttachmentMeta[];
  userId:          string;
  tenantId:        string;
  /** Hint from the calling mode — can bias classifier toward certain categories */
  modeHint?:       "easy" | "medium" | "hard";
}

export interface VibeClassifyOutput {
  templateResolution: TemplateResolution | null;  // null if skipped or no match
  enrichedPrompt:     string;                     // Layer Ω output (or raw if disabled)
  skipped:            boolean;
  durationMs:         number;
}
```

### 16.2 Integration — Zero Effort Mode (MEDIUM)

Zero Effort invokes `VibeClassify` **after** the intake form is submitted and **before**
`DraftProjectTemplate` runs.

```
Zero Effort form submitted
  │
  ▼
POST /v1/zero-effort/submit   (existing endpoint)
  │
  ├── [NEW] VibeClassify.execute(formData.prompt, ...)
  │     └── returns templateResolution
  │
  ▼
DraftProjectTemplate (existing use-case)
  │   receives: { ...formData, templateResolution }   ← added field
  │
  ▼
PrepromptEngine
  │   receives: { ...existing input, templateResolution }
  │
  ▼
Layer T injected if templateResolution ≠ null
```

**User visibility**: In MEDIUM mode, if a template was matched, a non-blocking banner in the
Zero Effort launch screen shows:
> "Ho identificato il tipo di progetto: *Portfolio creativo*. Puoi modificarlo prima di procedere."

With a link to change the template. This is informational only — the user is not blocked.

### 16.3 Integration — God Mode (HARD), Blank Profile

In God Mode, Layer Φ runs **on first message submission** in the workspace when the project
has no preset assigned (`project.presetId == null`).

```
User in workspace — first message sent (iteration 1)
  │
  ├── project.presetId == null?
  │     YES:
  │       ├── [NEW SILENT] VibeClassify.execute(message.text, attachments)
  │       │     └── returns templateResolution
  │       │
  │       └── if templateResolution.presetId ≠ null:
  │             project.presetId = templateResolution.presetId   ← update project
  │             (no UI notification — transparent to user)
  │
  │     NO (preset already set): skip VibeClassify
  │
  ▼
Layer 1 chat preview
  │   system prompt includes Layer T block (if templateResolution populated)
  │
  ▼
Normal chat flow continues
```

The project is updated silently. If the user later visits `ProjectConfigPopup`, the
auto-detected preset is visible (and editable). A subtle label marks it: "*(rilevato automaticamente)*".

### 16.4 Integration — VibeCore Mode (EASY)

Already documented in §6. Layer Φ runs pre-submit, before project creation. The flow is
explicit: user sees the "Analisi della richiesta…" phase label.

### 16.5 Mode Comparison Summary

| Aspect | EASY (VibeCore) | MEDIUM (Zero Effort) | HARD (God Mode) |
| --- | --- | --- | --- |
| When Φ runs | Pre-submit, before project creation | Post-form, before DraftProjectTemplate | First message, before Layer 1 |
| User visibility | Explicit phase label | Non-blocking banner with edit option | Silent (auto-detected label in popup) |
| Blocks on no match | No (creates blank project) | No (continues with no template) | No (Layer T empty = current behavior) |
| Auto-save proposed | Yes, post-generation | Yes, post-generation | Yes, post-generation |

---

## 17. Auto-save & Template Promotion Flow

### 17.1 When Auto-save Triggers

Auto-save of a new UserTemplate draft is proposed when:

1. Layer Φ ran in **ad-hoc mode** (formatHint match, not a presetId or existing userTemplateId)
2. The generation job completed with `status: "completed"` (not failed or cancelled)
3. No existing UserTemplate with `sectorKeywords ≈ current` and `ownerId = user` already exists
   (deduplication check: cosine similarity of keyword sets > 0.85 → skip proposal)

### 17.2 Auto-save Flow

```text
Job completes (status: "completed")
  │
  ├── job.templateDraft ≠ null?
  │     YES:
  │       ├── Dedup check (see §17.1 condition 3)
  │       │     DUPLICATE FOUND → skip, log, done
  │       │
  │       └── NOT DUPLICATE:
  │             Create UserTemplate {
  │               status: "draft",
  │               prepromptBlock: job.templateDraft,
  │               sourceJobId: job._id,
  │               expiresAt: now + 30d,
  │               name: auto-generated (see §17.3),
  │               ...
  │             }
  │             POST notification → workspace SSE channel
  │
  ▼
Workspace UI receives SSE event "template_draft_ready"
  │
  └── Show bottom-right toast (non-blocking):
        "Ho imparato il tuo stile per questo tipo di progetto.
         Vuoi salvarlo come template riutilizzabile?"
         [Salva]  [Non ora]
               │
        [Salva] → PATCH /v1/user-templates/:id/activate
                    UserTemplate.status = "active"
                    UserTemplate.expiresAt = null
                    Toast: "Template salvato! Disponibile nei tuoi progetti futuri."
               │
        [Non ora] → UserTemplate stays "draft", expires in 30d
```

### 17.3 Auto-generated Template Name

Name is generated by the LLM (same call as Layer Ω, appended as a side task) or derived
from the classification:

```typescript
function deriveTemplateName(formatHint: FormatHint, reasoning: string): string {
  // e.g. "Portfolio creativo — griglia masonry e lightbox"
  const base = FORMAT_HINT_LABELS[formatHint];          // "Portfolio"
  const detail = reasoning.slice(0, 40).replace(/\.$/, "");  // trim reasoning
  return `${base} — ${detail}`;
}
```

The user can rename it after saving from the dashboard template panel.

### 17.4 Superadmin Promotion to System Template

A superadmin can promote any `UserTemplate { status: "active" }` to a system template:

```http
PUT /v1/admin/user-templates/:id/promote-to-system
Authorization: Bearer <superadmin-token>

Body: {
  name: string,          // required: public-facing name
  description: string,   // required: catalog description
  tenantScope: "all" | string[]  // "all" = visible to all tenants
}
```

Effect:

- `userTemplate.isSystem = true`
- `userTemplate.ownerId` remains (attribution preserved)
- Template appears in the shared system catalog for all users (or specified tenants)
- Layer Φ classifier catalog picks it up on next warm-up (catalog is re-fetched per request)

The promoted template is listed in the Admin dashboard under:
**Admin → Governance → Template Catalog → User-originated Templates**

### 17.5 Dashboard — User Template Panel

New section in the user dashboard, below the existing project grid:

```text
┌─────────────────────────────────────────────────────────┐
│  I tuoi template                              [+ Nuovo]  │
│                                                          │
│  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │ 📄 Portfolio creativo     │  │ 📋 Modulo contatti   │ │
│  │ Usato 3 volte             │  │ Bozza · scade 12/6   │ │
│  │ [Usa]  [Modifica] [···]  │  │ [Salva]  [Elimina]  │ │
│  └──────────────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

- **Bozza** state shows expiry date and a "Salva" CTA
- **Attivo** state shows usage count and "Usa" (pre-selects in next VibeCore input)
- "Usa" pre-fills the dashboard chat with `userTemplateId` as a hidden param — Layer Φ
  skips classification and goes directly to Layer T injection

---

## 18. New Sub-tasks (§13–§17)

### H — `UserTemplate` Domain Layer

**Scope**: New entity + repository  
**Risk**: Low  
**Files**:

- `apps/api/src/domain/entities/UserTemplate.ts`
- `apps/api/src/domain/repositories/UserTemplateRepository.ts`
- `apps/api/src/infra/repositories/MongoUserTemplateRepository.ts`
- `packages/contracts/src/userTemplates.ts`

### I — Layer T slot in `PrepromptEngine`

**Scope**: Engine extension (additive)  
**Risk**: Low  
**Files**:

- `apps/api/src/application/llm/systemPromptLayers.ts` — add `buildLayerT()`
- `apps/api/src/services/preprompt/LayerComposer.ts` — inject Layer T between system and context
- `apps/api/src/application/use-cases/DraftProjectTemplate.ts` — pass `templateResolution`

No existing layer is modified; `buildLayerT()` returns `""` when `templateResolution` is null,
preserving exact current behavior.

### J — Cross-mode `VibeClassify` service wiring

**Scope**: New service integration  
**Risk**: Medium (touches Zero Effort and God Mode entry paths)  
**Files**:

- `apps/api/src/application/use-cases/VibeClassify.ts` — already planned in Sub-task E
- `apps/api/src/presentation/http/routes/zeroEffortRoutes.ts` — add classify call
- `apps/api/src/application/use-cases/HandleChatMessage.ts` — add silent classify on iter 1

Both integrations are **additive**: new code paths gated by `VIBE_CLASSIFIER_ENABLED` with
no change to the existing happy path when the flag is false.

### K — Auto-save & Promotion API

**Scope**: New feature  
**Risk**: Low  
**Files**:

- `apps/api/src/application/use-cases/ProposeUserTemplate.ts`
- `apps/api/src/presentation/http/routes/userTemplateRoutes.ts`
- `apps/api/src/presentation/http/routes/adminRoutes.ts` — `PUT /promote-to-system`
- `apps/web/components/workspace/TemplateDraftToast.tsx`
- `apps/web/components/dashboard/UserTemplatePanel.tsx`
- `apps/web/lib/api/userTemplates.ts`
