# Andy Code Cat — Structured Image Prompting Pipeline Spec

> Status: Proposed extension plan  
> Date: 2026-04-16  
> Scope: image-generation prompting, context enrichment, prompt optimization, focus-aware media application, prompt/version traceability

> Alignment note, 2026-05-29: this spec remains active only for AI image generation and prompt quality. Stock/placeholder image provider selection, fallback policy, backend fetch, local asset persistence, and Edit-mode stock regeneration are governed by `docs/specs/IMAGE_FETCH_PERSISTENCE_REFACTOR_PROPOSAL.md`.

---

## 1. Goal

Define a structured pipeline for image generation that makes produced visuals more coherent with the project, the selected page section, and the current version history.

The system should evolve from:

- a mostly direct user prompt + technical preprompt pass-through

To:

- a layered, asset-aware, focus-aware, versioned image prompting flow
- aligned with the current prompt architecture, prompt governance, prompt logs, and preview snapshot model

This is not a separate product track. It should reuse the existing prompting platform wherever possible.

### Current implementation status

Wave 1 is now implemented in the backend through:

- a shared context builder for image prompts
- a dedicated image-prompt optimization step with governed prompt-task settings
- prompt trace persistence inside generated asset metadata
- continued compatibility with the existing preview snapshot versioning flow
- a suggest-first inspector UX that proposes the kind of visual that fits the selected section before generation

Key entry points:

- `apps/api/src/application/prompting/buildImagePromptContext.ts`
- `apps/api/src/application/prompting/OptimizeImagePrompt.ts`
- `apps/api/src/application/use-cases/GenerateProjectImage.ts`
- `apps/api/src/presentation/http/routes/projectAssetRoutes.ts`

---

## 2. Current State Analysis

## 2.1 What already works well

The current image-generation flow already has important strengths:

- the request is scoped to a selected element or background target
- aspect ratio and layout safety are considered
- the generated media becomes a project asset with metadata
- a placeholder is applied immediately so the UI remains responsive
- the final asset is saved as a new preview version only when the render is ready
- the project preprompt is already passed into the image flow, so the system is not using the raw prompt alone

This means the platform already has:

- focus-aware media generation
- deferred rendering with non-blocking UX
- project asset persistence
- snapshot versioning integration

These are the correct primitives to build on.

## 2.2 Current limitation

The present prompt composition for image generation is still too thin and too technical.

Today the effective prompt is built mainly from:

1. full project preprompt template
2. selected element metadata
3. layout-safety instructions
4. raw user request

This causes four main issues.

### A. Prompt contamination from the technical preprompt

The project preprompt is designed for page generation, not for image models.
It contains HTML, CSS, JS, JSON, iframe, and response-format rules.
Those instructions are useful for chat artifacts, but they are noise for image generation.

### B. Missing semantic brand context

The image flow does not currently build a compact context packet from:

- project moodboard
- user style profile
- preset-specific image direction
- already-approved project assets
- page/section semantic role

As a result, image coherence depends too much on the wording quality of the last user message.

### C. No dedicated image prompt optimization stage

The repository already has a reusable prompt optimization architecture, but image generation bypasses it.
The chat side is more mature than the image side.

### D. Incomplete prompt version traceability

The final effective prompt is stored in asset metadata, which is good, but there is not yet a first-class image prompt task with:

- structured layer trace
- prompt-task governance
- dedicated optimization logs
- reproducible prompt bundle versions

---

## 3. Product Principles

The image prompting system should follow these principles.

1. Preserve user intent  
   The system must enrich the request, not overwrite it.

2. Context before style polish  
   First establish subject, role, purpose, and brand fit; only then refine aesthetics.

3. Separate business context from model syntax  
   Project identity and art direction should stay separate from provider-specific rendering hints.

4. Focus-aware and version-aware by default  
   If the user selected a specific element or section, the pipeline must use that context explicitly.

5. Reuse existing data structures and governance  
   Avoid creating a parallel architecture when the current prompting platform can be extended.

6. Traceability and reproducibility  
   Every generated image should be explainable and reproducible from its prompt bundle.

---

## 4. Recommended Layered Architecture

The recommended design is to mirror the existing prompting philosophy used for chat and optimizer flows.

## Layer 0 — Raw User Intent

The original request remains the source of truth.
Examples:

- hero image for a luxury travel landing page
- dark textured background for this section
- replace this placeholder with a fashion editorial portrait

## Layer A — Project Identity Context

Build a compact identity block from existing project data:

- project name
- project preset / website type
- moodboard tags
- user style profile
- tone, palette, brand adjectives
- business sector and audience

This should reuse the same precedence already used elsewhere:

project moodboard → user profile → defaults

## Layer B — Preset and Page Role Module

Each preset should be able to contribute image-specific direction.
For example:

- restaurant site → editorial food photography, warm highlights, table depth
- architect portfolio → clean geometry, daylight, material texture, neutral palette
- fashion brand → lookbook framing, premium contrast, minimal text scene

This layer should live next to the existing preset prompt modules, not in a separate subsystem.

## Layer C — Focus and Layout Context

When the user selected a specific element, enrich the prompt with:

- target selector and element tag
- section role such as hero, gallery card, testimonial portrait, background, logo slot
- aspect ratio and original dimensions
- current alt text or nearby text hints
- whether the media is foreground or background
- active snapshot context when available

This is the direct bridge with the focused-edit philosophy.

## Layer D — Asset-Aware Visual Enrichment

Use the existing project assets as contextual inspiration.
Sources should include:

- approved logo assets
- uploaded inspiration images
- materials already marked with useInProject
- URL references saved in the asset manager
- future screenshot summaries of the current preview

The pipeline should not dump raw files into the prompt. It should build compact visual signals such as:

- dominant palette
- photographic mood
- subject category
- texture/material cues
- composition style
- quality level

## Layer E — Model Adapter

Add a dedicated image-model adaptation layer that converts the context packet into a provider-friendly render prompt.

Responsibilities:

- translate the context into concise image-model language
- normalize prompt length
- add quality and framing cues
- generate optional negative guidance
- keep FLUX-specific phrasing separate from general creative intent

This is where the system decides how to phrase the final prompt for the active provider without polluting the upstream business context.

## Layer F — Final Prompt Bundle

The output of the pipeline should not be just one string internally.
It should be a structured bundle.

Suggested shape:

```ts
interface ResolvedImagePromptBundle {
  version: string;
  originalUserPrompt: string;
  optimizedUserPrompt: string;
  finalRenderPrompt: string;
  negativePrompt?: string;
  structuredSignals: {
    subject?: string;
    artDirection?: string[];
    palette?: string[];
    composition?: string[];
    constraints?: string[];
  };
  trace: {
    presetId?: string;
    selectedAssetIds: string[];
    selectedElementSelector?: string;
    parentSnapshotId?: string;
    layersApplied: string[];
  };
}
```

The provider may still receive only one final string, but the platform should retain the structured bundle for reproducibility and debugging.

---

## 5. Reuse of Existing Architecture

The correct direction is additive reuse.

## 5.1 Reuse the current prompt-task governance

Extend the existing prompt-task settings with new tasks such as:

- optimize_image_prompt
- review_generated_image
- classify_project_asset_visuals

This keeps image prompting under the same superadmin governance model already used for optimized user prompts.

## 5.2 Reuse the prompt execution log pattern

The existing prompt execution log model should also log image prompt optimization calls.
This provides:

- cost visibility
- provider/model traceability
- prompt quality auditing
- debugging history for failed or off-brand image outputs

## 5.3 Reuse preset modules

Instead of inventing a second preset system, extend each preset with an optional imagePromptModule.

Suggested addition to preset output metadata:

```ts
imagePromptModule?: {
  subjectPriorities: string[];
  preferredStyles: string[];
  compositionRules: string[];
  avoidRules?: string[];
}
```

This keeps website-type intelligence consistent between chat generation and image generation.

## 5.4 Reuse asset-aware context enrichment

The repository already has the right direction for asset-aware prompt enrichment.
The image pipeline should consume the same asset manager and selection policy rather than introducing a new media-context database.

---

## 6. Recommended Backend Modules

Keep the implementation modular under the application layer.

```text
apps/api/src/application/
  prompting/
    image/
      BuildImagePromptContext.ts
      OptimizeImagePrompt.ts
      composeImagePromptLayers.ts
      imagePromptTemplates.ts
      reduceImageContextBudget.ts
      persistImagePromptTrace.ts
```

### Responsibilities

- BuildImagePromptContext  
  Loads project, preset, moodboard, style profile, selected assets, selected element, and active snapshot info.

- OptimizeImagePrompt  
  Uses a task-governed LLM to rewrite the user intent into a stronger creative brief for the image model.

- composeImagePromptLayers  
  Deterministically assembles the final render prompt from the layer packet.

- reduceImageContextBudget  
  Prevents context explosion by ranking and trimming signals.

- persistImagePromptTrace  
  Stores prompt bundle version and layer trace into the asset metadata and prompt logs.

---

## 7. Integration with Focus Patch and Versioning

## 7.1 Current flow

The current UX already behaves well:

- placeholder applied immediately in the working preview
- final image replaces it when ready
- snapshot saved only when the final image is ready

This is good because it avoids polluting the version history with unstable intermediate states.

## 7.2 Recommended evolution: Media Patch

To align even more closely with focused-edit patterns, introduce a server-side media patch object.

Suggested concept:

```ts
interface MediaPatch {
  targetSelector: string;
  mediaMode: "foreground" | "background";
  assetId: string;
  cssDefaults: {
    fit: "cover" | "contain" | "auto";
    repeat: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
    opacity: number;
    filter: string;
  };
  parentSnapshotId?: string;
  promptBundleVersion?: string;
}
```

This would allow the backend to:

- apply the patch to the active snapshot consistently
- persist the resulting preview version deterministically
- preserve lineage between prompt, asset, and snapshot
- reduce client-only DOM mutation logic over time

This is effectively the media equivalent of focused patching.

---

## 8. Suggested Rollout Plan

## Wave 1 — Low-impact improvement using current patterns

Recommended first step:

1. keep the existing generate-image endpoint
2. add a dedicated image prompt optimization stage before the provider call
3. build a compact image context packet from project data and assets
4. remove technical HTML/CSS/JS noise from the image-optimization system prompt
5. log the run through the existing prompt execution logging infrastructure

This wave gives a major quality improvement with low regression risk.

## Wave 2 — Preset-driven image modules and admin governance

Then add:

- imagePromptModule per preset
- superadmin task settings for optimize_image_prompt
- per-product overrides by preset/category
- prompt preview/debug for image prompting

### Recommended implementation strategy for Wave 2

Wave 2 should be implemented as a deterministic specialization layer that sits between the generic project context and the final model adapter.

Recommended responsibilities:

1. preset-aware image direction  
   Each project preset should expose optional image rules such as:
   - preferred subject categories
   - preferred visual style and realism level
   - composition patterns
   - avoid rules
   - default negative cues

2. quality modes in the UI  
   The user should be able to choose between:
   - quick generation
   - optimized generation
   - optionally, optimize prompt first

3. prompt preview before generation  
   The workspace should allow the user to inspect:
   - original request
   - context-enriched prompt
   - final provider-ready prompt
   - estimated accessory cost for the optimization step

4. multi-image consistency support  
   Wave 2 should persist a small project-level style anchor so repeated image generations remain visually coherent across the same website.

Suggested data shape:

```ts
imagePromptModule?: {
  preferredSubjects?: string[];
  preferredStyles?: string[];
  compositionRules?: string[];
  paletteBias?: string[];
  avoidRules?: string[];
  defaultNegativePrompt?: string;
}
```

### Concrete backend strategy

The most effective backend sequence for Wave 2 is:

1. load deterministic context from project, moodboard, user profile, selected element, and assets
2. inject preset-specific image rules
3. build a normalized structured prompt bundle
4. optionally pass that bundle through an LLM optimizer
5. render the final provider-specific prompt
6. save trace, cost, and prompt lineage with the generated asset

This preserves explainability and makes the system debuggable.

## Wave 2.5 — Optional prompt optimization loop

Before or after Wave 2, an additional LLM optimization step is useful, but it should be positioned carefully.

### Recommended order

The most effective order is:

- Wave 1 and Wave 2 first build the structured context
- then the optional LLM optimizer refines that structured brief
- then the provider adapter produces the final image-model prompt

This is better than optimizing the raw user prompt alone.

### Why this is the better approach

If the LLM optimizer runs too early, it only sees the raw user message and misses:

- project identity
- moodboard direction
- preset-specific visual constraints
- selected-element role
- asset-derived inspiration

If it runs after the structured context bundle is assembled, it can produce a much stronger prompt with better brand coherence.

### Best product design recommendation

Use a hybrid strategy:

- always-on deterministic context enrichment  
  cheap, fast, stable, and reproducible

- optional user-triggered LLM prompt optimization  
  more creative and more expensive, but useful for high-value images

- optional post-generation review loop only when needed  
  use a second LLM or vision review step to suggest a retry prompt if the result is off-brief

### Suggested UX model

Add an action such as:

- Optimize image prompt

When the user clicks it:

1. compute an accessory cost estimate
2. run the optimizer task
3. show the improved prompt in a small preview panel
4. let the user accept, edit, or skip it
5. then launch the image generation

This should be logged separately from the main image-generation cost.

### Most effective optimization architecture overall

The best long-term design is therefore:

1. raw user prompt
2. Wave 1 context enrichment
3. Wave 2 preset specialization and consistency rules
4. optional LLM prompt optimizer
5. provider-specific final render prompt
6. image generation
7. optional post-generation review and retry suggestion

This gives the highest quality-to-cost ratio while keeping the system understandable and controllable.

## Wave 3 — Media patch and deeper version reproducibility

Finally add:

- server-side media patch application
- parentSnapshot linkage
- stronger trace between asset generation and visual version history
- optional consistency strategies for multi-image sets in the same project

---

## 9. Concrete Prompt Strategy Recommendation

Internally, the system should build structured guidance first and synthesize the final render prompt only at the end.

Recommended sections in the internal prompt template:

1. Subject and purpose  
   What the image must represent and why it exists in the page.

2. Brand and audience  
   What tone and brand identity it should communicate.

3. Visual art direction  
   Lighting, mood, palette, composition, realism level, lens/framing cues.

4. Layout constraints  
   Horizontal vs vertical, safe empty zones, cropping resilience, no text overlay unless requested.

5. Exclusions  
   What to avoid: random typography, watermarks, clutter, low-detail results, irrelevant objects.

6. Provider adaptation  
   Final wording style tuned for the actual image model.

This is much stronger than concatenating raw request + generic instructions.

---

## 10. Recommended Data and Trace Extensions

The following additions would keep the system coherent with the current data architecture.

### Extend asset generation metadata

Persist more structured prompt trace:

- optimizedPrompt
- finalRenderPrompt
- negativePrompt
- layersApplied
- selectedAssetIds
- selectedElementSelector
- parentSnapshotId
- presetId
- taskSettingVersion

### Extend prompt task settings

Add image-related task keys to the same governance object used today.

### Optional future collection

If image prompting becomes more strategic, create a dedicated reusable entity such as ImagePromptProfile only after the task-based governance path reaches its limit.

The system should not start there.

---

## 11. Final Recommendation

Yes — the platform should absolutely support a prompt-optimization pipeline for image generation, similar in philosophy to the chat/artifact flow.

But the right way is not to duplicate the chat system.
The right way is to:

- reuse the current prompt governance model
- reuse prompt execution logs
- reuse asset-aware enrichment
- reuse preset modules
- reuse focus/versioning patterns
- add a dedicated image prompt optimization layer and structured prompt bundle

### Recommended MVP decision

Implement Wave 1 first.
It delivers the biggest quality jump with the lowest architectural risk.

In short:

- keep the current image-generation endpoint and versioning UX
- replace the thin prompt composition with a structured image prompt pipeline
- treat image prompting as a first-class prompt task inside the existing prompting platform

That gives higher visual coherence, better reproducibility, and stronger alignment with the rest of the product architecture.
