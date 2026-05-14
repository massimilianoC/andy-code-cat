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
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { getParser } from "../../../application/documents/parsers/DocumentParserFactory";
import { buildProjectKnowledgeLayer } from "../../../application/llm/systemPromptLayers";
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
    /** If provided, backend loads project assets and builds Layer D document context for the LLM. */
    projectId: z.string().max(128).optional(),
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
    const projectRepository = new MongoProjectRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const storage = getFileStorage();

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

                const userId = req.auth!.userId;
                let layerDContext: string | undefined;
                const layerDocNames: string[] = [];

                // Layer D injection: when projectId is provided, verify ownership and build document context
                if (parsed.data.projectId) {
                    const projectId = parsed.data.projectId;

                    // Double sandbox: verify project belongs to the authenticated user
                    const project = await projectRepository.findByIdForUser(projectId, userId).catch(() => null);
                    if (!project) {
                        res.status(403).json({ error: "Project not found or access denied" });
                        return;
                    }

                    // Load project assets (ownership already verified above)
                    const assets = await assetRepository.listByProject(projectId, userId).catch(() => []);

                    // First pass: use fully-enriched traces (status === "ready")
                    const enrichedLayerD = env.enrichmentInjectLayerD
                        ? buildProjectKnowledgeLayer(assets, { maxChars: 8000, maxAssets: 3 })
                        : "";

                    if (enrichedLayerD) {
                        layerDContext = enrichedLayerD;
                        assets
                            .filter((a) => a.enrichmentTrace?.provenance.enrichmentStatus === "ready" && a.originalName)
                            .slice(0, 3)
                            .forEach((a) => layerDocNames.push(a.originalName));
                    } else if (assets.length > 0) {
                        // Second pass: inline text extraction for document assets not yet enriched
                        const docAssets = assets
                            .filter((a) => a.storedFilename && getParser(a.mimeType) !== null)
                            .slice(0, 3);

                        const snippets = await Promise.allSettled(
                            docAssets.map(async (asset) => {
                                const parser = getParser(asset.mimeType)!;
                                const filePath = storage.uploadFilePath(asset.userId, asset.projectId, asset.storedFilename);
                                const stream = await storage.createReadStream(filePath);
                                const chunks: Buffer[] = [];
                                await new Promise<void>((resolve, reject) => {
                                    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)));
                                    stream.on("end", resolve);
                                    stream.on("error", reject);
                                });
                                const buffer = Buffer.concat(chunks);
                                const parsedDoc = await parser.parse(buffer, asset.mimeType);
                                const snippet = parsedDoc.rawText.slice(0, 2500).trim();
                                return snippet ? `--- ${asset.originalName} ---\n${snippet}` : null;
                            }),
                        );

                        const blocks = snippets
                            .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
                            .map((r) => r.value)
                            .filter((s): s is string => s !== null && s.length > 0);

                        if (blocks.length > 0) {
                            layerDContext = `[DOCUMENT CONTEXT — use to enrich the brief fields]\n${blocks.join("\n\n")}`;
                            docAssets.forEach((a) => layerDocNames.push(a.originalName));
                        }
                    }
                }

                const result = await vibePrefill.execute({
                    prompt: parsed.data.prompt,
                    layerDContext,
                    attachmentMeta: parsed.data.attachmentMeta,
                    templateId: parsed.data.templateId ?? null,
                    formatHint: (parsed.data.formatHint ?? null) as import("@andy-code-cat/contracts").FormatHint | null,
                });

                // Attach document names that contributed to the brief (informational, shown to user)
                if (layerDocNames.length > 0) {
                    result.draft.attachedDocuments = layerDocNames;
                }

                res.json(result);
            } catch (error) {
                next(error);
            }
        },
    );

    return router;
}

