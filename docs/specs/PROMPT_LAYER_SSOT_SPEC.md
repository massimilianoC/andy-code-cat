# Prompt Layer SSOT — Single Source of Truth for Layer Definition, Composition, Persistence, and Display

Status: **draft — approved direction, pending implementation**
Owner: platform maintainer
Supersedes the presentation/duplication aspects of: `PROMPT_LAYER_RESTRUCTURE_PLAN.md` (implemented), `PREPROMPT_ENGINE_SPEC.md` (composition flow section)
Related: `PROMPTING_SERVICE_PLATFORM_SPEC.md`, `SUPER_ADMIN_SPEC.md`, `OUTPUT_LANGUAGE_CONTROL_SPEC.md`, `DOCUMENT_CONTEXT_LAYER_SPEC.md`

---

## 1. Problem — verified drift (audit 2026-07-02)

The layer architecture exists on paper (spec) and partially in code, but there is **no 1:1 correspondence** between (a) what superadmin configures, (b) what is actually sent to the LLM, (c) what is persisted, and (d) what the frontend Prompt tab displays. Audit findings on the current codebase:

| # | Finding | Location |
|---|---------|----------|
| 1 | **Layer T is dead code**: `buildLayerT` exists with audit sentinels and `FORMAT_HINT_RULES`, but no caller ever passes `templateResolution` — Layer T is always empty in every real send and in the preview endpoint. `formatHint` travels in the Vibe brief but never reaches the composer. | `systemPromptLayers.ts:730`, grep `templateResolution:` = 0 call sites |
| 2 | **Model-level `promptTemplate` is applied in the real send but invisible in preview**: real path merges `roleModel.promptTemplate` into the Layer-E slot; the preview endpoint only passes the project `prePromptTemplate`. | `llmRoutes.ts:453-458` vs `llmRoutes.ts:758-768` |
| 3 | **The preview endpoint re-composes the prompt independently** and has drifted: missing Layer L (outputLanguage), `requestSystemPrompt`, model template, focused-mode addendum; Layer D composition diverges from the real path after the projectLayerDContext refactor. | `llmRoutes.ts:714-789` |
| 4 | **The frontend preview render silently omits layers the endpoint returns** (L, G brand, F governance); `t_template` is not even in the endpoint JSON. | `page.tsx:3504-3561` |
| 5 | **The "real sent prompt" view loses layer identity**: `splitSentPromptSections` splits on `\n\n---\n\n` and labels each section by its first line — faithful but unstructured. | `page.tsx:5749-5759` |
| 6 | **Naming is inconsistent inside the composer itself**: the doc-comment says D = pre-prompt template / E = governance; the code returns D = documentContext / E = preprompt / F = governance. | `systemPromptComposer.ts:9-16` vs `:96-101` |

Root cause: **composition logic exists in two places, layer identity is not carried in the composed prompt, and the UI has two rendering modes with different data sources.**

## 2. Goal — the four-way invariant

> One canonical layer registry. The registry drives: (1) the superadmin configuration surface, (2) the actual composed prompt sent to the provider, (3) the persisted trace in MongoDB, and (4) the frontend Prompt tab. **What you configure is what is sent, what is sent is what is stored, what is stored is what you read. No fallback views, no mocks, no re-interpretation.**

Operative rules:

- R1. Every layer is defined **once**, in code, in a canonical registry (id, key, label, order, scope, editability, default builder).
- R2. Superadmin customizations are stored in MongoDB and resolved with an explicit priority chain; when no customization exists, the code default applies. The resolution result is deterministic and inspectable.
- R3. The composed system prompt **embeds explicit layer markers** so the prompt itself is self-describing.
- R4. The exact messages sent to the provider are persisted at send time (already partially true via `promptingTrace`); the trace additionally carries the structured layer breakdown.
- R5. The frontend Prompt tab renders **only** the persisted trace (or a dry-run of the identical composition path when no generation exists yet). It never re-composes, estimates, or approximates.
- R6. A layer defined in the spec that is not wired into the composition path must be either wired or removed. No aspirational layers (current Layer T situation).

## 3. Canonical layer registry

New module: `apps/api/src/application/llm/promptLayerRegistry.ts`.

```ts
export type PromptLayerId =
    | "A"   // base constraints (platform, non-editable)
    | "L"   // output language
    | "B"   // preset output format (product template)
    | "T"   // template resolution slot (formatHint / user template)
    | "C"   // style context (moodboard + user style profile)
    | "G"   // global brand identity
    | "D"   // document/knowledge context (project assets)
    | "X"   // grounded dataset context (data-dashboard only)
    | "E"   // pre-prompt template (project config + model template)
    | "F"   // governance system prompt (superadmin per product)
    | "P"   // output budget policy (platform, non-editable)
    | "R";  // request-level system prompt override

export interface PromptLayerDefinition {
    id: PromptLayerId;
    key: string;                 // stable kebab-case key, e.g. "base-constraints"
    label: string;               // human label shown in superadmin UI and Prompt tab
    order: number;               // composition order (registry is the ONLY place order is defined)
    kind: "static-template" | "runtime-context";
    /** Who can override the layer text. "none" = platform rules, never editable. */
    editableBy: "none" | "superadmin" | "project-owner";
    /** Where the override is stored when editableBy !== "none". */
    overrideScope?: "platform-product" | "project" | "model";
    description: string;         // one-line purpose, rendered in superadmin UI
}

export const PROMPT_LAYER_REGISTRY: readonly PromptLayerDefinition[] = [ /* A..R in order */ ];
```

Notes:

- `static-template` layers (A, P, and the template text of B/T/F/E) have overridable or fixed **text**; `runtime-context` layers (C, G, D, X, L) are data-driven — their content comes from project data at request time, but their **presence, order, and framing** are still governed by the registry.
- The registry replaces the implicit ordering currently hardcoded in `composeSystemPrompt` arrays.
- The superadmin UI lists exactly this registry: non-editable layers shown read-only (with their current default text), editable layers with an override editor.

## 4. Resolution chain (MongoDB overrides)

Follow the **existing** `governanceByProduct` + `resolveXFromConfig` pattern (`PlatformConfig.ts:309-346`):

```
PlatformConfig.governanceByProduct[productKey].promptLayers?: {
    [layerKey: string]: {
        enabled?: boolean;        // hard toggle (only for layers where disabling is safe)
        template?: string;        // override text for static-template layers
        updatedAt: string;
        updatedByUserId: string;
    }
}
```

Resolution priority per layer (first match wins):

1. **Project-level config** — only for Layer E (`llm_prompt_configs.prePromptTemplate`, existing behavior).
2. **Model-level template** — `roleModel.promptTemplate` merges into E (existing behavior, now explicit in the trace as `source: "model-template"`).
3. **Product override** — `governanceByProduct[productKey].promptLayers[layerKey].template`.
4. **Platform default override** — `governanceByProduct.default.promptLayers[layerKey].template`.
5. **Code default** — the registry's default builder.

A new resolver `resolvePromptLayersFromConfig(platformConfig, productKey)` returns, for every registry layer, `{ definition, effectiveTemplate, source }` where `source ∈ "code-default" | "platform-default" | "product-override" | "project-config" | "model-template"`. This `source` is persisted in the trace and shown in both the superadmin UI and the Prompt tab.

Non-editable layers (A, P) **ignore** any stored override: they are platform safety rules (visibility-without-JS, media contract, JSON output contract). The superadmin UI shows them read-only.

## 5. Marker protocol — self-describing prompt

Generalize the existing Layer-T sentinel precedent (`<!-- LAYER_T_START source=... -->`) to every non-empty layer:

```
<!-- PF_LAYER id=A key=base-constraints source=code-default -->
...layer content...
<!-- /PF_LAYER id=A -->
```

- Emitted by the composer for **every non-empty layer**, including the user-side context blocks (focus block, artifact block) which get `PF_BLOCK` markers with the same shape.
- HTML comments are near-zero-cost for the model and double as explicit provenance anchors ("these are platform rules") that reinforce override-priority language already present in Layer A / budget policy.
- The frontend parses these markers to rebuild the accordion structure semantically from the **real sent text** — no split heuristics, no first-line labels.
- The persisted structured breakdown (§6) is the primary UI source; markers are the guarantee that the raw prompt and the breakdown can never disagree (the breakdown is derived from the same marked string at send time).

## 6. Persistence contract

Extend `LlmPromptingTrace` (contracts):

```ts
export interface LlmPromptingTraceLayer {
    id: PromptLayerId;
    key: string;
    label: string;
    source: "code-default" | "platform-default" | "product-override" | "project-config" | "model-template" | "runtime";
    chars: number;
    /** [start, end) offsets into effectiveSystemPrompt — content is NOT duplicated. */
    span: [number, number];
}

export interface LlmPromptingTrace {
    // ...existing fields...
    layers?: LlmPromptingTraceLayer[];      // system-prompt breakdown
    userBlocks?: LlmPromptingTraceLayer[];  // focus/artifact/history block breakdown of the final user message
}
```

- The trace is persisted (as today) in the conversation message metadata at send time — **the moment the provider call is made**, not recomposed later.
- Content is not duplicated: `span` offsets point into `effectiveSystemPrompt` / the final user message, keeping message documents lean while guaranteeing byte-level 1:1.

## 7. Single composition path

- `resolveContext` (llmRoutes) becomes the **only** composer entry point. It internally uses `composeSystemPromptWithLayers` (registry-driven) and returns both the composed string and the breakdown.
- `GET /projects/:id/llm/prompt-preview` is reimplemented as a **dry-run of `resolveContext`** (same inputs, no provider call, flagged `dryRun: true` in the response). The duplicated composition block (llmRoutes:714-789) is deleted.
- The dry-run accepts optional query params for the inputs that only exist at request time (`uiLanguage`, `pipelineRole`, `model`) so the preview can show exactly what the next request would send, including Layer L and the model template.
- `composeSystemPrompt` (string-only variant) is removed; all callers get the layered result.

## 8. Layer T decision

Layer T is wired for real (option chosen over removal, since template-driven guidance is part of the product vision and `TEMPLATE_SKILLS_INJECTION_PLAN.md` depends on the slot):

- The Vibe brief's `formatHint` / `templateId` is threaded into `resolveContext` as `templateResolution`.
- The chat-preview path resolves `templateResolution` from the project (persisted at project creation from the brief) so follow-up turns keep the format guidance.
- If, at implementation time, the maintainer prefers to defer this, Layer T must be **removed from the registry** rather than left silently empty (R6).

## 9. Frontend Prompt tab contract

Single renderer, two data states — same component, same structure:

1. **Last generation exists** → render `promptingTrace.layers` accordions (label + source badge + chars + content via span). Header: "PROMPT REALMENTE INVIATO — <timestamp, model, provider>". A raw-view toggle shows `effectiveSystemPrompt` verbatim.
2. **No generation yet** → call the dry-run endpoint and render the identical structure. Header: "DRY-RUN — cosa verrà inviato alla prossima richiesta". Visually distinguished (badge color), but structurally identical.

Every layer in the registry is always represented — empty layers render as collapsed "empty" rows (as the old structured view did), so the operator sees what is *not* being injected and why (source: disabled / no data).

The heuristic `splitSentPromptSections` is deleted.

## 10. Superadmin UI contract

New "Prompt Layers" section in the superadmin governance panel (per product, with `default` as the base):

- Lists the registry in composition order: id, label, description, editability, current source, effective text preview.
- Editable layers: template editor with "reset to default" (deletes the MongoDB override record — absence of record = default, per R2).
- Non-editable layers: read-only display of the code default (so the operator can *read* the platform rules that will be sent, satisfying "voglio sapere cosa sto scrivendo e cosa viene inviato").
- The panel consumes the same `resolvePromptLayersFromConfig` resolver — no separate rendering of "what would be applied".

## 11. Implementation phases

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| 1 | Backend SSOT | `promptLayerRegistry.ts`, registry-driven `composeSystemPromptWithLayers` with PF_LAYER markers, `resolvePromptLayersFromConfig`, trace extension (`layers`, `userBlocks`), `resolveContext` as single path, preview endpoint → dry-run. Tests: marker round-trip parse, resolution chain priority, byte-1:1 span integrity. |
| 2 | Frontend Prompt tab | Single renderer on trace/dry-run, delete `splitSentPromptSections`, empty-layer rows, raw toggle. |
| 3 | Superadmin overrides | `promptLayers` in `governanceByProduct`, CRUD endpoints, Prompt Layers panel. |
| 4 | Layer T wiring | Thread `templateResolution` end-to-end (or registry removal if deferred). |
| 5 | Docs alignment | Fix composer doc-comment naming, update `PREPROMPT_ENGINE_SPEC.md`, `PROMPTING_PIPELINE_AGENT_GUARDRAILS.md`, INDEX. |

Phases 1–2 alone eliminate the structural drift (findings 2–6). Phase 3 delivers the superadmin control surface. Phase 4 closes finding 1.

## 12. Invariants for agents (guardrails)

- Never add a composition call site outside `resolveContext`.
- Never render prompt content in the UI from any source other than `promptingTrace` or the dry-run endpoint.
- Never add a layer without registering it in `PROMPT_LAYER_REGISTRY` (order, label, editability, source).
- A registry layer that is not fed by the pipeline is a bug (R6) — wire it or remove it.
