import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSelectionBlockCode, PipelineStage } from "@andy-code-cat/contracts";
import type { LlmProviderCatalog } from "../../../domain/entities/LlmCatalog";
import type { PipelineRun } from "../../../domain/entities/PipelineRun";
import { assertStatusTransition } from "../../../domain/entities/PipelineRun";
import type { CreateSystemNotificationInput, SystemNotificationRepository } from "../../../domain/repositories/SystemNotificationRepository";
import type { SystemNotification } from "../../../domain/entities/SystemNotification";
import type { NewPipelineRun, PipelineRunRepository } from "../../../domain/repositories/PipelineRunRepository";
import { computeCatalogRevision, ResolvePipelineModelLock } from "../ResolvePipelineModelLock";
import { SystemNotifier } from "../../services/SystemNotifier";

class FakeSystemNotificationRepository implements SystemNotificationRepository {
    created: CreateSystemNotificationInput[] = [];

    async create(input: CreateSystemNotificationInput): Promise<SystemNotification> {
        this.created.push(input);
        return { ...input, id: `notif-${this.created.length}`, status: "unread", createdAt: new Date() };
    }
    async listForUser(): Promise<SystemNotification[]> { return []; }
    async listForAdmin(): Promise<SystemNotification[]> { return []; }
    async markRead(): Promise<SystemNotification | null> { return null; }
}

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
        // Validate against the SAME invariant function MongoPipelineRunRepository.setStatus()
        // calls in production — a fake that skipped this would pass tests while hiding a real
        // "illegal transition -> 500" bug (exactly what happened before this file added the
        // "blocked" -> "blocked" self-transition).
        assertStatusTransition(run.status, status, detail);
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

        const result = await useCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "vibe_classify" });

        expect(result.blocked).toBeNull();
        expect(result.run.status).toBe("draft");
    });

    it("applies the lock on the first dispatch and records the stage that consumed it", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "workspace",
            optimizationPolicy: "skip",
        });

        const first = await useCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });

        expect(first.lockApplies).toBe(true);
        expect(first.blocked).toBeNull();
        expect(first.run.stages).toHaveLength(1);
        expect(first.run.stages[0]).toMatchObject({ stage: "generate", status: "dispatched" });
        expect(first.run.stages[0]?.decision.effective).toEqual({
            providerId: "siliconflow",
            modelId: "MiniMaxAI/MiniMax-M3",
            source: "pipeline-run-lock",
        });
    });

    it("stops applying the lock after the run has dispatched, so later turns follow the selector", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "workspace",
            optimizationPolicy: "skip",
        });

        await useCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });
        const second = await useCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });

        // The lock certifies the run's own generation and nothing after it: a second turn is
        // user-driven iteration, and the caller must fall back to its normal model cascade.
        expect(second.lockApplies).toBe(false);
        expect(second.blocked).toBeNull();
        // Exhausted, not re-recorded — the run keeps exactly the one stage that consumed it.
        expect(second.run.stages).toHaveLength(1);
    });

    it("an exhausted lock cannot block: a run that already generated keeps iterating after its model is deactivated", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "workspace",
            optimizationPolicy: "skip",
        });
        await useCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });

        const deactivated = new ResolvePipelineModelLock(
            repo,
            fakeGetLlmCatalog([fakeCatalog({ models: [{ ...fakeCatalog().models[0]!, isActive: false }] })]) as any,
        );
        const second = await deactivated.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });

        expect(second.lockApplies).toBe(false);
        expect(second.blocked).toBeNull();
        expect(second.run.status).not.toBe("blocked");
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

        const result = await dispatchUseCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });

        expect(result.blocked).toEqual({ code: "MODEL_LOCK_UNAVAILABLE", stage: "generate", at: expect.any(Date) });
        expect(result.run.status).toBe("blocked");
    });

    it("throws a 404 when the run does not belong to the requesting user", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
        });

        await expect(
            useCase.dispatch({ runId: run.id, ownerUserId: "someone-else", projectId: "project-1", stage: "vibe_classify" }),
        ).rejects.toMatchObject({ statusCode: 404, code: "PIPELINE_RUN_NOT_FOUND" });
    });

    it("throws a 404 (not a 403 leaking existence) when the run belongs to the caller but a different project", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        const run = await useCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
        });

        await expect(
            useCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-2", stage: "vibe_classify" }),
        ).rejects.toMatchObject({ statusCode: 404, code: "PIPELINE_RUN_NOT_FOUND" });
    });

    it("throws a 404 (not a 500) for an unknown runId", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const useCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog([fakeCatalog()]) as any);

        await expect(
            useCase.dispatch({ runId: "does-not-exist", ownerUserId: "user-1", projectId: "project-1", stage: "vibe_classify" }),
        ).rejects.toMatchObject({ statusCode: 404, code: "PIPELINE_RUN_NOT_FOUND" });
    });

    describe("I17 — SystemNotifier wiring", () => {
        afterEach(() => {
            SystemNotifier.configure({
                async create(): Promise<never> { throw new Error("unconfigured in test teardown"); },
                async listForUser() { return []; },
                async listForAdmin() { return []; },
                async markRead() { return null; },
            });
        });

        it("emits exactly one persisted notification on the genuine draft->blocked transition", async () => {
            const notifRepo = new FakeSystemNotificationRepository();
            SystemNotifier.configure(notifRepo);

            const repo = new InMemoryPipelineRunRepository();
            const active = [fakeCatalog()];
            const createUseCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog(active) as any);
            const run = await createUseCase.createRun({
                projectId: "project-1",
                ownerUserId: "user-1",
                entryMode: "vibe",
                optimizationPolicy: "skip",
            });

            const deactivated = fakeGetLlmCatalog([
                fakeCatalog({ models: [{ ...fakeCatalog().models[0]!, isActive: false }] }),
            ]);
            const dispatchUseCase = new ResolvePipelineModelLock(repo, deactivated as any);
            await dispatchUseCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });

            expect(notifRepo.created).toHaveLength(1);
            expect(notifRepo.created[0]).toMatchObject({
                projectId: "project-1",
                userId: "user-1",
                domain: "llm",
                severity: "warning",
                sourceEventType: "pipeline_run_blocked",
                metadata: expect.objectContaining({
                    pipelineRunId: run.id,
                    stage: "generate",
                    code: "MODEL_LOCK_UNAVAILABLE",
                    lockedProviderId: "siliconflow",
                    lockedModelId: "MiniMaxAI/MiniMax-M3",
                }),
            });
        });

        it("does NOT emit a second notification when a retry re-confirms an already-blocked run", async () => {
            const notifRepo = new FakeSystemNotificationRepository();
            SystemNotifier.configure(notifRepo);

            const repo = new InMemoryPipelineRunRepository();
            const active = [fakeCatalog()];
            const createUseCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog(active) as any);
            const run = await createUseCase.createRun({
                projectId: "project-1",
                ownerUserId: "user-1",
                entryMode: "vibe",
                optimizationPolicy: "skip",
            });

            const deactivated = fakeGetLlmCatalog([
                fakeCatalog({ models: [{ ...fakeCatalog().models[0]!, isActive: false }] }),
            ]);
            const dispatchUseCase = new ResolvePipelineModelLock(repo, deactivated as any);
            await dispatchUseCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });
            await dispatchUseCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });

            expect(notifRepo.created).toHaveLength(1);
        });
    });

    it("retrying dispatch against an already-blocked run re-confirms the block (409) instead of throwing an illegal-transition error (500)", async () => {
        const repo = new InMemoryPipelineRunRepository();
        const active = [fakeCatalog()];
        const createUseCase = new ResolvePipelineModelLock(repo, fakeGetLlmCatalog(active) as any);

        const run = await createUseCase.createRun({
            projectId: "project-1",
            ownerUserId: "user-1",
            entryMode: "vibe",
            optimizationPolicy: "skip",
        });

        // The catalog changes AFTER creation (locked model deactivated) — every dispatch() call
        // from here on re-checks the live catalog and finds it unavailable.
        const deactivated = fakeGetLlmCatalog([
            fakeCatalog({ models: [{ ...fakeCatalog().models[0]!, isActive: false }] }),
        ]);
        const dispatchUseCase = new ResolvePipelineModelLock(repo, deactivated as any);

        // First dispatch: draft -> blocked (the pre-existing, already-tested transition).
        const first = await dispatchUseCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });
        expect(first.blocked).toEqual({ code: "MODEL_LOCK_UNAVAILABLE", stage: "generate", at: expect.any(Date) });
        expect(first.run.status).toBe("blocked");

        // Second dispatch (a client retry after seeing the 409): blocked -> blocked. Before this
        // hardening pass, this threw "illegal status transition" (a plain Error -> 500),
        // silently discarding the MODEL_LOCK_UNAVAILABLE code the caller needs to show the user.
        const second = await dispatchUseCase.dispatch({ runId: run.id, ownerUserId: "user-1", projectId: "project-1", stage: "generate" });
        expect(second.blocked).toEqual({ code: "MODEL_LOCK_UNAVAILABLE", stage: "generate", at: expect.any(Date) });
        expect(second.run.status).toBe("blocked");
    });
});
