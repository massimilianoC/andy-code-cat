/**
 * Example wiring for the three capture flows on top of capture-service.ts.
 * Framework: Express (adapt trivially to Fastify/Koa/Next.js route handlers —
 * the logic in each handler is ~10 lines regardless of router library).
 *
 * This file is illustrative, not literally importable — replace the
 * `yourAuthMiddleware` / `yourContentStore` / `yourFileStorage` stand-ins with
 * whatever your project already has. Do NOT invent a new auth or storage
 * layer just for this feature — reuse what protects every other route.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { buildFullDoc, captureHtml, type CaptureFormat } from "./capture-service";

// Stand-ins — replace with your real implementations.
declare const yourAuthMiddleware: (req: Request, res: Response, next: NextFunction) => void;
declare const yourContentStore: {
    findById(id: string): Promise<{ html: string; css: string; js: string } | null>;
};
declare const yourFileStorage: {
    saveThumbnail(contentId: string, buffer: Buffer): Promise<string>;
    getThumbnailStream(path: string): NodeJS.ReadableStream;
};
declare const yourContentRecordRepo: {
    updateThumbnailPath(contentId: string, path: string): Promise<void>;
    getThumbnailPath(contentId: string): Promise<string | null>;
};

export function createCaptureRoutes(): Router {
    const router = Router();
    router.use(yourAuthMiddleware);

    // -------------------------------------------------------------------
    // Flow B — on-demand capture. Sync, user-initiated, no persistence.
    // GET /content/:id/capture?format=jpg|pdf
    // -------------------------------------------------------------------
    router.get("/content/:id/capture", async (req, res, next) => {
        try {
            const format = String(req.query.format ?? "jpg").toLowerCase();
            if (format !== "jpg" && format !== "pdf") {
                res.status(400).json({ error: "format must be jpg or pdf" });
                return;
            }

            const content = await yourContentStore.findById(req.params.id!);
            if (!content) {
                res.status(404).json({ error: "Content not found" });
                return;
            }

            const doc = buildFullDoc(content.html, content.css, content.js);
            const buffer = await captureHtml(doc, format as CaptureFormat);

            res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "image/jpeg");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="capture-${req.params.id}.${format}"`
            );
            res.send(buffer);
        } catch (error) {
            next(error);
        }
    });

    // -------------------------------------------------------------------
    // Flow A — background thumbnail. Streams the previously-generated file.
    // GET /content/:id/thumbnail
    // Returns 404 while the fire-and-forget job (see below) hasn't finished.
    // -------------------------------------------------------------------
    router.get("/content/:id/thumbnail", async (req, res, next) => {
        try {
            const thumbnailPath = await yourContentRecordRepo.getThumbnailPath(req.params.id!);
            if (!thumbnailPath) {
                res.status(404).json({ error: "Thumbnail not ready" });
                return;
            }
            res.setHeader("Content-Type", "image/jpeg");
            // Immutable per content id — safe to cache long-term.
            res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
            const stream = yourFileStorage.getThumbnailStream(thumbnailPath);
            stream.on("error", next);
            stream.pipe(res);
        } catch (error) {
            next(error);
        }
    });

    return router;
}

// -------------------------------------------------------------------------
// Flow A — the fire-and-forget scheduler. Call this (NOT awaited) from
// whatever handler creates/saves the content, right before you send the
// HTTP response.
//
//   router.post("/content", async (req, res) => {
//       const record = await yourContentStore.create(req.body);
//       scheduleThumbnail(record.id, record); // <-- not awaited
//       res.status(201).json(record);
//   });
// -------------------------------------------------------------------------
const inFlightThumbnails = new Set<string>();

export function scheduleThumbnail(
    contentId: string,
    artifacts: { html: string; css: string; js: string }
): void {
    if (inFlightThumbnails.has(contentId)) return; // de-dupe concurrent triggers
    inFlightThumbnails.add(contentId);

    runThumbnailJob(contentId, artifacts)
        .catch((err) => {
            console.error(`[thumbnail] failed for ${contentId}:`, err);
        })
        .finally(() => {
            inFlightThumbnails.delete(contentId);
        });
}

async function runThumbnailJob(
    contentId: string,
    artifacts: { html: string; css: string; js: string }
): Promise<void> {
    const doc = buildFullDoc(artifacts.html, artifacts.css, artifacts.js);
    const buffer = await captureHtml(doc, "jpg");
    const storedPath = await yourFileStorage.saveThumbnail(contentId, buffer);
    await yourContentRecordRepo.updateThumbnailPath(contentId, storedPath);
}

// -------------------------------------------------------------------------
// Flow C — export-embedded capture. Run both formats in parallel inside a
// larger bundling job (e.g. building a ZIP); a capture failure shouldn't
// abort the whole export.
// -------------------------------------------------------------------------
export async function captureForExport(artifacts: { html: string; css: string; js: string }) {
    const doc = buildFullDoc(artifacts.html, artifacts.css, artifacts.js);
    const [jpg, pdf] = await Promise.all([
        captureHtml(doc, "jpg").catch(() => null),
        captureHtml(doc, "pdf").catch(() => null),
    ]);
    return { jpg, pdf }; // caller adds whichever succeeded to the ZIP
}
