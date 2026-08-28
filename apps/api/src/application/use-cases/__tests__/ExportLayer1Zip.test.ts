import { describe, expect, it, vi, afterEach } from "vitest";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import { SystemNotifier } from "../../services/SystemNotifier";

// AL-025: export resolves the active version at PROJECT scope (AL-016), the same reading
// PublishProject already uses. These tests pin the repository method chosen — not the whole
// zip-building flow, which PublishExportMediaGuardrails.test.ts already exercises — so a snapshot
// with an unresolved media placeholder is used to short-circuit before any file I/O, the same
// technique that file already relies on.
const unresolvedSnapshot: PreviewSnapshot = {
    id: "snapshot-1",
    projectId: "project-1",
    conversationId: "conversation-owning-it",
    isActive: true,
    artifacts: {
        html: '<img src="asset://media/hero-main" alt="Hero">',
        css: "",
        js: "",
    },
    createdAt: new Date("2026-05-29T00:00:00.000Z"),
};

function createSnapshotRepo(snapshot: PreviewSnapshot | null) {
    return {
        findById: vi.fn(async () => snapshot),
        getActiveForProject: vi.fn(async () => snapshot),
        getActive: vi.fn(async () => snapshot),
    };
}

function loadEnv() {
    process.env.MONGODB_URI = "mongodb://localhost:27017/test";
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.EXPORT_JWT_SECRET = "test-export-secret";
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("ExportLayer1Zip — AL-025 project-scoped active resolution", () => {
    it("resolves via getActiveForProject, not getActive, when no snapshotId is supplied — even with a conversationId belonging to another conversation", async () => {
        loadEnv();
        const { ExportLayer1Zip } = await import("../ExportLayer1Zip");
        vi.spyOn(SystemNotifier.instance, "emit").mockImplementation(() => undefined);
        const exportRepo = { create: vi.fn(), updateFailed: vi.fn(), updateReady: vi.fn() };
        const storage = { exportZipPath: vi.fn(() => "unused.zip"), ensureDir: vi.fn() };
        const snapshotRepo = createSnapshotRepo(unresolvedSnapshot);
        const useCase = new ExportLayer1Zip(exportRepo as any, snapshotRepo as any, storage as any);

        // A conversationId is supplied but points at a conversation other than the active
        // snapshot's own — activation is project-scoped, so this must not matter.
        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            projectName: "Project",
            conversationId: "some-other-conversation",
        })).rejects.toThrow("Cannot export while media placeholders are unresolved");

        expect(snapshotRepo.getActiveForProject).toHaveBeenCalledWith("project-1");
        expect(snapshotRepo.getActive).not.toHaveBeenCalled();
    });

    it("still uses findById when an explicit snapshotId is supplied", async () => {
        loadEnv();
        const { ExportLayer1Zip } = await import("../ExportLayer1Zip");
        vi.spyOn(SystemNotifier.instance, "emit").mockImplementation(() => undefined);
        const exportRepo = { create: vi.fn(), updateFailed: vi.fn(), updateReady: vi.fn() };
        const storage = { exportZipPath: vi.fn(() => "unused.zip"), ensureDir: vi.fn() };
        const snapshotRepo = createSnapshotRepo(unresolvedSnapshot);
        const useCase = new ExportLayer1Zip(exportRepo as any, snapshotRepo as any, storage as any);

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            projectName: "Project",
            snapshotId: "snapshot-1",
        })).rejects.toThrow("Cannot export while media placeholders are unresolved");

        expect(snapshotRepo.findById).toHaveBeenCalledWith("project-1", "snapshot-1");
        expect(snapshotRepo.getActiveForProject).not.toHaveBeenCalled();
        expect(snapshotRepo.getActive).not.toHaveBeenCalled();
    });

    it("reports a project-scoped error, not a stale conversationId hint, when nothing is active", async () => {
        loadEnv();
        const { ExportLayer1Zip } = await import("../ExportLayer1Zip");
        const exportRepo = { create: vi.fn(), updateFailed: vi.fn(), updateReady: vi.fn() };
        const storage = { exportZipPath: vi.fn(() => "unused.zip"), ensureDir: vi.fn() };
        const snapshotRepo = createSnapshotRepo(null);
        const useCase = new ExportLayer1Zip(exportRepo as any, snapshotRepo as any, storage as any);

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            projectName: "Project",
        })).rejects.toThrow("No active snapshot found for this project. Provide a snapshotId, or activate a version first.");

        expect(snapshotRepo.getActiveForProject).toHaveBeenCalledWith("project-1");
    });
});
