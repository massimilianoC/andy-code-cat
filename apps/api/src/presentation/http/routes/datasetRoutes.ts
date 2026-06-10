import { Router } from "express";
import {
    datasetAskSchema,
    datasetBrowseSchema,
    datasetQuerySchema,
    type DatasetProfileDto,
    type DatasetFactsEnvelopeDto,
    type DatasetTableProfileDto,
    type ProjectDatasetListResponseDto,
} from "@andy-code-cat/contracts";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { DatasetCacheStore } from "../../../application/datasets/DatasetCacheStore";
import { answerDatasetQuestion, browseDatasetRows, buildDashboardSuggestion, buildDatasetInsights, executeDatasetQuery } from "../../../application/datasets/DatasetQueryEngine";
import { loadOrCreateDatasetRuntime } from "../../../application/datasets/DatasetLoader";

function isDatasetAsset(mimeType: string, originalName?: string): boolean {
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();
    return mime === "text/csv"
        || mime === "application/csv"
        || mime === "application/json"
        || mime === "application/xml"
        || mime === "text/xml"
        || mime === "application/sql"
        || mime === "text/sql"
        || mime === "text/x-sql"
        || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        || mime === "application/vnd.ms-excel"
        || Boolean(originalName?.toLowerCase().endsWith(".sql"));
}

export function createDatasetRoutes(): Router {
    const router = Router();
    const projectRepository = new MongoProjectRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);
    const storage = getFileStorage();
    const datasetCache = new DatasetCacheStore(storage);

    async function loadDataset(req: RequestWithContext, assetId: string) {
        const asset = await assetRepository.findById(assetId, req.sandbox!.projectId, req.auth!.userId);
        if (!asset) {
            const error = new Error("Dataset asset not found");
            (error as Error & { status?: number }).status = 404;
            throw error;
        }
        if (!isDatasetAsset(asset.mimeType, asset.originalName)) {
            const error = new Error("Asset is not a supported dataset. Supported formats: CSV, XLSX, JSON, XML, SQL dump.");
            (error as Error & { status?: number }).status = 422;
            throw error;
        }
        if (asset.externalUrl) {
            const error = new Error("URL reference assets are not supported as runtime datasets.");
            (error as Error & { status?: number }).status = 422;
            throw error;
        }

        const dataset = await loadOrCreateDatasetRuntime(storage, asset);
        if (!dataset) {
            const error = new Error("Dataset normalization failed for this asset.");
            (error as Error & { status?: number }).status = 422;
            throw error;
        }
        return { asset, dataset };
    }

    function toProfileDto(params: Awaited<ReturnType<typeof loadDataset>>): DatasetProfileDto {
        return {
            assetId: params.asset.id,
            projectId: params.asset.projectId,
            originalName: params.asset.originalName,
            mimeType: params.asset.mimeType,
            tables: params.dataset.tables.map((table) => table.profile) as DatasetTableProfileDto[],
            facts: params.dataset.facts as DatasetFactsEnvelopeDto,
            limitations: params.dataset.limitations,
            grounded: true,
        };
    }

    router.use(authMiddleware);

    router.get("/projects/:projectId/datasets", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const assets = await assetRepository.listByProject(req.sandbox!.projectId, req.auth!.userId);
            const datasets = await Promise.all(
                assets
                    .filter((asset) => isDatasetAsset(asset.mimeType, asset.originalName))
                    .map(async (asset) => ({
                        id: asset.id,
                        originalName: asset.originalName,
                        mimeType: asset.mimeType,
                        fileSize: asset.fileSize,
                        createdAt: asset.createdAt.toISOString(),
                    profileReady: Boolean(asset.enrichmentTrace?.structuredData?.dataset),
                        cacheReady: await datasetCache.exists(asset),
                    })),
            );
            const response: ProjectDatasetListResponseDto = { datasets };
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    router.get("/projects/:projectId/datasets/:assetId/profile", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const loaded = await loadDataset(req, req.params.assetId!);
            res.json(toProfileDto(loaded));
        } catch (error) {
            next(error);
        }
    });

    router.get("/projects/:projectId/datasets/:assetId/summary", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const loaded = await loadDataset(req, req.params.assetId!);
            const profile = toProfileDto(loaded);
            res.json({
                grounded: true,
                assetId: profile.assetId,
                facts: profile.facts,
                tables: profile.tables.map((table) => ({
                    name: table.name,
                    rowCount: table.rowCount,
                    columnCount: table.columnCount,
                })),
                limitations: profile.limitations,
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects/:projectId/datasets/:assetId/query", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const input = datasetQuerySchema.parse(req.body);
            const loaded = await loadDataset(req, req.params.assetId!);
            res.json(executeDatasetQuery(loaded.dataset, input));
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects/:projectId/datasets/:assetId/ask", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const input = datasetAskSchema.parse(req.body);
            const loaded = await loadDataset(req, req.params.assetId!);
            res.json(answerDatasetQuestion(loaded.dataset, input.question, input.tableName));
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects/:projectId/datasets/:assetId/browse", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const input = datasetBrowseSchema.parse(req.body);
            const loaded = await loadDataset(req, req.params.assetId!);
            res.json(browseDatasetRows(loaded.dataset, input));
        } catch (error) {
            next(error);
        }
    });

    router.get("/projects/:projectId/datasets/:assetId/insights", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const loaded = await loadDataset(req, req.params.assetId!);
            const tableName = typeof req.query.tableName === "string" ? req.query.tableName : undefined;
            res.json(buildDatasetInsights(loaded.dataset, tableName));
        } catch (error) {
            next(error);
        }
    });

    router.get("/projects/:projectId/datasets/:assetId/dashboard-suggestion", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const loaded = await loadDataset(req, req.params.assetId!);
            const tableName = typeof req.query.tableName === "string" ? req.query.tableName : undefined;
            res.json(buildDashboardSuggestion(loaded.dataset, tableName));
        } catch (error) {
            next(error);
        }
    });

    return router;
}
