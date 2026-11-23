import { Router } from "express";
import {
    llmPromptConfigSchema,
    optimizePromptSchema,
} from "@andy-code-cat/contracts";
import { env } from "../../../config";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectMoodboardRepository } from "../../../infra/repositories/MongoProjectMoodboardRepository";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import { MongoUserStyleProfileRepository } from "../../../infra/repositories/MongoUserStyleProfileRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createWorkSessionMiddleware } from "../middlewares/workSessionMiddleware";
import { MongoWorkSessionRepository } from "../../../infra/repositories/MongoWorkSessionRepository";
import { MongoLlmPromptConfigRepository } from "../../../infra/repositories/MongoLlmPromptConfigRepository";
import { GetLlmPromptConfig } from "../../../application/use-cases/GetLlmPromptConfig";
import { SetLlmPromptConfig } from "../../../application/use-cases/SetLlmPromptConfig";
import { OptimizeUserPrompt } from "../../../application/use-cases/OptimizeUserPrompt";
import { GetEffectiveLlmCatalog } from "../../../application/use-cases/GetEffectiveLlmCatalog";
import { GenerationStreamReadError } from "../../../application/use-cases/GenerateArtifact";
import { composeGenerationEngine } from "../../../composition/composeGenerationEngine";
import { getProviderStatus } from "../../../application/llm/providerAuth";
import { emitLlmFailureLog } from "../../../application/llm/llmFailureLog";
import { CHAT_TURN_DEFAULTS } from "../../../application/llm/chatTurnDefaults";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import type { RequestWithContext } from "../types";
import { ExecutionLogger } from "../../../application/services/ExecutionLogger";
import { HttpError, normalizeHttpError } from "../errors/httpError";
import { resolveAttachmentPolicyFromConfig } from "../../../domain/entities/PlatformConfig";
import { ResolvePipelineModelLock } from "../../../application/use-cases/ResolvePipelineModelLock";
import { MongoPipelineRunRepository } from "../../../infra/repositories/MongoPipelineRunRepository";

function sendSse(res: RequestWithContext["res"], payload: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createLlmRoutes(): Router {
    const router = Router();
    const projectRepository = new MongoProjectRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);
    const promptConfigRepository = new MongoLlmPromptConfigRepository();
    const getLlmPromptConfig = new GetLlmPromptConfig(promptConfigRepository);
    const setLlmPromptConfig = new SetLlmPromptConfig(promptConfigRepository);
    const moodboardRepository = new MongoProjectMoodboardRepository();
    const userStyleProfileRepository = new MongoUserStyleProfileRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const userRepo = new MongoUserRepository();
    const platformConfigRepo = new MongoPlatformConfigRepository();
    const promptExecutionLogRepository = new MongoPromptExecutionLogRepository();

    router.use(authMiddleware);
    // Mounted after auth because the session lookup is ownership-scoped. Never rejects: a
    // missing or foreign session id leaves the request untraced rather than refused
    // (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md rule 4).
    router.use(createWorkSessionMiddleware(new MongoWorkSessionRepository()));

    const llmCatalogRepository = new MongoLlmCatalogRepository();
    const getLlmCatalog = new GetLlmCatalog(
        env.LLM_CATALOG_SOURCE,
        env.SILICONFLOW_BASE_URL,
        env.LMSTUDIO_BASE_URL,
        env.OPENROUTER_BASE_URL,
        llmCatalogRepository,
        env.hasOpenRouterApiKey,
        env.providerApiKeys,
        env.LLM_DEFAULT_PROVIDER,
    );
    const getEffectiveLlmCatalog = new GetEffectiveLlmCatalog(getLlmCatalog);
    const pipelineRunRepository = new MongoPipelineRunRepository();
    const resolvePipelineModelLock = new ResolvePipelineModelLock(pipelineRunRepository, getLlmCatalog);

    const optimizeUserPrompt = new OptimizeUserPrompt(
        projectRepository,
        moodboardRepository,
        userStyleProfileRepository,
        assetRepository,
        platformConfigRepo,
        userRepo,
        promptExecutionLogRepository,
        getLlmCatalog,
        resolvePipelineModelLock,
        getFileStorage(),
    );

    // One wiring of the generation engine for the API and the background worker
    // (composition/composeGenerationEngine.ts); ResolvePromptExecution also answers the dry-run
    // prompt-preview, so the preview and the generation resolve through the same instance.
    const { resolvePromptExecution, generateArtifact } = composeGenerationEngine(getLlmCatalog);

    router.get("/llm/providers", async (_req, res, next) => {
        try {
            const catalog = await getEffectiveLlmCatalog.execute();
            const providers = catalog.providers.map((provider) => ({
                ...provider,
                ...getProviderStatus(provider.provider, provider.authType),
            }));

            res.json({
                ...catalog,
                providers,
                byokEnabled: true,
                activeProvider: catalog.activeProvider,
                hasProviderApiKeyConfigured: Object.keys(env.providerApiKeys).length > 0,
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/projects/:projectId/llm/prompt-config", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const config = await getLlmPromptConfig.execute(req.sandbox!.projectId);
            const [platformConfig, project] = await Promise.all([
                platformConfigRepo.get().catch(() => null),
                projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId).catch(() => null),
            ]);
            const attachmentPolicy = resolveAttachmentPolicyFromConfig(platformConfig, project?.presetId ?? "default");
            res.json({
                config: {
                    ...config,
                    createdAt: config.createdAt.toISOString(),
                    updatedAt: config.updatedAt.toISOString(),
                    // Backend-driven defaults for every consumer (web, tablet, mobile, branded clients).
                    // Clients must NOT hardcode these values — always read from this response.
                    chatDefaults: {
                        ...CHAT_TURN_DEFAULTS,
                        historyMaxMessages: env.LLM_MAX_HISTORY_MESSAGES,
                        historyMessageMaxChars: env.LLM_HISTORY_MESSAGE_MAX_CHARS,
                        maxCompletionTokens: env.LLM_DEFAULT_MAX_COMPLETION_TOKENS,
                        attachmentMaxFiles: attachmentPolicy.maxAttachmentsPerPrompt,
                        attachmentMaxTotalBytes: attachmentPolicy.maxTotalBytes,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // R1.4 — Prompt preview debug endpoint: returns the resolved system prompt with all layers visible
    router.get("/projects/:projectId/llm/prompt-usage-summary", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const summary = await promptExecutionLogRepository.summarizeByProject(req.sandbox!.projectId, req.auth!.userId);
            res.json(summary);
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects/:projectId/llm/optimize-prompt", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        const startedAt = Date.now();
        try {
            const body = optimizePromptSchema.parse(req.body);
            const result = await optimizeUserPrompt.execute({
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                rawPrompt: body.rawPrompt,
                assetIds: body.assetIds,
                conversationId: body.conversationId,
                sessionId: body.sessionId,
                provider: body.provider,
                model: body.model,
                taskKey: body.taskKey,
                pipelineRunId: body.pipelineRunId,
                optimizeMode: body.optimizeMode,
            });

            ExecutionLogger.instance.emit({
                projectId: req.sandbox!.projectId,
                domain: "llm",
                eventType: result.skipped ? "prompt_optimize_skipped" : "prompt_optimize_complete",
                level: "info",
                status: "success",
                durationMs: result.durationMs,
                metadata: {
                    taskKey: result.taskKey,
                    provider: result.provider,
                    model: result.model,
                    promptTokens: result.usage?.promptTokens,
                    completionTokens: result.usage?.completionTokens,
                    costEur: result.costEstimate?.amount,
                    skipped: result.skipped ?? false,
                },
            });

            res.json(result);
        } catch (error) {
            const normalized = normalizeHttpError(error);
            emitLlmFailureLog({
                projectId: req.sandbox!.projectId,
                durationMs: Date.now() - startedAt,
                provider: req.body?.provider,
                model: req.body?.model,
                code: normalized.code,
                message: normalized.userMessage,
                details: normalized.details,
            });
            next(error);
        }
    });

    router.post("/projects/:projectId/llm/optimize-prompt/stream", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        const startedAt = Date.now();

        try {
            const body = optimizePromptSchema.parse(req.body);

            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders?.();

            sendSse(res, { type: "thinking", content: "Analizzo il prompt originale...\n" });
            sendSse(res, { type: "thinking", content: "Recupero il contesto del progetto...\n" });
            sendSse(res, { type: "thinking", content: "Sto preparando una versione piu chiara e completa...\n" });

            const result = await optimizeUserPrompt.executeStream({
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                rawPrompt: body.rawPrompt,
                assetIds: body.assetIds,
                conversationId: body.conversationId,
                sessionId: body.sessionId,
                provider: body.provider,
                model: body.model,
                taskKey: body.taskKey,
                pipelineRunId: body.pipelineRunId,
                optimizeMode: body.optimizeMode,
            }, {
                onThinking: (chunk) => sendSse(res, { type: "thinking", content: String(chunk) }),
                onAnswer: (chunk) => sendSse(res, { type: "answer", content: String(chunk) }),
            });

            ExecutionLogger.instance.emit({
                projectId: req.sandbox!.projectId,
                domain: "llm",
                eventType: result.skipped ? "prompt_optimize_skipped" : "prompt_optimize_complete",
                level: "info",
                status: "success",
                durationMs: result.durationMs,
                metadata: {
                    taskKey: result.taskKey,
                    provider: result.provider,
                    model: result.model,
                    promptTokens: result.usage?.promptTokens,
                    completionTokens: result.usage?.completionTokens,
                    costEur: result.costEstimate?.amount,
                    skipped: result.skipped ?? false,
                    streaming: true,
                },
            });

            sendSse(res, { type: "done", result });
            res.end();
        } catch (error) {
            const normalized = normalizeHttpError(error);
            emitLlmFailureLog({
                projectId: req.sandbox!.projectId,
                durationMs: Date.now() - startedAt,
                provider: req.body?.provider,
                model: req.body?.model,
                code: normalized.code,
                message: normalized.userMessage,
                details: normalized.details,
            });

            if (res.headersSent) {
                if (!res.writableEnded && !res.destroyed) {
                    sendSse(res, {
                        type: "error",
                        message: normalized.userMessage,
                        durationMs: Date.now() - startedAt,
                        error: {
                            error: normalized.userMessage,
                            code: normalized.code,
                            status: normalized.statusCode,
                            userMessage: normalized.userMessage,
                            details: normalized.details,
                        },
                    });
                    res.end();
                }
                return;
            }

            next(error);
        }
    });

    router.get("/projects/:projectId/llm/prompt-preview", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const uiLanguage = typeof req.query.uiLanguage === "string" ? req.query.uiLanguage : undefined;
            const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
            const model = typeof req.query.model === "string" ? req.query.model : undefined;
            const capability = typeof req.query.capability === "string" ? req.query.capability : undefined;
            // pipelineRole mirrors the value the workspace sends to chat-preview (the backend-driven
            // chatDefaults default is "dialogue"). Keeping it in sync means the dry-run resolves the
            // SAME roleModel — hence the same model id and the same Layer E model template — that the
            // next real generation will use. Never hardcode a role here (PROMPT_LAYER_SSOT_SPEC §7).
            const pipelineRole = typeof req.query.pipelineRole === "string" ? req.query.pipelineRole : "dialogue";
            // Dry-run of the EXACT generation path: same resolver, same composer, no provider call.
            const context = await resolvePromptExecution.execute({
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                pipelineRole,
                provider,
                model,
                capability,
                outputLanguage: uiLanguage,
            });
            res.json({
                dryRun: true,
                presetId: null, // kept for backward-compat; presetId is visible in layers[].source
                provider: context.providerCatalog.provider,
                model: context.modelId,
                effectiveSystemPrompt: context.systemPrompt,
                layers: context.promptLayers,
                tokenEstimate: Math.ceil(context.systemPrompt.length / 4),
            });
        } catch (error) {
            next(error);
        }
    });

    router.put("/projects/:projectId/llm/prompt-config", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const body = llmPromptConfigSchema.parse(req.body);
            const updated = await setLlmPromptConfig.execute({
                projectId: req.sandbox!.projectId,
                enabled: body.enabled,
                responseFormatVersion: body.responseFormatVersion,
                prePromptTemplate: body.prePromptTemplate,
            });

            res.json({
                config: {
                    ...updated,
                    createdAt: updated.createdAt.toISOString(),
                    updatedAt: updated.updatedAt.toISOString(),
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // Both generation routes are transport adapters over GenerateArtifact (BACKGROUND_RUNS.md
    // §3.1): one engine, two ways of delivering its result. Nothing about what is sent to the
    // model, parsed, journalled or costed is decided here.
    router.post("/projects/:projectId/llm/chat-preview", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const outcome = await generateArtifact.execute({
                userId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                rawBody: req.body,
                workSessionId: req.workSession?.id,
                transport: "single",
            });
            if (outcome.kind !== "completed") {
                // A single call has no interruption path; reaching here would be a defect.
                throw new HttpError("Generation ended without a result", { statusCode: 502, code: "LLM_GENERATION_INCOMPLETE" });
            }
            res.json(outcome.result);
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects/:projectId/llm/chat-preview/stream", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        const startedAt = Date.now();
        // Abort provider fetch on client disconnect.
        // IMPORTANT: use res.on("close"), NOT req.on("close").
        // After express.json() consumes the body, req emits "close" in the next
        // tick — long before this code runs — making req.on("close") a dead
        // listener. res.on("close") fires when the HTTP response socket actually
        // closes (client disconnect or res.end()), which is what we need for SSE.
        const clientGone = new AbortController();
        const onClientClose = () => {
            console.log(`[stream-debug] res close event fired at ${Date.now() - startedAt}ms → aborting fetch`);
            clientGone.abort();
        };
        res.on("close", onClientClose);
        const responseOpen = () => !res.writableEnded && !res.destroyed;

        try {
            const outcome = await generateArtifact.execute({
                userId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                rawBody: req.body,
                workSessionId: req.workSession?.id,
                transport: "stream",
                startedAt,
                abortSignal: clientGone.signal,
                isStopped: () => res.destroyed || res.writableEnded,
                sink: {
                    streamOpened: () => {
                        res.setHeader("Content-Type", "text/event-stream");
                        res.setHeader("Cache-Control", "no-cache, no-transform");
                        res.setHeader("Connection", "keep-alive");
                        res.setHeader("X-Accel-Buffering", "no");
                        res.flushHeaders?.();
                    },
                    thinking: (content) => sendSse(res, { type: "thinking", content }),
                    answer: (content) => sendSse(res, { type: "answer", content }),
                    // Deterministic media-resolution steps, forwarded in real time.
                    mediaProgress: (event) => {
                        if (responseOpen()) sendSse(res, { type: "media_progress", ...event });
                    },
                },
            });
            res.off("close", onClientClose);

            if (outcome.kind === "aborted") {
                if (!res.writableEnded) res.end();
                return;
            }
            if (outcome.kind === "interrupted") {
                // Partial metadata, so the client can persist the cost/token info even for
                // aborted generations.
                if (responseOpen()) sendSse(res, { type: "interrupted", ...outcome.interrupted });
                if (!res.writableEnded) res.end();
                return;
            }
            sendSse(res, { type: "done", result: outcome.result });
            res.end();
        } catch (error) {
            res.off("close", onClientClose);
            if (error instanceof GenerationStreamReadError) {
                // Headers already flushed and the journal row already failed: say so and stop.
                sendSse(res, { type: "error", message: error.message, durationMs: error.durationMs });
                res.end();
                return;
            }
            // If headers have already been flushed (SSE started), we cannot use next(error),
            // which would try res.status().json() and crash. Send an SSE error event instead so
            // the client can handle it gracefully.
            if (res.headersSent) {
                const normalized = normalizeHttpError(error);
                console.error(`[stream-debug] post-flush error at ${Date.now() - startedAt}ms:`, error);
                if (responseOpen()) {
                    sendSse(res, {
                        type: "error",
                        message: normalized.userMessage,
                        durationMs: Date.now() - startedAt,
                        error: {
                            error: normalized.userMessage,
                            code: normalized.code,
                            status: normalized.statusCode,
                            userMessage: normalized.userMessage,
                            details: normalized.details,
                        },
                    });
                    res.end();
                }
                return;
            }
            next(error);
        }
    });

    return router;
}
