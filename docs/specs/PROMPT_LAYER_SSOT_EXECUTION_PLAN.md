# Prompt Layer SSOT — Execution Plan (agent-executable)

> **Superseded by [../SSOT_STATUS.md](../SSOT_STATUS.md) (2026-08-31).** The document this file
> forwarded to for future implementation has itself been retired; go to `SSOT_STATUS.md` instead.

Status: **historical execution record — do not execute as-is**
Parent spec: [PROMPT_LAYER_SSOT_SPEC.md](PROMPT_LAYER_SSOT_SPEC.md) (rationale, invariants).
Superseded for future implementation by: [PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md](PROMPT_EXECUTION_SSOT_REFACTOR_ANALYSIS_2026-08-18.md).
Historical baseline commit: `5d10f14` — "feat(prompt): SSOT groundwork".

This file documents the earlier implementation sequence and its original anchors. Its status
and some instructions predate the live implementation; preserve it for audit context, but do
not use it as an agent-executable plan. New work must follow the active remediation plan above.

---

## Non-negotiable rules (read before starting)

1. **Reuse existing structures.** Never create a parallel registry/storage for something that
   already exists. The layer registry is `PROMPT_LAYER_DESCRIPTORS` in
   `apps/api/src/application/llm/systemPromptComposer.ts` (already implemented). Layer overrides
   live where they already live: preset admin (B), `user_templates` (T), brand assets (G),
   `llm_prompt_configs` + model catalog `promptTemplate` (E), `governanceByProduct[productKey].promptTemplates` (F).
2. **One composition path.** After Step 1, `composeSystemPromptWithLayers` must be called from
   exactly TWO places in the whole API: `resolveContext()` and nowhere else (the preview endpoint
   reuses `resolveContext`). The deprecated `composeSystemPrompt` wrapper must have ZERO call
   sites at the end (Step 5 deletes it).
3. **The UI renders only persisted/dry-run data.** No client-side recomposition, no split
   heuristics, no fallback mock text.
4. **Additive contracts.** Never rename or remove existing response fields consumed elsewhere,
   EXCEPT the legacy preview-response `layers.{a_baseConstraints,...}` object and the frontend
   `splitSentPromptSections` helper, which Steps 3–4 explicitly replace together.
5. Run `npx tsc --noEmit -p apps/api/tsconfig.json` after every step. It must exit 0.

## Already done (baseline `5d10f14` — verify, do not redo)

- `systemPromptComposer.ts`: `PROMPT_LAYER_DESCRIPTORS` (order A,L,B,S,T,C,G,D,X,E,F,P,R),
  `PromptLayerTraceEntry`, PF_LAYER marker wrapping, span breakdown in `layers`, reserved empty
  Layer S (`skillsLayer` opt, always "" until TEMPLATE_SKILLS_INJECTION_PLAN Wave 3), Layer R
  (request override), `sources` opt, deprecated `composeSystemPrompt` wrapper.
- `PlatformConfig.ts`: `resolveGovernanceSystemPromptFromConfig(platformConfig, productKey, field)`
  → `{ value, source }` with `default`→product chain.
- `packages/contracts/src/llm.ts`: `LlmPromptingTraceLayer`, `LlmPromptingTrace.layers?`.
- `Project.ts` / `ProjectRepository.ts` / `MongoProjectRepository.ts`: `templateResolution` field
  (`ProjectTemplateResolution`) + `update()` plumbing.
- `vibecoreRoutes.ts` classify handler: persists `templateResolution` (source `layer_phi`) when
  `result.formatHint && !result.skipped`.

Verify with: `git show 5d10f14 --stat` and `npx tsc --noEmit -p apps/api/tsconfig.json`.

---

## STEP 1 — Wire `resolveContext` to the layered composer

File: `apps/api/src/presentation/http/routes/llmRoutes.ts`

### 1a. Imports

- In the import from `"../../../application/llm/systemPromptComposer"`, remove `composeSystemPrompt`
  and add `composeSystemPromptWithLayers` (if not already present) and the type
  `PromptLayerTraceEntry`. Also import type `TemplateResolution` from the same module.
- In the import from `"../../../domain/entities/PlatformConfig"`, add
  `resolveGovernanceSystemPromptFromConfig`.

### 1b. `LlmRuntimeContext` type

Anchor: `type LlmRuntimeContext = {` (near top of file, ~line 61).
Add one field to the type:

```ts
    /** Structured breakdown of systemPrompt — same spans, persisted in promptingTrace.layers. */
    promptLayers: PromptLayerTraceEntry[];
```

### 1c. Governance resolution

Anchor (inside `resolveContext`, ~line 357):

```ts
        const governanceTemplates =
            (project?.presetId ? platformConfig?.governanceByProduct?.[project.presetId]?.promptTemplates : undefined)
            ?? platformConfig?.governanceByProduct?.["default"]?.promptTemplates;
        const governanceSystemPrompt = governanceTemplates?.generationSystem || undefined;
        const governanceFocusedBasePrompt = governanceTemplates?.focusedEditSystem || undefined;
        const productKey = project?.presetId ?? "default";
```

Replace those lines with (note: `productKey` must be computed BEFORE the resolver calls):

```ts
        const productKey = project?.presetId ?? "default";
        const governanceResolved = resolveGovernanceSystemPromptFromConfig(platformConfig, productKey, "generationSystem");
        const governanceSystemPrompt = governanceResolved.value || undefined;
        const governanceFocusedBasePrompt = resolveGovernanceSystemPromptFromConfig(platformConfig, productKey, "focusedEditSystem").value || undefined;
```

### 1d. Layer T from the persisted project signal

Anchor: the line `const brandContext = await resolveBrandContext.execute(` (~line 460).
Immediately BEFORE that line, insert:

```ts
        // Layer T: re-inject the Layer Φ format signal persisted at classify time.
        // buildLayerT self-suppresses when presetId is set (Layer B already covers it).
        const templateResolution: TemplateResolution | null = project?.templateResolution
            ? {
                presetId: project.presetId ?? null,
                userTemplateId: null,
                formatHint: (project.templateResolution.formatHint ?? null) as TemplateResolution["formatHint"],
                confidence: project.templateResolution.confidence,
                reasoning: project.templateResolution.reasoning,
                source: project.templateResolution.source,
            }
            : null;
```

### 1e. Composition call

Anchor (~line 465):

```ts
        const systemPrompt = composeSystemPrompt({
```

Replace the whole call (up to and including the closing `});`) with:

```ts
        const layerSources: Partial<Record<import("../../../application/llm/systemPromptComposer").PromptLayerId, string>> = {
            B: project?.presetId ? "preset-catalog" : "code-default",
            T: templateResolution?.formatHint ? "project-config" : "empty",
            E: promptConfig.enabled && promptConfig.prePromptTemplate && roleModel?.promptTemplate
                ? "project-config+model-template"
                : roleModel?.promptTemplate ? "model-template"
                    : promptConfig.enabled && promptConfig.prePromptTemplate ? "project-config" : "empty",
            F: governanceResolved.source,
            R: input.systemPrompt ? "request" : "empty",
        };
        const composedLayers = composeSystemPromptWithLayers({
            presetId: project?.presetId,
            presetLayer,
            templateResolution,
            styleBlock,
            brandContextLayer: brandContextLayer || undefined,
            documentContextLayer: documentContextLayer || undefined,
            dataContextLayer: dataContextLayer || undefined,
            prePromptTemplate: effectivePrePromptTemplate || undefined,
            outputBudgetPolicy: buildOutputBudgetPolicy(),
            requestSystemPrompt: input.systemPrompt,
            governanceSystemPrompt,
            outputLanguage: input.outputLanguage ?? null,
            sources: layerSources,
        });
        const systemPrompt = composedLayers.composed;
```

IMPORTANT: this block references `roleModel`, which is currently declared AFTER the
`composeSystemPrompt` call site? NO — check: `roleModel` is declared at ~line 444, BEFORE the
composition. `effectivePrePromptTemplate` at ~line 453. Both are in scope. Do not move them.

### 1f. Return sites

There are TWO `return {` statements at the end of `resolveContext` (~lines 491 and 505). Add to
BOTH object literals:

```ts
                promptLayers: composedLayers.layers,
```

### Acceptance for Step 1

- `grep -n "composeSystemPrompt(" apps/api/src` → the ONLY match inside `llmRoutes.ts` must be
  `composeSystemPromptWithLayers(`. (Other files: none expected; if `OptimizeUserPrompt.ts` or
  others match `composeSystemPrompt(`, STOP and report — do not modify them.)
- `npx tsc --noEmit -p apps/api/tsconfig.json` → exit 0.

---

## STEP 2 — Persist `layers` in the promptingTrace at both send sites

File: `apps/api/src/presentation/http/routes/llmRoutes.ts`

There are exactly TWO sites building a `promptingTrace:` object for chat-preview
(buffered ~line 1076, streaming ~line 1598). Anchor for both:

```ts
                promptingTrace: {
                    originalUserMessage: body.message,
                    promptConfigId: context.promptConfigId,
                    prePromptTemplate: context.prePromptTemplate,
                    effectiveSystemPrompt: effectiveSystemPrompt,
                    messagesSentToLlm: messages,
                    focusContext: body.focusContext,
                },
```

(the streaming site may use a slightly different local name for the system prompt — same shape).

In BOTH, add ONE field after `effectiveSystemPrompt`:

```ts
                    layers: effectiveSystemPrompt === context.systemPrompt ? context.promptLayers : undefined,
```

RATIONALE (do not skip the guard): in focused-edit mode the route swaps/extends the system prompt
(`governanceFocusedSystemPrompt` / focused addendum), so the spans in `context.promptLayers` would
NOT match the trace text. The breakdown is only attached when the persisted
`effectiveSystemPrompt` is byte-identical to the composed prompt. Focused mode keeps the raw view
only — that is correct and expected.

If the local variable name at a site differs (e.g. `effectiveSystem`), adapt the guard to compare
THAT variable against `context.systemPrompt`.

### Acceptance for Step 2

- Both `promptingTrace` literals contain the guarded `layers` field.
- `npx tsc --noEmit -p apps/api/tsconfig.json` → exit 0.

---

## STEP 3 — Rewrite `/llm/prompt-preview` as a dry-run of `resolveContext`

File: `apps/api/src/presentation/http/routes/llmRoutes.ts`
Anchor: `router.get("/projects/:projectId/llm/prompt-preview"` (~line 714).

Replace the ENTIRE handler body (from `try {` to the matching `} catch (error) {`) with:

```ts
        try {
            const uiLanguage = typeof req.query.uiLanguage === "string" ? req.query.uiLanguage : undefined;
            const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
            const model = typeof req.query.model === "string" ? req.query.model : undefined;
            // Dry-run of the EXACT generation path: same resolver, same composer, no provider call.
            const context = await resolveContext({
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                pipelineRole: "coding",
                provider,
                model,
                outputLanguage: uiLanguage,
            });
            res.json({
                dryRun: true,
                presetId: null, // kept for backward-compat; presetId is visible in layers[].source
                provider: context.providerCatalog.provider,
                model: context.modelId,
                effectiveSystemPrompt: context.systemPrompt,
                layers: context.promptLayers,
                tokenEstimate: Math.ceil(context.systemPrompt.length / 4),
            });
        } catch (error) {
```

Then DELETE the now-unused locals this replacement orphans. After the change run:
`npx tsc --noEmit` — every "declared but never read" error in llmRoutes.ts caused by this step
must be fixed by deleting the dead code (candidates: `extractInlineDocumentLayerD` import,
`buildProjectKnowledgeLayer` import, `buildPresetLayerFromPreset` import IF now unused — check
each import is truly unused across the file before removing it).

NOTE on `resolveContext` input type: it requires `pipelineRole` (use literal `"coding"`) and
accepts optional `provider/model/capability/assetIds/systemPrompt/outputLanguage`. Do NOT add new
parameters to it.

### Acceptance for Step 3

- The handler contains NO `composeSystemPromptWithLayers` call and NO layer-building calls
  (`buildStyleContextBlock`, `buildBrandDocumentLayerD`, etc.) — it only calls `resolveContext`.
- Response JSON has `dryRun, effectiveSystemPrompt, layers, tokenEstimate, provider, model`.
- The legacy `layers.{a_baseConstraints,...}` shape is GONE from the response.
- `npx tsc --noEmit -p apps/api/tsconfig.json` → exit 0.

---

## STEP 4 — Frontend: single Prompt renderer from `layers[]`

Directory: `apps/web`. Find the consumers:

```
grep -rn "a_baseConstraints" apps/web
grep -rn "splitSentPromptSections" apps/web
grep -rn "prompt-preview" apps/web/lib
```

### 4a. API client type

In the api client module that types the prompt-preview response (hit of the third grep), replace
the old response type with:

```ts
export interface PromptLayerEntryDto {
    id: string;
    key: string;
    label: string;
    source: string;
    chars: number;
    span: [number, number];
}

export interface PromptPreviewResponse {
    dryRun: true;
    provider: string;
    model: string;
    effectiveSystemPrompt: string;
    layers: PromptLayerEntryDto[];
    tokenEstimate: number;
}
```

If the client function passes no params today, extend it to optionally pass
`uiLanguage`, `provider`, `model` as query params (all optional).

### 4b. Single renderer component

Create `apps/web/components/PromptLayersView.tsx` (client component). Exact contract:

```tsx
interface PromptLayersViewProps {
    /** "sent" = persisted trace of a real generation; "dry-run" = preview of next request. */
    mode: "sent" | "dry-run";
    /** Full system prompt text (trace.effectiveSystemPrompt or preview.effectiveSystemPrompt). */
    fullText: string;
    /** Structured breakdown; entries with chars === 0 are rendered as collapsed "not injected" rows. */
    layers: PromptLayerEntryDto[];
    /** Header metadata line (model, provider, timestamp) — already formatted by the caller. */
    subtitle?: string;
}
```

Behavior (implement exactly this, nothing more):

1. Header row: badge `PROMPT REALMENTE INVIATO` (mode "sent", green) or
   `DRY-RUN — PROSSIMA RICHIESTA` (mode "dry-run", amber) + `subtitle` + a `Raw` toggle button.
2. Raw toggle ON → render `fullText` verbatim in a `<pre>` (monospace, scrollable). Nothing else.
3. Raw toggle OFF (default) → one accordion row per entry of `layers`, in array order:
   - Row header: `label` + source chip (`source`) + `chars` count (`0 → "non iniettato"`, row
     disabled/collapsed, muted style).
   - Row body (expandable only when `chars > 0`): `<pre>` with
     `fullText.slice(span[0], span[1])`.
   - NO regex parsing, NO splitting on separators, NO trimming of the sliced content.
4. No fetches inside the component — data comes via props.

### 4c. Wire the two states

In the project page (hits of greps above, likely `apps/web/app/projects/[id]/page.tsx`):

1. Where the Prompt tab currently renders the last generation's trace via
   `splitSentPromptSections(...)`: replace with
   `<PromptLayersView mode="sent" fullText={trace.effectiveSystemPrompt} layers={trace.layers ?? []} subtitle={...} />`.
   When `trace.layers` is undefined/empty (legacy or focused-mode trace), the component still
   works: pass `layers={[]}` and default the Raw toggle to ON in that case (add an optional prop
   `defaultRaw?: boolean` and pass `defaultRaw={!trace.layers?.length}`).
2. Where the preview/structured view currently renders `a_baseConstraints` etc.: replace with a
   fetch of the new preview response + `<PromptLayersView mode="dry-run" ...>`.
3. DELETE `splitSentPromptSections` and every rendering branch that read the legacy
   `layers.a_baseConstraints` shape. `grep -rn "a_baseConstraints\|splitSentPromptSections" apps/web`
   must return 0 hits at the end.

### Acceptance for Step 4

- `npx tsc --noEmit -p apps/web/tsconfig.json` (or the repo's web typecheck script) → exit 0.
- Greps in 4c.3 return zero hits.
- Both tab states render through the SAME component.

---

## STEP 5 — Tests + deprecated-wrapper removal

### 5a. Create `apps/api/src/application/llm/__tests__/systemPromptComposer.ssot.test.ts`

Exact content:

```ts
import { describe, expect, it } from "vitest";

process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

async function loadComposer() {
    return import("../systemPromptComposer");
}

describe("composeSystemPromptWithLayers — SSOT contract", () => {
    it("returns one entry per descriptor, in registry order, including empty layers", async () => {
        const { composeSystemPromptWithLayers, PROMPT_LAYER_DESCRIPTORS } = await loadComposer();
        const result = composeSystemPromptWithLayers({});
        expect(result.layers.map((l) => l.id)).toEqual(PROMPT_LAYER_DESCRIPTORS.map((d) => d.id));
        const emptyEntries = result.layers.filter((l) => l.chars === 0);
        for (const entry of emptyEntries) {
            expect(entry.source).toBe("empty");
            expect(entry.span[0]).toBe(entry.span[1]);
        }
    });

    it("spans are byte-exact slices of composed, wrapped in PF_LAYER markers", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({
            prePromptTemplate: "PROJECT TEMPLATE CONTENT",
            governanceSystemPrompt: "GOVERNANCE CONTENT",
            outputBudgetPolicy: "BUDGET CONTENT",
            outputLanguage: "it",
        });
        for (const layer of result.layers.filter((l) => l.chars > 0)) {
            const slice = result.composed.slice(layer.span[0], layer.span[1]);
            expect(slice.startsWith(`<!-- PF_LAYER id=${layer.id} `)).toBe(true);
            expect(slice.endsWith(`<!-- /PF_LAYER id=${layer.id} -->`)).toBe(true);
        }
    });

    it("keeps Layer S empty unless the resolver passes filesystem skills", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({ prePromptTemplate: "x" });
        const layerS = result.layers.find((l) => l.id === "S")!;
        expect(layerS.chars).toBe(0);
        expect(result.composed).not.toContain("PF_LAYER id=S");
    });

    it("honours caller-provided sources and defaults the rest", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({
            governanceSystemPrompt: "GOV",
            sources: { F: "product-override" },
        });
        expect(result.layers.find((l) => l.id === "F")!.source).toBe("product-override");
        expect(result.layers.find((l) => l.id === "A")!.source).toBe("code-default");
    });

    it("emits the request override (Layer R) last", async () => {
        const { composeSystemPromptWithLayers } = await loadComposer();
        const result = composeSystemPromptWithLayers({ requestSystemPrompt: "REQ OVERRIDE" });
        const nonEmpty = result.layers.filter((l) => l.chars > 0);
        expect(nonEmpty[nonEmpty.length - 1]!.id).toBe("R");
        expect(result.composed.trimEnd().endsWith("<!-- /PF_LAYER id=R -->")).toBe(true);
    });
});
```

### 5b. Delete the deprecated wrapper

In `systemPromptComposer.ts`, delete the `composeSystemPrompt` function (the `@deprecated` one)
ONLY IF `grep -rn "composeSystemPrompt(" apps/api/src | grep -v WithLayers` returns zero hits.
If it returns hits, leave the wrapper and list the hits in your final report.

### 5c. Run

```
npm run test -w apps/api -- systemPromptComposer
npm run test -w apps/api -- llmMessageBuilder.mediaPolicy
npx tsc --noEmit -p apps/api/tsconfig.json
```

All must pass. The mediaPolicy test asserts `layers.composed.indexOf(layers.layerE) < indexOf(budgetPolicy)`
— this still holds with markers (raw layer text is contained inside the marked block).

---

## STEP 6 — Docs alignment (text-only)

1. `docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md` — append a rule block:
   composition happens ONLY in `resolveContext` via `composeSystemPromptWithLayers`;
   every new layer MUST be added to `PROMPT_LAYER_DESCRIPTORS`; the UI renders ONLY
   `promptingTrace.layers` / the dry-run endpoint; Layer S is the template-skills slot and is
   populated by `resolveFilesystemTemplateSkills` when a preset-specific folder exists.
2. `docs/specs/PROMPT_LAYER_SSOT_SPEC.md` — change Status line to
   `implemented (phases 1-2) — see PROMPT_LAYER_SSOT_EXECUTION_PLAN.md for the executed step list`,
   and in §3 add a note that the registry was realized as `PROMPT_LAYER_DESCRIPTORS` inside
   `systemPromptComposer.ts` (reuse-existing decision) instead of a new `promptLayerRegistry.ts` file,
   and that Layer S was added to the registry as the template-skills slot.
3. `docs/INDEX.md` — this file is already linked; verify the row exists (added at plan creation).
4. `docs/specs/PREPROMPT_ENGINE_SPEC.md` — add a short "Superseded composition flow" note at the top
   pointing to PROMPT_LAYER_SSOT_SPEC.md. Do not rewrite the document.

---

## Final verification & commit

1. `npx tsc --noEmit -p apps/api/tsconfig.json` → 0
2. web typecheck → 0
3. `npm run test -w apps/api` → green (pre-existing failures unrelated to prompt files: report, don't fix)
4. Manual smoke (optional if a local stack is running): GET
   `/v1/projects/<id>/llm/prompt-preview` returns `dryRun:true` + `layers[]` with spans that slice
   correctly against `effectiveSystemPrompt`.
5. Commit (Conventional Commits, one commit):
   `feat(prompt): 1:1 layer trace — resolveContext single path, dry-run preview, layered Prompt tab`
   Body: list Steps 1–6. Do NOT push, do NOT open PRs, do NOT touch main/develop.

## Out of scope — do NOT touch

- `OptimizeUserPrompt` trace shape (separate optimizer pipeline).
- Any TemplateSkill entity/collection (Layer S stays empty — plan not approved for implementation).
- Superadmin governance UI (`apps/web/app/admin/governance/page.tsx`) — it already edits Layer F
  storage (`promptTemplates.generationSystem`); no changes needed.
- Streaming SSE protocol, media resolution, cost ledger.
