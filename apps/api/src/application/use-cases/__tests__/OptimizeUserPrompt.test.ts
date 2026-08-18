import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "stream";

vi.mock("../../../config", () => ({
    env: {
        enrichmentEnabled: true,
        enrichmentInjectLayerD: true,
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

function makeReadyTrace() {
    return {
        assetId: "asset-1",
        projectId: "project-1",
        userId: "user-1",
        assetKind: "txt",
        provenance: {
            traceVersion: 1,
            enrichmentStatus: "ready",
            enrichedAt: new Date(),
            processingMs: 25,
            parserName: "text",
            parserVersion: "1.0.0",
            llmProvider: null,
            llmModel: null,
            llmTokensUsed: null,
            llmCostEur: null,
            errorMessage: null,
        },
        textLayer: {
            wordCount: 12,
            charCount: 72,
            languageHint: "it",
            pageCount: 1,
            sectionCount: 1,
            extractedTextSnippet: "Contesto allegato: usare il catalogo Jazz Milano e il tono premium.",
            fullTextStored: false,
        },
        documentBrief: null,
        structuredData: null,
        colorPalette: null,
        visualAnalysis: null,
        designSignals: null,
        distilledTitle: "Brand Brief",
        distilledSummary: "Documento guida per il brand.",
        distilledTags: ["brand"],
        distilledColors: [],
        renderedFragment: null,
    };
}

function createUseCase(platformConfig: unknown = null, overrides?: {
    assets?: any[];
    assetRepository?: { listByProject: ReturnType<typeof vi.fn> };
    storageText?: string;
    catalog?: unknown;
}) {
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
    const assetRepository = overrides?.assetRepository ?? { listByProject: vi.fn(async () => overrides?.assets ?? []) };
    const platformConfigRepository = { get: vi.fn(async () => platformConfig) };
    const userRepository = { incrementTokensConsumed: vi.fn(async () => undefined) };
    const promptExecutionLogRepository = { create: vi.fn(async () => undefined) };
    const getLlmCatalog = {
        execute: vi.fn(async () => overrides?.catalog ?? {
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
        }),
    };
    const storage = {
        uploadFilePath: vi.fn((_userId: string, _projectId: string, storedFilename: string) => storedFilename),
        createReadStream: vi.fn(async () => Readable.from([overrides?.storageText ?? ""])),
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
            storage as any,
        ),
        promptExecutionLogRepository,
    };
}

describe("OptimizeUserPrompt", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
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

    it("waits for pending Layer D document enrichment before zero-effort optimization", async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            choices: [{
                message: { content: "Prompt ottimizzato con il contesto allegato." },
                finish_reason: "stop",
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));
        vi.stubGlobal("fetch", fetchMock);

        const pendingAsset = {
            id: "asset-1",
            projectId: "project-1",
            userId: "user-1",
            originalName: "brand-brief.txt",
            mimeType: "text/plain",
            fileSize: 120,
            source: "upload",
            scope: "project",
            storedFilename: "brand-brief.txt",
            label: null,
            useInProject: true,
            styleRole: undefined,
            descriptionText: null,
            externalUrl: null,
            generationStatus: null,
            generationPrompt: null,
            generationMetadata: null,
            semanticMetadata: null,
            enrichmentTrace: null,
            createdAt: new Date(),
        };
        const readyAsset = { ...pendingAsset, enrichmentTrace: makeReadyTrace() };
        const assetRepository = {
            listByProject: vi.fn()
                .mockResolvedValueOnce([pendingAsset])
                .mockResolvedValue([readyAsset]),
        };
        const { useCase } = createUseCase(null, {
            assetRepository,
        });

        const pending = useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            rawPrompt: "Crea una landing per eventi musicali",
            taskKey: "zero_effort_optimize",
        });
        await vi.advanceTimersByTimeAsync(1_500);
        await pending;

        expect(assetRepository.listByProject).toHaveBeenCalledTimes(2);
        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        const messages = requestBody.messages as Array<{ role: string; content: string }>;
        expect(messages.map((message) => message.content).join("\n")).toContain("LAYER D");
        expect(messages.map((message) => message.content).join("\n")).toContain("catalogo Jazz Milano");
    });

    // ── resolveModelSelection pin: byte-identical (provider, model) vs. pre-refactor inline cascade ──

    it("model resolution: honors a request-override model because the resolved provider is openai-compatible", async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            choices: [{ message: { content: "Prompt ottimizzato." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        const { useCase } = createUseCase();

        await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            rawPrompt: "Landing page",
            provider: "siliconflow",
            model: "some-other-model-not-in-catalog",
        });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        // KNOWN-DIVERGENCE (future work): the override model is honored WITHOUT verifying it is
        // active in the catalog, because the resolved provider's apiType is openai-compatible.
        expect(requestBody.model).toBe("some-other-model-not-in-catalog");
    });

    it("model resolution: no override falls through to the active dialogue-role default model", async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            choices: [{ message: { content: "Prompt ottimizzato." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        const { useCase } = createUseCase();

        await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            rawPrompt: "Landing page",
        });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("MiniMaxAI/MiniMax-M2.5");
    });

    it("model resolution: task-setting model wins over the catalog default when active in the catalog", async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            choices: [{ message: { content: "Prompt ottimizzato." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        const catalog = {
            source: "env",
            providers: [{
                provider: "siliconflow",
                baseUrl: "https://llm.test/v1",
                apiType: "openai-compatible",
                authType: "none",
                isActive: true,
                models: [
                    {
                        id: "MiniMaxAI/MiniMax-M2.5",
                        provider: "siliconflow",
                        role: "dialogue",
                        capabilities: ["chat"],
                        isDefault: true,
                        isFallback: false,
                        isActive: true,
                    },
                    {
                        id: "deepseek-ai/DeepSeek-V3",
                        provider: "siliconflow",
                        role: "dialogue",
                        capabilities: ["chat"],
                        isDefault: false,
                        isFallback: false,
                        isActive: true,
                    },
                ],
                createdAt: new Date(),
                updatedAt: new Date(),
            }],
        };
        const { useCase } = createUseCase({
            governanceByProduct: {
                default: {
                    promptTaskSettings: {
                        optimize_user_prompt: {
                            provider: "siliconflow",
                            model: "deepseek-ai/DeepSeek-V3",
                        },
                    },
                },
            },
        }, { catalog });

        await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            rawPrompt: "Landing page",
            taskKey: "optimize_user_prompt",
        });

        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe("deepseek-ai/DeepSeek-V3");
    });
});
