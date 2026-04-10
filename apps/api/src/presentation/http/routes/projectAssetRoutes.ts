import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { UploadProjectAsset } from "../../../application/use-cases/UploadProjectAsset";
import { UpdateProjectAsset } from "../../../application/use-cases/UpdateProjectAsset";
import { AddUrlReference } from "../../../application/use-cases/AddUrlReference";
import { ListProjectAssets } from "../../../application/use-cases/ListProjectAssets";
import { DeleteProjectAsset } from "../../../application/use-cases/DeleteProjectAsset";
import type { RequestWithContext } from "../types";
import type { ProjectAssetDto } from "@andy-code-cat/contracts";
import fs from "fs";

// In-memory storage: the use case writes to disk itself after validation.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // hard upper bound; per-type limits in use case
});

function toDto(asset: {
    id: string;
    projectId: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    source: string;
    label?: string;
    useInProject?: boolean;
    styleRole?: string;
    descriptionText?: string;
    externalUrl?: string;
    createdAt: Date;
}): ProjectAssetDto {
    return {
        id: asset.id,
        projectId: asset.projectId,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        source: asset.source as ProjectAssetDto["source"],
        label: asset.label,
        useInProject: asset.useInProject,
        styleRole: asset.styleRole as ProjectAssetDto["styleRole"],
        descriptionText: asset.descriptionText,
        externalUrl: asset.externalUrl,
        createdAt: asset.createdAt.toISOString(),
    };
}

export function createProjectAssetRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);
    const storage = getFileStorage();

    const uploadAsset = new UploadProjectAsset(assetRepository, storage);
    const updateAsset = new UpdateProjectAsset(assetRepository);
    const addUrlRef = new AddUrlReference(assetRepository);
    const listAssets = new ListProjectAssets(assetRepository);
    const deleteAsset = new DeleteProjectAsset(assetRepository, storage);

    router.use(authMiddleware);

    // POST /v1/projects/:projectId/assets — upload a reference file
    router.post(
        "/projects/:projectId/assets",
        sandboxMiddleware,
        upload.single("file"),
        async (req: RequestWithContext, res, next) => {
            try {
                if (!req.file) {
                    res.status(400).json({ error: "No file uploaded. Use multipart/form-data with field name 'file'." });
                    return;
                }

                const asset = await uploadAsset.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    fileSize: req.file.size,
                    buffer: req.file.buffer,
                    label: typeof req.body["label"] === "string" ? req.body["label"] : undefined,
                    useInProject: req.body["useInProject"] === "true" || req.body["useInProject"] === true,
                    styleRole: (req.body["styleRole"] === "inspiration" || req.body["styleRole"] === "material")
                        ? req.body["styleRole"] as "inspiration" | "material"
                        : undefined,
                    descriptionText: typeof req.body["descriptionText"] === "string" ? req.body["descriptionText"] : undefined,
                });

                res.status(201).json({ asset: toDto(asset) });
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/assets/url — add a URL reference (no file upload)
    router.post(
        "/projects/:projectId/assets/url",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const asset = await addUrlRef.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    rawData: req.body,
                });
                res.status(201).json({ asset: toDto(asset) });
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/assets — list project assets
    // Optional query: ?source=user_upload | platform_generated
    router.get(
        "/projects/:projectId/assets",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const sourceParam = req.query["source"] as string | undefined;
                const source =
                    sourceParam === "user_upload" || sourceParam === "platform_generated"
                        ? sourceParam
                        : undefined;
                const assets = await listAssets.execute(req.sandbox!.projectId, req.auth!.userId, source);
                res.json({ assets: assets.map(toDto) });
            } catch (error) {
                next(error);
            }
        }
    );

    // PATCH /v1/projects/:projectId/assets/:assetId — update asset metadata
    router.patch(
        "/projects/:projectId/assets/:assetId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const asset = await updateAsset.execute({
                    assetId: req.params.assetId!,
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    rawData: req.body,
                });
                res.json({ asset: toDto(asset) });
            } catch (error) {
                next(error);
            }
        }
    );

    // DELETE /v1/projects/:projectId/assets/:assetId
    router.delete(
        "/projects/:projectId/assets/:assetId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                await deleteAsset.execute({
                    assetId: req.params.assetId!,
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                });
                res.status(204).send();
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/assets/:assetId/download — stream file
    router.get(
        "/projects/:projectId/assets/:assetId/download",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const asset = await assetRepository.findById(
                    req.params.assetId!,
                    req.sandbox!.projectId,
                    req.auth!.userId
                );
                if (!asset) {
                    res.status(404).json({ error: "Asset not found" });
                    return;
                }

                // URL references have no file — redirect to external URL
                if (asset.externalUrl) {
                    res.redirect(302, asset.externalUrl);
                    return;
                }

                const filePath = storage.uploadFilePath(
                    req.auth!.userId,
                    req.sandbox!.projectId,
                    asset.storedFilename
                );

                const exists = await storage.fileExists(filePath);
                if (!exists) {
                    res.status(410).json({ error: "File no longer available" });
                    return;
                }

                res.setHeader("Content-Type", asset.mimeType);
                res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(asset.originalName)}"`);
                res.setHeader("Content-Length", asset.fileSize);
                fs.createReadStream(filePath).pipe(res);
            } catch (error) {
                next(error);
            }
        }
    );

    return router;
}
