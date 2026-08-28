import {
    PROMPT_LAYER_DESCRIPTORS,
    type PromptLayerTraceEntry,
} from "./systemPromptComposer";

interface ProviderMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * Enforces PP-021 immediately before provider send. A trace is rejected if it
 * cannot describe the exact system message and every registered layer.
 */
export function assertPromptTraceParity(input: {
    effectiveSystemPrompt: string;
    layers: readonly PromptLayerTraceEntry[];
    messagesSentToLlm: readonly ProviderMessage[];
}): void {
    const systemMessage = input.messagesSentToLlm.find((message) => message.role === "system");
    if (!systemMessage || systemMessage.content !== input.effectiveSystemPrompt) {
        throw new Error("PP-021 trace parity failure: provider system message differs from effectiveSystemPrompt");
    }

    const expectedIds = PROMPT_LAYER_DESCRIPTORS.map((descriptor) => descriptor.id);
    const actualIds = input.layers.map((layer) => layer.id);
    if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
        throw new Error("PP-021 trace parity failure: layer registry is incomplete or out of order");
    }

    for (const [index, layer] of input.layers.entries()) {
        const descriptor = PROMPT_LAYER_DESCRIPTORS[index]!;
        const [start, end] = layer.span;
        if (layer.key !== descriptor.key || layer.label !== descriptor.label) {
            throw new Error(`PP-021 trace parity failure: descriptor mismatch for Layer ${layer.id}`);
        }
        if (start < 0 || end < start || end > input.effectiveSystemPrompt.length) {
            throw new Error(`PP-021 trace parity failure: invalid span for Layer ${layer.id}`);
        }
        if (layer.chars === 0) {
            if (layer.source !== "empty" || start !== end) {
                throw new Error(`PP-021 trace parity failure: invalid empty Layer ${layer.id}`);
            }
            continue;
        }
        if (layer.source === "empty") {
            throw new Error(`PP-021 trace parity failure: non-empty Layer ${layer.id} has empty source`);
        }
        const slice = input.effectiveSystemPrompt.slice(start, end);
        const openMarker = `<!-- PF_LAYER id=${layer.id} key=${layer.key} -->`;
        const closeMarker = `<!-- /PF_LAYER id=${layer.id} -->`;
        if (!slice.startsWith(`${openMarker}\n`) || !slice.endsWith(`\n${closeMarker}`)) {
            throw new Error(`PP-021 trace parity failure: span mismatch for Layer ${layer.id}`);
        }
        const content = slice.slice(openMarker.length + 1, -(closeMarker.length + 1));
        if (content.length !== layer.chars) {
            throw new Error(`PP-021 trace parity failure: char count mismatch for Layer ${layer.id}`);
        }
    }
}
