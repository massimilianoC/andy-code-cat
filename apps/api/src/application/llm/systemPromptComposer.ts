import { buildBaseConstraintsLayer, buildPresetLayer } from "./systemPromptLayers";

const LAYER_SEPARATOR = "\n\n---\n\n";

/**
 * Compose the full system prompt from the 4 architectural layers + budget policy.
 *
 * Layer A — Base constraints (always present)
 * Layer B — Preset output format (only when presetId is set)
 * Layer C — Style context block (from buildStyleContextBlock)
 * Layer D — Pre-prompt template (user-configurable per project)
 * Budget policy — Token / format rules (always present)
 * Request override — Optional per-request system prompt from the chat call
 *
 * Empty layers are omitted (no double separators).
 */
export function composeSystemPrompt(opts: {
    presetId?: string | null;
    styleBlock?: string;
    prePromptTemplate?: string;
    outputBudgetPolicy?: string;
    requestSystemPrompt?: string;
}): string {
    return [
        buildBaseConstraintsLayer(),
        buildPresetLayer(opts.presetId),
        opts.styleBlock ?? "",
        opts.prePromptTemplate ?? "",
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
    layerC: string;
    layerD: string;
    budgetPolicy: string;
    composed: string;
}

/**
 * Same as composeSystemPrompt but also returns each layer separately.
 * Used by the GET /v1/projects/:id/llm/prompt-preview debug endpoint.
 */
export function composeSystemPromptWithLayers(opts: {
    presetId?: string | null;
    styleBlock?: string;
    prePromptTemplate?: string;
    outputBudgetPolicy?: string;
    requestSystemPrompt?: string;
}): ResolvedPromptLayers {
    const layerA = buildBaseConstraintsLayer();
    const layerB = buildPresetLayer(opts.presetId);
    const layerC = opts.styleBlock ?? "";
    const layerD = opts.prePromptTemplate ?? "";
    const budgetPolicy = opts.outputBudgetPolicy ?? "";

    const composed = [layerA, layerB, layerC, layerD, budgetPolicy, opts.requestSystemPrompt ?? ""]
        .filter(Boolean)
        .join(LAYER_SEPARATOR)
        .trim();

    return { layerA, layerB, layerC, layerD, budgetPolicy, composed };
}
