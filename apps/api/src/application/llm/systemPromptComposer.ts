import { buildBaseConstraintsLayer, buildLayerT, buildPresetLayer, type TemplateResolution } from "./systemPromptLayers";
export type { TemplateResolution };

const LAYER_SEPARATOR = "\n\n---\n\n";

/**
 * Compose the full system prompt from the architectural layers + budget policy.
 *
 * Layer A — Base constraints (always present)
 * Layer B — Preset output format (only when presetId is set)
 * Layer T — Template resolution slot (Layer Φ output: formatHint or userTemplate preprompt)
 * Layer C — Style context block (from buildStyleContextBlock)
 * Layer D — Pre-prompt template (user-configurable per project)
 * Layer E — Governance system prompt (operator-injected via platform config)
 * Budget policy — Token / format rules (always present)
 * Request override — Optional per-request system prompt from the chat call
 *
 * Empty layers are omitted (no double separators).
 */
export function composeSystemPrompt(opts: {
    presetId?: string | null;
    presetLayer?: string;
    templateResolution?: TemplateResolution | null;
    userTemplatePreprompt?: string;
    styleBlock?: string;
    brandContextLayer?: string;
    documentContextLayer?: string;
    dataContextLayer?: string;
    prePromptTemplate?: string;
    outputBudgetPolicy?: string;
    requestSystemPrompt?: string;
    governanceSystemPrompt?: string;
}): string {
    const layerT = buildLayerT(opts.templateResolution, { userTemplatePreprompt: opts.userTemplatePreprompt });
    return [
        buildBaseConstraintsLayer(),
        opts.presetLayer ?? buildPresetLayer(opts.presetId),
        layerT,
        opts.styleBlock ?? "",
        opts.brandContextLayer ?? "",
        opts.documentContextLayer ?? "",
        opts.dataContextLayer ?? "",
        opts.prePromptTemplate ?? "",
        opts.governanceSystemPrompt ?? "",
        opts.outputBudgetPolicy ?? "",
        opts.requestSystemPrompt ?? "",
    ]
        .filter(Boolean)
        .join(LAYER_SEPARATOR)
        .trim();
}

export interface ResolvedPromptLayers {
    layerA: string;
    layerB: string;
    layerT: string;
    layerC: string;
    layerG: string;
    layerD: string;
    layerX: string;
    layerE: string;
    layerF: string;
    budgetPolicy: string;
    composed: string;
}

/**
 * Same as composeSystemPrompt but also returns each layer separately.
 * Used by the GET /v1/projects/:id/llm/prompt-preview debug endpoint.
 */
export function composeSystemPromptWithLayers(opts: {
    presetId?: string | null;
    presetLayer?: string;
    templateResolution?: TemplateResolution | null;
    userTemplatePreprompt?: string;
    styleBlock?: string;
    brandContextLayer?: string;
    documentContextLayer?: string;
    dataContextLayer?: string;
    prePromptTemplate?: string;
    outputBudgetPolicy?: string;
    requestSystemPrompt?: string;
    governanceSystemPrompt?: string;
}): ResolvedPromptLayers {
    const layerA = buildBaseConstraintsLayer();
    const layerB = opts.presetLayer ?? buildPresetLayer(opts.presetId);
    const layerT = buildLayerT(opts.templateResolution, { userTemplatePreprompt: opts.userTemplatePreprompt });
    const layerC = opts.styleBlock ?? "";
    const layerG = opts.brandContextLayer ?? "";
    const layerD = opts.documentContextLayer ?? "";
    const layerX = opts.dataContextLayer ?? "";
    const layerE = opts.prePromptTemplate ?? "";
    const layerF = opts.governanceSystemPrompt ?? "";
    const budgetPolicy = opts.outputBudgetPolicy ?? "";

    const composed = [layerA, layerB, layerT, layerC, layerG, layerD, layerX, layerE, layerF, budgetPolicy, opts.requestSystemPrompt ?? ""]
        .filter(Boolean)
        .join(LAYER_SEPARATOR)
        .trim();

    return { layerA, layerB, layerT, layerC, layerG, layerD, layerX, layerE, layerF, budgetPolicy, composed };
}
