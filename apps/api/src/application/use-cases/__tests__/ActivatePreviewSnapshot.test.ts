import { describe, expect, it, vi } from "vitest";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../../domain/repositories/PreviewSnapshotRepository";
import { ActivatePreviewSnapshot } from "../ActivatePreviewSnapshot";

/**
 * Minimal in-memory fake for the "active version" invariant this use-case protects
 * (docs/guides/TEST_COVERAGE_ROADMAP.md §3.2): exactly one snapshot per project (or
 * per conversation) is isActive at a time. The fake enforces the same exclusivity the
 * real MongoPreviewSnapshotRepository enforces with updateMany+updateOne, so a test
 * asserting "only the target is active afterwards" is meaningful here too — the
 * Mongo-specific race/atomicity concern is out of scope for this use-case-level test
 * and is tracked separately (roadmap §3.2 item 2, needs mongodb-memory-server).
 */
function makeSnapshot(overrides: Partial<PreviewSnapshot> & Pick<PreviewSnapshot, "id" | "conversationId">): PreviewSnapshot {
    return {
        projectId: "project-1",
        isActive: false,
        artifacts: { html: "<main></main>", css: "", js: "" },
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        ...overrides,
    };
}

class FakePreviewSnapshotRepository implements Pick<PreviewSnapshotRepository,
    "findById" | "activate" | "activateForProject"> {
    constructor(public snapshots: PreviewSnapshot[]) { }

    findById = vi.fn(async (projectId: string, snapshotId: string) => {
        return this.snapshots.find((s) => s.id === snapshotId && s.projectId === projectId) ?? null;
    });

    activate = vi.fn(async (projectId: string, conversationId: string, snapshotId: string) => {
        const target = this.snapshots.find((s) => s.id === snapshotId && s.conversationId === conversationId && s.projectId === projectId);
        if (!target) return null;
        this.snapshots.forEach((s) => { if (s.conversationId === conversationId) s.isActive = false; });
        target.isActive = true;
        return target;
    });

    activateForProject = vi.fn(async (projectId: string, snapshotId: string) => {
        const target = this.snapshots.find((s) => s.id === snapshotId && s.projectId === projectId);
        if (!target) return null;
        this.snapshots.forEach((s) => { if (s.projectId === projectId) s.isActive = false; });
        target.isActive = true;
        return target;
    });
}

describe("ActivatePreviewSnapshot", () => {
    it("activates the target snapshot and deactivates all others in the conversation", async () => {
        const snapshots = [
            makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true }),
            makeSnapshot({ id: "snap-2", conversationId: "conv-1", isActive: false }),
        ];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new ActivatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        const result = await useCase.execute({ projectId: "project-1", conversationId: "conv-1", snapshotId: "snap-2" });

        expect(result.id).toBe("snap-2");
        expect(repository.activate).toHaveBeenCalledWith("project-1", "conv-1", "snap-2");
        expect(repository.activateForProject).not.toHaveBeenCalled();
        const activeIds = snapshots.filter((s) => s.isActive).map((s) => s.id);
        expect(activeIds).toEqual(["snap-2"]);
    });

    it("activates at project level (activateForProject) when no conversationId is supplied", async () => {
        const snapshots = [
            makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true }),
            makeSnapshot({ id: "snap-2", conversationId: "conv-2", isActive: false }),
        ];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new ActivatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        const result = await useCase.execute({ projectId: "project-1", snapshotId: "snap-2" });

        expect(result.id).toBe("snap-2");
        expect(repository.activateForProject).toHaveBeenCalledWith("project-1", "snap-2");
        expect(repository.activate).not.toHaveBeenCalled();
        const activeIds = snapshots.filter((s) => s.isActive).map((s) => s.id);
        expect(activeIds).toEqual(["snap-2"]);
    });

    it("throws 404 when the snapshot does not exist", async () => {
        const repository = new FakePreviewSnapshotRepository([]);
        const useCase = new ActivatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        await expect(
            useCase.execute({ projectId: "project-1", conversationId: "conv-1", snapshotId: "missing" }),
        ).rejects.toMatchObject({ status: 404 });
    });

    it("throws 404 when the snapshot belongs to a different conversation", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1" })];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new ActivatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        await expect(
            useCase.execute({ projectId: "project-1", conversationId: "conv-2", snapshotId: "snap-1" }),
        ).rejects.toMatchObject({ status: 404 });
    });

    it("throws 400 and never mutates the repository when the target has unresolved media placeholders", async () => {
        const snapshots = [
            makeSnapshot({
                id: "broken",
                conversationId: "conv-1",
                artifacts: { html: "", css: '.x{background:url("asset://media/missing")}', js: "" },
            }),
        ];
        const repository = new FakePreviewSnapshotRepository(snapshots);
        const useCase = new ActivatePreviewSnapshot(repository as unknown as PreviewSnapshotRepository);

        await expect(
            useCase.execute({ projectId: "project-1", conversationId: "conv-1", snapshotId: "broken" }),
        ).rejects.toMatchObject({ status: 400 });

        expect(repository.activate).not.toHaveBeenCalled();
        expect(repository.activateForProject).not.toHaveBeenCalled();
        expect(snapshots[0]!.isActive).toBe(false);
    });
});
