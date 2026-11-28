import { Router } from "express";
import { pipeFileToResponse } from "../pipeFileToResponse";
import { setPublicUserFileHeaders } from "../security/userFileHeaders";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";

/**
 * Public media serving — no auth.
 * GET /p/media/:assetId — streams a stored project asset file.
 *
 * This is how generated pages, previews (sandboxed frames with no credentials) and published sites
 * embed a project's media, so it cannot require a token. It therefore serves only what such a page
 * embeds: images, video and audio. Documents, datasets and anything else uploaded as context are
 * available only through the authenticated download routes — knowing an asset id is not enough.
 *
 * URL references (externalUrl assets) are not served here: a redirect from the platform's domain
 * to an arbitrary address is an open redirect. Pages use the external URL directly.
 * Platform-generated images that are still "queued" and have no file yet return 404.
 */
/** Types a page embeds as media. Everything else is private to the owner. */
export function isPublicMediaType(mimeType: string | null | undefined): boolean {
    const mime = String(mimeType ?? "").toLowerCase().split(";")[0]!.trim();
    return /^(image|video|audio)\/[a-z0-9.+-]+$/.test(mime);
}

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

            if (asset.externalUrl || !isPublicMediaType(asset.mimeType)) {
                res.status(404).json({ error: "Asset not found" });
                return;
            }

            const filePath = storage.uploadFilePath(asset.userId, asset.projectId, asset.storedFilename);

            const exists = await storage.fileExists(filePath);
            if (!exists) {
                res.status(404).json({ error: "Asset file not yet available" });
                return;
            }

            const actualSize = await storage.fileSize(filePath).catch(() => asset.fileSize);

            // The declared MIME type never decides execution: passive types inline, the rest as a
            // download with a sandbox CSP (see userFileHeaders.ts).
            setPublicUserFileHeaders(res, asset.mimeType, asset.originalName);
            // Cache for 7 days — public, immutable per assetId
            res.setHeader("Cache-Control", "public, max-age=604800, immutable");
            if (actualSize > 0) {
                res.setHeader("Content-Length", actualSize);
            }

            pipeFileToResponse(await storage.createReadStream(filePath), res, `media ${asset.id}`);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
