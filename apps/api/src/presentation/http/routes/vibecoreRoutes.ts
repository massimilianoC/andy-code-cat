/**
 * VibeCore routes — Layer Φ pre-run intent & format classifier + LLM prefill.
 *
 * Route map:
 *   POST /v1/vibecore/classify  → classify prompt + attachments, returns VibeClassifyResponse
 *   POST /v1/vibecore/prefill   → LLM-powered Guided Mode form prefill, returns VibePrefillResponse
 */

import { Router, type RequestHandler } from "express";
import type { Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createWorkSessionMiddleware } from "../middlewares/workSessionMiddleware";
import type { RequestWithContext } from "../types";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { MongoBrandAssetRepository } from "../../../infra/repositories/MongoBrandAssetRepository";
import { ResolveBrandDocumentContext } from "../../../application/use-cases/ResolveBrandDocumentContext";
import { VibeClassifyStage, VibePrefillStage } from "../../../application/vibe/VibeEntryStages";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { VibeClassify } from "../../../application/use-cases/VibeClassify";
import { VibePrefill } from "../../../application/use-cases/VibePrefill";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoWorkSessionRepository } from "../../../infra/repositories/MongoWorkSessionRepository";
import { OpenWorkSession } from "../../../application/use-cases/OpenWorkSession";
import { MongoVibeIntakeRepository } from "../../../infra/repositories/MongoVibeIntakeRepository";
import { MongoZeroEffortFormProposalRepository } from "../../../infra/repositories/MongoZeroEffortFormProposalRepository";
import { WORK_SESSION_HEADER } from "../middlewares/workSessionMiddleware";
import {
    resolveAttachmentPolicyFromConfig,
    resolveDocumentContextPolicyFromConfig,
    type ProductAttachmentPolicy,
    type ProductDocumentContextPolicy,
} from "../../../domain/entities/PlatformConfig";
import { env } from "../../../config";

const attachmentMetaSchema = z.object({
    filename: z.string().max(255),
    mimeType: z.string().max(100),
    sizeBytes: z.number().int().nonnegative(),
});

/**
 * Generous upper bound for the Vibe prompt. This is a defensive ceiling against
 * abuse / runaway LLM cost, NOT a product limit — verbosity in the prompt is
 * welcome. ~12k chars ≈ 3k tokens, effectively unreachable in normal use. The
 * frontend counter mirrors this value (VibeCoreEntry.tsx).
 */
const VIBE_PROMPT_MAX_CHARS = 12000;

const classifyBodySchema = z.object({
    prompt: z.string().min(1).max(VIBE_PROMPT_MAX_CHARS),
    attachmentMeta: z.array(attachmentMetaSchema).max(100).optional(),
    generationMode: z.enum(["auto", "website", "data_dashboard"]).optional(),
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(200).optional(),
    /**
     * Optional. When omitted the API auto-creates a draft project so the
     * classifier LLM cost is always attributable (double-sandbox).
     * Returned in the response so the client can pin subsequent calls to it.
     */
    projectId: z.string().max(128).optional(),
    /** BCP-47 UI language from the client (e.g. "it", "en"). */
    uiLanguage: z.string().min(2).max(10).optional(),
});

const prefillBodySchema = z.object({
    prompt: z.string().min(1).max(VIBE_PROMPT_MAX_CHARS),
    /** If provided, backend loads project assets and builds Layer D document context for the LLM. */
    projectId: z.string().max(128).optional(),
    generationMode: z.enum(["auto", "website", "data_dashboard"]).optional(),
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(200).optional(),
    attachmentMeta: z.array(attachmentMetaSchema).max(100).optional(),
    templateId: z.string().max(120).nullable().optional(),
    formatHint: z.string().max(50).nullable().optional(),
    /** BCP-47 UI language from the client (e.g. "it", "en"). */
    uiLanguage: z.string().min(2).max(10).optional(),
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
        env.providerApiKeys,
        env.LLM_DEFAULT_PROVIDER,
    );
    const promptExecutionLogRepository = new MongoPromptExecutionLogRepository();
    const openWorkSession = new OpenWorkSession(new MongoWorkSessionRepository());
    const vibeIntakeRepository = new MongoVibeIntakeRepository();
    const zeroEffortFormProposalRepository = new MongoZeroEffortFormProposalRepository();
    const vibeClassify = new VibeClassify(platformConfigRepository, getLlmCatalog, promptExecutionLogRepository);
    const vibePrefill = new VibePrefill(platformConfigRepository, getLlmCatalog, promptExecutionLogRepository);
    const projectRepository = new MongoProjectRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const resolveBrandDocumentContext = new ResolveBrandDocumentContext(new MongoBrandAssetRepository());
    const storage = getFileStorage();
    const vibeClassifyStage = new VibeClassifyStage(vibeClassify, openWorkSession, vibeIntakeRepository, projectRepository);
    const vibePrefillStage = new VibePrefillStage(
        vibePrefill,
        openWorkSession,
        assetRepository,
        storage,
        resolveBrandDocumentContext,
        zeroEffortFormProposalRepository,
    );

    function validateAttachmentMetaLimits(attachmentMeta: Array<{ sizeBytes: number }>, policy: ProductAttachmentPolicy) {
        if (attachmentMeta.length > policy.maxAttachmentsPerPrompt) {
            return {
                status: 422,
                body: {
                    error: `Too many attachments: max ${policy.maxAttachmentsPerPrompt}`,
                    code: "ATTACHMENT_LIMIT_EXCEEDED",
                },
            };
        }

        const oversized = attachmentMeta.find((item) => item.sizeBytes > policy.maxFileSizeBytes);
        if (oversized) {
            return {
                status: 413,
                body: {
                    error: `File size exceeds limit: max ${policy.maxFileSizeBytes} bytes per file`,
                    code: "ATTACHMENT_FILE_TOO_LARGE",
                },
            };
        }

        const totalBytes = attachmentMeta.reduce((acc, item) => acc + item.sizeBytes, 0);
        if (totalBytes > policy.maxTotalBytes) {
            return {
                status: 422,
                body: {
                    error: `Attachment payload exceeds max total size (${policy.maxTotalBytes} bytes)`,
                    code: "ATTACHMENT_TOTAL_SIZE_EXCEEDED",
                },
            };
        }

        return null;
    }

    function buildAttachmentWarnings(attachmentMeta: Array<{ sizeBytes: number }>, policy: ProductAttachmentPolicy): string[] {
        const totalBytes = attachmentMeta.reduce((acc, item) => acc + item.sizeBytes, 0);
        if (totalBytes >= policy.warningThresholdBytes) {
            const usedMb = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
            const capMb = Math.round((policy.maxTotalBytes / (1024 * 1024)) * 10) / 10;
            return [`Attachment payload is near the cap: ${usedMb} MB / ${capMb} MB.`];
        }
        return [];
    }

    async function resolvePoliciesForProject(
        userId: string,
        projectId?: string,
    ): Promise<{
        attachmentPolicy: ProductAttachmentPolicy;
        documentContextPolicy: ProductDocumentContextPolicy;
    }> {
        const platformConfig = await platformConfigRepository.get().catch(() => null);
        if (!projectId) {
            return {
                attachmentPolicy: resolveAttachmentPolicyFromConfig(platformConfig, "default"),
                documentContextPolicy: resolveDocumentContextPolicyFromConfig(platformConfig, "default"),
            };
        }
        const project = await projectRepository.findByIdForUser(projectId, userId).catch(() => null);
        const productKey = project?.presetId ?? "default";
        return {
            attachmentPolicy: resolveAttachmentPolicyFromConfig(platformConfig, productKey),
            documentContextPolicy: resolveDocumentContextPolicyFromConfig(platformConfig, productKey),
        };
    }

    /**
     * Ensure a (user, project) sandbox pair for any vibe pipeline call.
     *
     * - If `projectId` is provided AND owned by the user → reuse it.
     * - Otherwise auto-create a lightweight draft project so every LLM call
     *   downstream is billable to a real project (double-sandbox guarantee).
     *
     * The draft name is derived from the prompt (first 60 chars) and prefixed
     * with "Vibe draft" so it is recognisable in the project list.
     * Returned projectId is echoed back to the client in the response.
     */
    async function ensureVibeProject(userId: string, projectId: string | undefined, prompt: string): Promise<string> {
        if (projectId) {
            const owned = await projectRepository.findByIdForUser(projectId, userId).catch(() => null);
            if (owned) return owned.id;
        }
        const seed = prompt.replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled";
        const draftName = `Vibe draft — ${seed}`;
        const created = await projectRepository.create(userId, draftName);
        return created.id;
    }

    router.use(authMiddleware as RequestHandler);
    // Mounted after auth because the session lookup is ownership-scoped. Never rejects: a
    // missing or foreign session id leaves the request untraced rather than refused
    // (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md rule 4).
    router.use(createWorkSessionMiddleware(new MongoWorkSessionRepository()) as RequestHandler);

    router.get(
        "/vibecore/config",
        async (req: RequestWithContext, res: Response, next: NextFunction) => {
            try {
                const userId = req.auth!.userId;
                const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
                if (requestedProjectId) {
                    const owned = await projectRepository.findByIdForUser(requestedProjectId, userId).catch(() => null);
                    if (!owned) {
                        res.status(403).json({ error: "Project not found or access denied" });
                        return;
                    }
                }
                const { attachmentPolicy, documentContextPolicy } = await resolvePoliciesForProject(userId, requestedProjectId);
                res.json({ attachmentPolicy, documentContextPolicy });
            } catch (error) {
                next(error);
            }
        },
    );

    router.post(
        "/vibecore/classify",
        async (req: RequestWithContext, res: Response, next: NextFunction) => {
            try {
                const parsed = classifyBodySchema.safeParse(req.body);
                if (!parsed.success) {
                    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
                    return;
                }

                const userId = req.auth!.userId;
                const projectId = await ensureVibeProject(userId, parsed.data.projectId, parsed.data.prompt);
                const { attachmentPolicy } = await resolvePoliciesForProject(userId, projectId);

                const attachmentMeta = parsed.data.attachmentMeta ?? [];
                const violation = validateAttachmentMetaLimits(attachmentMeta, attachmentPolicy);
                if (violation) {
                    res.status(violation.status).json(violation.body);
                    return;
                }
                const warnings = buildAttachmentWarnings(attachmentMeta, attachmentPolicy);

                // A resubmission carries the previous session id (x-work-session-id) and continues
                // it; a fresh prompt starts a new intent (VibeClassifyStage).
                const headerSessionId = String(req.headers[WORK_SESSION_HEADER] ?? "").trim() || undefined;
                const { result, workSessionId } = await vibeClassifyStage.execute({
                    userId,
                    projectId,
                    prompt: parsed.data.prompt,
                    attachmentMeta,
                    generationMode: parsed.data.generationMode,
                    provider: parsed.data.provider,
                    model: parsed.data.model,
                    continuingSessionId: req.workSession?.id ?? headerSessionId,
                });

                // Always echo projectId so the client pins follow-up calls (prefill, generation,
                // conversation) to the same sandbox, and workSessionId so every later call in this
                // intent joins one history.
                res.json({
                    ...result,
                    projectId,
                    warnings,
                    attachmentPolicy,
                    ...(workSessionId ? { workSessionId } : {}),
                });
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

                // Double-sandbox: if client passed a projectId they don't own, refuse.
                // (Auto-create only when no projectId was provided at all.)
                if (parsed.data.projectId) {
                    const owned = await projectRepository.findByIdForUser(parsed.data.projectId, userId).catch(() => null);
                    if (!owned) {
                        res.status(403).json({ error: "Project not found or access denied" });
                        return;
                    }
                }

                // Resolve (or create) the billing sandbox.
                const projectId = await ensureVibeProject(userId, parsed.data.projectId, parsed.data.prompt);
                const { attachmentPolicy, documentContextPolicy } = await resolvePoliciesForProject(userId, projectId);

                const attachmentMeta = parsed.data.attachmentMeta ?? [];
                const violation = validateAttachmentMetaLimits(attachmentMeta, attachmentPolicy);
                if (violation) {
                    res.status(violation.status).json(violation.body);
                    return;
                }
                const warnings = buildAttachmentWarnings(attachmentMeta, attachmentPolicy);

                const prefillHeaderSessionId = String(req.headers[WORK_SESSION_HEADER] ?? "").trim() || undefined;
                const { result } = await vibePrefillStage.execute({
                    userId,
                    projectId,
                    prompt: parsed.data.prompt,
                    attachmentMeta,
                    documentContextPolicy,
                    generationMode: parsed.data.generationMode,
                    templateId: parsed.data.templateId ?? null,
                    formatHint: parsed.data.formatHint ?? null,
                    provider: parsed.data.provider,
                    model: parsed.data.model,
                    uiLanguage: parsed.data.uiLanguage,
                    continuingSessionId: req.workSession?.id ?? prefillHeaderSessionId,
                });

                // Merge, don't overwrite: `warnings` here are attachment-policy notices, while
                // the use case adds its own when the automatic prefill fell back. Spreading
                // `result` first and then assigning `warnings` used to drop the latter silently.
                res.json({
                    ...result,
                    projectId,
                    warnings: [...warnings, ...(result.warnings ?? [])],
                    attachmentPolicy,
                });
            } catch (error) {
                next(error);
            }
        },
    );

    return router;
}

