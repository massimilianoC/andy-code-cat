import { Router } from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoExportRepository } from "../../../infra/repositories/MongoExportRepository";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { localFileStorage } from "../../../infra/storage/LocalFileStorage";
import { ExportLayer1Zip } from "../../../application/use-cases/ExportLayer1Zip";
import { GetExport } from "../../../application/use-cases/GetExport";
import { exportLayer1Schema } from "@andy-code-cat/contracts";
import type { RequestWithContext } from "../types";
import type { ExportRecord } from "../../../domain/entities/ExportRecord";
import { env } from "../../../config";

function toDto(record: ExportRecord) {
    return {
        id: record.id,
        projectId: record.projectId,
        sourceType: record.sourceType,
        snapshotId: record.snapshotId,
        status: record.status,
        fileSize: record.fileSize,
        fileSha256: record.fileSha256,
        filesIncluded: record.filesIncluded,
        assetPlaceholders: record.assetPlaceholders,
        downloadCount: record.downloadCount,
        expiresAt: record.expiresAt.toISOString(),
        errorMessage: record.errorMessage,
        createdAt: record.createdAt.toISOString(),
        readyAt: record.readyAt?.toISOString(),
    };
}

interface DownloadTokenPayload {
    sub: string;
    userId: string;
    projectId: string;
}

export function createExportRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();
    const exportRepository = new MongoExportRepository();
    const conversationRepository = new MongoConversationRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const exportLayer1Zip = new ExportLayer1Zip(exportRepository, snapshotRepository, localFileStorage, conversationRepository);
    const getExport = new GetExport(exportRepository);

    // -----------------------------------------------------------------
    // POST /v1/projects/:projectId/export/layer1 — create Layer 1 export
    // -----------------------------------------------------------------
    router.post(
        "/projects/:projectId/export/layer1",
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = exportLayer1Schema.parse(req.body);

                // Resolve project name for README (re-fetch to get name)
                const project = await projectRepository.findByIdForUser(
                    req.sandbox!.projectId,
                    req.auth!.userId
                );
                const projectName = project?.name ?? "Progetto";

                const result = await exportLayer1Zip.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    projectName,
                    snapshotId: body.snapshotId,
                    conversationId: body.conversationId,
                });

                res.status(201).json({
                    ...toDto(result),
                    downloadToken: result.downloadToken,
                    downloadUrl: result.downloadUrl,
                });
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /v1/exports/:exportId — status polling (requires auth)
    // -----------------------------------------------------------------
    router.get(
        "/exports/:exportId",
        authMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const record = await getExport.execute(req.params.exportId!);
                // Enforce that only the owner can see their export
                if (record.userId !== req.auth!.userId) {
                    res.status(403).json({ error: "Access denied" });
                    return;
                }
                res.json(toDto(record));
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /v1/exports/:exportId/download — authenticated ZIP stream
    // Uses Bearer token — no JWT-in-URL fragility or TTL issues.
    // -----------------------------------------------------------------
    router.get(
        "/exports/:exportId/download",
        authMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const record = await getExport.execute(req.params.exportId!);
                if (record.userId !== req.auth!.userId) {
                    res.status(403).json({ error: "Access denied" });
                    return;
                }
                if (record.status !== "ready") {
                    res.status(404).json({ error: "Export not ready or failed" });
                    return;
                }
                const zipPath = localFileStorage.exportZipPath(record.userId, record.projectId, record.id);
                const exists = await localFileStorage.fileExists(zipPath);
                if (!exists) {
                    res.status(410).json({ error: "Export file no longer available (expired or removed)" });
                    return;
                }
                const filename = `export-layer1-${record.id.slice(0, 8)}.zip`;
                res.setHeader("Content-Type", "application/zip");
                res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
                if (record.fileSize) {
                    res.setHeader("Content-Length", record.fileSize);
                }
                fs.createReadStream(zipPath).pipe(res);
                exportRepository.incrementDownloadCount(record.id).catch(() => { /* ignore */ });
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /v1/download/:token — stream ZIP (public, JWT only)
    // NOTE: mounted at root level (/v1/...) in app.ts
    // -----------------------------------------------------------------
    router.get(
        "/download/:token",
        async (req, res, next) => {
            try {
                let payload: DownloadTokenPayload;
                try {
                    payload = jwt.verify(req.params.token, env.EXPORT_JWT_SECRET) as DownloadTokenPayload;
                } catch {
                    res.status(401).json({ error: "Invalid or expired download token" });
                    return;
                }

                const exportId = payload.sub;
                const userId = payload.userId;
                const projectId = payload.projectId;

                // All path components come from verified JWT payload — no user input in path construction
                const zipPath = localFileStorage.exportZipPath(userId, projectId, exportId);
                const exists = await localFileStorage.fileExists(zipPath);
                if (!exists) {
                    res.status(410).json({ error: "Export file no longer available (expired or removed)" });
                    return;
                }

                const filename = `export-${exportId.slice(0, 8)}.zip`;
                res.setHeader("Content-Type", "application/zip");
                res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
                const fileSize = await localFileStorage.fileSize(zipPath);
                res.setHeader("Content-Length", fileSize);

                fs.createReadStream(zipPath).pipe(res);

                // Fire-and-forget: increment download counter
                exportRepository.incrementDownloadCount(exportId).catch(() => { /* ignore */ });
            } catch (error) {
                next(error);
            }
        }
    );

    return router;
}
