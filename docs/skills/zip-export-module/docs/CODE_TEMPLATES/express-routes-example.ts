/**
 * Example wiring for export creation, status polling, and download on top of
 * export-zip-use-case.ts. Framework: Express (adapt trivially to Fastify/Koa/
 * Next.js route handlers — the logic in each handler is short regardless of
 * router library).
 *
 * This file is illustrative, not literally importable — replace the
 * `yourAuthMiddleware` / `yourOwnershipCheck` / `yourExportRepository` /
 * `yourFileStorage` stand-ins with whatever your project already has.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import fs from "fs";
import jwt from "jsonwebtoken";
import { exportProjectAsZip } from "./export-zip-use-case";

// Stand-ins — replace with your real implementations.
declare const yourAuthMiddleware: (req: Request, res: Response, next: NextFunction) => void;
declare const yourOwnershipCheck: (req: Request, res: Response, next: NextFunction) => void;
declare const yourProjectStore: { findName(projectId: string): Promise<string> };
declare const yourExportRepository: {
    findById(id: string): Promise<{ id: string; userId: string; projectId: string; status: string; fileSize?: number } | null>;
    incrementDownloadCount(id: string): Promise<void>;
};
declare const yourFileStorage: {
    exportZipPath(userId: string, projectId: string, exportId: string): string;
    fileExists(filePath: string): Promise<boolean>;
};

const EXPORT_JWT_SECRET = process.env.EXPORT_JWT_SECRET!; // dedicated secret — see AGENTS.md §2

interface DownloadTokenPayload {
    sub: string;
    userId: string;
    projectId: string;
}

export function createExportRoutes(): Router {
    const router = Router();

    // Downloads read from disk / stream the ZIP — rate-limit to blunt abuse
    // (scripted download loops, token brute-forcing on the public route below).
    const downloadLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
    });

    // -----------------------------------------------------------------
    // POST /projects/:projectId/export — create the ZIP (synchronous for MVP)
    // -----------------------------------------------------------------
    router.post(
        "/projects/:projectId/export",
        yourAuthMiddleware,
        yourOwnershipCheck,
        async (req: Request & { auth?: { userId: string } }, res, next) => {
            try {
                const projectName = await yourProjectStore.findName(req.params.projectId!);
                const result = await exportProjectAsZip({
                    projectId: req.params.projectId!,
                    userId: req.auth!.userId,
                    projectName,
                });
                res.status(201).json(result);
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /exports/:exportId — status polling (only needed if export can be async)
    // -----------------------------------------------------------------
    router.get(
        "/exports/:exportId",
        yourAuthMiddleware,
        async (req: Request & { auth?: { userId: string } }, res, next) => {
            try {
                const record = await yourExportRepository.findById(req.params.exportId!);
                if (!record) {
                    res.status(404).json({ error: "Export not found" });
                    return;
                }
                if (record.userId !== req.auth!.userId) {
                    res.status(403).json({ error: "Access denied" });
                    return;
                }
                res.json(record);
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /exports/:exportId/download — authenticated stream (Bearer token).
    // Prefer this over the public token URL below when your frontend can
    // always attach an Authorization header (see frontend-export-button.tsx).
    // -----------------------------------------------------------------
    router.get(
        "/exports/:exportId/download",
        downloadLimiter,
        yourAuthMiddleware,
        async (req: Request & { auth?: { userId: string } }, res, next) => {
            try {
                const record = await yourExportRepository.findById(req.params.exportId!);
                if (!record) {
                    res.status(404).json({ error: "Export not found" });
                    return;
                }
                if (record.userId !== req.auth!.userId) {
                    res.status(403).json({ error: "Access denied" });
                    return;
                }
                if (record.status !== "ready") {
                    res.status(404).json({ error: "Export not ready or failed" });
                    return;
                }
                const zipPath = yourFileStorage.exportZipPath(record.userId, record.projectId, record.id);
                const exists = await yourFileStorage.fileExists(zipPath);
                if (!exists) {
                    res.status(410).json({ error: "Export file no longer available (expired or removed)" });
                    return;
                }
                res.setHeader("Content-Type", "application/zip");
                res.setHeader("Content-Disposition", `attachment; filename="export-${record.id.slice(0, 8)}.zip"`);
                if (record.fileSize) res.setHeader("Content-Length", record.fileSize);
                fs.createReadStream(zipPath).pipe(res);
                yourExportRepository.incrementDownloadCount(record.id).catch(() => { /* ignore */ });
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /download/:token — public stream, JWT only. Only implement this if
    // you need bare-link downloads (emails, curl, plain <a href>) — otherwise
    // the Bearer-authenticated route above is simpler and just as secure.
    // -----------------------------------------------------------------
    router.get("/download/:token", downloadLimiter, async (req, res, next) => {
        try {
            let payload: DownloadTokenPayload;
            try {
                payload = jwt.verify(req.params.token, EXPORT_JWT_SECRET) as DownloadTokenPayload;
            } catch {
                res.status(401).json({ error: "Invalid or expired download token" });
                return;
            }

            // Path built ONLY from the verified JWT payload — never from other request input.
            const zipPath = yourFileStorage.exportZipPath(payload.userId, payload.projectId, payload.sub);
            const exists = await yourFileStorage.fileExists(zipPath);
            if (!exists) {
                res.status(410).json({ error: "Export file no longer available (expired or removed)" });
                return;
            }

            res.setHeader("Content-Type", "application/zip");
            res.setHeader("Content-Disposition", `attachment; filename="export-${payload.sub.slice(0, 8)}.zip"`);
            fs.createReadStream(zipPath).pipe(res);
            yourExportRepository.incrementDownloadCount(payload.sub).catch(() => { /* ignore */ });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
