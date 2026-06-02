import { describe, expect, it } from "vitest";
import { buildChatCompletionRequestBody } from "../chatRequestAdapter";

describe("buildChatCompletionRequestBody", () => {
    const baseInput = {
        provider: "siliconflow",
        model: "Qwen/Qwen3-8B",
        messages: [{ role: "user", content: "hello" }],
        maxTokens: 256,
        temperature: 0.4,
    };

    it("adds SiliconFlow thinking controls with the provider-native fields", () => {
        const body = buildChatCompletionRequestBody({
            ...baseInput,
            thinkingBudget: 2048,
        });

        expect(body).toMatchObject({
            model: "Qwen/Qwen3-8B",
            max_tokens: 256,
            enable_thinking: true,
            thinking_budget: 2048,
        });
        expect(body).not.toHaveProperty("thinking");
    });

    it("does not emit unsupported custom thinking payloads for OpenRouter", () => {
        const body = buildChatCompletionRequestBody({
            ...baseInput,
            provider: "openrouter",
            model: "openai/gpt-4o-mini",
            thinkingBudget: 2048,
        });

        expect(body).toMatchObject({
            model: "openai/gpt-4o-mini",
            max_tokens: 256,
        });
        expect(body).not.toHaveProperty("thinking");
        expect(body).not.toHaveProperty("thinking_budget");
    });

    it("omits SiliconFlow thinking fields for models that do not support them", () => {
        const body = buildChatCompletionRequestBody({
            ...baseInput,
            model: "Qwen/Qwen3-VL-32B-Instruct",
            thinkingBudget: 2048,
        });

        expect(body).toMatchObject({
            model: "Qwen/Qwen3-VL-32B-Instruct",
            max_tokens: 256,
        });
        expect(body).not.toHaveProperty("enable_thinking");
        expect(body).not.toHaveProperty("thinking_budget");
    });

    it("does not infer thinking support from the model name suffix alone", () => {
        const body = buildChatCompletionRequestBody({
            ...baseInput,
            model: "Qwen/Qwen3-VL-32B-Thinking",
            thinkingBudget: 2048,
        });

        expect(body).toMatchObject({
            model: "Qwen/Qwen3-VL-32B-Thinking",
            max_tokens: 256,
        });
        expect(body).not.toHaveProperty("enable_thinking");
        expect(body).not.toHaveProperty("thinking_budget");
    });

    it("uses strict JSON schema for OpenRouter models that advertise structured outputs", () => {
        const body = buildChatCompletionRequestBody({
            ...baseInput,
            provider: "openrouter",
            model: "openai/gpt-4o-mini",
            structuredOutputMode: "artifact",
            supportedParameters: ["structured_outputs"],
        });

        expect(body).toMatchObject({
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "andy_artifact_response",
                    strict: true,
                },
            },
            provider: { require_parameters: true },
        });
    });

    it("falls back to JSON mode for OpenRouter models that only advertise response_format", () => {
        const body = buildChatCompletionRequestBody({
            ...baseInput,
            provider: "openrouter",
            model: "some/model",
            structuredOutputMode: "artifact",
            supportedParameters: ["response_format"],
        });

        expect(body).toMatchObject({
            response_format: { type: "json_object" },
            provider: { require_parameters: true },
        });
    });

    it("keeps unsupported OpenRouter models selectable without forcing response_format", () => {
        const body = buildChatCompletionRequestBody({
            ...baseInput,
            provider: "openrouter",
            model: "legacy/model",
            structuredOutputMode: "artifact",
        });

        expect(body).not.toHaveProperty("response_format");
        expect(body).not.toHaveProperty("provider");
    });

    it("uses SiliconFlow JSON mode conservatively for compatible artifact models", () => {
        const compatible = buildChatCompletionRequestBody({
            ...baseInput,
            model: "MiniMaxAI/MiniMax-M2.5",
            structuredOutputMode: "artifact",
        });
        const excluded = buildChatCompletionRequestBody({
            ...baseInput,
            model: "deepseek-ai/DeepSeek-V3.2",
            structuredOutputMode: "artifact",
        });

        expect(compatible).toMatchObject({ response_format: { type: "json_object" } });
        expect(excluded).not.toHaveProperty("response_format");
    });
});
