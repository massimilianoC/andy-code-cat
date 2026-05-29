import { describe, expect, it, vi, afterEach } from "vitest";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { SiteDeployment } from "../../../domain/entities/SiteDeployment";
import { SystemNotifier } from "../../services/SystemNotifier";

const unresolvedSnapshot: PreviewSnapshot = {
    id: "snapshot-1",
    projectId: "project-1",
    conversationId: "conversation-1",
    isActive: true,
    artifacts: {
        html: '<img src="asset://media/hero-main" alt="Hero">',
        css: "",
        js: "",
    },
    createdAt: new Date("2026-05-29T00:00:00.000Z"),
};

function createSnapshotRepo(snapshot: PreviewSnapshot) {
    return {
        findById: vi.fn(async () => snapshot),
        getActiveForProject: vi.fn(async () => snapshot),
        getActive: vi.fn(async () => snapshot),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("publish/export unresolved media guardrails", () => {
    it("blocks publish before writing files when a snapshot still has media placeholders", async () => {
        const { PublishProject } = await import("../PublishProject");
        const notifierSpy = vi.spyOn(SystemNotifier.instance, "emit").mockImplementation(() => undefined);
        const deploymentRepo = {
            isCustomSlugTaken: vi.fn(async () => false),
            findActiveByProjectId: vi.fn(async () => null),
            isPublishIdTaken: vi.fn(async () => false),
            create: vi.fn(),
            updateStatus: vi.fn(),
        };
        const storage = { writePublishFiles: vi.fn() };
        const useCase = new PublishProject(
            deploymentRepo as any,
            createSnapshotRepo(unresolvedSnapshot) as any,
            storage as any,
        );

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            snapshotId: "snapshot-1",
        })).rejects.toThrow("Cannot publish while media placeholders are unresolved");

        expect(storage.writePublishFiles).not.toHaveBeenCalled();
        expect(deploymentRepo.create).not.toHaveBeenCalled();
        expect(notifierSpy).toHaveBeenCalledWith(expect.objectContaining({
            domain: "publish",
            sourceEventType: "publish_blocked_unresolved_media",
            metadata: expect.objectContaining({ unresolvedMediaKeys: ["hero-main"] }),
        }));
    });

    it("blocks republish before overwriting live files when a snapshot still has media placeholders", async () => {
        const { PublishProject } = await import("../PublishProject");
        const notifierSpy = vi.spyOn(SystemNotifier.instance, "emit").mockImplementation(() => undefined);
        const existing: SiteDeployment = {
            id: "deployment-1",
            publishId: "abcd1234",
            projectId: "project-1",
            userId: "user-1",
            snapshotId: "old-snapshot",
            status: "live",
            url: "/p/abcd1234",
            filesDeployed: ["index.html"],
            createdAt: new Date("2026-05-29T00:00:00.000Z"),
            updatedAt: new Date("2026-05-29T00:00:00.000Z"),
        };
        const deploymentRepo = {
            isCustomSlugTaken: vi.fn(async () => false),
            findActiveByProjectId: vi.fn(async () => existing),
            updateStatus: vi.fn(),
        };
        const storage = { writePublishFiles: vi.fn() };
        const useCase = new PublishProject(
            deploymentRepo as any,
            createSnapshotRepo(unresolvedSnapshot) as any,
            storage as any,
        );

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            snapshotId: "snapshot-1",
        })).rejects.toThrow("Cannot publish while media placeholders are unresolved");

        expect(storage.writePublishFiles).not.toHaveBeenCalled();
        expect(deploymentRepo.updateStatus).not.toHaveBeenCalled();
        expect(notifierSpy).toHaveBeenCalledWith(expect.objectContaining({
            sourceEventType: "publish_blocked_unresolved_media",
        }));
    });

    it("blocks Layer 1 export before creating export records or ZIP files", async () => {
        process.env.MONGODB_URI = "mongodb://localhost:27017/test";
        process.env.JWT_ACCESS_SECRET = "test-access-secret";
        process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
        process.env.EXPORT_JWT_SECRET = "test-export-secret";
        const { ExportLayer1Zip } = await import("../ExportLayer1Zip");
        const notifierSpy = vi.spyOn(SystemNotifier.instance, "emit").mockImplementation(() => undefined);
        const exportRepo = {
            create: vi.fn(),
            updateFailed: vi.fn(),
            updateReady: vi.fn(),
        };
        const storage = {
            exportZipPath: vi.fn(() => "unused.zip"),
            ensureDir: vi.fn(),
        };
        const useCase = new ExportLayer1Zip(
            exportRepo as any,
            createSnapshotRepo(unresolvedSnapshot) as any,
            storage as any,
        );

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            projectName: "Project",
            snapshotId: "snapshot-1",
        })).rejects.toThrow("Cannot export while media placeholders are unresolved");

        expect(exportRepo.create).not.toHaveBeenCalled();
        expect(storage.ensureDir).not.toHaveBeenCalled();
        expect(notifierSpy).toHaveBeenCalledWith(expect.objectContaining({
            domain: "export",
            sourceEventType: "export_blocked_unresolved_media",
            metadata: expect.objectContaining({ unresolvedMediaKeys: ["hero-main"] }),
        }));
    });
});
