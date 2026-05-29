import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import { GetEffectiveLlmCatalog } from "../GetEffectiveLlmCatalog";

describe("GetEffectiveLlmCatalog", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns the already-hydrated effective catalog from the shared resolver", async () => {
        const baseCatalog = {
            source: "env" as const,
            activeProvider: "lmstudio",
            providers: [
                {
                    provider: "lmstudio",
                    baseUrl: "http://127.0.0.1:1234/v1",
                    apiType: "openai-compatible" as const,
                    authType: "none" as const,
                    isActive: true,
                    createdAt: new Date("2026-01-01T00:00:00.000Z"),
                    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
                    models: [
                        {
                            id: "local/default-chat",
                            provider: "lmstudio",
                            role: "dialogue",
                            capabilities: ["chat"],
                            isDefault: true,
                            isFallback: false,
                            isActive: true,
                        },
                    ],
                },
                {
                    provider: "siliconflow",
                    baseUrl: "https://api.siliconflow.com/v1",
                    apiType: "openai-compatible" as const,
                    authType: "bearer" as const,
                    isActive: true,
                    createdAt: new Date("2026-01-01T00:00:00.000Z"),
                    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
                    models: [
                        {
                            id: "Qwen/Qwen3-32B",
                            provider: "siliconflow",
                            role: "dialogue",
                            capabilities: ["chat"],
                            isDefault: true,
                            isFallback: false,
                            isActive: true,
                        },
                    ],
                },
            ] satisfies LlmProviderCatalog[],
        };

        const useCase = new GetEffectiveLlmCatalog(
            { execute: vi.fn().mockResolvedValue(baseCatalog) } as unknown as import("../GetLlmCatalog").GetLlmCatalog,
        );

        const effective = await useCase.execute();

        expect(effective.source).toBe("env");
        expect(effective.activeProvider).toBe("lmstudio");
        expect(effective.providers.find((provider) => provider.provider === "lmstudio")?.models[0]?.id).toBe("local/default-chat");
    });
});