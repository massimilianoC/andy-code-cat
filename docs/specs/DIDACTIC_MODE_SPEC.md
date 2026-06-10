# Didactic Mode — Implementation Spec

**Status:** planned
**Branch target:** `develop` (feature branch `feat/didactic-mode`, currently deferred — another agent owns the shared checkout)
**Milestone tag:** `R4-didactic-mode` (off-roadmap segment feature)

> Decisions in §0.2 are **locked** from a structured interview (7 rounds). They supersede earlier drafts.

---

## 0. Purpose

**Didactic Mode** is a parallel, additive, fully backward-compatible layer on top of the existing workstation/CAD mode. After an LLM run has produced an artifact (HTML/CSS/JS), Didactic Mode lets the user *understand* the produced code — what it does, why it was built that way, which prompt choices drove it — instead of *producing* new code.

It is a read-only **interrogation layer toward the current artifact**, not a generation layer. It reuses the existing inspect engine, Monaco editor, snapshot model, prompt-layer infrastructure, and LLM engine, and atomizes capabilities into reusable tools (a standalone dual-view, draggable splitters, parametric didactic prompts).

**Guiding principle: extend, do not rewrite.** No destructive change to the production chat, WYSIWYG edit mode, inspector, or snapshot pipeline. Didactic runs never create or mutate `PreviewSnapshot`/`Project`.

### 0.1 Roadmap positioning

Not on the committed release roadmap (R0–R5). Self-standing, **segment-defining MVP** for the "Scuole & Università" vertical (`TARGET-VISION.md` §3 — a read-only subset of *Modalità laboratorio*). Consumes (does not re-implement) **R1** layered prompting (`promptingTrace`) and **R2** logging/cost (`PromptExecutionLog`, `CostTransactionService`). Distinct from **R5 RAG chatbot** (that targets site *visitors*; this targets the *creator*). Expanded only if it finds commercial traction.

### 0.2 Locked decisions (interview)

| # | Area | Decision |
|---|---|---|
| 1 | Entry | Segmented **Build ↔ Didactic** toggle in `WorkspaceHeader`. In Didactic the production-chat column is replaced by the Didactic panel (chat state preserved); preview + tabs remain. |
| 2 | MVP scope | **Both** auto-generated knowledge **and** Q&A click-to-ask ship in the MVP (equal priority). |
| 3 | Availability | **Available to all users.** Optional `PlatformConfig.features.didacticMode` kill-switch defaults **on**. |
| 4 | Taxonomy | **Technical categories + difficulty level** (badge). |
| 5 | Knowledge generation | **On-demand with estimated-cost confirmation**, cached per snapshot; **single run** produces overview + topics + quizzes together. |
| 6 | Quizzes | **5** multiple-choice (4 options), **mixed difficulty**, explanation + anchors; **attempts are ephemeral** (self-check, not persisted). |
| 7 | Topic interaction | Click a topic → **opens dual-view + highlights** the anchor. |
| 8 | Output language | **UI language** of the user (IT/EN). Decoupled from Layer L for the MVP. |
| 9 | Q&A cost | **No per-question limit**; cost logged via ledger only. |
| 10 | Q&A persistence | **Project-level history** (`didactic_qna`), each entry records the `snapshotId` it referred to. |
| 11 | Panel layout | Two sub-tabs: **Esplora** (overview/topics/quizzes) and **Chiedi** (Q&A). |
| 12 | Dual-view | Standalone control **in the preview tab bar** (available in Build and Didactic); right pane defaults to **code** (tab per anchor). |
| 13 | Topic volume | **~6–10** topics, balanced across categories. |
| 14 | Difficulty UI | **Badge only** (no filter in MVP). |
| 15 | Model | **Same provider/model selected in the workspace** (like chat). |
| 16 | Stale cache | **Non-destructive "regenerate" banner**; previous knowledge stays visible until regenerated. |
| 17 | Click-to-ask | **Always active** in Didactic mode (no separate arming). |
| 18 | First run | **Empty state + CTA "Genera analisi" + hint** about click-to-ask. |
| 19 | Cost tracking | `didactic` cost category with **accordion** sub-items (knowledge-gen / ask). |
| 20 | Consistency | **Everything anchored to a snapshot**; new snapshot → stale (`groundingHash`); Q&A entries record their version. |
| 21 | Persistence | **Two collections**: `didactic_artifact_knowledge` (per snapshot) + `didactic_qna` (per project). |
| 22 | Endpoints | Project-scoped router **`/v1/projects/:id/didactic/*`**. |
| 23 | Q&A delivery | **SSE streaming only** (reuse chat pattern). |
| 24 | Impact metrics | **Base metrics via execution log** (no dedicated dashboard in MVP). |
| 25 | prompt_layer grounding | Based on **`promptingTrace` only**; 8-layer `prompt-preview` injection deferred. |

---

## 1. Reusability Audit — What Already Exists

Reuse these directly; do not reinvent.

| Existing piece | File | Reused how |
|---|---|---|
| Inspect engine (click→element) | `PF_INSPECT_SCRIPT` in `apps/web/app/workspace/[projectId]/iframe-scripts.ts` → `pf-select` `{stableNodeId, selector, tag, classes, outerHtml, ...}` | Click-to-ask on preview, routed to the didactic layer by `workMode` |
| Highlight + scroll-to by selector | `pf-edit-scroll-to` / `scrollToSel()` (same file) | Topic tutorials: highlight a region in the preview |
| Code editor + selection | `CodeEditorPanel` (`page.tsx`), Monaco `onDidChangeCursorSelection` | Click-to-ask on code; `revealRangeInCenter` for code anchors |
| Snapshot model | `PreviewSnapshot` (`apps/api/src/domain/entities/PreviewSnapshot.ts`): `artifacts`, `metadata.promptingTrace` | Grounding source (code + real prompts) |
| Current-version selection | `selectedBackendSnapshotId`, `ListPreviewSnapshots` | "current artifact" = same selection engine |
| LLM engine | `composeSystemPrompt()`, `buildChatCompletionRequestBody()`, `tryParseStructuredJson()`, `CostTransactionService`, `ExecutionLogger` | Didactic runs call the same engine |
| Q&A streaming | `streamLlmChatPreview` + `/llm/chat-preview/stream` (`apps/web/lib/api/llm.ts`) | SSE pattern cloned for `ask/stream` |
| Vertical-slice pattern | `UserStyleProfile` (entity→repo→use-case→contract→route) | Template for the `didactic` domain |
| Cost ledger + categories | `CostTransactionService`, `PlatformConfig.costRates`, `cost_transactions` | New `didactic` category + sub-type for the accordion |
| Auth / sandbox | `authMiddleware` + `sandboxMiddleware` | All endpoints read-only, sandbox-gated |

**No existing knowledge-base / quiz / RAG system.** The didactic domain is net-new.

### Net new files

```text
# Backend
apps/api/src/domain/entities/DidacticArtifactKnowledge.ts
apps/api/src/domain/entities/DidacticQnaEntry.ts
apps/api/src/domain/repositories/DidacticArtifactKnowledgeRepository.ts
apps/api/src/domain/repositories/DidacticQnaRepository.ts
apps/api/src/infra/repositories/MongoDidacticArtifactKnowledgeRepository.ts
apps/api/src/infra/repositories/MongoDidacticQnaRepository.ts
apps/api/src/application/didactic/instrumentArtifactHtml.ts
apps/api/src/application/use-cases/GenerateDidacticKnowledge.ts
apps/api/src/application/use-cases/GetDidacticKnowledge.ts
apps/api/src/application/use-cases/AskDidacticQuestion.ts
apps/api/src/application/use-cases/ListDidacticQna.ts
apps/api/src/application/llm/didacticPrompts.ts
apps/api/src/presentation/http/routes/didacticRoutes.ts
packages/contracts/src/didactic.ts

# Frontend
apps/web/lib/api/didactic.ts
apps/web/components/didactic/DidacticPanel.tsx        # hosts Esplora/Chiedi sub-tabs
apps/web/components/didactic/DidacticExploreTab.tsx   # overview + topics + quizzes
apps/web/components/didactic/DidacticAskTab.tsx       # Q&A
apps/web/components/didactic/DidacticTopicLauncher.tsx# topic → dual-view + highlight
apps/web/components/workspace/DualView.tsx
apps/web/components/workspace/DraggableHSplit.tsx
apps/web/components/workspace/DraggableVSplit.tsx
```

**Modified:** `page.tsx` (`workMode` state, route select/code-selection, mount panels, dual-view control), `WorkspaceHeader.tsx` (Build/Didactic toggle), `app.ts` (register `createDidacticRoutes()` before project routes), `PlatformConfig` (kill-switch + `didactic` cost rate), `docs/INDEX.md`.

**Reused unchanged:** `iframe-scripts.ts`, LLM engine, snapshot model, auth/sandbox.

---

## 2. Core Concepts

### 2.1 Work mode

New state `workMode: "build" | "didactic"`, default `"build"`. In `"didactic"`: production-chat column hidden (state preserved); `pf-select` and Monaco `onCodeSelectionChange` route to the Didactic panel; **click-to-ask is always armed**.

### 2.2 Grounding

Per current snapshot: `artifacts.{html,css,js}` + `metadata.promptingTrace` (`originalUserMessage`, `prePromptTemplate`, `effectiveSystemPrompt`). Zero extra storage. `prompt_layer` topics use only `promptingTrace`.

### 2.3 Anchors (see §10)

`{ kind: "preview"|"html"|"css"|"js"|"prompt", pfId?, lineRange? }`, validated server-side against an instrumented-HTML index.

### 2.4 Snapshot-anchored consistency

Knowledge + anchors are valid only for the snapshot that produced them. `groundingHash` = hash(`artifacts` + `promptingTrace`); on mismatch the panel shows a non-destructive "regenerate" banner (old content stays). Each `didactic_qna` entry stores the `snapshotId` it referred to.

---

## 3. Data Model

### 3.1 `didactic_artifact_knowledge` (per snapshot, cache)

```ts
export type DidacticDifficulty = "base" | "intermediate" | "advanced";

export interface DidacticAnchor {
  kind: "preview" | "html" | "css" | "js" | "prompt";
  pfId?: string;                 // preview/html → resolves to [data-pf-id="pf-<n>"]
  lineRange?: [number, number];  // css/js (and optionally html)
}

export interface DidacticTopic {
  id: string;
  category: DidacticCategory;    // §11.1 closed enum
  difficulty: DidacticDifficulty;
  title: string;
  summary: string;
  anchors: DidacticAnchor[];
}

export interface DidacticQuiz {
  id: string;
  difficulty: DidacticDifficulty;
  question: string;
  options: string[];             // 4
  correctIndex: number;
  explanation: string;
  anchors: DidacticAnchor[];
}

export interface DidacticArtifactKnowledge {
  id: string;
  projectId: string;
  snapshotId: string;
  userId: string;
  overview: string;
  topics: DidacticTopic[];       // ~6–10
  quizzes: DidacticQuiz[];       // 5, mixed difficulty
  groundingHash: string;
  model?: string;
  provider?: string;
  generatedAt: Date;
}
```

Repo: `MongoDidacticArtifactKnowledgeRepository`, unique index `{ projectId, snapshotId }`, `toEntity()`/`upsert` per `MongoUserStyleProfileRepository`.

### 3.2 `didactic_qna` (per project, history)

```ts
export interface DidacticQnaEntry {
  id: string;
  projectId: string;
  userId: string;
  snapshotId: string;            // version the question referred to
  focus?: {                      // null = whole-artifact question
    kind: "preview" | "html" | "css" | "js";
    pfId?: string;
    outerHtml?: string;          // preview focus
    lineRange?: [number, number];
    selectedText?: string;       // code focus
  };
  question: string;
  answer: string;
  model?: string;
  provider?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  createdAt: Date;
}
```

Repo: `MongoDidacticQnaRepository`, index `{ projectId, createdAt: -1 }`. Written on SSE `done`.

---

## 4. Anchor Resolution (decision)

The LLM sees only artifact **text**, but preview highlighting needs the live DOM. **Approach A — backend-instrumented HTML:**

1. `instrumentArtifactHtml.ts` (cheerio / node-html-parser) assigns deterministic `data-pf-id="pf-<n>"` to every "significant" element (block + media + text-bearing, **mirroring the `score()` heuristic** in `iframe-scripts.ts`). Returns `{ instrumentedHtml, idIndex }` (`pf-<n>` → `{ tag, classes, textSnippet, lineRange }`).
2. The LLM receives the instrumented HTML (with ids + numbered lines) and must reference **existing `pf-<n>` only** (or `lineRange` for code).
3. Backend **validates** every anchor against `idIndex` / line counts; invalid anchors are dropped (logged), never persisted.
4. The didactic dual-view preview renders the **instrumented** HTML, so `pf-edit-scroll-to` highlights `[data-pf-id="pf-<n>"]` reliably. Build-mode preview renders the original unchanged.

Trade-off: didactic preview is a derived read-only copy (never published/exported). `data-pf-id` is already a convention in `iframe-scripts.ts`.

**Artifact size cap:** instrumenter trims total chars sent to the LLM; for `ask` it prioritizes the focus region.

---

## 5. Analysis Models — Prompts, Taxonomy, Output

### 5.1 Category taxonomy (closed enum)

```ts
export const DIDACTIC_CATEGORIES = [
  "html_structure", "css_technique", "js_function",
  "responsiveness", "accessibility", "design_choice", "prompt_layer",
] as const;
export type DidacticCategory = (typeof DIDACTIC_CATEGORIES)[number];
```

### 5.2 LLM output contract (single run)

`generate` produces overview + topics + quizzes in one structured-JSON response, parsed with `tryParseStructuredJson` + `LLM_JSON_PARSING_GUIDELINES`:

```jsonc
{
  "overview": "2-4 sentences, in {UI_LANGUAGE}",
  "topics": [ { "category": "css_technique", "difficulty": "base|intermediate|advanced",
    "title": "<=80 chars", "summary": "1-3 sentences",
    "anchors": [ { "kind": "preview|html|css|js|prompt", "pfId": "pf-12", "lineRange": [40,52] } ] } ],
  "quizzes": [ { "difficulty": "...", "question": "...", "options": ["a","b","c","d"],
    "correctIndex": 0, "explanation": "...", "anchors": [ ... ] } ]
}
```

Constraints in the prompt: **6–10 topics balanced across categories**, **exactly 5 quizzes mixed difficulty**, anchors reference existing `pf-<n>`/lines only. Backend maps `pfId` → `{ stableNodeId, selector }` after validation.

### 5.3 Prompt templates (`didacticPrompts.ts`)

`buildDidacticPrompt({ mode, artifacts, promptingTrace?, focus?, question?, uiLanguage })` → `{ system, user }`. Shared preamble:

> You are a didactic code explainer embedded in a web-builder. You ONLY explain the given artifact and the prompt decisions that produced it — you NEVER propose, rewrite, or output code. Reference real elements. Anchors MUST use only `data-pf-id` values present in the provided HTML, or line ranges within the provided files. Answer in {UI_LANGUAGE}.

- **generate**: blocks `[INSTRUMENTED HTML]`, `[CSS (numbered)]`, `[JS (numbered)]`, `[GENERATION INTENT]` (= `promptingTrace`), + the JSON-output instruction.
- **ask**: blocks `[FOCUS]` (preview: `outerHtml`+`pfId`; code: `selectedText`+`lineRange`; or none), `[ARTIFACT CONTEXT]` (trimmed), `[GENERATION INTENT]`, then the user question. Streams a conversational answer (no JSON).

### 5.4 Model, budget, language, fallback

- **Model/role**: workspace-selected provider/model; default role `coding` for generate, `dialogue` for ask (via `GetLlmCatalog`).
- **Budget**: `max_tokens` from `LlmChatDefaults` (backend-driven).
- **Language**: `{UI_LANGUAGE}` = user UI locale (IT/EN), passed by the client.
- **Fallback (no `promptingTrace`)**: omit `[GENERATION INTENT]`, code-only grounding; note prompt rationale unavailable.

---

## 6. API

Auth + sandbox, read-only, project-scoped (`/v1/projects/:id/didactic/*`), registered before project routes.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `…/didactic/knowledge?snapshotId=` | `{ status: "ready"\|"stale"\|"absent", knowledge? }` (cache + `groundingHash` check) |
| `POST` | `…/didactic/knowledge/generate` | Single run → overview+topics+quizzes; returns knowledge + `costEstimate` |
| `POST` | `…/didactic/ask/stream` | SSE Q&A (reuse `LlmChatStreamEvent`); persists a `didactic_qna` entry on `done` |
| `GET` | `…/didactic/qna` | Project-level Q&A history |

Use-cases: `GenerateDidacticKnowledge` (instrument → prompt → LLM → parse → validate anchors → persist → `PromptExecutionLog` `taskKey:"didactic_knowledge_generate"` → `CostTransaction` category `didactic`/sub `knowledge_generate`); `GetDidacticKnowledge`; `AskDidacticQuestion` (`taskKey:"didactic_ask"`, sub `ask`, persists qna); `ListDidacticQna`.

---

## 7. Frontend / UX

### 7.1 Entry & layout

- **Build ↔ Didactic** segmented toggle in `WorkspaceHeader`. Switching to Didactic hides the chat column (state preserved) and mounts `DidacticPanel`; preview + tabs stay.
- **Dual-view** standalone control **in the preview tab bar**: splits into left preview ⟷ right code/prompt (reuses `DraggableHSplit`). Available in either work mode. Right pane defaults to the code tab matching the anchor.

### 7.2 DidacticPanel — two sub-tabs

- **Esplora**: header (snapshot/version selector, cache-status badge `ready/stale/absent`, **Generate/Regenerate** with **estimated-cost confirmation**); overview card; topics list grouped by category with **difficulty badges** (~6–10); quizzes (5, ephemeral self-check: pick → immediate correct/incorrect + explanation + anchors). Stale → non-destructive banner; old content stays.
- **Chiedi**: Q&A. Active focus chip (preview `<tag>` / code `L40–52`), question input, streamed answer; below, the **project Q&A history** (`GET …/qna`) with per-entry version label.

### 7.3 Interaction flows

- **Click-to-ask (always active in Didactic)**: `pf-select` (preview) or Monaco range (code) → set focus chip in **Chiedi** (does NOT open the build inspector) → `streamDidacticAsk`.
- **Topic tutorial**: click topic → opens dual-view, switches `previewTab` to the anchor `kind`, highlights preview anchors via `pf-edit-scroll-to` and code anchors via Monaco reveal+decoration.
- **First run (no knowledge)**: empty state with explanation, **CTA "Genera analisi"**, and a hint that you can click preview/code to ask.

### 7.4 States & styling

Loading (skeleton), empty (CTA), error (retry), stale (banner). Tailwind + shadcn/ui, consistent with workspace panels. All copy via i18n `didactic.*` (IT + EN).

---

## 8. Governance & Cross-Cutting

- **Availability**: all users; `PlatformConfig.features.didacticMode` kill-switch (default **on**) hides the toggle when off.
- **Cost**: `didactic` rate in `PlatformConfig.costRates`; every run records a `CostTransaction` with sub-type (`knowledge_generate` | `ask`) so the cost UI renders a **didactic accordion**; `PromptExecutionLog` per run.
- **Rate limiting**: none in MVP (logging only) — monitor cost; a limit can be added later if abuse appears.
- **Impact metrics**: derived from `PromptExecutionLog` + `CostTransaction` (runs, types, cost). No dedicated dashboard in MVP.
- **Read-only invariant**: never writes `PreviewSnapshot` / mutates `Project`; enforced by a test asserting `ListPreviewSnapshots` is unchanged after generate/ask.

---

## 9. Phased Delivery

### Phase 0 — Enabling refactor (non-destructive)
Extract inline splitters into `DraggableHSplit`/`DraggableVSplit` (identical cookies/clamps). Introduce `workMode` (default `build`). No visible change.

### Phase 1 — Standalone dual-view
`DualView.tsx` + preview-tab-bar control; reuses `buildPreviewDoc()` and tabs; works in Build mode independently.

### Phase 2 — Didactic MVP (knowledge + Q&A)
Contracts freeze → 2 collections → instrumenter → `generate` (single run) + `ask` (SSE) + qna persistence → `DidacticPanel` (Esplora + Chiedi) → click-to-ask → topic→dual-view → cost accordion → i18n. Split into the work packages in §10.2.

### Future (post-traction, out of MVP)
Difficulty filter; quiz attempt persistence + scoring; Layer L language; 8-layer prompt grounding; analytics dashboard; teacher session config / structured paths / student-prompt evaluation / moderated gallery / roles.

---

## 10. Delegation Plan

### 10.1 Contracts-first freeze (before parallel work)
Land `packages/contracts/src/didactic.ts` (enums, anchor, topic/quiz, knowledge DTO + `status`, qna DTO, ask request) + both entities. Then backend/frontend parallelize.

### 10.2 File ownership map (collision avoidance)

`page.tsx` is the single hot file — only the *integration* owner edits it per phase.

| WP | Owner | Files (new unless noted) | Must NOT touch |
|---|---|---|---|
| WP-CONTRACTS | contracts | `packages/contracts/src/didactic.ts`, both entities + repo interfaces | else |
| WP0 | fe-integration | `Draggable{H,V}Split.tsx`; edit `page.tsx`, `WorkspaceHeader.tsx` | backend |
| WP1 | fe-view | `DualView.tsx`; edit `page.tsx` (preview tab bar) | backend |
| WP2-BE | be | instrumenter, repos impl, `Generate/Get/AskDidactic*`, `ListDidacticQna`, `didacticPrompts.ts`, `didacticRoutes.ts`, register in `app.ts`, cost rate + kill-switch | frontend, `page.tsx` |
| WP2-FE | fe | `lib/api/didactic.ts`, `DidacticPanel`+`Explore`/`Ask`/`TopicLauncher`; edit `page.tsx` (mount + routing) | backend |
| WP-COST-UI | fe-cost | didactic accordion in the existing cost UI | backend |

### 10.3 Acceptance criteria
- **WP0**: splitters byte-identical (same cookies/clamps); `workMode` defaults build; no visible change; existing E2E green.
- **WP1**: dual-view toggles in Build mode; chat/edit untouched.
- **WP2**: generate → overview + 6–10 topics + 5 quizzes, **only valid anchors** (validation test vs `idIndex`); cache hit on second open (no new `PromptExecutionLog`); stale banner on artifact change. Click preview/code → focus chip → streamed answer persisted to `didactic_qna` with correct `snapshotId`; **assert no snapshot created**; sandbox denial for cross-user project; cost recorded under `didactic` with correct sub-type.

---

## 11. End-to-End Verification

1. `npm run test -w apps/api` — anchor validation (drop invalid `pfId`), cache hit/miss via `groundingHash`, structured-JSON parse, read-only invariant (`ListPreviewSnapshots` unchanged after generate/ask), sandbox denial.
2. Stack already running (do **not** re-run `install.sh`); in a project with ≥1 snapshot:
   - **P1**: dual-view toggle → preview+code side-by-side; Build mode unchanged.
   - **P2 knowledge**: Genera (with cost confirm) → overview + topics (category groups, difficulty badges) + 5 quizzes; click topic → dual-view + correct highlight; quiz self-check works; second open = cache hit; edit artifact → stale banner, old stays.
   - **P2 Q&A**: click preview block / select code → focus chip → streamed answer; entry appears in project Q&A history with version label; no snapshot created; cost shows in the didactic accordion.
3. Non-regression: Build mode chat, WYSIWYG edit, inspector, focus-patch identical to before.

---

## 12. Integration Anchors (verified in code)

Confirmed so an autonomous agent does not rediscover them.

| Anchor | Location | How to use |
|---|---|---|
| HTML parser | `cheerio` `^1.2.0` already in `apps/api/package.json` | Instrumenter uses cheerio — **no new dependency**. |
| Significance heuristic | `score()` in `iframe-scripts.ts` | Mirror its block/media/text scoring to choose which elements get `data-pf-id`. |
| Preview highlight | `pf-edit-scroll-to` / `scrollToSel()` in `iframe-scripts.ts` | Highlight a `[data-pf-id]` from a topic anchor. |
| Header toggle site | `apps/web/components/workspace/WorkspaceHeader.tsx` (left/center/right flex) | Add `workMode` + `onWorkModeChange` props; render a segmented Build/Didactic control (left, after project name). |
| Cost ledger UI | `CostBadge` → `CostDetailDrawer` → `CostBreakdownTree.tsx` (`apps/web/components/cost/`) | Tree groups by `ResourceType` → the **didactic accordion appears automatically** once new resource types are emitted; WP-COST-UI only adds labels/icons for them. |
| Cost resource types | `ResourceType` map in `apps/api/src/domain/entities/CostTransaction.ts` | Add `LLM_DIDACTIC_KNOWLEDGE: "llm.didactic.knowledge"` and `LLM_DIDACTIC_ASK: "llm.didactic.ask"`. |
| Cost rates | `PlatformConfig.costRates.perType?: Record<ResourceType, ResourceTypeCostPolicy>` | No new field — set per-type rates under the two new resource types (default to the `llm.chat` rate). |
| Task defaults | `DEFAULT_PROMPT_TASK_SETTINGS` in `PlatformConfig.ts` | Add `didactic_knowledge_generate` + `didactic_ask` (model/temp/maxTokens) as governance defaults; the workspace-selected model overrides at call time (decision #15). |
| Kill-switch | `PlatformConfig` interface | Add `features?: { didacticMode: boolean }` (default true). |
| SSE server pattern | `llmRoutes.ts:1154` `POST …/chat-preview/stream` (`text/event-stream`, `res.write("data: …")`) | `ask/stream` mirrors this handler exactly. |
| SSE client pattern | `streamLlmChatPreview` in `apps/web/lib/api/llm.ts` | `streamDidacticAsk` clones the reader/`LlmChatStreamEvent` loop. |
| Splitter regions | `page.tsx`: state `549–555`, cookie load `963–967`, drag effects `2244–2287`, JSX handles `3376` (vresizer) + `3804` (resizer), grid `3225` | WP0 extracts these into `Draggable{H,V}Split`. |

---

## 13. Execution Plan — Waves

Parallelism is bounded by one hard constraint: **`page.tsx` is edited by WP0, WP1, and WP2-FE**, so those serialize under a single `fe-integration` owner. The backend and cost lanes run fully in parallel.

```text
WAVE 1 (sequential, foundation)
  └─ WP-CONTRACTS  (freeze packages/contracts/src/didactic.ts + both entities + repo interfaces)
        GATE: types compile; imported by a no-op in api & web.

WAVE 2 (3 lanes in parallel after Wave 1)
  ├─ Lane BE  : WP2-BE
  │     instrumentArtifactHtml • Mongo repos • Generate/Get/Ask/ListQna •
  │     didacticPrompts • didacticRoutes • app.ts register •
  │     ResourceType + costRates.perType + promptTaskSettings + features flag
  │     GATE: integration test — generate returns contract-valid JSON w/ only
  │           valid anchors (fixture snapshot); ask SSE streams + writes didactic_qna;
  │           read-only invariant test; sandbox denial test.
  ├─ Lane FE-FND : WP0 → WP1   (serial on page.tsx, parallel to BE)
  │     WP0 splitters+workMode (no visible change) → WP1 dual-view in preview tab bar
  │     GATE: dual-view works in Build mode; existing E2E green.
  └─ Lane COST : WP-COST-UI
        labels/icons for the two new ResourceTypes in CostBreakdownTree
        GATE: a seeded didactic CostTransaction renders under the didactic accordion.

WAVE 3 (sequential, after Wave 2 — needs BE API + FE-FND)
  └─ WP2-FE  (fe-integration owns page.tsx)
        lib/api/didactic • DidacticPanel (Esplora/Chiedi) • Explore/Ask/TopicLauncher •
        page.tsx: mount panel, Build/Didactic routing of pf-select + Monaco selection,
        topic→dual-view highlight, empty/loading/stale/error states, i18n didactic.*
        GATE: full E2E (§11) on the running stack.

WAVE 4 (optional / post-traction)
  difficulty filter • quiz attempt persistence + scoring • Layer L language •
  8-layer prompt grounding • analytics dashboard • teacher session config / roles.
```

Estimated effort (rough): Wave 1 ~0.5d · Wave 2 BE ~2–3d, FE-FND ~1.5d, COST ~0.5d · Wave 3 ~2–3d.

### 13.1 Autonomy readiness

The spec is **design-complete** for an autonomous multi-agent build of Waves 1–3: contracts, data model, anchor strategy, prompts, endpoints, UX, cost, governance, verified integration anchors, wave/dependency plan, ownership map, and acceptance gates are all defined. Remaining items are **defaulted, not blocking**: didactic cost rate (= `llm.chat` rate), i18n copy (drafted by the FE agent), instrumenter thresholds (mirror `score()`), counts (5 quizzes / 6–10 topics).

Two **operational** caveats (outside the spec):

1. **Shared checkout** — the working directory is currently owned by another agent (Layer L). An autonomous run must use an **isolated git worktree** (or wait) to avoid collision.
2. **E2E gates need the running stack** — Wave 2/3 gates require executing against the live Docker stack; they cannot be self-verified from static analysis alone.
