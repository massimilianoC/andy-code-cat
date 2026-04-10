import { Router } from "express";
import {
    createWysiwygEditSessionSchema,
    saveWysiwygEditStateSchema,
    commitWysiwygSessionSchema,
} from "@andy-code-cat/contracts";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import type { RequestWithContext } from "../types";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoWysiwygEditSessionRepository } from "../../../infra/repositories/MongoWysiwygEditSessionRepository";
import { CreateWysiwygEditSession } from "../../../application/use-cases/CreateWysiwygEditSession";
import { SaveWysiwygEditState } from "../../../application/use-cases/SaveWysiwygEditState";
import { CommitWysiwygSession } from "../../../application/use-cases/CommitWysiwygSession";

export function createWysiwygRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();
    const wysiwygRepository = new MongoWysiwygEditSessionRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const createSession = new CreateWysiwygEditSession(wysiwygRepository);
    const saveState = new SaveWysiwygEditState(wysiwygRepository);
    const commitSession = new CommitWysiwygSession(wysiwygRepository, snapshotRepository);

    router.use(authMiddleware);

    /**
     * POST /v1/projects/:projectId/wysiwyg/sessions
     * Create or resume an active WYSIWYG edit session for a conversation+snapshot pair.
     * Idempotent: returns existing active session if one exists.
     */
    router.post(
        "/projects/:projectId/wysiwyg/sessions",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = createWysiwygEditSessionSchema.parse(req.body);
                const result = await createSession.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    conversationId: body.conversationId,
                    originSnapshotId: body.originSnapshotId,
                    currentHtml: body.currentHtml,
                    currentCss: body.currentCss,
                    currentJs: body.currentJs,
                });
                if (!result) {
                    res.status(500).json({ error: "Could not create WYSIWYG session" });
                    return;
                }
                res.status(result.resumed ? 200 : 201).json({
                    session: result.session,
                    resumed: result.resumed,
                });
            } catch (err) {
                next(err);
            }
        }
    );

    /**
     * GET /v1/projects/:projectId/wysiwyg/sessions/:sessionId
     * Retrieve a session by ID (must belong to the project).
     */
    router.get(
        "/projects/:projectId/wysiwyg/sessions/:sessionId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const sessionId = String(req.params.sessionId ?? "");
                const session = await wysiwygRepository.findById(sessionId, req.sandbox!.projectId);
                if (!session) {
                    res.status(404).json({ error: "Session not found" });
                    return;
                }
                res.json({ session });
            } catch (err) {
                next(err);
            }
        }
    );

    /**
     * PATCH /v1/projects/:projectId/wysiwyg/sessions/:sessionId/state
     * Autosave current edit state (html/css/js) for crash recovery and undo/redo history.
     */
    router.patch(
        "/projects/:projectId/wysiwyg/sessions/:sessionId/state",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = saveWysiwygEditStateSchema.parse(req.body);
                const sessionId = String(req.params.sessionId ?? "");
                const session = await saveState.execute({
                    sessionId,
                    projectId: req.sandbox!.projectId,
                    html: body.html,
                    css: body.css,
                    js: body.js,
                });
                if (!session) {
                    res.status(404).json({ error: "Session not found or already committed" });
                    return;
                }
                res.json({ session });
            } catch (err) {
                next(err);
            }
        }
    );

    /**
     * POST /v1/projects/:projectId/wysiwyg/sessions/:sessionId/commit
     * Commit the session: creates a new versioned PreviewSnapshot, activates it,
     * and marks the session as committed with the new snapshot ID.
     */
    router.post(
        "/projects/:projectId/wysiwyg/sessions/:sessionId/commit",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = commitWysiwygSessionSchema.parse(req.body);
                const sessionId = String(req.params.sessionId ?? "");
                const result = await commitSession.execute({
                    sessionId,
                    projectId: req.sandbox!.projectId,
                    description: body.description,
                });
                if (!result) {
                    res.status(404).json({ error: "Session not found or already committed" });
                    return;
                }
                res.status(201).json({
                    snapshot: result.snapshot,
                    session: result.session,
                });
            } catch (err) {
                next(err);
            }
        }
    );

    return router;
}
