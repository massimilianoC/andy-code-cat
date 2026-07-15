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
    it("repairs a legacy utility-only snapshot before publishing it", async () => {
        const { PublishProject } = await import("../PublishProject");
        const snapshot: PreviewSnapshot = {
            ...unresolvedSnapshot,
            artifacts: {
                html: "<html><head></head><body><main class='max-w-7xl flex gap-6 bg-ink text-cream'>Ready</main></body></html>",
                css: ":root { --ink: #0A1628; --cream: #F5F1E8; }",
                js: "",
            },
        };
        const writtenFiles = vi.fn(async (_publishId: string, files: Record<string, string>) => Object.keys(files));
        const deployment: SiteDeployment = {
            id: "deployment-1",
            publishId: "abcd1234",
            projectId: "project-1",
            userId: "user-1",
            snapshotId: snapshot.id,
            status: "deploying",
            url: "/p/abcd1234",
            filesDeployed: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const deploymentRepo = {
            isCustomSlugTaken: vi.fn(async () => false),
            findActiveByProjectId: vi.fn(async () => null),
            isPublishIdTaken: vi.fn(async () => false),
            create: vi.fn(async () => deployment),
            updateStatus: vi.fn(async () => ({ ...deployment, status: "live" as const })),
        };
        const useCase = new PublishProject(
            deploymentRepo as any,
            createSnapshotRepo(snapshot) as any,
            { writePublishFiles: writtenFiles } as any,
        );

        await useCase.execute({ projectId: "project-1", userId: "user-1", snapshotId: snapshot.id });

        const files = writtenFiles.mock.calls[0]?.[1] as Record<string, string>;
        const indexHtml = files["index.html"];
        expect(indexHtml).toContain("tailwind.config");
        expect(indexHtml).toContain("cdn.tailwindcss.com/3.4.17");
        expect(indexHtml?.indexOf("cdn.tailwindcss.com")).toBeLessThan(indexHtml?.indexOf("tailwind.config") ?? -1);
    });

    it("normalizes published media URLs to the public same-origin path", async () => {
        const { normalizePublishedMediaUrls } = await import("../PublishProject");
        const content = [
            'src="http://localhost:4000/p/media/asset-1"',
            "url(https://api.example.test/p/media/asset-2?size=large)",
            'href="https://cdn.example.test/image.jpg"',
        ].join("\n");

        expect(normalizePublishedMediaUrls(content)).toBe([
            'src="/p/media/asset-1"',
            "url(/p/media/asset-2?size=large)",
            'href="https://cdn.example.test/image.jpg"',
        ].join("\n"));
    });

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
