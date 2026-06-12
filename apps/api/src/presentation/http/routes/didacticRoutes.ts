import { Router } from "express";
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
import type { RequestWithContext } from "../types";

function sendSse(res: RequestWithContext["res"], payload: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).write(`data: ${JSON.stringify(payload)}\n\n`);
}

function dedupeModelsById(models: Array<{ id: string; role: string; isDefault?: boolean; isFallback?: boolean; isActive?: boolean }>) {
    const byId = new Map<string, (typeof models)[number]>();
    for (const m of models) {
        if (!m.isActive || !m.id) continue;
        const prev = byId.get(m.id);
        if (!prev || (m.isDefault && !prev.isDefault)) byId.set(m.id, m);
    }
    return [...byId.values()];
}

function pickDialogueModel(models: Array<{ id: string; role: string; isDefault?: boolean; isFallback?: boolean; isActive?: boolean }>) {
    return (
        models.find((m) => m.role === "dialogue" && m.isDefault && m.isActive) ??
        models.find((m) => m.role === "dialogue" && m.isFallback && m.isActive) ??
        models.find((m) => m.isActive)
    );
}

async function resolveLlmContext(userId: string) {
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

    const providerCatalog =
        (prefs?.defaultProvider
            ? catalog.providers.find((p) => p.provider === prefs.defaultProvider && p.isActive)
            : undefined) ??
        catalog.providers.find((p) => p.provider === env.LLM_DEFAULT_PROVIDER) ??
        catalog.providers[0];

    if (!providerCatalog) throw new Error("No LLM provider available");

    const models = dedupeModelsById(providerCatalog.models);
    const roleOverride = prefs?.roleModelOverrides?.["dialogue"];
    const explicitModel = roleOverride ? models.find((m) => m.id === roleOverride) : undefined;
    const roleModel =
        explicitModel ??
        pickDialogueModel(models);

    if (!roleModel) throw new Error("No LLM model available");

    const apiKey = env.providerApiKeys[providerCatalog.provider] ?? "";
    return {
        provider: providerCatalog.provider,
        model: roleModel.id,
        baseUrl: providerCatalog.baseUrl,
        apiKey,
        temperature: 0.4,
        maxTokens: env.LLM_DEFAULT_MAX_COMPLETION_TOKENS ? Number(env.LLM_DEFAULT_MAX_COMPLETION_TOKENS) : 4096,
    };
}

export function createDidacticRoutes(): Router {
    const router = Router();
    const sandbox = createSandboxMiddleware(new MongoProjectRepository());

    // All didactic routes are auth + sandbox protected
    router.use(authMiddleware);
    router.use(sandbox);

    const knowledgeRepo = new MongoDidacticArtifactKnowledgeRepository();
    const qnaRepo = new MongoDidacticQnaRepository();
    const snapshotRepo = new MongoPreviewSnapshotRepository();

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

            const llmContext = await resolveLlmContext(req.auth!.userId);
            const useCase = new GenerateDidacticKnowledge(knowledgeRepo);
            const result = await useCase.execute({
                projectId,
                snapshotId: body.snapshotId,
                userId: req.auth!.userId,
                snapshot,
                uiLanguage: body.uiLanguage,
                llmContext,
            });

            res.json({
                knowledge: {
                    ...result.knowledge,
                    generatedAt: result.knowledge.generatedAt.toISOString(),
                },
                costEstimate: result.costEstimate,
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

            const llmContext = await resolveLlmContext(req.auth!.userId);
            const askUseCase = new AskDidacticQuestion(qnaRepo);

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
