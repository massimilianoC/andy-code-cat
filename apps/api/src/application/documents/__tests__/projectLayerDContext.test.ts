import { describe, expect, it, vi } from "vitest";
import { Readable } from "stream";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: true,
        ENRICHMENT_LAYER_D_MAX_CHARS: 50_000,
        ENRICHMENT_LAYER_D_MAX_ASSETS: 10,
    },
}));

import { buildProjectLayerDContext } from "../projectLayerDContext";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { AssetEnrichmentTrace } from "../../../domain/entities/AssetEnrichmentTrace";
import type { ProjectAssetRepository } from "../../../domain/repositories/ProjectAssetRepository";
import type { IFileStorage } from "../../../infra/storage/IFileStorage";

function makePendingUpload(overrides: Partial<ProjectAsset> = {}): ProjectAsset {
    return {
        id: "asset-1",
        projectId: "project-1",
        userId: "user-1",
        scope: "project",
        originalName: "brand-reference.png",
        storedFilename: "asset-1-brand-reference.png",
        mimeType: "image/png",
        fileSize: 1024,
        source: "user_upload",
        useInProject: true,
        // Fresh by default: these fixtures stand in for an upload the enrichment pipeline has not
        // stamped yet, which is the only trace-less state worth waiting on.
        createdAt: new Date(),
        enrichmentTrace: null,
        ...overrides,
    };
}

function makeAssetRepository(): ProjectAssetRepository {
    return {
        create: vi.fn(),
        listByProject: vi.fn(),
        listByUser: vi.fn(),
        findById: vi.fn(),
        findByIdPublic: vi.fn(),
        delete: vi.fn(),
        totalProjectSize: vi.fn(),
        countByProject: vi.fn(),
        summarizeGenerationByProject: vi.fn(),
        summarizeGenerationCostsByUser: vi.fn(),
        listRecentGeneratedByProject: vi.fn(),
        summarizeGenerationAll: vi.fn(),
        listRecentGeneratedAll: vi.fn(),
        saveEnrichmentTrace: vi.fn(),
        update: vi.fn(),
    } as unknown as ProjectAssetRepository;
}

function makeReadyTrace(asset: ProjectAsset): AssetEnrichmentTrace {
    return {
        assetId: asset.id,
        projectId: asset.projectId,
        userId: asset.userId,
        assetKind: "pdf",
        provenance: {
            traceVersion: 1,
            enrichmentStatus: "ready",
            enrichedAt: new Date("2026-07-10T00:00:01.000Z"),
            processingMs: 1000,
            parserName: "pdf-parse",
            parserVersion: "1.0.0",
            llmProvider: null,
            llmModel: null,
            llmTokensUsed: null,
            llmCostEur: null,
            errorMessage: null,
        },
        textLayer: {
            wordCount: 20,
            charCount: 120,
            languageHint: "it",
            pageCount: 1,
            sectionCount: 1,
            extractedTextSnippet: "Brand book: tono editoriale, CTA prenota una consulenza.",
            fullTextStored: false,
        },
        documentBrief: null,
        structuredData: null,
        colorPalette: null,
        visualAnalysis: null,
        designSignals: null,
        distilledTitle: "Brand book allegato",
        distilledSummary: "Linee guida reali estratte dall'allegato.",
        distilledTags: ["brand-book"],
        distilledColors: [],
        renderedFragment: null,
    };
}

function makeStorage(): IFileStorage {
    return {
        uploadDirPath: vi.fn(),
        uploadFilePath: vi.fn(() => "unused"),
        saveUpload: vi.fn(),
        deleteUpload: vi.fn(),
        createReadStream: vi.fn(async () => Readable.from([])),
        exportDirPath: vi.fn(),
        exportZipPath: vi.fn(),
        writeExportFile: vi.fn(),
        deleteExportDir: vi.fn(),
        publishDirPath: vi.fn(),
        writePublishFiles: vi.fn(),
        resolvePublishFile: vi.fn(),
        deletePublishDir: vi.fn(),
        copyPublishDir: vi.fn(),
        workspacePath: vi.fn(),
        workspaceInputPath: vi.fn(),
        workspaceInputAssetsPath: vi.fn(),
        workspaceInputLayer1Path: vi.fn(),
        workspaceOutputPath: vi.fn(),
        workspaceLogsPath: vi.fn(),
        writeWorkspaceFile: vi.fn(),
        deleteWorkspaceDir: vi.fn(),
        profileDirPath: vi.fn(),
        writeProfileData: vi.fn(),
        readProfileData: vi.fn(),
        deleteProfileData: vi.fn(),
        thumbnailFilePath: vi.fn(),
        saveThumbnailFile: vi.fn(),
        getThumbnailStream: vi.fn(),
        deleteThumbnailFile: vi.fn(),
        ensureDir: vi.fn(),
        fileExists: vi.fn(),
        fileSize: vi.fn(),
    } as unknown as IFileStorage;
}

describe("buildProjectLayerDContext", () => {
    it("waits for pending attachment enrichment before building Layer D", async () => {
        const pending = makePendingUpload({
            originalName: "brand-book.pdf",
            mimeType: "application/pdf",
        });
        const ready = { ...pending, enrichmentTrace: makeReadyTrace(pending) };
        const repository = makeAssetRepository();
        vi.mocked(repository.listByProject).mockResolvedValue([ready]);

        const result = await buildProjectLayerDContext({
            assetRepository: repository,
            storage: makeStorage(),
            projectId: pending.projectId,
            userId: pending.userId,
            assets: [pending],
            maxChars: 8000,
            maxAssets: 10,
            fallbackInlineExtractionMaxAssets: 0,
            waitForPendingMs: 1_600,
        });

        expect(repository.listByProject).toHaveBeenCalled();
        expect(result.layer).toContain("Brand book allegato");
        expect(result.layer).toContain("Brand book: tono editoriale");
    });

    it("does not wait on an asset the pipeline never scheduled", async () => {
        // Every image the media pipeline generates lands with no enrichmentTrace and never gets
        // one. Waiting on it used to cost the full 120s budget on every request in the project.
        const generated = makePendingUpload({
            originalName: "hero-generated.jpg",
            mimeType: "image/jpeg",
            createdAt: new Date(Date.now() - 5 * 60_000),
        });
        const repository = makeAssetRepository();

        const startedAt = Date.now();
        const result = await buildProjectLayerDContext({
            assetRepository: repository,
            storage: makeStorage(),
            projectId: generated.projectId,
            userId: generated.userId,
            assets: [generated],
            maxChars: 8000,
            maxAssets: 10,
            fallbackInlineExtractionMaxAssets: 0,
            waitForPendingMs: 120_000,
        });

        // Returns immediately and never polls: there is nothing in flight to poll for.
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        expect(repository.listByProject).not.toHaveBeenCalled();
        expect(result.assets).toEqual([generated]);
    });

    it("keeps freshly uploaded attachments visible when enrichment is still pending", async () => {
        const asset = makePendingUpload();
        const repository = makeAssetRepository();

        const result = await buildProjectLayerDContext({
            assetRepository: repository,
            storage: makeStorage(),
            projectId: asset.projectId,
            userId: asset.userId,
            assets: [asset],
            maxChars: 8000,
            maxAssets: 10,
            fallbackInlineExtractionMaxAssets: 0,
            includeUnenrichedAssets: true,
            waitForPendingMs: 0,
        });

        expect(result.layer).toContain("brand-reference.png");
        expect(result.layer).toContain("uploaded reference");
        expect(result.assets).toEqual([asset]);
        expect(repository.listByProject).not.toHaveBeenCalled();
    });
});
