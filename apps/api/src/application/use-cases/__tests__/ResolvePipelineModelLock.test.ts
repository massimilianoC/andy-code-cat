import { describe, expect, it, vi } from "vitest";
import type { ModelSelectionBlockCode, PipelineStage } from "@andy-code-cat/contracts";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import type { PipelineRun } from "../../../domain/entities/PipelineRun";
import type { NewPipelineRun, PipelineRunRepository } from "../../../domain/repositories/PipelineRunRepository";
import { computeCatalogRevision, ResolvePipelineModelLock } from "../ResolvePipelineModelLock";

function fakeCatalog(overrides?: Partial<LlmProviderCatalog>): LlmProviderCatalog {
    return {
        provider: "siliconflow",
        baseUrl: "https://llm.test/v1",
        apiType: "openai-compatible",
        authType: "none",
        isActive: true,
        models: [
            {
                id: "MiniMaxAI/MiniMax-M3",
                provider: "siliconflow",
                role: "dialogue",
                capabilities: ["chat"],
                isDefault: true,
                isFallback: false,
                isActive: true,
            },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function fakeGetLlmCatalog(providers: LlmProviderCatalog[]) {
    return { execute: vi.fn(async () => ({ source: "env" as const, providers, activeProvider: providers[0]?.provider ?? "siliconflow" })) };
}

class InMemoryPipelineRunRepository implements PipelineRunRepository {
    runs = new Map<string, PipelineRun>();
    private seq = 0;

    async create(run: NewPipelineRun): Promise<PipelineRun> {
        const id = `run-${++this.seq}`;
        const now = new Date();
        const entity: PipelineRun = { id, status: "draft", stages: [], createdAt: now, updatedAt: now, ...run };
        this.runs.set(id, entity);
        return entity;
    }

    async findByIdForUser(id: string, userId: string): Promise<PipelineRun | null> {
        const run = this.runs.get(id);
        return run && run.ownerUserId === userId ? run : null;
    }

    async listByProject(projectId: string): Promise<PipelineRun[]> {
        return [...this.runs.values()].filter((r) => r.projectId === projectId);
    }

    async appendStage(runId: string, stage: PipelineRun["stages"][number]): Promise<PipelineRun> {
        const run = this.runs.get(runId);
        if (!run) throw new Error("not found");
        const updated = { ...run, stages: [...run.stages, stage], updatedAt: new Date() };
        this.runs.set(runId, updated);
        return updated;
    }

    async setStatus(
        runId: string,
        status: PipelineRun["status"],
        detail?: { code: ModelSelectionBlockCode; stage: PipelineStage },
    ): Promise<PipelineRun> {
        const run = this.runs.get(runId);
        if (!run) throw new Error("not found");
        const updated: PipelineRun = {
            ...run,
            status,
            blocked: detail ? { code: detail.code, stage: detail.stage, at: new Date() } : run.blocked,
            updatedAt: new Date(),
        };
        this.runs.set(runId, updated);
        return updated;
    }

    async attachCanonicalBrief(runId: string, brief: PipelineRun["canonicalBrief"]): Promise<PipelineRun> {
        const run = this.runs.get(runId);
        if (!run) throw new Error("not found");
        const updated = { ...run, canonicalBrief: brief, updatedAt: new Date() };
        this.runs.set(runId, updated);
        return updated;
    }
}

describe("computeCatalogRevision", () => {
    it("is stable for the same active provider/model set", () => {
        const a = computeCatalogRevision([fakeCatalog()]);
        const b = computeCatalogRevision([fakeCatalog()]);
        expect(a).toBe(b);
    });

    it("changes when a model is deactivated", () => {
        const before = computeCatalogRevision([fakeCatalog()]);
        const after = computeCatalogRevision([
            fakeCatalog({ models: [{ ...fakeCatalog().models[0]!, isActive: false }] }),
        ]);
        expect(before).not.toBe(after);
    });
});

describe("ResolvePipelineModelLock — createRun", () => {
    it("freezes a modelLock matching the vibe-cascade resolution for the given catalog", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
        });

        expect(run.status).toBe("draft");
        expect(run.modelLock.effective).toEqual({ providerId: "siliconflow", modelId: "MiniMaxAI/MiniMax-M3" });
        expect(run.modelLock.selectedBy).toBe("catalog-proposal");
        expect(run.modelLock.policy).toBe("legacy");
    });

    it("honors a requested provider/model that exists in the catalog and marks selectedBy=user", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
            requestedProviderId: "siliconflow",
            requestedModelId: "MiniMaxAI/MiniMax-M3",
        });

        expect(run.modelLock.selectedBy).toBe("user");
        expect(run.modelLock.requested).toEqual({
            providerId: "siliconflow",
            modelId: "MiniMaxAI/MiniMax-M3",
            catalogRevision: computeCatalogRevision([fakeCatalog()]),
        });
    });
});

describe("ResolvePipelineModelLock — dispatch", () => {
    it("returns not-blocked when the locked model is still active", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const catalog = [fakeCatalog()];
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog(catalog) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
        });

        const result = await useCase.dispatch({ runId: run.id, ownerUserId: "user-1", stage: "vibe_classify" });

        expect(result.blocked).toBeNull();
        expect(result.run.status).toBe("draft");
    });

    it("blocks the run when the locked model has since been deactivated", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const active = [fakeCatalog()];
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog(active) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
        });

        // Simulate the catalog changing between run creation and dispatch: the locked model
        // is no longer active on any provider.
        const deactivated = fakeGetLlmCatalog([
            fakeCatalog({ models: [{ ...fakeCatalog().models[0]!, isActive: false }] }),
        ]);
        const dispatchUseCase = new ResolvePipelineModelLock(repo, deactivated as any);

        const result = await dispatchUseCase.dispatch({ runId: run.id, ownerUserId: "user-1", stage: "generate" });

        expect(result.blocked).toEqual({ code: "MODEL_LOCK_UNAVAILABLE", stage: "generate", at: expect.any(Date) });
        expect(result.run.status).toBe("blocked");
    });

    it("throws when the run does not belong to the requesting user", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
        });

        await expect(
            useCase.dispatch({ runId: run.id, ownerUserId: "someone-else", stage: "vibe_classify" }),
        ).rejects.toThrow(/not found/i);
    });
});
