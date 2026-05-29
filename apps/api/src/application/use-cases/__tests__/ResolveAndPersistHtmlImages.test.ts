import { describe, expect, it, vi } from "vitest";
import type { ProjectAsset, AssetSource } from "../../../domain/entities/ProjectAsset";
import type { ExternalImageDownloader } from "../../../infra/image/ExternalImageDownloader";
import type { ResolvedImageSearchResult } from "../../../infra/image/types";

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
        imageStockPersistStrict: true,
    },
}));

import { ResolveAndPersistHtmlImages } from "../ResolveAndPersistHtmlImages";

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
            source: input.source as AssetSource,
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

const resolved: ResolvedImageSearchResult = {
    url: "https://images.pexels.com/photos/1/test.jpg",
    attribution: "Pexels - Tester",
    width: 1200,
    height: 600,
    mediaType: "photo",
    provider: "pexels",
    fallbackUsed: false,
    attemptedProviders: [{ provider: "pexels", status: "success" }],
};

describe("ResolveAndPersistHtmlImages", () => {
    it("replaces stock placeholders with internal asset URLs and keeps generation metadata", async () => {
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
        const resolver = vi.fn(async () => resolved);
        const useCase = new ResolveAndPersistHtmlImages(repo as any, storage as any, undefined, downloader, resolver);

        const result = await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            html: '<img src="https://loremflickr.com/1200/600/office" alt="office">',
            sourceContext: { route: "chat-preview" },
            strictPersistence: true,
        });

        expect(result.html).toContain('src="http://api.test/p/media/asset-1"');
        expect(result.html).not.toContain("loremflickr.com");
        expect(result.assets).toHaveLength(1);
        const saved = repo.assets[0]!;
        expect(saved.source).toBe("platform_generated");
        expect(saved.generationMetadata?.provider).toBe("pexels");
        expect(saved.generationMetadata?.providerResponse?.query).toBe("office");
    });
});
