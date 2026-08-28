import { describe, expect, it, vi } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import { ReconcileLlmCatalogAvailability } from "../ReconcileLlmCatalogAvailability";

function model(id: string, overrides: Partial<LlmProviderCatalog["models"][number]> = {}) {
    return {
        id,
        provider: "siliconflow",
        role: "dialogue" as const,
        capabilities: ["chat"],
        isDefault: false,
        isFallback: true,
        isActive: true,
        ...overrides,
    };
}

function harness(providers: Array<{ provider: string; models: LlmProviderCatalog["models"] }>) {
    const repository = {
        markAvailability: vi.fn(async (_input: { provider: string; liveModelIds: string[]; checkedAt: Date }) => ({ live: 1, deprecated: 0 })),
        upsertProvider: vi.fn(),
        listActiveProviders: vi.fn(),
        listAllProviders: vi.fn(),
        upsertModel: vi.fn(),
        deleteModel: vi.fn(),
        setModelsActive: vi.fn(),
    };
    const getEffectiveLlmCatalog = {
        execute: vi.fn(async () => ({
            source: "mongo" as const,
            activeProvider: "siliconflow",
            providers: providers.map((entry) => ({
                provider: entry.provider,
                baseUrl: "https://example.invalid/v1",
                isActive: true,
                models: entry.models,
                createdAt: new Date(),
                updatedAt: new Date(),
            })),
        })),
    };
    return {
        repository,
        getEffectiveLlmCatalog,
        useCase: new ReconcileLlmCatalogAvailability(repository as never, getEffectiveLlmCatalog as never),
    };
}

describe("ReconcileLlmCatalogAvailability", () => {
    it("reports only what the provider still lists as live", async () => {
        const { repository, useCase } = harness([{
            provider: "siliconflow",
            models: [
                model("still/here"),
                model("also/here"),
                model("retired/one", { availability: "deprecated" }),
            ],
        }]);

        await useCase.execute();

        const call = repository.markAvailability.mock.calls[0]![0];
        // A row carried over from storage is exactly the one under question, so it does not get
        // to vote on its own availability.
        expect(call.liveModelIds).toEqual(["still/here", "also/here"]);
    });

    it("forces a refresh — a cached list would certify yesterday's answer", async () => {
        const { getEffectiveLlmCatalog, useCase } = harness([{
            provider: "siliconflow",
            models: [model("a/b")],
        }]);

        await useCase.execute();

        expect(getEffectiveLlmCatalog.execute).toHaveBeenCalledWith({ forceRefresh: true });
    });

    it("does nothing for a provider that returned nothing", async () => {
        const { repository, useCase } = harness([{ provider: "lmstudio", models: [] }]);

        const result = await useCase.execute();

        // An unreachable provider reports an empty list, which is indistinguishable from one that
        // retired its entire catalogue. Refusing to act is the difference between "could not
        // check" and "everything is gone" — the second would deprecate a working setup wholesale.
        expect(repository.markAvailability).not.toHaveBeenCalled();
        expect(result.providers).toEqual([]);
    });

    it("keeps going when one provider fails", async () => {
        const { repository, useCase } = harness([
            { provider: "siliconflow", models: [model("a/b")] },
            { provider: "openrouter", models: [model("c/d")] },
        ]);
        repository.markAvailability.mockRejectedValueOnce(new Error("mongo unavailable"));

        const result = await useCase.execute();

        expect(repository.markAvailability).toHaveBeenCalledTimes(2);
        expect(result.providers).toHaveLength(2);
    });
});
