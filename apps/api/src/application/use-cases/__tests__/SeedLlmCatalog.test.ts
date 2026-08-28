import { describe, expect, it, vi } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import type { LlmCatalogRepository } from "../../../domain/repositories/LlmCatalogRepository";
import { SeedLlmCatalog } from "../SeedLlmCatalog";

function provider(overrides: Partial<LlmProviderCatalog> = {}): LlmProviderCatalog {
    return {
        provider: "siliconflow",
        baseUrl: "https://api.example.test/v1",
        apiType: "openai-compatible",
        authType: "bearer",
        isActive: true,
        models: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

describe("SeedLlmCatalog", () => {
    it("adds missing defaults without replacing operator activation or manual models", async () => {
        const providerWrites: Array<Parameters<LlmCatalogRepository["upsertProvider"]>[0]> = [];
        const persistedMiniMax = {
            id: "MiniMaxAI/MiniMax-M3",
            provider: "siliconflow",
            role: "dialogue" as const,
            capabilities: ["chat"],
            isDefault: false,
            isFallback: true,
            isActive: false,
            displayName: "Operator name",
        };
        const manualModel = {
            id: "operator/manual-model",
            provider: "siliconflow",
            role: "dialogue" as const,
            capabilities: ["chat"],
            isDefault: false,
            isFallback: true,
            isActive: true,
        };
        const repository = {
            listAllProviders: vi.fn(async () => [provider({ isActive: false, models: [persistedMiniMax, manualModel] })]),
            upsertProvider: vi.fn(async (input: Parameters<LlmCatalogRepository["upsertProvider"]>[0]) => {
                providerWrites.push(input);
            }),
            listActiveProviders: vi.fn(),
            upsertModel: vi.fn(),
            deleteModel: vi.fn(),
            setModelsActive: vi.fn(),
            markAvailability: vi.fn(),
        };

        await new SeedLlmCatalog(repository as never, "https://api.example.test/v1", "http://lmstudio.test/v1", "https://openrouter.test/v1").execute();

        const siliconFlowWrite = providerWrites.find((input) => input.provider === "siliconflow");
        expect(siliconFlowWrite).toBeDefined();
        if (!siliconFlowWrite) throw new Error("Missing SiliconFlow seed write");
        expect(siliconFlowWrite).toMatchObject({ isActive: false });
        expect(siliconFlowWrite.models.find((model: { id: string }) => model.id === persistedMiniMax.id)).toMatchObject({
            isActive: false,
            displayName: "Operator name",
        });
        expect(siliconFlowWrite.models.find((model: { id: string }) => model.id === manualModel.id)).toMatchObject(manualModel);
        expect(siliconFlowWrite.models.some((model: { id: string }) => model.id === "moonshotai/Kimi-K3")).toBe(true);
    });
});
