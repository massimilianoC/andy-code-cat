/**
 * VibeCore routes — Layer Φ pre-run intent & format classifier + LLM prefill.
 *
 * Route map:
 *   POST /v1/vibecore/classify  → classify prompt + attachments, returns VibeClassifyResponse
 *   POST /v1/vibecore/prefill   → LLM-powered zero-effort form prefill, returns VibePrefillResponse
 */

import { Router, type RequestHandler } from "express";
import type { Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middlewares/authMiddleware";
import type { RequestWithContext } from "../types";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { VibeClassify } from "../../../application/use-cases/VibeClassify";
import { VibePrefill } from "../../../application/use-cases/VibePrefill";
import { env } from "../../../config";

const attachmentMetaSchema = z.object({
    filename: z.string().max(255),
    mimeType: z.string().max(100),
    sizeBytes: z.number().int().nonnegative(),
});

const classifyBodySchema = z.object({
    prompt: z.string().min(1).max(2000),
    attachmentMeta: z.array(attachmentMetaSchema).max(3).optional(),
});

const prefillBodySchema = z.object({
    prompt: z.string().min(1).max(2000),
    attachmentMeta: z.array(attachmentMetaSchema).max(3).optional(),
    templateId: z.string().max(120).nullable().optional(),
    formatHint: z.string().max(50).nullable().optional(),
});

export function createVibecoreRoutes(): Router {
    const router = Router();

    const platformConfigRepository = new MongoPlatformConfigRepository();
    const llmCatalogRepository = new MongoLlmCatalogRepository();
    const getLlmCatalog = new GetLlmCatalog(
        env.LLM_CATALOG_SOURCE,
        env.SILICONFLOW_BASE_URL,
        env.LMSTUDIO_BASE_URL,
        env.OPENROUTER_BASE_URL,
        llmCatalogRepository,
        env.hasOpenRouterApiKey,
    );
    const vibeClassify = new VibeClassify(platformConfigRepository, getLlmCatalog);
    const vibePrefill = new VibePrefill(platformConfigRepository, getLlmCatalog);

    router.use(authMiddleware as RequestHandler);

    router.post(
        "/vibecore/classify",
        async (req: RequestWithContext, res: Response, next: NextFunction) => {
            try {
                const parsed = classifyBodySchema.safeParse(req.body);
                if (!parsed.success) {
                    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
                    return;
                }

                const result = await vibeClassify.execute({
                    prompt: parsed.data.prompt,
                    attachmentMeta: parsed.data.attachmentMeta,
                });

                res.json(result);
            } catch (error) {
                next(error);
            }
        },
    );

    router.post(
        "/vibecore/prefill",
        async (req: RequestWithContext, res: Response, next: NextFunction) => {
            try {
                const parsed = prefillBodySchema.safeParse(req.body);
                if (!parsed.success) {
                    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
                    return;
                }

                const result = await vibePrefill.execute({
                    prompt: parsed.data.prompt,
                    attachmentMeta: parsed.data.attachmentMeta,
                    templateId: parsed.data.templateId ?? null,
                    formatHint: (parsed.data.formatHint ?? null) as import("@andy-code-cat/contracts").FormatHint | null,
                });

                res.json(result);
            } catch (error) {
                next(error);
            }
        },
    );

    return router;
}

