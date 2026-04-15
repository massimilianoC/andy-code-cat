# Andy Code Cat — Asset-Aware Context Enrichment for Prompt Optimization

> Status: Proposed extension plan
> Date: 2026-04-15
> Scope: low-impact evolution of the prompt optimizer so it can use uploaded files, URL references, screenshots, and vision summaries as context
> Audience: maintainers, contributors, backend/frontend agents, superadmin operators

---

## 1. Goal

Extend the current prompt-optimization layer so the user is not limited to plain text.

The system should be able to enrich the prompt using:

- uploaded PDF files
- uploaded text documents
- uploaded images
- example links and competitor/reference sites
- platform-generated screenshots or previews

The result should remain the same product behavior:

- the user clicks an action before generation
- the system rewrites the user prompt into a stronger brief
- the technical generation pipeline remains unchanged

This is a content-quality enhancement, not a replacement of the generation architecture.

---

## 2. Current capability inventory

The repository already contains most of the required primitives.

### 2.1 Project asset storage already exists

The platform already supports project-scoped assets with double sandbox protection.

Relevant capabilities already present:

- file upload to the project asset manager
- metadata flags such as `useInProject`
- semantic role such as `styleRole`
- free-text notes via `descriptionText`
- URL-based references through `externalUrl`
- support for both `user_upload` and `platform_generated` assets

This is the correct base for context enrichment because it avoids creating a second storage system.

### 2.2 Prompt optimization layer already exists

The current system already supports:

- on-demand prompt optimization before generation
- dedicated logging outside the main conversation flow
- superadmin prompt-task governance for provider/model/template selection
- optimizer cost tracking

This means the right insertion point already exists.

### 2.3 Vision and screenshot primitives already exist

The platform already has:

- vision-capable models in the LLM catalog
- a Puppeteer-based screenshot service for preview and export capture
- prior design and vision-oriented analysis in the onboarding/style profiling track

This makes “reference-site analysis” and “image-informed prompt enrichment” feasible with limited architectural impact.

---

## 3. Strategic fit with the current roadmap

This proposal fits naturally between current roadmap layers rather than creating a parallel initiative.

### Why it aligns well

- it strengthens R0 and R1 prompt quality without modifying the existing system-prompt composition
- it improves R2 observability because asset-aware optimization can be logged and costed separately
- it creates a foundation that later benefits R5 document ingestion and RAG workflows

### Positioning recommendation

Treat this as a focused extension of:

- the Prompt Optimizer
- the Project Asset Manager
- the Prompting Service Platform

Not as a brand-new subsystem.

---

## 4. Low-impact architectural recommendation

## 4.1 Source of truth

Use the existing project asset collection as the canonical storage layer for all contextual materials.

That includes:

- uploaded files
- external example links
- future platform-generated screenshots or derived summaries

### Implementation rule

The chat and project UI should keep populating the existing asset manager.
The optimizer should read from that same source.

This minimizes regression risk and avoids duplicated storage logic.

---

## 4.2 Proposed context flow

### User flow

1. user writes a raw prompt
2. user optionally attaches or selects assets already linked to the project
3. user optionally adds one or more reference URLs
4. the optimizer reads project context plus relevant assets
5. the optimizer produces a stronger, richer prompt
6. the user reviews and sends it into the normal generation flow

### Backend flow

1. load active project preset and project metadata
2. load project moodboard and user style profile
3. resolve asset candidates from the existing asset collection
4. transform those assets into compact context fragments
5. compose a context packet for the optimizer
6. call the optimizer LLM
7. log usage and cost in the dedicated prompt execution log collection

---

## 5. Recommended context hierarchy

The optimizer should not ingest raw material blindly. It should build a ranked context packet.

### Priority order

1. raw user prompt
2. active project preset and project type
3. project moodboard
4. user style profile
5. explicitly selected assets
6. assets flagged as `useInProject`
7. URL references and derived screenshot summaries

### Ranking rule

When too much material is available, prefer:

- recently selected assets
- assets explicitly marked for project use
- inspiration references over generic uploads
- shorter summaries over full raw file text

This prevents token bloat and keeps the optimizer fast and cheap.

---

## 6. Asset-type handling strategy

## 6.1 PDF and text documents

### MVP behavior

- extract a safe text excerpt
- summarise it into a short content brief
- include only the concise summary in the optimizer context

### Supported document classes

- PDF
- TXT
- MD
- lightweight HTML snippets or exported briefs

### Guardrails

- per-file character cap
- per-run total context cap
- truncation with visible summary markers

---

## 6.2 Images

### MVP behavior

When the selected model supports vision:

- generate a short visual description
- extract mood, color direction, layout impression, and subject hints
- feed only the summary to the optimizer prompt

When no vision model is available:

- fall back to filename, MIME type, label, and user-provided `descriptionText`

### Goal

Use the image as inspiration context, not as an object-recognition product in itself.

---

## 6.3 URL references and example sites

The current asset manager already supports URL references. This is the correct entry point for link-based context.

### Recommended low-impact behavior

Store each example link as a URL reference asset and allow the optimizer to pull it as inspiration material.

### Analysis layers for a URL

1. metadata fetch
   - title
   - description
   - Open Graph preview
2. visible text extraction
   - headings
   - CTA wording
   - section labels
3. optional screenshot capture
   - full-page preview via Puppeteer
4. optional vision summary
   - color mood
   - layout style
   - visual hierarchy
   - professionalism and tone cues

This makes “analyze similar sites” a natural extension of the same flow.

---

## 7. Proposed service modules

Keep the implementation modular and reusable under the existing prompting service direction.

```text
apps/api/src/application/
  prompting/
    context/
      ContextPacketBuilder.ts
      AssetSelectionPolicy.ts
      AssetTextExtractor.ts
      AssetVisionSummarizer.ts
      UrlReferenceAnalyzer.ts
      ContextBudgetReducer.ts
```

### Responsibilities

- `ContextPacketBuilder` — assembles the final optimizer context
- `AssetSelectionPolicy` — chooses which project assets matter most
- `AssetTextExtractor` — extracts summaries from PDF/TXT/MD
- `AssetVisionSummarizer` — creates short image/reference-page descriptions
- `UrlReferenceAnalyzer` — fetches metadata and, later, screenshots reference URLs
- `ContextBudgetReducer` — keeps token usage under control

This keeps the current optimizer orchestration simple while allowing future reuse.

---

## 8. Using Puppeteer safely for reference-site analysis

Puppeteer is already available for preview/export capture, so it can be extended carefully.

### Recommended extension

Add a dedicated safe use case for external reference URLs.

### What it should do

- open the public URL with timeout limits
- capture one screenshot
- optionally extract visible text and title
- return a compact summary for the optimizer
- optionally store the screenshot as a `platform_generated` project asset

### Security guardrails

To avoid SSRF or abuse, the feature should:

- allow only `http` and `https`
- block private and local IP ranges
- reject localhost and internal hostnames
- set strict navigation timeouts
- cap screenshot size and page length
- never follow authenticated or private user sessions

This keeps the feature safe for public open-source collaboration and deployment.

---

## 9. Proposed data strategy

## 9.1 Immediate recommendation

Do not create a new primary asset storage collection.
Reuse the existing project asset collection.

That is the lowest-risk and most robust short-term design.

## 9.2 What can be stored there immediately

- uploaded project files
- URL references
- manual descriptions
- platform-generated screenshots
- platform-generated derived visual notes

## 9.3 Optional future cache layer

If performance or repeated analysis becomes expensive, add a secondary cache collection later, for example:

- `context_enrichment_cache`

This should remain optional and derived, not the source of truth.

---

## 10. Operational rollout plan

## Wave 1 — Asset-aware optimizer using current assets

Goal: minimal-risk extension of the existing optimizer.

Deliverables:

- let the workspace optimizer read project assets already marked for use
- include `descriptionText`, labels, URL refs, and lightweight text summaries
- no new UI complexity required beyond asset selection

Expected value:

- immediate improvement in prompt quality with almost no architectural disruption

## Wave 2 — Document summarization

Deliverables:

- PDF/TXT/MD excerpt extraction
- short automatic summaries for prompt enrichment
- summary reuse in optimizer runs

Expected value:

- better prompts from briefs, menus, brochures, FAQs, and client text packs

## Wave 3 — Reference-site analysis

Deliverables:

- URL reference assets become analyzable
- metadata extraction
- visible-text analysis
- optional Puppeteer screenshot capture

Expected value:

- better use of competitor links and design references

## Wave 4 — Vision-informed enrichment

Deliverables:

- screenshot-based layout and aesthetic analysis
- image-based inspiration summaries
- optional separate prompt task such as `describe_asset_vision`

Expected value:

- better visual direction without contaminating the technical generation prompt

## Wave 5 — Context scoring and caching

Deliverables:

- per-asset relevance scoring
- cached summaries for repeated reuse
- better token budgeting and faster optimization response times

---

## 11. Proposed UX enhancements

These changes can be delivered incrementally.

### Workspace UX

- asset picker inside the prompt optimizer flow
- quick toggle: use all project assets marked for context
- quick toggle: include only inspiration assets
- add URL as reference directly from chat or project config

### Asset Manager UX

- clearer visibility for `useInProject`
- clearer visibility for `styleRole`
- “Analyze reference” action for URL assets
- “Generate visual summary” action for image assets

These are additive improvements and do not require a redesign.

---

## 12. Cost and observability policy

The optimizer and context-analysis layers should remain independently observable.

### Requirements

- keep optimizer/context runs out of the normal project conversation storage
- keep logging in the dedicated prompt execution log path
- include costs, token counts, provider, model, and asset counts
- expose the cost back into the user-facing project total
- let superadmin inspect this in MongoDB and via dashboard tools

This is already aligned with the current prompting governance direction.

---

## 13. Recommended next implementation slice

If the goal is maximum value with minimal disruption, the best next slice is:

1. extend the current optimizer to auto-read project assets already flagged with `useInProject`
2. support URL reference assets as inspiration input
3. generate lightweight document and image summaries
4. defer advanced remote page screenshot analysis to the next wave

This delivers strong improvement quickly while preserving the architecture already in place.

---

## 14. Final recommendation

Yes — the correct design is for the chat and project UI to keep populating the existing project asset collection, and for the prompt optimizer to draw from that collection to build a richer optimization prompt.

That is the most robust low-impact path because it:

- reuses the current asset manager
- reuses the current optimizer entry point
- reuses the current vision-capable model catalog
- reuses the existing Puppeteer capture foundation
- keeps observability and cost tracking coherent
- avoids introducing a second fragmented context system
