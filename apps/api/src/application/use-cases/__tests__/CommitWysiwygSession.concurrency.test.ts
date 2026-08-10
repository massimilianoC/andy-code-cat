import { describe, expect, it, vi } from "vitest";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../../domain/repositories/PreviewSnapshotRepository";
import type { WysiwygEditSession } from "../../../domain/entities/WysiwygEditSession";
import type { WysiwygEditSessionRepository } from "../../../domain/repositories/WysiwygEditSessionRepository";
import { CommitWysiwygSession } from "../CommitWysiwygSession";

/**
 * Same exclusivity semantics as apps/api/src/application/use-cases/__tests__/CreatePreviewSnapshot.concurrency.test.ts —
 * CommitWysiwygSession.execute() always activates (activate: true is hardcoded), so every
 * commit clears isActive across the whole project before inserting. See
 * docs/specs/PREVIEW_SNAPSHOT_CONCURRENCY_GUARD_PLAN.md §9.1 ("Analogo per Wave 2").
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
            parentSnapshotId: input.parentSnapshotId,
            isActive: input.activate,
            artifacts: input.artifacts,
            serviceManifest: input.serviceManifest,
            metadata: input.metadata,
            createdAt: new Date("2026-08-10T00:00:00.000Z"),
            activatedAt: input.activate ? new Date("2026-08-10T00:00:00.000Z") : undefined,
        };
        this.snapshots.push(snapshot);
        return snapshot;
    });
}

class FakeWysiwygEditSessionRepository implements Pick<WysiwygEditSessionRepository, "findById" | "commit"> {
    constructor(public sessions: WysiwygEditSession[]) { }

    findById = vi.fn(async (sessionId: string, projectId: string) => {
        return this.sessions.find((s) => s.id === sessionId && s.projectId === projectId) ?? null;
    });

    commit = vi.fn(async (sessionId: string, projectId: string, committedSnapshotId: string) => {
        const session = this.sessions.find((s) => s.id === sessionId && s.projectId === projectId);
        if (!session) return null;
        session.status = "committed";
        session.committedSnapshotId = committedSnapshotId;
        return session;
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

function makeSession(overrides: Partial<WysiwygEditSession> = {}): WysiwygEditSession {
    return {
        id: "wysiwyg-1",
        projectId: "project-1",
        userId: "user-1",
        conversationId: "conv-1",
        originSnapshotId: "snap-1",
        currentHtml: "<main>edited</main>",
        currentCss: "",
        currentJs: "",
        operationCount: 3,
        status: "active",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        ...overrides,
    };
}

describe("CommitWysiwygSession — optimistic concurrency guard", () => {
    it("succeeds when expectedActiveSnapshotId is absent, even if a different snapshot is active (backward compatibility)", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const snapshotRepo = new FakePreviewSnapshotRepository(snapshots);
        const wysiwygRepo = new FakeWysiwygEditSessionRepository([makeSession()]);
        const useCase = new CommitWysiwygSession(
            wysiwygRepo as unknown as WysiwygEditSessionRepository,
            snapshotRepo as unknown as PreviewSnapshotRepository,
        );

        const result = await useCase.execute({ sessionId: "wysiwyg-1", projectId: "project-1" });

        expect(result?.snapshot.isActive).toBe(true);
    });

    it("succeeds when expectedActiveSnapshotId matches the currently active snapshot", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const snapshotRepo = new FakePreviewSnapshotRepository(snapshots);
        const wysiwygRepo = new FakeWysiwygEditSessionRepository([makeSession()]);
        const useCase = new CommitWysiwygSession(
            wysiwygRepo as unknown as WysiwygEditSessionRepository,
            snapshotRepo as unknown as PreviewSnapshotRepository,
        );

        const result = await useCase.execute({
            sessionId: "wysiwyg-1",
            projectId: "project-1",
            expectedActiveSnapshotId: "snap-1",
        });

        expect(result?.snapshot.isActive).toBe(true);
        expect(wysiwygRepo.commit).toHaveBeenCalledWith("wysiwyg-1", "project-1", result?.snapshot.id);
    });

    it("throws 409 when expectedActiveSnapshotId points to a snapshot that is no longer active", async () => {
        const snapshots = [
            makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: false }),
            makeSnapshot({ id: "snap-2", conversationId: "conv-1", isActive: true }),
        ];
        const snapshotRepo = new FakePreviewSnapshotRepository(snapshots);
        const wysiwygRepo = new FakeWysiwygEditSessionRepository([makeSession()]);
        const useCase = new CommitWysiwygSession(
            wysiwygRepo as unknown as WysiwygEditSessionRepository,
            snapshotRepo as unknown as PreviewSnapshotRepository,
        );

        await expect(
            useCase.execute({ sessionId: "wysiwyg-1", projectId: "project-1", expectedActiveSnapshotId: "snap-1" }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT",
            details: { expectedActiveSnapshotId: "snap-1", actualActiveSnapshotId: "snap-2" },
        });
    });

    it("never commits the session or inserts a snapshot when a conflict is detected", async () => {
        const snapshots = [makeSnapshot({ id: "snap-1", conversationId: "conv-1", isActive: true })];
        const snapshotRepo = new FakePreviewSnapshotRepository(snapshots);
        const session = makeSession();
        const wysiwygRepo = new FakeWysiwygEditSessionRepository([session]);
        const useCase = new CommitWysiwygSession(
            wysiwygRepo as unknown as WysiwygEditSessionRepository,
            snapshotRepo as unknown as PreviewSnapshotRepository,
        );

        await expect(
            useCase.execute({ sessionId: "wysiwyg-1", projectId: "project-1", expectedActiveSnapshotId: "snap-stale" }),
        ).rejects.toThrow();

        expect(snapshotRepo.create).not.toHaveBeenCalled();
        expect(wysiwygRepo.commit).not.toHaveBeenCalled();
        expect(session.status).toBe("active");
        expect(snapshots).toHaveLength(1);
    });

    it("succeeds when expectedActiveSnapshotId is null and no snapshot is active (first generation)", async () => {
        const snapshotRepo = new FakePreviewSnapshotRepository([]);
        const wysiwygRepo = new FakeWysiwygEditSessionRepository([makeSession({ originSnapshotId: "does-not-exist" })]);
        const useCase = new CommitWysiwygSession(
            wysiwygRepo as unknown as WysiwygEditSessionRepository,
            snapshotRepo as unknown as PreviewSnapshotRepository,
        );

        const result = await useCase.execute({
            sessionId: "wysiwyg-1",
            projectId: "project-1",
            expectedActiveSnapshotId: null,
        });

        expect(result?.snapshot.isActive).toBe(true);
    });

    it("returns null (session not found / already committed) before the guard runs, without touching the snapshot repository", async () => {
        const snapshotRepo = new FakePreviewSnapshotRepository([]);
        const wysiwygRepo = new FakeWysiwygEditSessionRepository([makeSession({ status: "committed" })]);
        const useCase = new CommitWysiwygSession(
            wysiwygRepo as unknown as WysiwygEditSessionRepository,
            snapshotRepo as unknown as PreviewSnapshotRepository,
        );

        const result = await useCase.execute({
            sessionId: "wysiwyg-1",
            projectId: "project-1",
            expectedActiveSnapshotId: "snap-stale",
        });

        expect(result).toBeNull();
        expect(snapshotRepo.getActiveForProject).not.toHaveBeenCalled();
        expect(snapshotRepo.create).not.toHaveBeenCalled();
    });
});
