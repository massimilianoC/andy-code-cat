import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
    generateDidacticKnowledgeSchema,
    askDidacticQuestionSchema,
} from "@andy-code-cat/contracts";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoDidacticArtifactKnowledgeRepository } from "../../../infra/repositories/MongoDidacticArtifactKnowledgeRepository";
import { MongoDidacticQnaRepository } from "../../../infra/repositories/MongoDidacticQnaRepository";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { GetDidacticKnowledge } from "../../../application/use-cases/GetDidacticKnowledge";
import { GenerateDidacticKnowledge } from "../../../application/use-cases/GenerateDidacticKnowledge";
import { AskDidacticQuestion } from "../../../application/use-cases/AskDidacticQuestion";
import { ListDidacticQna } from "../../../application/use-cases/ListDidacticQna";
import { CostTransactionService } from "../../../application/cost/CostTransactionService";
import { ExecutionLogger } from "../../../application/services/ExecutionLogger";
import { ResourceType } from "../../../domain/entities/CostTransaction";
import { env } from "../../../config";
import { HttpError } from "../errors/httpError";
import { resolveComposerCascade } from "../../../application/llm/catalogModels";
import type { RequestWithContext } from "../types";

function sendSse(res: RequestWithContext["res"], payload: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * The completion budget for a didactic generation, clamped the way the chat preview clamps its own
 * (`resolveChatPreviewMaxTokens` in llmRoutes.ts).
 *
 * `LLM_DEFAULT_MAX_COMPLETION_TOKENS` is a global "as much as the biggest model allows" figure —
 * 167000 on this deployment. This route passed it through raw, so every request asked for a
 * 167k-token completion regardless of what the chosen model can hold. It only ever worked because
 * the model being resolved happened to have a large enough window; the moment a 128k model was
 * selected the provider answered `400 maximum context length is 128000 tokens ... you requested
 * about 167515 (515 of text input, 167000 in the output)` before generating a single token.
 *
 * A didactic knowledge payload is a bounded object — topics and quizzes for one artifact. Measured
 * runs used 4348 and 6076 completion tokens, so this ceiling is generous by more than a factor of
 * two while fitting inside any model with a 32k window.
 */
const DIDACTIC_COMPLETION_CEILING = 16_000;

function resolveDidacticMaxTokens(): number {
    return Math.min(env.LLM_DEFAULT_MAX_COMPLETION_TOKENS || DIDACTIC_COMPLETION_CEILING, DIDACTIC_COMPLETION_CEILING);
}

/**
 * @param selected the provider/model the user currently has selected in the workspace. It is a
 * request, not an authority (AGENTS.md, Rule Zero's corollary): the cascade resolves it against the
 * catalog, and an unavailable choice is refused rather than quietly replaced — silently running a
 * different model is precisely the defect this parameter exists to close.
 */
async function resolveLlmContext(userId: string, selected?: { provider?: string; model?: string }) {
    const catalog = await new GetLlmCatalog(
        env.LLM_CATALOG_SOURCE,
        env.SILICONFLOW_BASE_URL,
        env.LMSTUDIO_BASE_URL,
        env.OPENROUTER_BASE_URL,
        new MongoLlmCatalogRepository(),
        Boolean(env.providerApiKeys["openrouter"]),
        env.providerApiKeys,
        env.LLM_DEFAULT_PROVIDER,
    ).execute();
    const userRepo = new MongoUserRepository();
    const user = await userRepo.findById(userId);
    const prefs = user?.llmPreferences;

    // Same cascade the generation composer uses, with the dialogue role pinned — see
    // resolveComposerCascade in application/llm/catalogModels.ts. This route used to carry its
    // own copy of both the cascade and dedupeModelsById.
    // The user's live selection wins over the stored preference; the preference is the fallback for
    // a request that arrives before the picker has resolved.
    const requestedProvider = selected?.provider ?? prefs?.defaultProvider;
    const requestedModel = selected?.model ?? prefs?.roleModelOverrides?.["dialogue"];

    const cascade = resolveComposerCascade({
        providers: catalog.providers,
        requestedProvider,
        requestedModel,
        pipelineRole: "dialogue",
        envDefaultProvider: env.LLM_DEFAULT_PROVIDER,
    });

    // Only when the user asked explicitly. A stale stored preference should still degrade to the
    // cascade's default — it is not a choice the user made for this request.
    if (selected?.provider && cascade.requestedProviderUnavailable) {
        throw new HttpError(`The selected provider "${selected.provider}" is not available.`, {
            statusCode: 409,
            code: "SELECTED_PROVIDER_UNAVAILABLE",
            userMessage: `Il provider selezionato (${selected.provider}) non è disponibile. Scegline un altro dal selettore in alto.`,
        });
    }
    if (selected?.model && cascade.requestedModelUnavailable) {
        throw new HttpError(`The selected model "${selected.model}" is not available.`, {
            statusCode: 409,
            code: "SELECTED_MODEL_UNAVAILABLE",
            userMessage: `Il modello selezionato (${selected.model}) non è disponibile. Scegline un altro dal selettore in alto.`,
        });
    }

    const providerCatalog = cascade.providerCatalog;
    if (!providerCatalog) throw new Error("No LLM provider available");

    const roleModel = cascade.roleModel;

    if (!roleModel) throw new Error("No LLM model available");

    const apiKey = env.providerApiKeys[providerCatalog.provider] ?? "";
    return {
        provider: providerCatalog.provider,
        model: roleModel.id,
        baseUrl: providerCatalog.baseUrl,
        apiKey,
        temperature: 0.4,
        maxTokens: resolveDidacticMaxTokens(),
    };
}

export function createDidacticRoutes(): Router {
    const router = Router();
    const sandbox = createSandboxMiddleware(new MongoProjectRepository());
    const didacticLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
    });

    // Scope auth + sandbox to the didactic project namespace so unrelated /v1 routes can fall through.
    router.use("/projects/:projectId/didactic", didacticLimiter, authMiddleware, sandbox);

    const knowledgeRepo = new MongoDidacticArtifactKnowledgeRepository();
    const qnaRepo = new MongoDidacticQnaRepository();
    const snapshotRepo = new MongoPreviewSnapshotRepository();
    const promptExecutionLogRepo = new MongoPromptExecutionLogRepository();

    // GET /v1/projects/:projectId/didactic/knowledge?snapshotId=...
    router.get("/projects/:projectId/didactic/knowledge", async (req: RequestWithContext, res, next) => {
        try {
            const projectId = z.string().min(1).parse(req.params.projectId);
            const snapshotId = z.string().min(1).parse(req.query.snapshotId);
            const snapshot = await snapshotRepo.findById(projectId, snapshotId);
            if (!snapshot || snapshot.projectId !== projectId) {
                res.status(404).json({ error: "Snapshot not found" });
                return;
            }
            const useCase = new GetDidacticKnowledge(knowledgeRepo);
            const result = await useCase.execute({ projectId, snapshotId, currentSnapshot: snapshot });
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    // POST /v1/projects/:projectId/didactic/knowledge/generate
    router.post("/projects/:projectId/didactic/knowledge/generate", async (req: RequestWithContext, res, next) => {
        try {
            const projectId = z.string().min(1).parse(req.params.projectId);
            const body = generateDidacticKnowledgeSchema.parse(req.body);
            const snapshot = await snapshotRepo.findById(projectId, body.snapshotId);
            if (!snapshot || snapshot.projectId !== projectId) {
                res.status(404).json({ error: "Snapshot not found" });
                return;
            }

            const llmContext = await resolveLlmContext(req.auth!.userId, { provider: body.provider, model: body.model });
            const useCase = new GenerateDidacticKnowledge(knowledgeRepo, promptExecutionLogRepo);
            const result = await useCase.execute({
                projectId,
                snapshotId: body.snapshotId,
                userId: req.auth!.userId,
                snapshot,
                uiLanguage: body.uiLanguage,
                llmContext,
                workSessionId: req.workSession?.id,
                pipelineRunId: body.pipelineRunId,
            });

            res.json({
                knowledge: {
                    ...result.knowledge,
                    generatedAt: result.knowledge.generatedAt.toISOString(),
                },
                costEstimate: result.costEstimate,
                shortfall: result.shortfall,
            });
        } catch (err) {
            next(err);
        }
    });

    // POST /v1/projects/:projectId/didactic/ask/stream
    router.post("/projects/:projectId/didactic/ask/stream", async (req: RequestWithContext, res, next) => {
        try {
            const projectId = z.string().min(1).parse(req.params.projectId);
            const body = askDidacticQuestionSchema.parse(req.body);
            const snapshot = await snapshotRepo.findById(projectId, body.snapshotId);
            if (!snapshot || snapshot.projectId !== projectId) {
                res.status(404).json({ error: "Snapshot not found" });
                return;
            }

            const llmContext = await resolveLlmContext(req.auth!.userId, { provider: body.provider, model: body.model });
            const askUseCase = new AskDidacticQuestion(qnaRepo, promptExecutionLogRepo);

            // SSE setup
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            (res as any).flushHeaders?.();

            const startMs = Date.now();
            let answer = "";
            let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

            try {
                const askInput = {
                    projectId,
                    userId: req.auth!.userId,
                    snapshotId: body.snapshotId,
                    snapshot,
                    question: body.question,
                    focus: body.focus,
                    uiLanguage: body.uiLanguage,
                    llmContext,
                    workSessionId: req.workSession?.id,
                    pipelineRunId: body.pipelineRunId,
                };

                const result = await askUseCase.streamTokens(askInput, (delta) => {
                    sendSse(res, { type: "token", content: delta });
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (res as any).flush?.();
                });

                answer = result.fullAnswer;
                usage = result.usage;

                // Persist Q&A
                await askUseCase.persist({
                    projectId,
                    userId: req.auth!.userId,
                    snapshotId: body.snapshotId,
                    snapshot,
                    question: body.question,
                    focus: body.focus,
                    uiLanguage: body.uiLanguage,
                    llmContext,
                    answer,
                    usage,
                    model: result.model,
                    provider: result.provider,
                });

                const durationMs = Date.now() - startMs;

                ExecutionLogger.instance.emit({
                    projectId,
                    snapshotId: body.snapshotId,
                    domain: "llm",
                    eventType: "didactic_ask",
                    level: "info",
                    status: "success",
                    durationMs,
                    metadata: {
                        provider: result.provider,
                        model: result.model,
                        promptTokens: usage?.promptTokens,
                        completionTokens: usage?.completionTokens,
                    },
                });

                CostTransactionService.instance.record({
                    userId: req.auth!.userId,
                    projectId,
                    resourceType: ResourceType.LLM_DIDACTIC_ASK,
                    resourceSubtype: result.model,
                    providerCostUsd: 0,
                    units: usage
                        ? {
                              promptTokens: usage.promptTokens,
                              completionTokens: usage.completionTokens,
                              totalTokens: usage.totalTokens,
                          }
                        : {},
                    sourceRef: {},
                    meta: { provider: result.provider, model: result.model, snapshotId: body.snapshotId },
                });

                sendSse(res, { type: "done" });
                res.end();
            } catch (streamErr) {
                const durationMs = Date.now() - startMs;
                sendSse(res, {
                    type: "error",
                    message: streamErr instanceof Error ? streamErr.message : "Unknown error",
                    durationMs,
                });
                if (!res.writableEnded) res.end();
            }
        } catch (err) {
            next(err);
        }
    });

    // GET /v1/projects/:projectId/didactic/qna
    router.get("/projects/:projectId/didactic/qna", async (req: RequestWithContext, res, next) => {
        try {
            const projectId = z.string().min(1).parse(req.params.projectId);
            const useCase = new ListDidacticQna(qnaRepo);
            const entries = await useCase.execute({ projectId });
            res.json({
                entries: entries.map((e) => ({
                    ...e,
                    createdAt: e.createdAt.toISOString(),
                })),
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
