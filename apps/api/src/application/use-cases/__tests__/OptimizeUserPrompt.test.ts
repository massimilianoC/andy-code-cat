import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: false,
        providerApiKeys: {},
        LLM_DEFAULT_PROVIDER: "siliconflow",
        LLM_MAX_COMPLETION_TOKENS: 32000,
        COST_POLICY_TEXT_EUR_PER_1K_TOKENS: 0.002,
        COST_POLICY_IMAGE_EUR_PER_ASSET: 0.02,
        COST_POLICY_VIDEO_EUR_PER_ASSET: 0.2,
        COST_POLICY_USD_TO_EUR_RATE: 0.92,
        COST_POLICY_PROVIDER_MARKUP_FACTOR: 1.2,
    },
}));

import { OptimizeUserPrompt } from "../OptimizeUserPrompt";

function streamResponse(lines: string[]) {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(lines.join("\n")));
                controller.close();
            },
        }),
        { status: 200 },
    );
}

function createUseCase(platformConfig: unknown = null) {
    const projectRepository = {
        findByIdForUser: vi.fn(async () => ({
            id: "project-1",
            ownerUserId: "user-1",
            name: "Studio Demo",
            presetId: "landing_page",
            createdAt: new Date(),
            updatedAt: new Date(),
        })),
    };
    const moodboardRepository = { findByProjectId: vi.fn(async () => null) };
    const userStyleProfileRepository = { findByUserId: vi.fn(async () => null) };
    const assetRepository = { listByProject: vi.fn(async () => []) };
    const platformConfigRepository = { get: vi.fn(async () => platformConfig) };
    const userRepository = { incrementTokensConsumed: vi.fn(async () => undefined) };
    const promptExecutionLogRepository = { create: vi.fn(async () => undefined) };
    const getLlmCatalog = {
        execute: vi.fn(async () => ({
            source: "env",
            providers: [{
                provider: "siliconflow",
                baseUrl: "https://llm.test/v1",
                apiType: "openai-compatible",
                authType: "none",
                isActive: true,
                models: [{
                    id: "MiniMaxAI/MiniMax-M2.5",
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
        })),
    };

    return {
        useCase: new OptimizeUserPrompt(
            projectRepository as any,
            moodboardRepository as any,
            userStyleProfileRepository as any,
            assetRepository as any,
            platformConfigRepository as any,
            userRepository as any,
            promptExecutionLogRepository as any,
            getLlmCatalog as any,
        ),
        promptExecutionLogRepository,
    };
}

describe("OptimizeUserPrompt", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("uses streamed reasoning text as the optimized prompt when content chunks are empty", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
            'data: {"choices":[{"delta":{"reasoning_content":"<think>analisi interna</think>Landing page concreta con hero fotografico e CTA chiara."}}]}',
            'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
            "data: [DONE]",
            "",
        ])));

        const { useCase, promptExecutionLogRepository } = createUseCase();
        const thinkingChunks: string[] = [];
        const answerChunks: string[] = [];

        const result = await useCase.executeStream({
            projectId: "project-1",
            userId: "user-1",
            rawPrompt: "Landing page",
        }, {
            onThinking: (chunk) => thinkingChunks.push(chunk),
            onAnswer: (chunk) => answerChunks.push(chunk),
        });

        expect(result.optimizedPrompt).toBe("Landing page concreta con hero fotografico e CTA chiara.");
        expect(result.rawResponse).toContain("Landing page concreta");
        expect(thinkingChunks.join("")).toContain("Landing page concreta");
        expect(answerChunks).toEqual([]);
        expect(promptExecutionLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({
            optimizedPrompt: "Landing page concreta con hero fotografico e CTA chiara.",
            status: "succeeded",
        }));
    });

    it("sends the expanded budget for a persisted legacy zero-effort optimizer setting", async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            choices: [{
                message: { content: "Prompt ottimizzato completo." },
                finish_reason: "stop",
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));
        vi.stubGlobal("fetch", fetchMock);

        const { useCase } = createUseCase({
            governanceByProduct: {
                default: {
                    promptTaskSettings: {
                        zero_effort_optimize: {
                            maxCompletionTokens: 1200,
                        },
                    },
                },
            },
        });

        await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            rawPrompt: "Landing page",
            taskKey: "zero_effort_optimize",
        });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.max_tokens).toBe(32000);
    });
});
