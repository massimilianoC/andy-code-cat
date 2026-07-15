import { describe, expect, it } from "vitest";

process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

async function loadPromptTraceModules() {
    const [{ composeSystemPromptWithLayers }, { assertPromptTraceParity }, { buildMessagesWithHistory }] = await Promise.all([
        import("../systemPromptComposer"),
        import("../promptTraceParity"),
        import("../llmMessageBuilder"),
    ]);
    return { composeSystemPromptWithLayers, assertPromptTraceParity, buildMessagesWithHistory };
}

describe("assertPromptTraceParity — PP-021", () => {
    it("accepts exact provider messages with every registered layer, including empty rows", async () => {
        const { composeSystemPromptWithLayers, assertPromptTraceParity, buildMessagesWithHistory } = await loadPromptTraceModules();
        const composed = composeSystemPromptWithLayers({
            presetId: "form",
            focusedModeLayer: "FOCUSED PROTOCOL",
            sources: { V: "preset-capability", Q: "focused-mode" },
        });
        const { messages } = buildMessagesWithHistory(
            composed.composed,
            "Edit the selected element",
            [{ role: "assistant", content: "Previous answer" }],
        );
        expect(messages[0]).toEqual({ role: "system", content: composed.composed });
        expect(() => assertPromptTraceParity({
            effectiveSystemPrompt: composed.composed,
            layers: composed.layers,
            messagesSentToLlm: messages,
        })).not.toThrow();
    });

    it("rejects post-composition additions and missing registry rows", async () => {
        const { composeSystemPromptWithLayers, assertPromptTraceParity } = await loadPromptTraceModules();
        const composed = composeSystemPromptWithLayers({ focusedModeLayer: "FOCUSED PROTOCOL" });
        expect(() => assertPromptTraceParity({
            effectiveSystemPrompt: composed.composed,
            layers: composed.layers,
            messagesSentToLlm: [{ role: "system", content: `${composed.composed}\nUNTRACKED` }],
        })).toThrow("provider system message differs");
        expect(() => assertPromptTraceParity({
            effectiveSystemPrompt: composed.composed,
            layers: composed.layers.filter((layer) => layer.id !== "V"),
            messagesSentToLlm: [{ role: "system", content: composed.composed }],
        })).toThrow("layer registry is incomplete");
    });

    it("rejects altered descriptor metadata and char counts", async () => {
        const { composeSystemPromptWithLayers, assertPromptTraceParity } = await loadPromptTraceModules();
        const composed = composeSystemPromptWithLayers({ focusedModeLayer: "FOCUSED PROTOCOL" });
        const layerQIndex = composed.layers.findIndex((layer) => layer.id === "Q");
        const wrongDescriptor = composed.layers.map((layer, index) => index === layerQIndex
            ? { ...layer, key: "unregistered-key" }
            : layer);
        const wrongChars = composed.layers.map((layer, index) => index === layerQIndex
            ? { ...layer, chars: layer.chars + 1 }
            : layer);
        const messages = [{ role: "system" as const, content: composed.composed }];

        expect(() => assertPromptTraceParity({
            effectiveSystemPrompt: composed.composed,
            layers: wrongDescriptor,
            messagesSentToLlm: messages,
        })).toThrow("descriptor mismatch");
        expect(() => assertPromptTraceParity({
            effectiveSystemPrompt: composed.composed,
            layers: wrongChars,
            messagesSentToLlm: messages,
        })).toThrow("char count mismatch");
    });
});
