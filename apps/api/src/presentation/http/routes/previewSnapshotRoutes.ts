import { Router } from "express";
import {
    activatePreviewSnapshotSchema,
    createPreviewSnapshotSchema,
} from "@andy-code-cat/contracts";
import { tryParseStructuredJson } from "../../../application/llm/llmParser";
import { injectStableIds } from "../../../application/llm/htmlIdInjector";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { CreatePreviewSnapshot } from "../../../application/use-cases/CreatePreviewSnapshot";
import { ListPreviewSnapshots } from "../../../application/use-cases/ListPreviewSnapshots";
import { ActivatePreviewSnapshot } from "../../../application/use-cases/ActivatePreviewSnapshot";
import { GetPreviewSnapshot } from "../../../application/use-cases/GetPreviewSnapshot";
import { CapturePreviewSnapshot } from "../../../application/use-cases/CapturePreviewSnapshot";
import { DeletePreviewSnapshot } from "../../../application/use-cases/DeletePreviewSnapshot";
import { ExecutionLogger } from "../../../application/services/ExecutionLogger";

export function createPreviewSnapshotRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const conversationRepository = new MongoConversationRepository();
    const previewSnapshotRepository = new MongoPreviewSnapshotRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const createPreviewSnapshot = new CreatePreviewSnapshot(previewSnapshotRepository);
    const listPreviewSnapshots = new ListPreviewSnapshots(previewSnapshotRepository);
    const activatePreviewSnapshot = new ActivatePreviewSnapshot(previewSnapshotRepository);
    const getPreviewSnapshot = new GetPreviewSnapshot(previewSnapshotRepository);
    const capturePreviewSnapshot = new CapturePreviewSnapshot(previewSnapshotRepository);
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
                res.json({ snapshots, activeSnapshotId });
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

                const conversation = await conversationRepository.findById(body.conversationId, req.sandbox!.projectId);
                if (!conversation) {
                    res.status(404).json({ error: "Conversation not found" });
                    return;
                }

                // If rawLlmResponse is provided, let the backend be the authority on parsing.
                // Re-parse and override artifacts + structuredParseValid if the parse succeeds.
                // IMPORTANT: only override when the raw response contains non-empty html.
                // In focused-patch mode the LLM emits artifacts.html="" (only focusPatch
                // is populated); the server already merged the patch and returned the full
                // HTML to the client, which passes it back here as body.artifacts.html.
                // Overriding with empty html would corrupt the stored snapshot.
                let artifacts = body.artifacts;
                let structuredParseValid = body.metadata?.structuredParseValid ?? false;

                if (body.rawLlmResponse) {
                    const parsed = tryParseStructuredJson(body.rawLlmResponse);
                    if (parsed.parseValid && parsed.structured && parsed.structured.artifacts.html) {
                        artifacts = {
                            html: parsed.structured.artifacts.html,
                            css: parsed.structured.artifacts.css,
                            js: parsed.structured.artifacts.js,
                        };
                        structuredParseValid = true;
                    }
                }

                // Inject stable element IDs on every block element before storing.
                // This enables selector-based replacement in future focus-edit requests,
                // making patch application completely independent of text content matching.
                if (artifacts.html) {
                    artifacts = { ...artifacts, html: injectStableIds(artifacts.html) };
                }

                const snapshot = await createPreviewSnapshot.execute({
                    projectId: req.sandbox!.projectId,
                    conversationId: body.conversationId,
                    sourceMessageId: body.sourceMessageId,
                    parentSnapshotId: body.parentSnapshotId,
                    artifacts,
                    focusContext: body.focusContext,
                    metadata: body.metadata ? { ...body.metadata, structuredParseValid } : undefined,
                    activate: body.activate,
                });

                // ── Execution log (fire-and-forget) ──────────────────────────
                ExecutionLogger.instance.emit({
                    projectId: req.sandbox!.projectId,
                    conversationId: body.conversationId,
                    snapshotId: snapshot.id,
                    domain: "snapshot",
                    eventType: "snapshot_created",
                    level: "info",
                    status: "success",
                    metadata: {
                        snapshotId: snapshot.id,
                        parentSnapshotId: body.parentSnapshotId,
                        sourceMessageId: body.sourceMessageId,
                        activated: body.activate,
                        htmlBytes: artifacts.html?.length ?? 0,
                        finishReason: body.metadata?.finishReason,
                        model: body.metadata?.model,
                        provider: body.metadata?.provider,
                        structuredParseValid,
                        hasFocusContext: Boolean(body.focusContext),
                    },
                });
                // ── end execution log ─────────────────────────────────────────

                res.status(201).json({ snapshot });
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
                res.json({ snapshot });
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

                res.json({ snapshot });
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

    return router;
}
