import { Router } from "express";
import {
    llmChatPreviewSchema,
    llmPromptConfigSchema,
    optimizePromptSchema,
    type LlmChatPreviewResult,
    type MediaResolutionMetadata,
} from "@andy-code-cat/contracts";
import { tryParseStructuredJson, buildFormattedReply } from "../../../application/llm/llmParser";
import { applyFocusPatch } from "../../../application/llm/llmPatchMerger";
import { assertPromptTraceParity } from "../../../application/llm/promptTraceParity";
import { buildChatCompletionRequestBody } from "../../../application/llm/chatRequestAdapter";
import {
    buildParseFailureStructured,
    isGenerationParseFailure,
    tryBuildSectionContextOpts,
    resolveUsageWithFallback,
    buildMessagesWithHistory,
} from "../../../application/llm/llmMessageBuilder";
import { ResolveArtifactMedia } from "../../../application/media/ResolveArtifactMedia";
import { MongoServiceApiKeyRepository } from "../../../infra/repositories/MongoServiceApiKeyRepository";
import { estimateCost } from "../../../application/llm/costPolicy";
import { getSiliconFlowPrice } from "../../../application/llm/siliconflowPricing";
import { env } from "../../../config";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectMoodboardRepository } from "../../../infra/repositories/MongoProjectMoodboardRepository";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import { CostTransactionService } from "../../../application/cost/CostTransactionService";
import { ResourceType } from "../../../domain/entities/CostTransaction";
import { MongoUserStyleProfileRepository } from "../../../infra/repositories/MongoUserStyleProfileRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoProjectPresetRepository } from "../../../infra/repositories/MongoProjectPresetRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoMediaResolutionTraceRepository } from "../../../infra/repositories/MongoMediaResolutionTraceRepository";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { authMiddleware } from "../middlewares/authMiddleware";
import { MongoLlmPromptConfigRepository } from "../../../infra/repositories/MongoLlmPromptConfigRepository";
import { GetLlmPromptConfig } from "../../../application/use-cases/GetLlmPromptConfig";
import { SetLlmPromptConfig } from "../../../application/use-cases/SetLlmPromptConfig";
import { OptimizeUserPrompt } from "../../../application/use-cases/OptimizeUserPrompt";
import { GetEffectiveLlmCatalog } from "../../../application/use-cases/GetEffectiveLlmCatalog";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import type { RequestWithContext } from "../types";
import { ExecutionLogger } from "../../../application/services/ExecutionLogger";
import { HttpError, normalizeHttpError } from "../errors/httpError";
import { resolveAttachmentPolicyFromConfig } from "../../../domain/entities/PlatformConfig";
import { MongoBrandAssetRepository } from "../../../infra/repositories/MongoBrandAssetRepository";
import { ResolveBrandContext } from "../../../application/use-cases/ResolveBrandContext";
import { ResolveBrandDocumentContext } from "../../../application/use-cases/ResolveBrandDocumentContext";
import { ResolvePromptExecution, type LlmRuntimeContext } from "../../../application/use-cases/ResolvePromptExecution";
import { ResolvePipelineModelLock } from "../../../application/use-cases/ResolvePipelineModelLock";
import { MongoPipelineRunRepository } from "../../../infra/repositories/MongoPipelineRunRepository";

type LlmProviderStatus = {
    requiresKey: boolean;
    hasApiKeyConfigured: boolean;
    keyEnvironmentVariable?: string;
};

const PROVIDER_KEY_ENV_HINTS: Record<string, string> = {
    siliconflow: "SILICONFLOW_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
};

/**
 * I11 (SSOT program): a "pending" PromptExecutionLog older than this is treated as abandoned
 * (e.g. the API process crashed mid-call) and no longer blocks a retry using the same
 * idempotencyKey. Matches the generous end of this route's own generation timeouts.
 */
const PROMPT_EXECUTION_IDEMPOTENCY_STALE_MS = 5 * 60_000;

function resolveChatPreviewMaxTokens(requestedMaxTokens?: number): number {
    const previewCeiling = 64_000;
    const defaultPreviewBudget = Math.min(env.LLM_DEFAULT_MAX_COMPLETION_TOKENS, previewCeiling);
    return Math.min(requestedMaxTokens ?? defaultPreviewBudget, env.LLM_MAX_COMPLETION_TOKENS, previewCeiling);
}

function sendSse(res: RequestWithContext["res"], payload: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildPromptExecutionMediaResolutionSummary(metadata?: MediaResolutionMetadata) {
    if (!metadata) {
        return undefined;
    }

    const resolvedCount = metadata.directives?.filter((directive) => directive.status === "resolved" || directive.status === "fallback_resolved").length
        ?? metadata.assetIds?.length
        ?? 0;
    const failedCount = metadata.directives?.filter((directive) => directive.status === "unresolved").length ?? 0;

    if (!metadata.degraded && resolvedCount === 0 && failedCount === 0 && (!metadata.mediaKeys || metadata.mediaKeys.length === 0)) {
        return undefined;
    }

    return {
        version: metadata.version,
        resolvedCount,
        failedCount,
        degraded: metadata.degraded,
        mediaKeys: metadata.mediaKeys,
        traceIds: metadata.traceIds,
    };
}

function getProviderStatus(providerKey: string, authType?: "api-key" | "bearer" | "none"): LlmProviderStatus {
    const requiresKey = authType !== "none";
    return {
        requiresKey,
        hasApiKeyConfigured: requiresKey ? Boolean(env.providerApiKeys[providerKey]) : true,
        keyEnvironmentVariable: requiresKey ? (PROVIDER_KEY_ENV_HINTS[providerKey] ?? "LLM_PROVIDER_API_KEYS_JSON") : undefined,
    };
}

function buildProviderApiKeyMissingError(context: LlmRuntimeContext): HttpError {
    const providerStatus = getProviderStatus(context.providerCatalog.provider, context.providerCatalog.authType);
    return new HttpError(`Missing API key for provider ${context.providerCatalog.provider}`, {
        statusCode: 503,
        code: "LLM_PROVIDER_API_KEY_MISSING",
        userMessage: `Il provider ${context.providerCatalog.provider} richiede una API key che non e configurata.`,
        details: {
            provider: context.providerCatalog.provider,
            model: context.modelId,
            authType: context.providerCatalog.authType,
            keyEnvironmentVariable: providerStatus.keyEnvironmentVariable,
        },
    });
}

function buildProviderResponseError(input: {
    statusCode: number;
    code: string;
    message: string;
    userMessage: string;
    provider: string;
    model: string;
    providerStatus?: number;
    providerBody?: unknown;
}): HttpError {
    return new HttpError(input.message, {
        statusCode: input.statusCode,
        code: input.code,
        userMessage: input.userMessage,
        details: {
            provider: input.provider,
            model: input.model,
            providerStatus: input.providerStatus,
            providerBody: input.providerBody,
        },
    });
}

function emitLlmFailureLog(input: {
    projectId: string;
    durationMs: number;
    provider?: string;
    model?: string;
    code?: string;
    message: string;
    details?: unknown;
    isFocusedMode?: boolean;
}) {
    ExecutionLogger.instance.emit({
        projectId: input.projectId,
        domain: "llm",
        eventType: "llm_generation_failed",
        level: "error",
        status: "failure",
        durationMs: input.durationMs,
        metadata: {
            provider: input.provider,
            model: input.model,
            code: input.code,
            message: input.message,
            details: input.details,
            isFocusedMode: input.isFocusedMode,
        },
    });
}

function parseLlmChatPreviewBody(raw: unknown) {
    const parsed = llmChatPreviewSchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }

    const focusOnlyError =
        parsed.error.issues.length > 0 &&
        parsed.error.issues.every((issue) => issue.path[0] === "focusContext");

    if (focusOnlyError && raw && typeof raw === "object") {
        const fallbackParsed = llmChatPreviewSchema.safeParse({
            ...(raw as Record<string, unknown>),
            focusContext: undefined,
        });

        if (fallbackParsed.success) {
            console.warn("[llm] invalid focusContext ignored - falling back to full-project context.", {
                focusContextErrors: parsed.error.flatten().fieldErrors.focusContext,
            });
            return fallbackParsed.data;
        }
    }

    throw parsed.error;
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
    const presetRepository = new MongoProjectPresetRepository();
    const promptExecutionLogRepository = new MongoPromptExecutionLogRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();
    const mediaResolutionTraceRepository = new MongoMediaResolutionTraceRepository();
    const serviceKeyRepo = new MongoServiceApiKeyRepository();
    const brandAssetRepository = new MongoBrandAssetRepository();
    const resolveBrandContext = new ResolveBrandContext(brandAssetRepository);
    const resolveBrandDocumentContext = new ResolveBrandDocumentContext(brandAssetRepository);
    const resolveArtifactMedia = new ResolveArtifactMedia(
        assetRepository,
        getFileStorage(),
        serviceKeyRepo,
        undefined,
        undefined,
        platformConfigRepo,
        mediaResolutionTraceRepository,
    );

    router.use(authMiddleware);

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

    function resolveAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none") {
        if (authType === "none") {
            return undefined;
        }

        const key = env.providerApiKeys[providerKey];
        if (!key) {
            return undefined;
        }

        const kind = authType ?? "bearer";
        return kind === "api-key" ? key : `Bearer ${key}`;
    }

    // I10 of the SSOT program: the composer previously nested here as `resolveContext()` is now
    // ResolvePromptExecution — a pure move (see that file's doc comment), constructed once here
    // with the same dependency instances the closure used to capture.
    const resolvePromptExecution = new ResolvePromptExecution(
        getLlmCatalog,
        getLlmPromptConfig,
        moodboardRepository,
        userStyleProfileRepository,
        projectRepository,
        platformConfigRepo,
        assetRepository,
        presetRepository,
        resolveBrandDocumentContext,
        resolveBrandContext,
        resolvePipelineModelLock,
        getFileStorage(),
    );

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
                        temperature: 0.4,
                        pipelineRole: "dialogue",
                        capability: "chat",
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

    router.post("/projects/:projectId/llm/chat-preview", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        const startedAt = Date.now();
        // I11 (SSOT program): set once the durable pending record is written, read in the catch
        // block to mark that same record failed. Declared outside the try so both see it.
        let promptExecutionLogId: string | undefined;

        try {
            const body = parseLlmChatPreviewBody(req.body);
            const isFocusedMode = Boolean(
                body.focusContext
                && body.focusContext.mode !== "project"
                && body.currentArtifacts
                && (body.currentArtifacts.html || body.currentArtifacts.css || body.currentArtifacts.js)
            );
            const sectionOpts = tryBuildSectionContextOpts(isFocusedMode, body);
            const context = await resolvePromptExecution.execute({
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                pipelineRole: body.pipelineRole,
                provider: body.provider,
                model: body.model,
                capability: body.capability,
                assetIds: body.assetIds,
                systemPrompt: body.systemPrompt,
                outputLanguage: body.uiLanguage,
                focusedMode: isFocusedMode ? {
                    focusContext: body.focusContext!,
                    pageMap: sectionOpts?.pageMap,
                } : undefined,
                pipelineRunId: body.pipelineRunId,
            });
            const effectiveSystemPrompt = context.systemPrompt;

            const { messages } = buildMessagesWithHistory(
                effectiveSystemPrompt,
                body.message,
                body.history,
                body.currentArtifacts,
                body.focusContext,
                sectionOpts,
            );
            assertPromptTraceParity({
                effectiveSystemPrompt,
                layers: context.promptLayers,
                messagesSentToLlm: messages,
            });

            const authHeader = resolveAuthHeader(context.providerCatalog.provider, context.providerCatalog.authType);

            if (!authHeader && context.providerCatalog.authType !== "none") {
                throw buildProviderApiKeyMissingError(context);
            }

            // ── I11: durable pending journal write, AWAITED before the provider call ──────
            if (body.idempotencyKey) {
                const activeDuplicate = await promptExecutionLogRepository.findActiveByIdempotencyKey(
                    req.sandbox!.projectId,
                    req.auth!.userId,
                    body.idempotencyKey,
                    PROMPT_EXECUTION_IDEMPOTENCY_STALE_MS,
                );
                if (activeDuplicate) {
                    throw new HttpError("A request with this idempotency key is already in flight or has already completed", {
                        statusCode: 409,
                        code: "DUPLICATE_REQUEST",
                        userMessage: "Questa richiesta è già stata inviata. Attendi il completamento prima di ripetere.",
                        details: { promptExecutionId: activeDuplicate.id, status: activeDuplicate.status },
                    });
                }
            }
            const pendingLog = await promptExecutionLogRepository.createPending({
                taskKey: "chat",
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                conversationId: body.conversationId,
                provider: context.providerCatalog.provider,
                model: context.modelId,
                inputPrompt: body.message.slice(0, 2000),
                renderedSystemPrompt: effectiveSystemPrompt,
                renderedUserPrompt: messages[messages.length - 1]?.content,
                contextMeta: {
                    projectPresetId: context.projectPresetId,
                    usedMoodboard: false,
                    usedUserProfile: false,
                },
                idempotencyKey: body.idempotencyKey,
            });
            promptExecutionLogId = pendingLog.id;
            // ── end I11 pending write ───────────────────────────────────────────────────

            const sfRes = await fetch(`${context.providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(authHeader ? { Authorization: authHeader } : {}),
                },
                body: JSON.stringify(buildChatCompletionRequestBody({
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                    maxTokens: resolveChatPreviewMaxTokens(body.max_tokens),
                    temperature: body.temperature ?? 0.4,
                    messages,
                    thinkingBudget: body.thinking_budget,
                })),
            });

            const sfJson = await sfRes.json().catch(() => ({}));

            if (!sfRes.ok) {
                console.error("[LLM provider error]", {
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                    providerStatus: sfRes.status,
                    providerBody: sfJson,
                });
                // Pass through 429 (rate limit) and 404 (model not found) directly
                // so the client knows the actual reason instead of seeing a generic 502.
                const outStatus = sfRes.status === 429 ? 429 : sfRes.status === 404 ? 404 : 502;
                throw buildProviderResponseError({
                    statusCode: outStatus,
                    code: outStatus === 429 ? "LLM_PROVIDER_RATE_LIMIT" : outStatus === 404 ? "LLM_MODEL_NOT_FOUND" : "LLM_PROVIDER_REQUEST_FAILED",
                    message: outStatus === 429
                        ? "LLM provider rate limit reached"
                        : outStatus === 404
                            ? "Model not found at provider"
                            : "LLM provider call failed",
                    userMessage: outStatus === 429
                        ? "Il provider ha raggiunto il rate limit. Riprova tra poco o seleziona un altro modello."
                        : outStatus === 404
                            ? "Il modello selezionato non e disponibile presso il provider. Scegli un modello diverso."
                            : "La chiamata al provider LLM non e andata a buon fine.",
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                    providerStatus: sfRes.status,
                    providerBody: sfJson,
                });
            }

            const rawReply = String(sfJson?.choices?.[0]?.message?.content ?? "").trim();
            if (!rawReply) {
                throw buildProviderResponseError({
                    statusCode: 502,
                    code: "LLM_PROVIDER_EMPTY_RESPONSE",
                    message: "LLM provider returned empty content",
                    userMessage: "Il provider ha restituito una risposta vuota.",
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                    providerBody: sfJson,
                });
            }

            const parsed = tryParseStructuredJson(rawReply);
            const generationParseError = isGenerationParseFailure({
                parseValid: parsed.parseValid,
                isFocusedMode,
                hasCurrentArtifacts: Boolean(body.currentArtifacts?.html),
            });
            let structured = parsed.structured ?? buildParseFailureStructured();
            let mediaResolutionMetadata: MediaResolutionMetadata | undefined;
            let focusPatchApplied: boolean | undefined;
            let focusPatchParseError: boolean | undefined;
            if (isFocusedMode && body.currentArtifacts) {
                if (parsed.structured?.focusPatch) {
                    // When selectedElement is present, derive anchor server-side from outerHtml
                    // so the LLM doesn't need to include it (avoids JSON encoding failures).
                    const serverAnchor = body.focusContext?.selectedElement?.outerHtml;
                    const patchResult = applyFocusPatch(body.currentArtifacts, parsed.structured.focusPatch, {
                        html: body.currentArtifacts.html ?? "",
                        css: body.currentArtifacts.css ?? "",
                        js: body.currentArtifacts.js ?? "",
                    }, serverAnchor);
                    // When the focused patch targets HTML, the LLM may also provide companion
                    // CSS/JS rules required to style the new element (even though focused mode
                    // instructs empty strings). Carry those through so the new element renders
                    // correctly without a second round-trip for the user.
                    const patchType = parsed.structured.focusPatch.targetType;
                    const companionCss = patchType === "html" ? (parsed.structured.artifacts?.css ?? "") : "";
                    const companionJs = patchType === "html" ? (parsed.structured.artifacts?.js ?? "") : "";
                    // Append companion CSS/JS produced by the LLM to the existing
                    // base CSS/JS (patchResult.artifacts already carries the base).
                    // Using || would silently drop the base styles when the LLM
                    // breaks the focused-mode protocol and returns non-empty artifacts.
                    const patchedArtifacts = {
                        ...patchResult.artifacts,
                        css: [patchResult.artifacts.css, companionCss].filter(Boolean).join("\n"),
                        js: [patchResult.artifacts.js, companionJs].filter(Boolean).join("\n"),
                    };
                    structured = { ...structured, artifacts: patchedArtifacts };
                    focusPatchApplied = patchResult.patchApplied;
                    // Fallback: client HTML may have been truncated (htmlLimit) so the target
                    // element was cut off. Retry the merge against the server's stored active
                    // snapshot which always contains the full artifact HTML.
                    if (!focusPatchApplied) {
                        const activeSnap = await snapshotRepository.getActiveForProject(req.sandbox!.projectId).catch(() => null);
                        if (activeSnap?.artifacts.html) {
                            const retryResult = applyFocusPatch(
                                activeSnap.artifacts,
                                parsed.structured.focusPatch,
                                activeSnap.artifacts,
                                serverAnchor
                            );
                            if (retryResult.patchApplied) {
                                console.info("[focusPatch] server-snapshot fallback applied successfully");
                                structured = {
                                    ...structured,
                                    artifacts: {
                                        ...retryResult.artifacts,
                                        css: [retryResult.artifacts.css, companionCss].filter(Boolean).join("\n"),
                                        js: [retryResult.artifacts.js, companionJs].filter(Boolean).join("\n"),
                                    },
                                };
                                focusPatchApplied = true;
                            }
                        }
                    }
                } else {
                    // Focused mode but no focusPatch (parse failed or LLM chat-only) —
                    // preserve currentArtifacts so no snapshot is created with fallback HTML.
                    structured = {
                        ...structured,
                        artifacts: {
                            html: body.currentArtifacts.html ?? "",
                            css: body.currentArtifacts.css ?? "",
                            js: body.currentArtifacts.js ?? "",
                        },
                    };
                    focusPatchApplied = false;
                    // When the JSON parse itself failed in focused mode, craft a
                    // user-friendly reply instead of dumping the raw LLM output,
                    // and flag the error so the frontend can suggest a model switch.
                    if (!parsed.parseValid) {
                        focusPatchParseError = true;
                        structured = {
                            ...structured,
                            chat: {
                                summary: "Il modello ha prodotto una risposta non interpretabile (JSON malformato). L'elemento non è stato modificato.",
                                bullets: [
                                    "La pagina resta invariata.",
                                    "Prova a cambiare modello o ripetere la richiesta.",
                                ],
                                nextActions: [],
                            },
                        };
                    }
                }
            }
            // Post-process media placeholders and legacy provider URLs into stable ProjectAsset URLs.
            // Wrapped in try/catch: media resolution must never abort the artifact delivery.
            // If resolution fails entirely the user gets the raw artifacts and a logged warning.
            if (!generationParseError && (structured.artifacts?.html || structured.artifacts?.css)) {
                try {
                    const mediaResolution = await resolveArtifactMedia.execute({
                        projectId: req.sandbox!.projectId,
                        userId: req.auth!.userId,
                        artifacts: structured.artifacts,
                        mediaManifest: structured.mediaManifest,
                        sourceContext: {
                            route: "chat-preview",
                            conversationId: body.conversationId,
                            focusPatchApplied,
                        },
                        mode: isFocusedMode ? "focused_edit" : "initial_generation",
                    });
                    structured = {
                        ...structured,
                        artifacts: mediaResolution.artifacts,
                    };
                    mediaResolutionMetadata = mediaResolution.metadata;
                } catch (mediaError) {
                    console.error("[llm/chat-preview] media resolution failed — delivering artifacts without resolved media:", mediaError);
                    ExecutionLogger.instance.emit({
                        projectId: req.sandbox!.projectId,
                        domain: "system",
                        eventType: "artifact_media_resolution_error",
                        level: "error",
                        status: "failure",
                        metadata: { error: mediaError instanceof Error ? mediaError.message : String(mediaError) },
                    });
                }
            }
            const reply = (parsed.parseValid || focusPatchParseError || generationParseError) ? buildFormattedReply(structured) : rawReply;
            const resolvedUsage = resolveUsageWithFallback({
                usage: sfJson?.usage
                    ? {
                        promptTokens: Number(sfJson.usage.prompt_tokens ?? 0),
                        completionTokens: Number(sfJson.usage.completion_tokens ?? 0),
                        totalTokens: Number(sfJson.usage.total_tokens ?? 0),
                    }
                    : undefined,
                messages,
                outputText: rawReply,
            });
            userRepo.incrementTokensConsumed(req.auth!.userId, resolvedUsage.totalTokens).catch(() => { });

            // OpenRouter (and compatible providers) may return usage.cost in USD.
            const rawProviderCost = sfJson?.usage?.cost;
            let providerCostUsd: number | undefined =
                typeof rawProviderCost === "number" ? rawProviderCost
                    : typeof rawProviderCost === "string" ? (parseFloat(rawProviderCost) || undefined)
                        : undefined;
            // SiliconFlow does not return cost in the API response; compute from per-model pricing table.
            if (providerCostUsd === undefined && context.providerCatalog.provider === "siliconflow") {
                const sfPrice = getSiliconFlowPrice(context.modelId);
                if (sfPrice && sfPrice.priceUnit === "per_m_tokens") {
                    providerCostUsd =
                        (resolvedUsage.promptTokens / 1_000_000) * sfPrice.input +
                        (resolvedUsage.completionTokens / 1_000_000) * sfPrice.output;
                }
            }

            const result: LlmChatPreviewResult = {
                reply,
                rawResponse: rawReply,
                structuredParseValid: parsed.parseValid,
                promptingTrace: {
                    originalUserMessage: body.message,
                    promptConfigId: context.promptConfigId,
                    prePromptTemplate: context.prePromptTemplate,
                    effectiveSystemPrompt: effectiveSystemPrompt,
                    layers: context.promptLayers,
                    messagesSentToLlm: messages,
                    focusContext: body.focusContext,
                },
                structured,
                mediaResolution: mediaResolutionMetadata,
                focusPatchApplied,
                focusPatchParseError,
                generationParseError: generationParseError || undefined,
                provider: context.providerCatalog.provider,
                model: context.modelId,
                finishReason: sfJson?.choices?.[0]?.finish_reason,
                usage: resolvedUsage,
                costEstimate: estimateCost(
                    {
                        capability: body.capability,
                        tokenUsage: resolvedUsage,
                        providerCostUsd,
                    },
                    {
                        textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                        imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                        videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                        usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                        providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                    }
                ),
                durationMs: Date.now() - startedAt,
                simulated: false,
                promptExecutionId: promptExecutionLogId,
            };
            const mediaResolutionSummary = buildPromptExecutionMediaResolutionSummary(result.mediaResolution);

            // ── Execution log (fire-and-forget) ──────────────────────────────
            ExecutionLogger.instance.emit({
                projectId: req.sandbox!.projectId,
                domain: "llm",
                eventType: "llm_generation_complete",
                level: parsed.parseValid ? "info" : "warn",
                status: parsed.parseValid ? "success" : "partial",
                durationMs: result.durationMs,
                metadata: {
                    provider: result.provider,
                    model: result.model,
                    finishReason: result.finishReason,
                    promptTokens: result.usage?.promptTokens,
                    completionTokens: result.usage?.completionTokens,
                    costEur: result.costEstimate?.amount,
                    structuredParseValid: result.structuredParseValid,
                    simulated: result.simulated,
                    isFocusedMode,
                    focusPatchPresent: Boolean(focusPatchApplied !== undefined),
                },
            });
            if (generationParseError) {
                const rawLen = rawReply.length;
                ExecutionLogger.instance.emit({
                    projectId: req.sandbox!.projectId,
                    conversationId: body.conversationId,
                    domain: "llm",
                    eventType: "llm_generation_parse_failed",
                    level: "error",
                    status: "failure",
                    durationMs: result.durationMs,
                    metadata: {
                        provider: result.provider,
                        model: result.model,
                        finishReason: result.finishReason,
                        completionTokens: result.usage?.completionTokens,
                        isFocusedMode,
                        streaming: false,
                        rawLength: rawLen,
                        rawPrefix: rawReply.slice(0, 1200),
                        rawSuffix: rawLen > 1800 ? rawReply.slice(-600) : "",
                    },
                });
            }
            if (isFocusedMode && focusPatchApplied !== undefined) {
                ExecutionLogger.instance.emit({
                    projectId: req.sandbox!.projectId,
                    domain: "focus_patch",
                    eventType: focusPatchApplied ? "focus_patch_applied" : "focus_patch_failed",
                    level: focusPatchApplied ? "info" : "warn",
                    status: focusPatchApplied ? "success" : "failure",
                    durationMs: result.durationMs,
                    metadata: {
                        anchorTag: body.focusContext?.selectedElement?.tag,
                        anchorPfIdPresent: Boolean(body.focusContext?.selectedElement?.outerHtml?.includes("data-pf-id")),
                    },
                });
            }
            // ── end execution log ─────────────────────────────────────────────

            // ── I11: durable journal completion, AWAITED before the response is sent ──
            // This ensures chat costs are included in project cost totals alongside
            // optimize/suggest costs, and that the record a retry's idempotencyKey check
            // would find is guaranteed to reflect the final outcome before the client sees it.
            if (promptExecutionLogId) {
                await promptExecutionLogRepository.complete(promptExecutionLogId, {
                    status: "succeeded",
                    usage: result.usage,
                    mediaResolutionSummary,
                    costEstimate: result.costEstimate,
                    durationMs: result.durationMs,
                });
            }
            // ── end I11 journal completion ──────────────────────────────────────

            // ── Cost ledger: append-only transaction record ───────────────────
            CostTransactionService.instance.record({
                userId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                resourceType: ResourceType.LLM_CHAT,
                resourceSubtype: context.modelId,
                providerCostUsd: providerCostUsd,
                precomputedTotalEur: result.costEstimate?.amount,
                units: result.usage ? {
                    promptTokens: result.usage.promptTokens,
                    completionTokens: result.usage.completionTokens,
                    totalTokens: result.usage.totalTokens,
                } : {},
                sourceRef: { conversationId: body.conversationId },
                meta: {
                    provider: result.provider,
                    model: result.model,
                    finishReason: result.finishReason,
                    isFocusedMode,
                },
            });
            // ── end cost ledger ───────────────────────────────────────────────

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
            // I11: best-effort — never let a failed journal write mask the real error.
            if (promptExecutionLogId) {
                promptExecutionLogRepository.complete(promptExecutionLogId, {
                    status: "failed",
                    errorMessage: normalized.userMessage,
                    durationMs: Date.now() - startedAt,
                }).catch(() => { });
            }
            next(error);
        }
    });

    router.post("/projects/:projectId/llm/chat-preview/stream", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        const startedAt = Date.now();
        // I11 (SSOT program): set once the durable pending record is written, read wherever
        // this handler exits (success, interrupted, or the outer catch) to complete that record.
        let promptExecutionLogId: string | undefined;

        try {
            const body = parseLlmChatPreviewBody(req.body);
            const isFocusedMode = Boolean(
                body.focusContext
                && body.focusContext.mode !== "project"
                && body.currentArtifacts
                && (body.currentArtifacts.html || body.currentArtifacts.css || body.currentArtifacts.js)
            );
            const sectionOpts = tryBuildSectionContextOpts(isFocusedMode, body);
            const context = await resolvePromptExecution.execute({
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                pipelineRole: body.pipelineRole,
                provider: body.provider,
                model: body.model,
                capability: body.capability,
                assetIds: body.assetIds,
                systemPrompt: body.systemPrompt,
                outputLanguage: body.uiLanguage,
                focusedMode: isFocusedMode ? {
                    focusContext: body.focusContext!,
                    pageMap: sectionOpts?.pageMap,
                } : undefined,
                pipelineRunId: body.pipelineRunId,
            });
            const effectiveSystemPrompt = context.systemPrompt;

            const { messages, historyIncluded } = buildMessagesWithHistory(
                effectiveSystemPrompt,
                body.message,
                body.history,
                body.currentArtifacts,
                body.focusContext,
                sectionOpts,
            );
            assertPromptTraceParity({
                effectiveSystemPrompt,
                layers: context.promptLayers,
                messagesSentToLlm: messages,
            });

            const authHeader = resolveAuthHeader(context.providerCatalog.provider, context.providerCatalog.authType);
            console.log(`[stream-debug] provider=${context.providerCatalog.provider} model=${context.modelId} authType=${context.providerCatalog.authType} hasAuth=${Boolean(authHeader)} historyIncluded=${historyIncluded} msgCount=${messages.length}`);

            if (!authHeader && context.providerCatalog.authType !== "none") {
                throw buildProviderApiKeyMissingError(context);
            }

            // ── I11: durable pending journal write, AWAITED before the provider call ──────
            if (body.idempotencyKey) {
                const activeDuplicate = await promptExecutionLogRepository.findActiveByIdempotencyKey(
                    req.sandbox!.projectId,
                    req.auth!.userId,
                    body.idempotencyKey,
                    PROMPT_EXECUTION_IDEMPOTENCY_STALE_MS,
                );
                if (activeDuplicate) {
                    throw new HttpError("A request with this idempotency key is already in flight or has already completed", {
                        statusCode: 409,
                        code: "DUPLICATE_REQUEST",
                        userMessage: "Questa richiesta è già stata inviata. Attendi il completamento prima di ripetere.",
                        details: { promptExecutionId: activeDuplicate.id, status: activeDuplicate.status },
                    });
                }
            }
            const pendingLog = await promptExecutionLogRepository.createPending({
                taskKey: "chat",
                projectId: req.sandbox!.projectId,
                userId: req.auth!.userId,
                conversationId: body.conversationId,
                provider: context.providerCatalog.provider,
                model: context.modelId,
                inputPrompt: body.message.slice(0, 2000),
                renderedSystemPrompt: effectiveSystemPrompt,
                renderedUserPrompt: messages[messages.length - 1]?.content,
                contextMeta: {
                    projectPresetId: context.projectPresetId,
                    usedMoodboard: false,
                    usedUserProfile: false,
                },
                idempotencyKey: body.idempotencyKey,
            });
            promptExecutionLogId = pendingLog.id;
            // ── end I11 pending write ───────────────────────────────────────────────────

            // Abort provider fetch on client disconnect or after 5-minute hard timeout.
            // IMPORTANT: use res.on("close"), NOT req.on("close").
            // After express.json() consumes the body, req emits "close" in the next
            // tick — long before this code runs — making req.on("close") a dead
            // listener. res.on("close") fires when the HTTP response socket actually
            // closes (client disconnect or res.end()), which is what we need for SSE.
            const fetchAbort = new AbortController();
            const onClientClose = () => {
                console.log(`[stream-debug] res close event fired at ${Date.now() - startedAt}ms → aborting fetch`);
                fetchAbort.abort();
            };
            res.on("close", onClientClose);
            console.log(`[stream-debug] starting fetch to provider at ${Date.now() - startedAt}ms`);
            const fetchTimeout = setTimeout(() => fetchAbort.abort(), 20 * 60 * 1000);

            let sfRes: Response;
            try {
                sfRes = await fetch(`${context.providerCatalog.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(authHeader ? { Authorization: authHeader } : {}),
                    },
                    body: JSON.stringify(buildChatCompletionRequestBody({
                        provider: context.providerCatalog.provider,
                        model: context.modelId,
                        stream: true,
                        maxTokens: resolveChatPreviewMaxTokens(body.max_tokens),
                        temperature: body.temperature ?? 0.4,
                        messages,
                        thinkingBudget: body.thinking_budget,
                    })),
                    signal: fetchAbort.signal,
                });
            } catch (fetchErr) {
                clearTimeout(fetchTimeout);
                res.off("close", onClientClose);
                if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
                    console.log(`[stream-debug] AbortError from fetch at ${Date.now() - startedAt}ms`);
                    if (!res.writableEnded) res.end();
                    return;
                }
                console.log(`[stream-debug] fetch threw non-abort error at ${Date.now() - startedAt}ms:`, fetchErr);
                throw buildProviderResponseError({
                    statusCode: 502,
                    code: "LLM_PROVIDER_CONNECTION_FAILED",
                    message: fetchErr instanceof Error ? fetchErr.message : "Provider connection error",
                    userMessage: "Non e stato possibile contattare il provider LLM.",
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                });
            }
            clearTimeout(fetchTimeout);

            if (!sfRes.ok || !sfRes.body) {
                res.off("close", onClientClose);
                const providerBody = await sfRes.text().catch(() => "");
                console.log(`[stream-debug] provider error status=${sfRes.status} at ${Date.now() - startedAt}ms body=${providerBody.slice(0, 200)}`);
                throw buildProviderResponseError({
                    statusCode: sfRes.status === 429 ? 429 : sfRes.status === 404 ? 404 : 502,
                    code: sfRes.status === 429 ? "LLM_PROVIDER_RATE_LIMIT" : sfRes.status === 404 ? "LLM_MODEL_NOT_FOUND" : "LLM_PROVIDER_REQUEST_FAILED",
                    message: `Provider error ${sfRes.status}`,
                    userMessage: sfRes.status === 429
                        ? "Il provider ha raggiunto il rate limit. Riprova tra poco o seleziona un altro modello."
                        : sfRes.status === 404
                            ? "Il modello selezionato non e disponibile presso il provider. Scegli un modello diverso."
                            : "La chiamata al provider LLM non e andata a buon fine.",
                    provider: context.providerCatalog.provider,
                    model: context.modelId,
                    providerStatus: sfRes.status,
                    providerBody,
                });
            }

            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders?.();
            console.log(`[stream-debug] provider response ok, starting stream read at ${Date.now() - startedAt}ms`);

            const reader = sfRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let rawReply = "";
            let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
            let providerCostUsdStream: number | undefined;
            let finishReason: string | undefined;
            let streamAborted = false;

            try {
                while (true) {
                    if (res.destroyed || res.writableEnded) { streamAborted = true; break; }
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith("data:")) continue;

                        const data = trimmed.slice(5).trim();
                        if (!data || data === "[DONE]") {
                            continue;
                        }

                        try {
                            const json = JSON.parse(data) as {
                                choices?: Array<{
                                    delta?: {
                                        content?: string;
                                        reasoning_content?: string;
                                        reasoning?: string;
                                        thinking?: string;
                                    };
                                    finish_reason?: string | null;
                                }>;
                                usage?: {
                                    prompt_tokens?: number;
                                    completion_tokens?: number;
                                    total_tokens?: number;
                                    /** OpenRouter real cost in USD */
                                    cost?: number | string;
                                };
                            };

                            const delta = json.choices?.[0]?.delta;
                            const thinking =
                                delta?.reasoning_content ??
                                delta?.reasoning ??
                                delta?.thinking;

                            const content = delta?.content;

                            if (thinking) {
                                sendSse(res, { type: "thinking", content: String(thinking) });
                            }

                            if (content) {
                                rawReply += String(content);
                                sendSse(res, { type: "answer", content: String(content) });
                            }

                            const fr = json.choices?.[0]?.finish_reason;
                            if (fr) {
                                finishReason = String(fr);
                            }

                            if (json.usage) {
                                usage = {
                                    promptTokens: Number(json.usage.prompt_tokens ?? 0),
                                    completionTokens: Number(json.usage.completion_tokens ?? 0),
                                    totalTokens: Number(json.usage.total_tokens ?? 0),
                                };
                                const rc = json.usage.cost;
                                if (typeof rc === "number") providerCostUsdStream = rc;
                                else if (typeof rc === "string") { const p = parseFloat(rc); if (!isNaN(p)) providerCostUsdStream = p; }
                            }
                        } catch {
                            // Ignore malformed chunk.
                        }
                    }
                }
            } catch (streamReadErr) {
                if (streamReadErr instanceof Error && streamReadErr.name === "AbortError") {
                    streamAborted = true;
                } else {
                    // Headers already flushed — send SSE error instead of next(error).
                    res.off("close", onClientClose);
                    console.log(`[stream-debug] stream read error at ${Date.now() - startedAt}ms:`, streamReadErr);
                    if (promptExecutionLogId) {
                        await promptExecutionLogRepository.complete(promptExecutionLogId, {
                            status: "failed",
                            errorMessage: streamReadErr instanceof Error ? streamReadErr.message : "Stream read error",
                            durationMs: Date.now() - startedAt,
                        }).catch(() => { });
                    }
                    sendSse(res, { type: "error", message: streamReadErr instanceof Error ? streamReadErr.message : "Stream read error", durationMs: Date.now() - startedAt });
                    res.end();
                    return;
                }
            }

            res.off("close", onClientClose);

            // SiliconFlow does not return cost in the stream; compute from per-model pricing table.
            if (providerCostUsdStream === undefined && context.providerCatalog.provider === "siliconflow" && usage) {
                const sfPrice = getSiliconFlowPrice(context.modelId);
                if (sfPrice && sfPrice.priceUnit === "per_m_tokens") {
                    providerCostUsdStream =
                        (usage.promptTokens / 1_000_000) * sfPrice.input +
                        (usage.completionTokens / 1_000_000) * sfPrice.output;
                }
            }

            if (streamAborted || res.destroyed || res.writableEnded) {
                // Send an "interrupted" event with partial metadata so the client
                // can persist the cost/token info even for aborted generations.
                const partialUsage = resolveUsageWithFallback({ usage, messages, outputText: rawReply });
                userRepo.incrementTokensConsumed(req.auth!.userId, partialUsage.totalTokens).catch(() => { });
                const partialCost = estimateCost(
                    { capability: body.capability, tokenUsage: partialUsage, providerCostUsd: providerCostUsdStream },
                    {
                        textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                        imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                        videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                        usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                        providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                    }
                );
                // I11: the journal never got a success write for this run — mark it failed
                // (interrupted) rather than leaving it "pending" forever.
                if (promptExecutionLogId) {
                    await promptExecutionLogRepository.complete(promptExecutionLogId, {
                        status: "failed",
                        errorMessage: "Generation interrupted (client disconnect or timeout)",
                        durationMs: Date.now() - startedAt,
                    }).catch(() => { });
                }
                if (!res.writableEnded && !res.destroyed) {
                    sendSse(res, {
                        type: "interrupted",
                        provider: context.providerCatalog.provider,
                        model: context.modelId,
                        usage: partialUsage,
                        costEstimate: partialCost,
                        durationMs: Date.now() - startedAt,
                        partialReply: rawReply.length > 0 ? rawReply.slice(0, 200) : undefined,
                    });
                }
                if (!res.writableEnded) res.end();
                return;
            }

            const trimmedRaw = rawReply.trim();
            const parsed = tryParseStructuredJson(trimmedRaw);
            const generationParseErrorStream = isGenerationParseFailure({
                parseValid: parsed.parseValid,
                isFocusedMode,
                hasCurrentArtifacts: Boolean(body.currentArtifacts?.html),
            });
            let structured = parsed.structured ?? buildParseFailureStructured();
            let mediaResolutionMetadata: MediaResolutionMetadata | undefined;
            let focusPatchAppliedStream: boolean | undefined;
            let focusPatchParseErrorStream: boolean | undefined;
            if (isFocusedMode && body.currentArtifacts) {
                if (parsed.structured?.focusPatch) {
                    const serverAnchor = body.focusContext?.selectedElement?.outerHtml;
                    const patchResult = applyFocusPatch(body.currentArtifacts, parsed.structured.focusPatch, {
                        html: body.currentArtifacts.html ?? "",
                        css: body.currentArtifacts.css ?? "",
                        js: body.currentArtifacts.js ?? "",
                    }, serverAnchor);
                    const patchTypeStream = parsed.structured.focusPatch.targetType;
                    const companionCssStream = patchTypeStream === "html" ? (parsed.structured.artifacts?.css ?? "") : "";
                    const companionJsStream = patchTypeStream === "html" ? (parsed.structured.artifacts?.js ?? "") : "";
                    const patchedArtifactsStream = {
                        ...patchResult.artifacts,
                        css: [patchResult.artifacts.css, companionCssStream].filter(Boolean).join("\n"),
                        js: [patchResult.artifacts.js, companionJsStream].filter(Boolean).join("\n"),
                    };
                    structured = { ...structured, artifacts: patchedArtifactsStream };
                    focusPatchAppliedStream = patchResult.patchApplied;
                    // Fallback: client HTML may have been truncated (htmlLimit) so the target
                    // element was cut off. Retry the merge against the server's stored active
                    // snapshot which always contains the full artifact HTML.
                    if (!focusPatchAppliedStream) {
                        const activeSnap = await snapshotRepository.getActiveForProject(req.sandbox!.projectId).catch(() => null);
                        if (activeSnap?.artifacts.html) {
                            const retryResult = applyFocusPatch(
                                activeSnap.artifacts,
                                parsed.structured.focusPatch,
                                activeSnap.artifacts,
                                serverAnchor
                            );
                            if (retryResult.patchApplied) {
                                console.info("[focusPatch] server-snapshot fallback applied successfully");
                                structured = {
                                    ...structured,
                                    artifacts: {
                                        ...retryResult.artifacts,
                                        css: [retryResult.artifacts.css, companionCssStream].filter(Boolean).join("\n"),
                                        js: [retryResult.artifacts.js, companionJsStream].filter(Boolean).join("\n"),
                                    },
                                };
                                focusPatchAppliedStream = true;
                            }
                        }
                    }
                } else {
                    structured = {
                        ...structured,
                        artifacts: {
                            html: body.currentArtifacts.html ?? "",
                            css: body.currentArtifacts.css ?? "",
                            js: body.currentArtifacts.js ?? "",
                        },
                    };
                    focusPatchAppliedStream = false;
                    if (!parsed.parseValid) {
                        focusPatchParseErrorStream = true;
                        structured = {
                            ...structured,
                            chat: {
                                summary: "Il modello ha prodotto una risposta non interpretabile (JSON malformato). L'elemento non è stato modificato.",
                                bullets: [
                                    "La pagina resta invariata.",
                                    "Prova a cambiare modello o ripetere la richiesta.",
                                ],
                                nextActions: [],
                            },
                        };
                    }
                }
            }
            // Post-process media placeholders and legacy provider URLs into stable ProjectAsset URLs.
            if (!generationParseErrorStream && (structured.artifacts?.html || structured.artifacts?.css)) {
                try {
                    const mediaResolution = await resolveArtifactMedia.execute({
                        projectId: req.sandbox!.projectId,
                        userId: req.auth!.userId,
                        artifacts: structured.artifacts,
                        mediaManifest: structured.mediaManifest,
                        sourceContext: {
                            route: "chat-preview-stream",
                            conversationId: body.conversationId,
                            focusPatchApplied: focusPatchAppliedStream,
                        },
                        mode: isFocusedMode ? "focused_edit" : "initial_generation",
                        // Forward deterministic media-resolution steps to the client in real time.
                        onProgress: (event) => {
                            if (!res.writableEnded && !res.destroyed) {
                                sendSse(res, { type: "media_progress", ...event });
                            }
                        },
                    });
                    structured = {
                        ...structured,
                        artifacts: mediaResolution.artifacts,
                    };
                    mediaResolutionMetadata = mediaResolution.metadata;
                } catch (mediaError) {
                    console.error("[llm/chat-preview-stream] media resolution failed — delivering artifacts without resolved media:", mediaError);
                    ExecutionLogger.instance.emit({
                        projectId: req.sandbox!.projectId,
                        domain: "system",
                        eventType: "artifact_media_resolution_error",
                        level: "error",
                        status: "failure",
                        metadata: { error: mediaError instanceof Error ? mediaError.message : String(mediaError) },
                    });
                }
            }
            const reply = (parsed.parseValid || focusPatchParseErrorStream || generationParseErrorStream) ? buildFormattedReply(structured) : trimmedRaw;
            const resolvedUsage = resolveUsageWithFallback({
                usage,
                messages,
                outputText: trimmedRaw,
            });
            userRepo.incrementTokensConsumed(req.auth!.userId, resolvedUsage.totalTokens).catch(() => { });

            const result: LlmChatPreviewResult = {
                reply,
                rawResponse: trimmedRaw,
                structuredParseValid: parsed.parseValid,
                promptingTrace: {
                    originalUserMessage: body.message,
                    promptConfigId: context.promptConfigId,
                    prePromptTemplate: context.prePromptTemplate,
                    effectiveSystemPrompt: effectiveSystemPrompt,
                    layers: context.promptLayers,
                    messagesSentToLlm: messages,
                    focusContext: body.focusContext,
                },
                structured,
                mediaResolution: mediaResolutionMetadata,
                provider: context.providerCatalog.provider,
                model: context.modelId,
                finishReason,
                usage: resolvedUsage,
                costEstimate: estimateCost(
                    {
                        capability: body.capability,
                        tokenUsage: resolvedUsage,
                        providerCostUsd: providerCostUsdStream,
                    },
                    {
                        textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                        imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                        videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                        usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                        providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                    }
                ),
                durationMs: Date.now() - startedAt,
                simulated: false,
                focusPatchApplied: focusPatchAppliedStream,
                focusPatchParseError: focusPatchParseErrorStream,
                generationParseError: generationParseErrorStream || undefined,
                promptExecutionId: promptExecutionLogId,
            };
            const mediaResolutionSummary = buildPromptExecutionMediaResolutionSummary(result.mediaResolution);

            // ── Execution log (fire-and-forget) ──────────────────────────────
            ExecutionLogger.instance.emit({
                projectId: req.sandbox!.projectId,
                domain: "llm",
                eventType: "llm_generation_complete",
                level: parsed.parseValid ? "info" : "warn",
                status: parsed.parseValid ? "success" : "partial",
                durationMs: result.durationMs,
                metadata: {
                    provider: result.provider,
                    model: result.model,
                    finishReason: result.finishReason,
                    promptTokens: result.usage?.promptTokens,
                    completionTokens: result.usage?.completionTokens,
                    costEur: result.costEstimate?.amount,
                    structuredParseValid: result.structuredParseValid,
                    simulated: result.simulated,
                    isFocusedMode,
                    focusPatchPresent: Boolean(focusPatchAppliedStream !== undefined),
                    streaming: true,
                },
            });
            if (generationParseErrorStream) {
                const rawLenStream = trimmedRaw.length;
                ExecutionLogger.instance.emit({
                    projectId: req.sandbox!.projectId,
                    conversationId: body.conversationId,
                    domain: "llm",
                    eventType: "llm_generation_parse_failed",
                    level: "error",
                    status: "failure",
                    durationMs: result.durationMs,
                    metadata: {
                        provider: result.provider,
                        model: result.model,
                        finishReason: result.finishReason,
                        completionTokens: result.usage?.completionTokens,
                        isFocusedMode,
                        streaming: true,
                        rawLength: rawLenStream,
                        rawPrefix: trimmedRaw.slice(0, 1200),
                        rawSuffix: rawLenStream > 1800 ? trimmedRaw.slice(-600) : "",
                    },
                });
            }
            if (isFocusedMode && focusPatchAppliedStream !== undefined) {
                ExecutionLogger.instance.emit({
                    projectId: req.sandbox!.projectId,
                    domain: "focus_patch",
                    eventType: focusPatchAppliedStream ? "focus_patch_applied" : "focus_patch_failed",
                    level: focusPatchAppliedStream ? "info" : "warn",
                    status: focusPatchAppliedStream ? "success" : "failure",
                    durationMs: result.durationMs,
                    metadata: {
                        anchorTag: body.focusContext?.selectedElement?.tag,
                        anchorPfIdPresent: Boolean(body.focusContext?.selectedElement?.outerHtml?.includes("data-pf-id")),
                        streaming: true,
                    },
                });
            }
            // ── end execution log ─────────────────────────────────────────────

            // ── I11: durable journal completion, AWAITED before the SSE "done" event ──
            if (promptExecutionLogId) {
                await promptExecutionLogRepository.complete(promptExecutionLogId, {
                    status: "succeeded",
                    usage: result.usage,
                    mediaResolutionSummary,
                    costEstimate: result.costEstimate,
                    durationMs: result.durationMs,
                }).catch(() => { });
            }
            // ── end I11 journal completion ──────────────────────────────────────

            // ── Cost ledger: append-only transaction record ───────────────────
            CostTransactionService.instance.record({
                userId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                resourceType: ResourceType.LLM_CHAT,
                resourceSubtype: context.modelId,
                providerCostUsd: providerCostUsdStream,
                precomputedTotalEur: result.costEstimate?.amount,
                units: result.usage ? {
                    promptTokens: result.usage.promptTokens,
                    completionTokens: result.usage.completionTokens,
                    totalTokens: result.usage.totalTokens,
                } : {},
                sourceRef: { conversationId: body.conversationId },
                meta: {
                    provider: result.provider,
                    model: result.model,
                    finishReason: result.finishReason,
                    isFocusedMode,
                    streaming: true,
                },
            });
            // ── end cost ledger ───────────────────────────────────────────────

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
            // I11: best-effort — never let a failed journal write mask the real error.
            if (promptExecutionLogId) {
                promptExecutionLogRepository.complete(promptExecutionLogId, {
                    status: "failed",
                    errorMessage: normalized.userMessage,
                    durationMs: Date.now() - startedAt,
                }).catch(() => { });
            }
            // If headers have already been flushed (SSE started), we cannot use
            // next(error) which would try res.status().json() and crash. Instead
            // send an SSE error event so the client can handle it gracefully.
            if (res.headersSent) {
                console.error(`[stream-debug] post-flush error at ${Date.now() - startedAt}ms:`, error);
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

    return router;
}
