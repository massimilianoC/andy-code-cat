import { describe, expect, it, vi } from "vitest";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import { SetLlmModelsActive } from "../SetLlmModelsActive";

function model(id: string, overrides: Partial<LlmProviderCatalog["models"][number]> = {}) {
    return {
        id,
        provider: "siliconflow",
        role: "dialogue" as const,
        capabilities: ["chat"],
        isDefault: false,
        isFallback: true,
        isActive: false,
        ...overrides,
    };
}

function harness(models: LlmProviderCatalog["models"]) {
    const repository = {
        setModelsActive: vi.fn(async (_input: { provider: string; models: LlmProviderCatalog["models"]; isActive: boolean }) => ({}) as LlmProviderCatalog),
        upsertProvider: vi.fn(),
        listActiveProviders: vi.fn(),
        listAllProviders: vi.fn(),
        upsertModel: vi.fn(),
        deleteModel: vi.fn(),
        markAvailability: vi.fn(),
    };
    const getEffectiveLlmCatalog = {
        execute: vi.fn(async () => ({
            source: "mongo" as const,
            activeProvider: "siliconflow",
            providers: [{
                provider: "siliconflow",
                baseUrl: "https://api.siliconflow.cn/v1",
                isActive: true,
                models,
                createdAt: new Date(),
                updatedAt: new Date(),
            }],
        })),
    };
    return {
        repository,
        useCase: new SetLlmModelsActive(repository as never, getEffectiveLlmCatalog as never),
    };
}

describe("SetLlmModelsActive", () => {
    it("activates a whole group in a single write", async () => {
        const { repository, useCase } = harness([
            model("deepseek-ai/DeepSeek-V3"),
            model("deepseek-ai/DeepSeek-R1"),
            model("Qwen/Qwen3-32B"),
        ]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"],
            isActive: true,
        });

        expect(result.applied).toEqual(["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"]);
        expect(result.unknown).toEqual([]);
        // One decision, one write. Per-model calls would let a group half-apply and leave a
        // catalog the operator never chose.
        expect(repository.setModelsActive).toHaveBeenCalledTimes(1);
        expect(repository.setModelsActive.mock.calls[0]![0]).toMatchObject({
            provider: "siliconflow",
            isActive: true,
        });
    });

    it("resolves ids against the effective catalog, so a model known only from discovery is persistable", async () => {
        const { repository, useCase } = harness([model("only/discovered")]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["only/discovered"],
            isActive: true,
        });

        expect(result.applied).toEqual(["only/discovered"]);
        const written = repository.setModelsActive.mock.calls[0]![0];
        // Full descriptors, not bare ids: the repository has to materialise a row that does not
        // exist yet, or the decision is forgotten at the next restart.
        expect(written.models[0]).toMatchObject({ id: "only/discovered", capabilities: ["chat"] });
    });

    it("reports ids it could not find instead of silently dropping them", async () => {
        const { useCase } = harness([model("known/model")]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["known/model", "retired/model"],
            isActive: true,
        });

        expect(result.applied).toEqual(["known/model"]);
        expect(result.unknown).toEqual(["retired/model"]);
    });

    it("de-duplicates a request rather than writing the same id twice", async () => {
        const { repository, useCase } = harness([model("dup/model")]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["dup/model", "dup/model"],
            isActive: false,
        });

        expect(result.applied).toEqual(["dup/model"]);
        const written = repository.setModelsActive.mock.calls[0]![0];
        expect(written.models).toHaveLength(1);
    });

    it("writes nothing when no id resolves", async () => {
        const { repository, useCase } = harness([model("known/model")]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["nothing/here"],
            isActive: true,
        });

        expect(result.applied).toEqual([]);
        expect(repository.setModelsActive).not.toHaveBeenCalled();
    });

    it("rejects an unknown provider rather than creating one by accident", async () => {
        const { useCase } = harness([model("known/model")]);

        await expect(useCase.execute({
            provider: "not-a-provider",
            modelIds: ["known/model"],
            isActive: true,
        })).rejects.toMatchObject({ statusCode: 404 });
    });
});

// BEHAVIOUR CHANGE, deliberate. These used to assert that a model marked deprecated could
// not be switched back on. That rule trusted `availability` as a verdict, and it is not one:
// discovery reported 13 SiliconFlow models on one poll and 77 on the next, so a single
// unlucky poll could put a model permanently out of the operator's reach. Availability is
// now advisory — the operator decides, and a model that really is gone fails at dispatch
// with a named error instead of being refused on a guess.
describe("SetLlmModelsActive — availability is advisory, the operator decides", () => {
    it("activates a deprecated model, and still reports that it is not currently offered", async () => {
        const { repository, useCase } = harness([
            model("still/offered"),
            model("retired/model", { availability: "deprecated" }),
        ]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["still/offered", "retired/model"],
            isActive: true,
        });

        expect(result.applied).toEqual(["still/offered", "retired/model"]);
        // Reported, not refused: the operator should know what they switched on.
        expect(result.deprecated).toEqual(["retired/model"]);
        const written = repository.setModelsActive.mock.calls[0]![0];
        expect(written.models.map((entry) => entry.id)).toEqual(["still/offered", "retired/model"]);
    });

    it("still allows switching a deprecated model OFF, so a group cleanup completes", async () => {
        const { repository, useCase } = harness([
            model("retired/model", { availability: "deprecated", isActive: true }),
        ]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["retired/model"],
            isActive: false,
        });

        expect(result.applied).toEqual(["retired/model"]);
        expect(result.deprecated).toEqual([]);
        expect(repository.setModelsActive).toHaveBeenCalledTimes(1);
    });

    it("writes nothing when every requested id is unknown to the catalog", async () => {
        // Unknown is still a hard skip — there is no model to rule on, so nothing is written.
        const { repository, useCase } = harness([model("still/offered")]);

        const result = await useCase.execute({
            provider: "siliconflow",
            modelIds: ["never/existed"],
            isActive: true,
        });

        expect(result.applied).toEqual([]);
        expect(result.unknown).toEqual(["never/existed"]);
        expect(repository.setModelsActive).not.toHaveBeenCalled();
    });
});
