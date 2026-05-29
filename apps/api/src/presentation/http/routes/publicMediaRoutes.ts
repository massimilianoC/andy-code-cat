import { Router } from "express";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";

/**
 * Public media serving — no auth.
 * GET /p/media/:assetId — streams a stored project asset file.
 *
 * The URL is only useful if the caller already holds the assetId (returned via the
 * authenticated API), so there is no meaningful security regression: knowing an
 * assetId gives access to the file, but assetIds are UUIDs obtained through the
 * authenticated asset endpoints.
 *
 * URL references (externalUrl assets) are redirected to their external URL.
 * Platform-generated images that are still "queued" and have no file yet return 404.
 */
export function createPublicMediaRoutes(): Router {
    const router = Router();
    const assetRepository = new MongoProjectAssetRepository();
    const storage = getFileStorage();

    router.get("/media/:assetId", async (req, res, next) => {
        try {
            const { assetId } = req.params;
            if (!assetId) {
                res.status(400).json({ error: "Missing assetId" });
                return;
            }

            // Preview iframes are sandboxed srcDoc documents with an opaque origin.
            // Helmet's default CORP is same-origin, which makes browsers block these
            // media responses even when the request succeeds with 200 OK.
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
            res.setHeader("Access-Control-Allow-Origin", "*");

            const asset = await assetRepository.findByIdPublic(assetId);
            if (!asset) {
                res.status(404).json({ error: "Asset not found" });
                return;
            }

            // URL references: redirect to external URL
            if (asset.externalUrl) {
                res.redirect(302, asset.externalUrl);
                return;
            }

            const filePath = storage.uploadFilePath(asset.userId, asset.projectId, asset.storedFilename);

            const exists = await storage.fileExists(filePath);
            if (!exists) {
                res.status(404).json({ error: "Asset file not yet available" });
                return;
            }

            const actualSize = await storage.fileSize(filePath).catch(() => asset.fileSize);

            res.setHeader("Content-Type", asset.mimeType);
            // Inline disposition so browsers render images directly
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(asset.originalName)}"`);
            // Cache for 7 days — public, immutable per assetId
            res.setHeader("Cache-Control", "public, max-age=604800, immutable");
            if (actualSize > 0) {
                res.setHeader("Content-Length", actualSize);
            }

            const stream = await storage.createReadStream(filePath);
            stream.pipe(res);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
