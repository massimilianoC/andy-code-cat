import { describe, expect, it, vi } from "vitest";
import type { ArtifactMediaManifest } from "@andy-code-cat/contracts";
import type { AssetSource, ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { ExternalImageDownloader } from "../../../infra/image/ExternalImageDownloader";
import type { ResolvedImageSearchResult } from "../../../infra/image/types";
import { ResolveArtifactMedia } from "../ResolveArtifactMedia";

vi.mock("../../services/ExecutionLogger", () => ({
    ExecutionLogger: {
        instance: {
            emit: vi.fn(),
        },
    },
}));

vi.mock("../../../config", () => ({
    env: {
        PUBLIC_API_BASE_URL: "http://api.test",
        imageStockPersistStrict: false,
    },
}));

class MemoryAssetRepository {
    assets: ProjectAsset[] = [];

    async create(input: {
        projectId: string;
        userId: string;
        originalName: string;
        storedFilename: string;
        mimeType: string;
        fileSize: number;
        source: AssetSource;
        scope?: "project" | "user" | "global";
        label?: string;
    }): Promise<ProjectAsset> {
        const asset: ProjectAsset = {
            id: `asset-${this.assets.length + 1}`,
            createdAt: new Date("2026-05-29T00:00:00.000Z"),
            scope: "project",
            ...input,
        };
        this.assets.push(asset);
        return asset;
    }

    async update(id: string, _projectId: string, _userId: string, data: Partial<ProjectAsset>) {
        const index = this.assets.findIndex((asset) => asset.id === id);
        if (index < 0) return null;
        const current = this.assets[index]!;
        this.assets[index] = { ...current, ...data };
        return this.assets[index];
    }

    listByProject = vi.fn();
    listByUser = vi.fn();
    findById = vi.fn();
    findByIdPublic = vi.fn();
    delete = vi.fn();
    totalProjectSize = vi.fn();
    countByProject = vi.fn();
    summarizeGenerationByProject = vi.fn();
    summarizeGenerationCostsByUser = vi.fn();
    listRecentGeneratedByProject = vi.fn();
    summarizeGenerationAll = vi.fn();
    listRecentGeneratedAll = vi.fn();
    saveEnrichmentTrace = vi.fn();
}

class MemoryStorage {
    files = new Map<string, Buffer>();
    uploadDirPath(userId: string, projectId: string) { return `/uploads/${userId}/${projectId}`; }
    uploadFilePath(userId: string, projectId: string, storedFilename: string) { return `/uploads/${userId}/${projectId}/${storedFilename}`; }
    async saveUpload(userId: string, projectId: string, storedFilename: string, buffer: Buffer) {
        const filePath = this.uploadFilePath(userId, projectId, storedFilename);
        this.files.set(filePath, buffer);
        return filePath;
    }
    deleteUpload = vi.fn();
    createReadStream = vi.fn();
    exportDirPath = vi.fn();
    exportZipPath = vi.fn();
    writeExportFile = vi.fn();
    deleteExportDir = vi.fn();
    publishDirPath = vi.fn();
    writePublishFiles = vi.fn();
    resolvePublishFile = vi.fn();
    deletePublishDir = vi.fn();
    copyPublishDir = vi.fn();
    workspacePath = vi.fn();
    workspaceInputPath = vi.fn();
    workspaceInputAssetsPath = vi.fn();
    workspaceInputLayer1Path = vi.fn();
    workspaceOutputPath = vi.fn();
    workspaceLogsPath = vi.fn();
    writeWorkspaceFile = vi.fn();
    deleteWorkspaceDir = vi.fn();
    profileDirPath = vi.fn();
    writeProfileData = vi.fn();
    readProfileData = vi.fn();
    deleteProfileData = vi.fn();
    thumbnailFilePath = vi.fn();
    saveThumbnailFile = vi.fn();
    getThumbnailStream = vi.fn();
    deleteThumbnailFile = vi.fn();
    ensureDir = vi.fn();
    fileExists = vi.fn();
    fileSize = vi.fn();
}

class MemoryTraceRepository {
    traces: any[] = [];
    attachSnapshot = vi.fn();

    async createMany(input: any[]) {
        const created = input.map((trace, index) => ({
            id: `trace-${this.traces.length + index + 1}`,
            createdAt: new Date("2026-05-29T00:00:00.000Z"),
            ...trace,
        }));
        this.traces.push(...created);
        return created;
    }
}

const resolved: ResolvedImageSearchResult = {
    url: "https://images.pexels.com/photos/1/test.jpg",
    attribution: "Pexels - Tester",
    width: 1600,
    height: 900,
    mediaType: "photo",
    provider: "pexels",
    fallbackUsed: false,
    attemptedProviders: [{ provider: "pexels", status: "success" }],
};

const manifest: ArtifactMediaManifest = {
    version: "media-manifest-v1",
    requests: [{
        key: "hero-main",
        kind: "background",
        role: "hero",
        sourceStrategy: "stock",
        semanticQuery: "modern architecture studio",
        alt: "Modern architecture studio",
        width: 1600,
        height: 900,
        priority: 10,
    }],
};

describe("ResolveArtifactMedia", () => {
    it("persists manifest placeholders as project assets and replaces HTML/CSS references", async () => {
        const repo = new MemoryAssetRepository();
        const storage = new MemoryStorage();
        const traceRepository = new MemoryTraceRepository();
        const downloader: ExternalImageDownloader = {
            download: vi.fn(async () => ({
                buffer: Buffer.from("fake-image"),
                mimeType: "image/jpeg",
                bytes: 10,
                finalUrl: resolved.url,
            })),
        };
        const imageResolver = vi.fn(async () => resolved);
        const useCase = new ResolveArtifactMedia(
            repo as any,
            storage as any,
            undefined,
            downloader,
            imageResolver,
            undefined,
            traceRepository as any,
        );

        const result = await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                html: '<section data-media-key="hero-main"></section>',
                css: '.hero{background-image:url("asset://media/hero-main")}',
                js: "",
            },
            mediaManifest: manifest,
            sourceContext: { route: "chat-preview" },
            mode: "initial_generation",
        });

        expect(result.artifacts.css).toContain("http://api.test/p/media/asset-1");
        expect(result.artifacts.css).not.toContain("asset://media/hero-main");
        expect(result.resolvedAssets).toHaveLength(1);
        expect(result.traces[0]).toMatchObject({
            traceId: "trace-1",
            mediaKey: "hero-main",
            provider: "pexels",
            fallbackUsed: false,
            assetId: "asset-1",
        });
        expect(result.metadata).toMatchObject({
            version: "media-resolution-v1",
            traceIds: ["trace-1"],
            assetIds: ["asset-1"],
            mediaKeys: ["hero-main"],
            degraded: false,
        });
        expect(result.metadata?.directives?.[0]).toMatchObject({
            key: "hero-main",
            status: "resolved",
            provider: "pexels",
            assetId: "asset-1",
        });
        expect(traceRepository.traces[0]).toMatchObject({
            mediaKey: "hero-main",
            resolvedAssetId: "asset-1",
            status: "resolved",
            providerKind: "stock",
            finalProvider: "pexels",
        });
        expect(repo.assets[0]?.generationMetadata?.providerResponse?.query).toBe("modern architecture studio");
        expect(repo.assets[0]?.generationMetadata).toMatchObject({
            conversationId: undefined,
            mediaKey: "hero-main",
            semanticQuery: "modern architecture studio",
            resolutionRoute: "chat-preview",
            fallbackUsed: false,
        });
    });

    it("rejects placeholders without a matching manifest request", async () => {
        const useCase = new ResolveArtifactMedia(
            new MemoryAssetRepository() as any,
            new MemoryStorage() as any,
            undefined,
            { download: vi.fn() },
            vi.fn(),
        );

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                html: '<img src="asset://media/missing-key">',
                css: "",
                js: "",
            },
            mediaManifest: manifest,
            sourceContext: { route: "chat-preview" },
            mode: "initial_generation",
        })).rejects.toThrow("Missing mediaManifest request");
    });

    it("uses the platform stock provider policy when resolving manifest media", async () => {
        const repo = new MemoryAssetRepository();
        const storage = new MemoryStorage();
        const downloader: ExternalImageDownloader = {
            download: vi.fn(async () => ({
                buffer: Buffer.from("fake-image"),
                mimeType: "image/jpeg",
                bytes: 10,
                finalUrl: resolved.url,
            })),
        };
        const imageResolver = vi.fn(async () => ({
            ...resolved,
            provider: "pixabay",
            attemptedProviders: [{ provider: "pixabay", status: "success" }],
        } satisfies ResolvedImageSearchResult));
        const platformConfigRepository = {
            get: vi.fn(async () => ({
                mediaProviderPolicy: {
                    stockImage: {
                        primaryProvider: "pixabay",
                        fallbackEnabled: false,
                        fallbackProviders: [],
                        allowPicsumFallback: false,
                    },
                },
            })),
        };
        const useCase = new ResolveArtifactMedia(
            repo as any,
            storage as any,
            undefined,
            downloader,
            imageResolver,
            platformConfigRepository as any,
        );

        await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                html: '<img src="asset://media/hero-main" alt="Hero">',
                css: "",
                js: "",
            },
            mediaManifest: manifest,
            sourceContext: { route: "chat-preview" },
            mode: "initial_generation",
        });

        expect(imageResolver).toHaveBeenCalledWith(
            expect.objectContaining({ query: "modern architecture studio" }),
            {},
            ["pixabay"],
        );
    });

    it("warns (does not throw) when data-media-key exists without a resolved asset URL", async () => {
        // Reproduces the MiniMax bug: LLM puts data-media-key on an element but uses a CSS
        // gradient instead of an asset://media/ placeholder, so the resolver never runs.
        const repo = new MemoryAssetRepository();
        const storage = new MemoryStorage();
        const useCase = new ResolveArtifactMedia(
            repo as any,
            storage as any,
            undefined,
            { download: vi.fn() },
            vi.fn(),
        );

        const result = await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                // data-media-key present, but src is a gradient — no asset://media/ placeholder
                html: '<section data-media-key="hero-acoustic" style="background:linear-gradient(...)"></section>',
                css: "",
                js: "",
            },
            mediaManifest: undefined, // no manifest
            sourceContext: { route: "chat-preview" },
            mode: "initial_generation",
        });

        // Should not throw; artifact is returned as-is with a warning
        const failedWarning = result.warnings.find(
            (w) => w.code === "media_resolution_failed" && w.mediaKey === "hero-acoustic",
        );
        expect(failedWarning).toBeDefined();
        expect(result.resolvedAssets).toHaveLength(0);

        // GAP-3 fix: even with nothing resolved, the snapshot must carry structured proof of degradation.
        expect(result.metadata).toBeDefined();
        expect(result.metadata?.degraded).toBe(true);
        expect(result.metadata?.mediaKeys).toContain("hero-acoustic");
    });

    it("resolves and injects via data-media-key when there is no asset://media placeholder", async () => {
        // The model annotated an element with data-media-key + provided a manifest request,
        // but used no asset://media placeholder. The resolver must still fetch and inject.
        const repo = new MemoryAssetRepository();
        const storage = new MemoryStorage();
        const downloader: ExternalImageDownloader = {
            download: vi.fn(async () => ({
                buffer: Buffer.from("fake-image"),
                mimeType: "image/jpeg",
                bytes: 10,
                finalUrl: resolved.url,
            })),
        };
        const imageResolver = vi.fn(async () => resolved);
        const traceRepository = new MemoryTraceRepository();
        const useCase = new ResolveArtifactMedia(
            repo as any,
            storage as any,
            undefined,
            downloader,
            imageResolver,
            undefined,
            traceRepository as any,
        );

        const result = await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                // data-media-key on an empty section, NO asset://media placeholder anywhere
                html: '<section class="cta" data-media-key="cta-background"></section>',
                css: ".cta{height:300px}",
                js: "",
            },
            mediaManifest: {
                version: "media-manifest-v1",
                requests: [{
                    key: "cta-background",
                    kind: "background",
                    role: "background",
                    sourceStrategy: "stock",
                    semanticQuery: "call to action banner abstract",
                    alt: "CTA background",
                    priority: 5,
                }],
            },
            sourceContext: { route: "chat-preview" },
            mode: "initial_generation",
        });

        // Resolved + persisted + injected as a scoped CSS rule on the data-media-key element.
        expect(result.resolvedAssets).toHaveLength(1);
        expect(result.artifacts.css).toContain("[data-media-key=\"cta-background\"]");
        expect(result.artifacts.css).toContain("http://api.test/p/media/asset-1");
        // Directive summary present and resolved.
        const directive = result.metadata?.directives?.find((d) => d.key === "cta-background");
        expect(directive?.status).toBe("resolved");
        expect(directive?.semanticQuery).toBe("call to action banner abstract");
        expect(directive?.assetId).toBe("asset-1");
    });

    it("injects src when the data-media-key element is an <img>", async () => {
        const repo = new MemoryAssetRepository();
        const storage = new MemoryStorage();
        const downloader: ExternalImageDownloader = {
            download: vi.fn(async () => ({
                buffer: Buffer.from("fake-image"), mimeType: "image/jpeg", bytes: 10, finalUrl: resolved.url,
            })),
        };
        const useCase = new ResolveArtifactMedia(
            repo as any, storage as any, undefined, downloader, vi.fn(async () => resolved), undefined,
        );

        const result = await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                html: '<img class="logo" data-media-key="brand-logo" alt="logo">',
                css: "",
                js: "",
            },
            mediaManifest: {
                version: "media-manifest-v1",
                requests: [{
                    key: "brand-logo", kind: "logo", role: "logo", sourceStrategy: "stock",
                    semanticQuery: "minimal brand logo", alt: "logo", priority: 1,
                }],
            },
            sourceContext: { route: "chat-preview" },
            mode: "initial_generation",
        });

        expect(result.resolvedAssets).toHaveLength(1);
        expect(result.artifacts.html).toContain('src="http://api.test/p/media/asset-1"');
    });

    it("emits deterministic progress events (start, resolved, replacing, done)", async () => {
        const repo = new MemoryAssetRepository();
        const storage = new MemoryStorage();
        const downloader: ExternalImageDownloader = {
            download: vi.fn(async () => ({
                buffer: Buffer.from("fake-image"),
                mimeType: "image/jpeg",
                bytes: 10,
                finalUrl: resolved.url,
            })),
        };
        const imageResolver = vi.fn(async () => resolved);
        const useCase = new ResolveArtifactMedia(
            repo as any,
            storage as any,
            undefined,
            downloader,
            imageResolver,
            undefined,
        );

        const events: any[] = [];
        await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                html: '<img src="asset://media/hero-main" alt="Hero">',
                css: "",
                js: "",
            },
            mediaManifest: manifest,
            sourceContext: { route: "chat-preview-stream", conversationId: "conversation-1", parentSnapshotId: "snapshot-0" },
            mode: "initial_generation",
            onProgress: (e) => events.push(e),
        });

        const phases = events.map((e) => e.phase);
        expect(phases).toContain("start");
        expect(phases).toContain("resolved");
        expect(phases).toContain("replacing");
        expect(phases).toContain("done");
        const startEvent = events.find((e) => e.phase === "start");
        expect(startEvent.total).toBe(1);
        const doneEvent = events.find((e) => e.phase === "done");
        expect(doneEvent.resolvedCount).toBe(1);
        expect(repo.assets[0]?.generationMetadata).toMatchObject({
            conversationId: "conversation-1",
            parentSnapshotId: "snapshot-0",
            mediaKey: "hero-main",
            resolutionRoute: "chat-preview-stream",
        });
    });

    it("continues resolving other images when one image provider throws", async () => {
        // Reproduces the all-or-nothing bug: one request throws, others should still resolve.
        const repo = new MemoryAssetRepository();
        const storage = new MemoryStorage();
        const downloader: ExternalImageDownloader = {
            download: vi.fn(async () => ({
                buffer: Buffer.from("fake-image"),
                mimeType: "image/jpeg",
                bytes: 10,
                finalUrl: resolved.url,
            })),
        };

        let callCount = 0;
        const imageResolver = vi.fn(async () => {
            callCount++;
            if (callCount === 1) throw new Error("Provider timeout");
            return resolved;
        });

        const useCase = new ResolveArtifactMedia(
            repo as any,
            storage as any,
            undefined,
            downloader,
            imageResolver,
            undefined,
        );

        const result = await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            artifacts: {
                html: '<img src="asset://media/img-a"><img src="asset://media/img-b">',
                css: "",
                js: "",
            },
            mediaManifest: {
                version: "media-manifest-v1",
                requests: [
                    { key: "img-a", kind: "image", role: "hero", sourceStrategy: "stock", semanticQuery: "query a", alt: "A", priority: 10 },
                    { key: "img-b", kind: "image", role: "section", sourceStrategy: "stock", semanticQuery: "query b", alt: "B", priority: 5 },
                ],
            },
            sourceContext: { route: "chat-preview" },
            mode: "initial_generation",
        });

        // img-a failed, img-b should still resolve
        expect(result.resolvedAssets).toHaveLength(1);
        expect(result.artifacts.html).toContain("http://api.test/p/media/");
        const failedWarning = result.warnings.find((w) => w.mediaKey === "img-a");
        expect(failedWarning).toBeDefined();
    });
});
