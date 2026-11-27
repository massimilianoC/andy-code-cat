import { Router } from "express";
import { pipeFileToResponse } from "../pipeFileToResponse";
import {
    activatePreviewSnapshotSchema,
    createPreviewSnapshotSchema,
} from "@andy-code-cat/contracts";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectPresetRepository } from "../../../infra/repositories/MongoProjectPresetRepository";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoMediaResolutionTraceRepository } from "../../../infra/repositories/MongoMediaResolutionTraceRepository";
import { CreatePreviewSnapshot } from "../../../application/use-cases/CreatePreviewSnapshot";
import { CommitArtifactVersion, withConfiguredFormRuntime } from "../../../application/use-cases/CommitArtifactVersion";
import { ListPreviewSnapshots } from "../../../application/use-cases/ListPreviewSnapshots";
import { ActivatePreviewSnapshot } from "../../../application/use-cases/ActivatePreviewSnapshot";
import { GetPreviewSnapshot } from "../../../application/use-cases/GetPreviewSnapshot";
import { CapturePreviewSnapshot } from "../../../application/use-cases/CapturePreviewSnapshot";
import { DeletePreviewSnapshot } from "../../../application/use-cases/DeletePreviewSnapshot";
import { ExecutionLogger } from "../../../application/services/ExecutionLogger";
import { SnapshotThumbnailJob } from "../../../application/services/SnapshotThumbnailJob";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { assertGeneratedJavaScriptSyntax } from "../../../application/artifacts/generatedJavaScriptSyntax";

export function createPreviewSnapshotRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const projectPresetRepository = new MongoProjectPresetRepository();
    const conversationRepository = new MongoConversationRepository();
    const previewSnapshotRepository = new MongoPreviewSnapshotRepository();
    const mediaResolutionTraceRepository = new MongoMediaResolutionTraceRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const createPreviewSnapshot = new CreatePreviewSnapshot(
        previewSnapshotRepository,
        mediaResolutionTraceRepository,
        conversationRepository,
    );
    const commitArtifactVersion = new CommitArtifactVersion(
        conversationRepository,
        projectRepository,
        previewSnapshotRepository,
        createPreviewSnapshot,
    );
    const listPreviewSnapshots = new ListPreviewSnapshots(previewSnapshotRepository);
    const activatePreviewSnapshot = new ActivatePreviewSnapshot(previewSnapshotRepository);
    const getPreviewSnapshot = new GetPreviewSnapshot(previewSnapshotRepository);
    const capturePreviewSnapshot = new CapturePreviewSnapshot(
        previewSnapshotRepository,
        projectRepository,
        projectPresetRepository,
    );
    const deletePreviewSnapshot = new DeletePreviewSnapshot(previewSnapshotRepository);

    router.use(authMiddleware);

    router.get(
        "/projects/:projectId/preview-snapshots",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const conversationId = String(req.query.conversationId ?? "").trim() || undefined;

                if (conversationId) {
                    const conversation = await conversationRepository.findById(conversationId, req.sandbox!.projectId);
                    if (!conversation) {
                        res.status(404).json({ error: "Conversation not found" });
                        return;
                    }
                }

                const snapshots = await listPreviewSnapshots.execute(req.sandbox!.projectId, conversationId);
                const activeSnapshotId = snapshots.find((s) => s.isActive)?.id;
                const project = await projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId);
                res.json({
                    snapshots: snapshots.map((snapshot) => withConfiguredFormRuntime(snapshot, project?.serviceConfig?.forms)),
                    activeSnapshotId,
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/projects/:projectId/preview-snapshots",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = createPreviewSnapshotSchema.parse(req.body);
                const { created, snapshot } = await commitArtifactVersion.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    request: body,
                });
                // AL-045 — a no-op write is not a creation. 200 says "here is the version you
                // are on"; 201 says "here is the version you just made". The client shows a
                // different message for each, so the distinction has to survive the response.
                res.status(created ? 201 : 200).json({ created, snapshot });
            } catch (error) {
                next(error);
            }
        }
    );

    router.get(
        "/projects/:projectId/preview-snapshots/:snapshotId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const snapshot = await getPreviewSnapshot.execute(req.sandbox!.projectId, req.params.snapshotId!);
                if (!snapshot) {
                    res.status(404).json({ error: "Snapshot not found" });
                    return;
                }
                const project = await projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId);
                res.json({ snapshot: withConfiguredFormRuntime(snapshot, project?.serviceConfig?.forms) });
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/projects/:projectId/preview-snapshots/:snapshotId/activate",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = activatePreviewSnapshotSchema.parse(req.body);

                if (body.conversationId) {
                    const conversation = await conversationRepository.findById(body.conversationId, req.sandbox!.projectId);
                    if (!conversation) {
                        res.status(404).json({ error: "Conversation not found" });
                        return;
                    }
                }

                const candidate = await previewSnapshotRepository.findById(
                    req.sandbox!.projectId,
                    req.params.snapshotId!,
                );
                if (!candidate) {
                    res.status(404).json({ error: "Snapshot not found" });
                    return;
                }
                assertGeneratedJavaScriptSyntax(candidate.artifacts.js);

                const snapshot = await activatePreviewSnapshot.execute({
                    projectId: req.sandbox!.projectId,
                    conversationId: body.conversationId,
                    snapshotId: req.params.snapshotId!,
                });

                // ── Execution log (fire-and-forget) ──────────────────────────
                ExecutionLogger.instance.emit({
                    projectId: req.sandbox!.projectId,
                    conversationId: body.conversationId,
                    snapshotId: req.params.snapshotId!,
                    domain: "snapshot",
                    eventType: "snapshot_activated",
                    level: "info",
                    status: "success",
                    metadata: {
                        snapshotId: req.params.snapshotId!,
                        conversationId: body.conversationId,
                    },
                });
                // ── end execution log ─────────────────────────────────────────

                // ── Background thumbnail job (fire-and-forget) ────────────────
                const project = await projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId);
                const runtimeSnapshot = withConfiguredFormRuntime(snapshot, project?.serviceConfig?.forms);
                if (runtimeSnapshot.artifacts.html && !runtimeSnapshot.thumbnailPath) {
                    SnapshotThumbnailJob.schedule(
                        req.sandbox!.projectId,
                        runtimeSnapshot.id,
                        runtimeSnapshot.artifacts,
                        previewSnapshotRepository
                    );
                }
                // ── end thumbnail job ─────────────────────────────────────────

                res.json({ snapshot: runtimeSnapshot });
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------------
    // GET /projects/:projectId/preview-snapshots/:snapshotId/capture
    // Query: ?format=jpg|pdf
    // Returns the rendered preview as a JPEG image or PDF document.
    // Uses Puppeteer (headless Chromium) server-side.
    // https://pptr.dev/api/puppeteer.page.screenshot
    // https://pptr.dev/api/puppeteer.page.pdf
    // -----------------------------------------------------------------------
    router.get(
        "/projects/:projectId/preview-snapshots/:snapshotId/capture",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const rawFormat = String(req.query.format ?? "jpg").toLowerCase();
                if (rawFormat !== "jpg" && rawFormat !== "pdf") {
                    res.status(400).json({ error: "format must be jpg or pdf" });
                    return;
                }

                const buffer = await capturePreviewSnapshot.execute(
                    req.sandbox!.projectId,
                    req.params.snapshotId!,
                    rawFormat
                );

                const filename = `preview-snapshot-${req.params.snapshotId}.${rawFormat}`;
                res.setHeader(
                    "Content-Type",
                    rawFormat === "pdf" ? "application/pdf" : "image/jpeg"
                );
                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename="${filename}"`
                );
                res.send(buffer);
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------------
    // DELETE /projects/:projectId/preview-snapshots/:snapshotId
    // Deletes a single snapshot. Cannot delete the currently active snapshot.
    // -----------------------------------------------------------------------
    router.delete(
        "/projects/:projectId/preview-snapshots/:snapshotId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                await deletePreviewSnapshot.execute(
                    req.sandbox!.projectId,
                    req.params.snapshotId!
                );
                res.status(204).send();
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------------
    // GET /projects/:projectId/preview-snapshots/:snapshotId/thumbnail
    // Streams the stored Puppeteer JPEG thumbnail.
    // Returns 404 while the background job has not yet completed.
    // Adds a long-lived Cache-Control header since thumbnails are immutable
    // per snapshotId.
    // -----------------------------------------------------------------------
    router.get(
        "/projects/:projectId/preview-snapshots/:snapshotId/thumbnail",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const snapshot = await getPreviewSnapshot.execute(
                    req.sandbox!.projectId,
                    req.params.snapshotId!
                );
                if (!snapshot || !snapshot.thumbnailPath) {
                    res.status(404).json({ error: "Thumbnail not ready" });
                    return;
                }

                const storage = getFileStorage();
                const stream = await storage.getThumbnailStream(snapshot.thumbnailPath);

                res.setHeader("Content-Type", "image/jpeg");
                // Immutable per snapshotId — safe to cache for 1 year
                res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
                pipeFileToResponse(stream, res, `thumbnail ${snapshot.id}`);
            } catch (error) {
                next(error);
            }
        }
    );

    return router;
}
