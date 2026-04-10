import { Router } from "express";
import {
    createConversationSchema,
    addMessageSchema,
    logBackgroundTaskSchema,
    updateBackgroundTaskSchema,
} from "@andy-code-cat/contracts";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoConversationRepository } from "../../../infra/repositories/MongoConversationRepository";
import { CreateConversation } from "../../../application/use-cases/CreateConversation";
import { AddMessage } from "../../../application/use-cases/AddMessage";
import { GetConversations } from "../../../application/use-cases/GetConversations";
import { GetConversation } from "../../../application/use-cases/GetConversation";
import { GetOrCreateProjectConversation } from "../../../application/use-cases/GetOrCreateProjectConversation";
import { LogBackgroundTask } from "../../../application/use-cases/LogBackgroundTask";
import type { RequestWithContext } from "../types";

export function createConversationRoutes(): Router {
    const router = Router();

    const projectRepository = new MongoProjectRepository();
    const conversationRepository = new MongoConversationRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const createConversation = new CreateConversation(conversationRepository);
    const addMessage = new AddMessage(conversationRepository);
    const getConversations = new GetConversations(conversationRepository);
    const getConversation = new GetConversation(conversationRepository);
    const getOrCreateProjectConversation = new GetOrCreateProjectConversation(conversationRepository);
    const logBackgroundTask = new LogBackgroundTask(conversationRepository);

    router.use(authMiddleware);

    // GET /v1/projects/:projectId/conversation  (singular)
    // Get or create the single project conversation.
    // This is the primary entry-point for the workspace UI.
    router.get(
        "/projects/:projectId/conversation",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const result = await getOrCreateProjectConversation.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                });
                res.status(result.created ? 201 : 200).json({
                    conversation: result.conversation,
                    created: result.created,
                });
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/conversations
    // List all conversation summaries for a project (no messages, sorted by updatedAt desc)
    router.get(
        "/projects/:projectId/conversations",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const conversations = await getConversations.execute(
                    req.sandbox!.projectId,
                    req.auth!.userId
                );
                res.json({ conversations });
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/conversations
    // Create a new conversation, optionally with a first user message
    router.post(
        "/projects/:projectId/conversations",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = createConversationSchema.parse(req.body);
                const conversation = await createConversation.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    title: body.title,
                    firstMessage: body.firstMessage
                        ? { role: body.firstMessage.role, content: body.firstMessage.content }
                        : undefined,
                });
                res.status(201).json({ conversation });
            } catch (error) {
                next(error);
            }
        }
    );

    // GET /v1/projects/:projectId/conversations/:conversationId
    // Full conversation with all messages and background tasks
    router.get(
        "/projects/:projectId/conversations/:conversationId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const conversation = await getConversation.execute(
                    req.params.conversationId!,
                    req.sandbox!.projectId
                );
                res.json({ conversation });
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/conversations/:conversationId/messages
    // Append a message (any role) to the conversation log
    router.post(
        "/projects/:projectId/conversations/:conversationId/messages",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = addMessageSchema.parse(req.body);
                const message = await addMessage.execute({
                    conversationId: req.params.conversationId!,
                    projectId: req.sandbox!.projectId,
                    role: body.role,
                    content: body.content,
                    metadata: body.metadata,
                });
                res.status(201).json({ message });
            } catch (error) {
                next(error);
            }
        }
    );

    // POST /v1/projects/:projectId/conversations/:conversationId/messages/:messageId/tasks
    // Log a background task (analysis, pipeline, query, etc.) attached to a message
    router.post(
        "/projects/:projectId/conversations/:conversationId/messages/:messageId/tasks",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = logBackgroundTaskSchema.parse(req.body);
                const task = await logBackgroundTask.execute({
                    conversationId: req.params.conversationId!,
                    projectId: req.sandbox!.projectId,
                    messageId: req.params.messageId!,
                    type: body.type,
                    pipelineProfile: body.pipelineProfile,
                    input: body.input,
                    output: body.output,
                    status: body.status,
                    error: body.error,
                    tokenUsage: body.tokenUsage,
                    costEstimate: body.costEstimate,
                });
                res.status(201).json({ task });
            } catch (error) {
                next(error);
            }
        }
    );

    // PATCH /v1/projects/:projectId/conversations/:conversationId/messages/:messageId/tasks/:taskId
    // Update a background task status/output (e.g. when async pipeline finishes)
    router.patch(
        "/projects/:projectId/conversations/:conversationId/messages/:messageId/tasks/:taskId",
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = updateBackgroundTaskSchema.parse(req.body);
                await conversationRepository.updateBackgroundTask(
                    req.params.conversationId!,
                    req.params.messageId!,
                    req.params.taskId!,
                    {
                        ...body,
                        completedAt: ["completed", "failed"].includes(body.status)
                            ? new Date()
                            : undefined,
                    }
                );
                res.json({ message: "Task updated" });
            } catch (error) {
                next(error);
            }
        }
    );

    return router;
}
