/**
 * VibeCore routes — Layer Φ pre-run intent & format classifier.
 *
 * Route map:
 *   POST /v1/vibecore/classify  → classify prompt + attachments, returns VibeClassifyResponse
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
import { env } from "../../../config";

const classifyBodySchema = z.object({
    prompt: z.string().min(1).max(2000),
    attachmentMeta: z
        .array(
            z.object({
                filename: z.string().max(255),
                mimeType: z.string().max(100),
                sizeBytes: z.number().int().nonnegative(),
            }),
        )
        .max(3)
        .optional(),
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

    return router;
}
