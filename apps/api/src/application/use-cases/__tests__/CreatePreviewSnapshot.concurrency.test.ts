import { describe, expect, it, vi } from "vitest";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../../domain/repositories/PreviewSnapshotRepository";
import { CreatePreviewSnapshot } from "../CreatePreviewSnapshot";

/**
 * In-memory fake replicating the exclusivity semantics of the real
 * MongoPreviewSnapshotRepository.create({activate:true}): clears isActive across the
 * WHOLE project, then inserts the new snapshot as active. Same approach as the fake in
 * apps/api/src/application/use-cases/__tests__/ActivatePreviewSnapshot.test.ts (on branch
 * chore/ci-and-testing-policy, not yet merged here — rebuilt locally per
 * docs/specs/PREVIEW_SNAPSHOT_CONCURRENCY_GUARD_PLAN.md §9.1).
 */
class FakePreviewSnapshotRepository implements Pick<PreviewSnapshotRepository,
    "create" | "findById" | "getActiveForProject"> {
    private counter = 0;

    constructor(public snapshots: PreviewSnapshot[]) { }

    findById = vi.fn(async (projectId: string, snapshotId: string) => {
        return this.snapshots.find((s) => s.id === snapshotId && s.projectId === projectId) ?? null;
    });

    getActiveForProject = vi.fn(async (projectId: string) => {
        return this.snapshots.find((s) => s.projectId === projectId && s.isActive) ?? null;
    });

    create = vi.fn(async (input: Parameters<PreviewSnapshotRepository["create"]>[0]) => {
        if (input.activate) {
            this.snapshots.forEach((s) => { if (s.projectId === input.projectId) s.isActive = false; });
        }
        const snapshot: PreviewSnapshot = {
            id: `snap-new-${++this.counter}`,
            projectId: input.projectId,
            conversationId: input.conversationId,
            sourceMessageId: input.sourceMessageId,
            parentSnapshotId: input.parentSnapshotId,
            isActive: input.activate,
            artifacts: input.artifacts,
            serviceManifest: input.serviceManifest,
            focusContext: input.focusContext,
            metadata: input.metadata,
            createdAt: new Date("2026-08-10T00:00:00.000Z"),
            activatedAt: input.activate ? new Date("2026-08-10T00:00:00.000Z") : undefined,
        };
        this.snapshots.push(snapshot);
        return snapshot;
    });
}

function makeSnapshot(overrides: Partial<PreviewSnapshot> & Pick<PreviewSnapshot, "id" | "conversationId">): PreviewSnapshot {
    return {
        projectId: "project-1",
        isActive: false,
        artifacts: { html: "<main></main>", css: "", js: "" },
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        ...overrides,
    };
}

const baseInput = {
    projectId: "project-1",
    conversationId: "conv-1",
    artifacts: { html: "<main>v2</main>", css: "", js: "" },
    activate: true,
};

describe("CreatePreviewSnapshot — optimistic concurrency guard", () => {
    it("succeeds when expectedActiveSnapshotId is absent, even if a different snapshot is active (backward compatibility)", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        const result = await useCase.execute({ ...baseInput });

        expect(result.isActive).toBe(true);
        expect(repository.create).toHaveBeenCalledOnce();
    });

    it("succeeds when expectedActiveSnapshotId matches the currently active snapshot", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        const result = await useCase.execute({ ...baseInput, expectedActiveSnapshotId: "snap-1" });

        expect(result.isActive).toBe(true);
        const activeIds = snapshots.filter((s) => s.isActive).map((s) => s.id);
        expect(activeIds).toEqual([result.id]);
    });

    it("throws 409 when expectedActiveSnapshotId points to a snapshot that is no longer active", async () => {
        const snapshots = [
            makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: false }),
            makeSnapshot({ id: "snap-2", conversationId: "conv-1", isActive: true }),
        ];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        await expect(
            useCase.execute({ ...baseInput, expectedActiveSnapshotId: "snap-1" }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT",
            details: { expectedActiveSnapshotId: "snap-1", actualActiveSnapshotId: "snap-2" },
        });
    });

    it("succeeds when expectedActiveSnapshotId is null and no snapshot is active (first generation)", async () => {
        const snapshots: PreviewSnapshot[] = [];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        const result = await useCase.execute({ ...baseInput, expectedActiveSnapshotId: null });

        expect(result.isActive).toBe(true);
    });

    it("throws 409 when expectedActiveSnapshotId is null but a snapshot is already active", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        await expect(
            useCase.execute({ ...baseInput, expectedActiveSnapshotId: null }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT",
            details: { expectedActiveSnapshotId: null, actualActiveSnapshotId: "snap-1" },
        });
    });

    it("never calls repository.create when a conflict is detected — no snapshot is inserted", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        await expect(
            useCase.execute({ ...baseInput, expectedActiveSnapshotId: "snap-stale" }),
        ).rejects.toThrow();

        expect(repository.create).not.toHaveBeenCalled();
        expect(snapshots).toHaveLength(1);
    });

    it("succeeds despite a stale expectedActiveSnapshotId when activate is false — the guard only applies to activation", async () => {
        const snapshots = [
            makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: false }),
            makeSnapshot({ id: "snap-2", conversationId: "conv-1", isActive: true }),
        ];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        const result = await useCase.execute({ ...baseInput, activate: false, expectedActiveSnapshotId: "snap-1" });

        expect(result.isActive).toBe(false);
        expect(repository.getActiveForProject).not.toHaveBeenCalled();
    });

    it("succeeds on a deliberate branch — expectedActiveSnapshotId differs from parentSnapshotId but matches the real active snapshot", async () => {
        const snapshots = [
            makeSnapshot({ id: "snap-old", conversationId: "conv-1", isActive: false }),
            makeSnapshot({ id: "snap-active", conversationId: "conv-1", isActive: true }),
        ];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        const result = await useCase.execute({
            ...baseInput,
            parentSnapshotId: "snap-old",
            expectedActiveSnapshotId: "snap-active",
        });

        expect(result.isActive).toBe(true);
        expect(result.parentSnapshotId).toBe("snap-old");
    });

    it("reports 400 (unresolved media placeholders) rather than 409 when both problems are present — error precedence is unchanged", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new CreatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        await expect(
            useCase.execute({
                ...baseInput,
                artifacts: { html: '<img src="asset://media/hero-image">', css: "", js: "" },
                expectedActiveSnapshotId: "snap-stale",
            }),
        ).rejects.toMatchObject({ status: 400 });
        expect(repository.create).not.toHaveBeenCalled();
    });
});
