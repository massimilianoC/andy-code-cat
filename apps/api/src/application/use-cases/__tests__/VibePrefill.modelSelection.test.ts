import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        vibeClassifierEnabled: true,
        providerApiKeys: {},
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { VibePrefill } from "../VibePrefill";

/**
 * Model-selection characterization coverage for VibePrefill.ts, following the same
 * mocking pattern as VibeClassify.test.ts and OptimizeUserPrompt.test.ts. VibePrefill had no
 * dedicated execute()-path test before this refactor (only parsePrefillResponse.test.ts covered
 * response parsing) — these assertions pin the pre-refactor inline cascade's (provider, model)
 * output exactly, now that the resolution has moved to resolveModelSelection().
 */

function defaultCatalog() {
    return {
        source: "env",
        providers: [{
            provider: "siliconflow",
            baseUrl: "https://llm.test/v1",
            apiType: "openai-compatible",
            authType: "none",
            isActive: true,
            models: [{
                id: "MiniMaxAI/MiniMax-M3",
                provider: "siliconflow",
                role: "dialogue",
                capabilities: ["chat"],
                isDefault: true,
                isFallback: false,
                isActive: true,
            }],
            createdAt: new Date(),
            updatedAt: new Date(),
        }],
    };
}

function createUseCase(opts?: { platformConfig?: unknown; catalog?: unknown }) {
    const platformConfigRepository = { get: vi.fn(async () => opts?.platformConfig ?? null) };
    const getLlmCatalog = { execute: vi.fn(async () => opts?.catalog ?? defaultCatalog()) };
    return {
        useCase: new VibePrefill(platformConfigRepository as any, getLlmCatalog as any),
    };
}

function stubLlm() {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

describe("VibePrefill — model resolution (resolveModelSelection pin)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("honors a request-override provider+model present in the catalog", async () => {
        const fetchMock = stubLlm();
        const catalog = {
            source: "env",
            providers: [
                ...defaultCatalog().providers,
                {
                    provider: "openrouter",
                    baseUrl: "https://llm.test/openrouter/v1",
                    apiType: "openai-compatible",
                    authType: "none",
                    isActive: true,
                    models: [{
                        id: "Qwen/Qwen3-32B",
                        provider: "openrouter",
                        role: "dialogue",
                        capabilities: ["chat"],
                        isDefault: true,
                        isFallback: false,
                        isActive: true,
                    }],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        };
        const { useCase } = createUseCase({ catalog });

        await useCase.execute({ prompt: "Build a jazz club website", provider: "openrouter", model: "Qwen/Qwen3-32B" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("Qwen/Qwen3-32B");
    });

    // BEHAVIOUR CHANGE, deliberate. This test used to assert the fall-through as correct, and in
    // doing so it pinned a live defect: a model the caller named but that is not in the active
    // catalog was quietly replaced, so the brief came back written by a model the user never
    // chose while the pipeline lock froze yet another one. The rule is now the same everywhere —
    // honour the request or refuse it, never substitute — and for this use case the refusal
    // travels through its existing graceful-degradation path rather than a throw.
    it("an override model not in the catalog is refused, not silently replaced", async () => {
        const fetchMock = stubLlm();
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt: "Build a jazz club website", model: "not-a-real-model" });

        // No provider call at all: nothing was asked of a substitute model.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.skipped).toBe(true);
        expect(result.warnings?.join(" ")).toContain("not-a-real-model");
    });

    it("no override at all: uses the task-setting provider+model when configured", async () => {
        const fetchMock = stubLlm();
        const { useCase } = createUseCase({
            platformConfig: {
                governanceByProduct: {
                    default: {
                        promptTaskSettings: {
                            vibe_intent_prefill: {
                                provider: "siliconflow",
                                model: "MiniMaxAI/MiniMax-M3",
                            },
                        },
                    },
                },
            },
        });

        await useCase.execute({ prompt: "Build a jazz club website" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("MiniMaxAI/MiniMax-M3");
    });

    it("no override and no task-setting: falls through to the hardcoded fallback provider+model when the configured task-setting provider is not active", async () => {
        const fetchMock = stubLlm();
        const catalog = {
            source: "env",
            providers: [
                {
                    provider: "openrouter",
                    baseUrl: "https://llm.test/openrouter/v1",
                    apiType: "openai-compatible",
                    authType: "none",
                    isActive: true,
                    models: [{
                        id: "Qwen/Qwen3-32B",
                        provider: "openrouter",
                        role: "dialogue",
                        capabilities: ["chat"],
                        isDefault: true,
                        isFallback: false,
                        isActive: true,
                    }],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                ...defaultCatalog().providers,
            ],
        };
        const { useCase } = createUseCase({ catalog });

        await useCase.execute({ prompt: "Build a jazz club website" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("MiniMaxAI/MiniMax-M3");
        // Resolved via the FALLBACK_PROVIDER ("siliconflow") step of the cascade, not openrouter.
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://llm.test/v1/chat/completions");
    });
});
