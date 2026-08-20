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

import { VibeClassify } from "../VibeClassify";

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
        useCase: new VibeClassify(platformConfigRepository as any, getLlmCatalog as any),
        platformConfigRepository,
        getLlmCatalog,
    };
}

function stubLlm(json: Record<string, unknown>) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(json) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const BUG_PROMPT =
    "Build a unicycle company product website. React, Tailwind CSS, Framer Motion for all animations, " +
    "Awwwards-level micro-interactions and immersive scroll storytelling.";

describe("VibeClassify", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends the selection procedure and one annotated catalog in the system prompt", async () => {
        const fetchMock = stubLlm({ templateId: null, formatHint: null, confidence: 0, reasoning: "n/a" });
        const { useCase } = createUseCase();

        await useCase.execute({ prompt: "any prompt" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        const systemMessage = requestBody.messages.find((m: { role: string }) => m.role === "system").content as string;

        expect(systemMessage).toContain("TEMPLATE SELECTION PROCEDURE");
        expect(systemMessage).toContain("STEP 2 — MECHANIC EVIDENCE");
        expect(systemMessage).toContain("CANONICAL PRESET SELECTION CONTRACT");
        expect(systemMessage).toContain("[videogame]");
        expect(systemMessage).toContain("SELECT WHEN:");
        expect(systemMessage).toContain("DO NOT SELECT WHEN:");
        expect(systemMessage).not.toContain('- id: "videogame"');
        expect(systemMessage.split("[videogame]").length).toBe(2);
    });

    it("REGRESSION — trusts the model's answer for the production bug prompt (Awwwards-level unicycle website)", async () => {
        stubLlm({ templateId: "website", formatHint: "one_pager", confidence: 0.92, reasoning: "names a company product website" });
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt: BUG_PROMPT });

        expect(result.templateId).toBe("website");
        expect(result.confidence).toBe(0.92);
        expect(result.reasoning).not.toContain("deterministic");
        expect(result.skipped).toBe(false);
    });

    it("does not upgrade or rewrite the model's answer for a prompt containing 'Awwwards-level'", async () => {
        stubLlm({ templateId: "landing", formatHint: null, confidence: 0.8, reasoning: "single conversion goal" });
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt: BUG_PROMPT });

        expect(result.templateId).toBe("landing");
        expect(result.confidence).toBe(0.8);
    });

    it("honours the confidence threshold", async () => {
        stubLlm({ templateId: "videogame", formatHint: null, confidence: 0.4, reasoning: "weak signal" });
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt: "some prompt" });

        expect(result.templateId).toBeNull();
        expect(result.confidence).toBe(0.4);
        expect(result.skipped).toBe(false);
    });

    it.each([
        ["Create a playable arcade game with score, lives, HUD and game over", "videogame"],
        ["build a copy of Spore space-age part, fly your spaceship between stars, zoom into planets, upgrade your ship", "game3d"],
        ["Build an endless runner with lanes, coins and retry", "freerunner"],
        ["crea un videogioco con livelli, ostacoli e punteggio", "videogame"],
    ])("passes a game preset through when the LLM selects it: %s -> %s", async (prompt, templateId) => {
        stubLlm({ templateId, formatHint: null, confidence: 0.9, reasoning: "explicit gameplay mechanics" });
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt });

        expect(result.templateId).toBe(templateId);
    });

    it("rejects a templateId that is not in the catalog", async () => {
        stubLlm({ templateId: "not-a-preset", formatHint: null, confidence: 0.95, reasoning: "hallucinated id" });
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt: "anything" });

        expect(result.templateId).toBeNull();
    });

    it("returns no template guess when there is no active provider", async () => {
        const { useCase } = createUseCase({ catalog: { source: "env", providers: [] } });

        const result = await useCase.execute({ prompt: "Create a playable arcade game with score, levels, controls, win and game over states." });

        expect(result).toEqual({ templateId: null, formatHint: null, confidence: 0, reasoning: "no active provider", skipped: true });
    });

    it("returns no template guess when the provider throws", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt: "crea un gioco infinite runner con ostacoli e punteggio" });

        expect(result.templateId).toBeNull();
        expect(result.skipped).toBe(true);
        expect(result.reasoning).toBe("classifier error");
    });

    it("returns no template guess on a provider HTTP error", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
        const { useCase } = createUseCase();

        const result = await useCase.execute({ prompt: "crea un gioco infinite runner con ostacoli e punteggio" });

        expect(result.templateId).toBeNull();
        expect(result.skipped).toBe(true);
        expect(result.reasoning).toBe("provider error 500");
    });

    it("appends attachment metadata to the user message", async () => {
        const fetchMock = stubLlm({ templateId: "data-dashboard", formatHint: "analytics_dashboard", confidence: 0.9, reasoning: "dataset attached with analytical intent" });
        const { useCase } = createUseCase();

        await useCase.execute({
            prompt: "analizza queste vendite",
            attachmentMeta: [{ filename: "sales.csv", mimeType: "text/csv", sizeBytes: 2048 }],
        });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        const userMessage = requestBody.messages.find((m: { role: string }) => m.role === "user").content as string;
        expect(userMessage).toContain("sales.csv");
        expect(userMessage).toContain("text/csv");
    });

    // ── resolveModelSelection pin: byte-identical (provider, model) vs. pre-refactor inline cascade ──

    it("model resolution: honors a request-override provider+model present in the catalog", async () => {
        const fetchMock = stubLlm({ templateId: null, formatHint: null, confidence: 0, reasoning: "n/a" });
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

        await useCase.execute({ prompt: "any prompt", provider: "openrouter", model: "Qwen/Qwen3-32B" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("Qwen/Qwen3-32B");
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("openrouter");
    });

    it("model resolution: an override model not in the catalog silently falls through to the catalog default model", async () => {
        const fetchMock = stubLlm({ templateId: null, formatHint: null, confidence: 0, reasoning: "n/a" });
        const { useCase } = createUseCase();

        await useCase.execute({ prompt: "any prompt", model: "not-a-real-model" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("MiniMaxAI/MiniMax-M3");
    });

    it("model resolution: no override falls through to the first active model when no task setting or isDefault model matches", async () => {
        const fetchMock = stubLlm({ templateId: null, formatHint: null, confidence: 0, reasoning: "n/a" });
        const catalog = {
            source: "env",
            providers: [{
                provider: "siliconflow",
                baseUrl: "https://llm.test/v1",
                apiType: "openai-compatible",
                authType: "none",
                isActive: true,
                models: [{
                    id: "some-other-model",
                    provider: "siliconflow",
                    role: "dialogue",
                    capabilities: ["chat"],
                    isDefault: false,
                    isFallback: false,
                    isActive: true,
                }],
                createdAt: new Date(),
                updatedAt: new Date(),
            }],
        };
        const { useCase } = createUseCase({ catalog });

        await useCase.execute({ prompt: "any prompt" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("some-other-model");
    });

    it("a legacy operator systemTemplate cannot remove the canonical contract", async () => {
        const fetchMock = stubLlm({ templateId: null, formatHint: null, confidence: 0, reasoning: "n/a" });
        const { useCase } = createUseCase({
            platformConfig: {
                governanceByProduct: {
                    default: {
                        promptTaskSettings: {
                            vibe_intent_classify: {
                                systemTemplate: "OLD RULES\n{{TEMPLATE_LIST}}",
                            },
                        },
                    },
                },
            },
        });

        await useCase.execute({ prompt: "any prompt" });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        const systemMessage = requestBody.messages.find((m: { role: string }) => m.role === "system").content as string;

        expect(systemMessage).toContain("OLD RULES");
        expect(systemMessage).toContain("CANONICAL PRESET SELECTION CONTRACT");
        expect(systemMessage).not.toContain("{{TEMPLATE_LIST}}");
    });
});
