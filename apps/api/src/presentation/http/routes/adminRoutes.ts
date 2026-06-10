import { Router } from "express";
import { adminDraftProjectTemplateSchema, adminLlmModelPatchSchema, adminProjectPresetPatchSchema, adminSeedLlmRegistrySchema, adminSeedPresetRegistrySchema, createBrandAssetTextSchema, promoteBrandAssetSchema, updateBrandAssetSchema } from "@andy-code-cat/contracts";
import { authMiddleware } from "../middlewares/authMiddleware";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoSiteDeploymentRepository } from "../../../infra/repositories/MongoSiteDeploymentRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoSessionRepository } from "../../../infra/repositories/MongoSessionRepository";
import { MongoLlmCatalogRepository } from "../../../infra/repositories/MongoLlmCatalogRepository";
import { MongoProjectPresetRepository } from "../../../infra/repositories/MongoProjectPresetRepository";
import { ListUsers } from "../../../application/use-cases/admin/ListUsers";
import { GetUserDetail } from "../../../application/use-cases/admin/GetUserDetail";
import { BlockUser } from "../../../application/use-cases/admin/BlockUser";
import { SetUserRole } from "../../../application/use-cases/admin/SetUserRole";
import { AdminCreateUser } from "../../../application/use-cases/admin/AdminCreateUser";
import { SetUserLimits } from "../../../application/use-cases/admin/SetUserLimits";
import { DeleteUser } from "../../../application/use-cases/admin/DeleteUser";
import { AdminListProjects } from "../../../application/use-cases/admin/AdminListProjects";
import { AdminDeleteProject } from "../../../application/use-cases/admin/AdminDeleteProject";
import { UpdateUserProfile } from "../../../application/use-cases/admin/UpdateUserProfile";
import { AdminResetUserPassword } from "../../../application/use-cases/admin/AdminResetUserPassword";
import { SetUserPasswordResetRequired } from "../../../application/use-cases/admin/SetUserPasswordResetRequired";
import { GetPlatformStats } from "../../../application/use-cases/admin/GetPlatformStats";
import { GetPlatformConfig } from "../../../application/use-cases/admin/GetPlatformConfig";
import { SetPlatformConfig } from "../../../application/use-cases/admin/SetPlatformConfig";
import { AdminTogglePublication } from "../../../application/use-cases/admin/AdminTogglePublication";
import { SeedLlmCatalog } from "../../../application/use-cases/SeedLlmCatalog";
import { GetLlmCatalog } from "../../../application/use-cases/GetLlmCatalog";
import { GetEffectiveLlmCatalog } from "../../../application/use-cases/GetEffectiveLlmCatalog";
import { DraftProjectTemplate } from "../../../application/use-cases/DraftProjectTemplate";
import { env } from "../../../config";
import { PRESET_CATALOG } from "../../../domain/entities/ProjectPreset";
import { MongoPromptExecutionLogRepository } from "../../../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { GetAdminAiAnalytics, GetProjectAiAnalytics } from "../../../application/use-cases/GetProjectAiAnalytics";
import { MongoServiceApiKeyRepository } from "../../../infra/repositories/MongoServiceApiKeyRepository";
import { CryptoService } from "../../../infra/security/CryptoService";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { MongoBrandAssetRepository } from "../../../infra/repositories/MongoBrandAssetRepository";
import { SetBrandAsset } from "../../../application/use-cases/SetBrandAsset";
import { ListBrandAssets } from "../../../application/use-cases/ListBrandAssets";
import { DeleteBrandAsset } from "../../../application/use-cases/DeleteBrandAsset";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import type { BrandAsset } from "../../../domain/entities/BrandAsset";
import type { BrandAssetDto } from "@andy-code-cat/contracts";
import type { RequestWithContext } from "../types";

/**
 * Computes a subdomain URL for a published site.
 * Returns null for local/dev setups or when PUBLIC_DOMAIN is not configured.
 * This mirrors the same guard logic used in publishRoutes.ts — never stored, always computed.
 */
function buildSubdomainUrlFromParts(identifier: string): string | null {
    const domain = env.PUBLIC_DOMAIN?.trim();
    if (!domain) return null;
    if (
        domain.includes(":") ||
        domain.includes("/") ||
        /^https?:/i.test(domain) ||
        domain === "localhost" ||
        domain.startsWith("localhost.") ||
        domain.endsWith(".localhost") ||
        domain === "127.0.0.1"
    ) {
        return null;
    }
    return `https://${identifier}.${domain}`;
}

function getRequiredRouteParam(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`Missing route parameter: ${name}`);
    }

    return value;
}

function toBrandAssetDto(asset: BrandAsset): BrandAssetDto {
    const downloadUrl = asset.valueType === "asset_ref"
        ? (asset.scope === "platform"
            ? `/v1/admin/brand-assets/${asset.id}/download`
            : asset.scope === "user"
            ? `/v1/users/me/brand-assets/${asset.id}/download`
            : `/v1/projects/${asset.projectId}/brand-assets/${asset.id}/download`)
        : undefined;
    return {
        id: asset.id,
        scope: asset.scope,
        ownerUserId: asset.ownerUserId,
        projectId: asset.projectId,
        role: asset.role,
        customRoleLabel: asset.customRoleLabel,
        policy: asset.policy,
        valueType: asset.valueType,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
        textValue: asset.textValue,
        description: asset.description,
        isActive: asset.isActive,
        priority: asset.priority,
        downloadUrl,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
    };
}

export function createAdminRoutes(): Router {
    const router = Router();

    // Repositories
    const userRepo = new MongoUserRepository();
    const projectRepo = new MongoProjectRepository();
    const deploymentRepo = new MongoSiteDeploymentRepository();
    const configRepo = new MongoPlatformConfigRepository();
    const sessionRepo = new MongoSessionRepository();
    const llmCatalogRepo = new MongoLlmCatalogRepository();
    const presetRepo = new MongoProjectPresetRepository();
    const promptExecutionLogRepo = new MongoPromptExecutionLogRepository();
    const assetRepo = new MongoProjectAssetRepository();
    const serviceKeyRepo = new MongoServiceApiKeyRepository();
    const brandAssetRepo = new MongoBrandAssetRepository();
    const brandStorage = getFileStorage();
    const brandUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    const setBrandAsset = new SetBrandAsset(brandAssetRepo, assetRepo);
    const listBrandAssets = new ListBrandAssets(brandAssetRepo);
    const deleteBrandAsset = new DeleteBrandAsset(brandAssetRepo, brandStorage);

    // Use-cases
    const listUsers = new ListUsers(userRepo);
    const getUserDetail = new GetUserDetail(userRepo, projectRepo);
    const blockUser = new BlockUser(userRepo, sessionRepo);
    const setUserRole = new SetUserRole(userRepo);
    const adminCreateUser = new AdminCreateUser(userRepo, projectRepo);
    const setUserLimits = new SetUserLimits(userRepo);
    const deleteUser = new DeleteUser(userRepo);
    const updateUserProfile = new UpdateUserProfile(userRepo);
    const adminResetUserPassword = new AdminResetUserPassword(userRepo, sessionRepo);
    const setUserPasswordResetRequired = new SetUserPasswordResetRequired(userRepo);
    const getPlatformStats = new GetPlatformStats(userRepo, deploymentRepo, projectRepo);
    const getPlatformConfig = new GetPlatformConfig(configRepo);
    const setPlatformConfig = new SetPlatformConfig(configRepo);
    const adminTogglePublication = new AdminTogglePublication(deploymentRepo);
    const adminListProjects = new AdminListProjects(projectRepo, userRepo, deploymentRepo);
    const adminDeleteProject = new AdminDeleteProject(projectRepo, deploymentRepo);
    const seedLlmCatalog = new SeedLlmCatalog(
        llmCatalogRepo,
        env.SILICONFLOW_BASE_URL,
        env.LMSTUDIO_BASE_URL,
        env.OPENROUTER_BASE_URL,
        env.hasOpenRouterApiKey,
    );
    const getLlmCatalog = new GetLlmCatalog(
        env.LLM_CATALOG_SOURCE,
        env.SILICONFLOW_BASE_URL,
        env.LMSTUDIO_BASE_URL,
        env.OPENROUTER_BASE_URL,
        llmCatalogRepo,
        env.hasOpenRouterApiKey,
        env.providerApiKeys,
        env.LLM_DEFAULT_PROVIDER,
    );
    const getEffectiveLlmCatalog = new GetEffectiveLlmCatalog(getLlmCatalog);
    const draftProjectTemplate = new DraftProjectTemplate(
        configRepo,
        promptExecutionLogRepo,
        userRepo,
        getLlmCatalog,
    );
    const getAdminAiAnalytics = new GetAdminAiAnalytics(promptExecutionLogRepo, assetRepo);
    const getProjectAiAnalytics = new GetProjectAiAnalytics(promptExecutionLogRepo, assetRepo);

    // All admin routes require auth + superadmin role
    router.use(authMiddleware, requireSuperAdmin);

    // ── Stats ──────────────────────────────────────────────────────────────────
    router.get("/admin/stats", async (_req, res, next) => {
        try {
            const stats = await getPlatformStats.execute();
            res.json(stats);
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin/ai-analytics", async (_req, res, next) => {
        try {
            const analytics = await getAdminAiAnalytics.execute();
            res.json(analytics);
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin/projects/:projectId/ai-analytics", async (req, res, next) => {
        try {
            const projectId = getRequiredRouteParam(req.params.projectId, "projectId");
            const project = await projectRepo.findById(projectId);
            if (!project) {
                res.status(404).json({ error: "Project not found" });
                return;
            }
            const analytics = await getProjectAiAnalytics.execute(projectId, project.ownerUserId);
            res.json({
                projectId,
                projectName: project.name,
                ownerUserId: project.ownerUserId,
                ...analytics,
            });
        } catch (err) {
            next(err);
        }
    });

    // ── Platform config ────────────────────────────────────────────────────────
    router.get("/admin/config", async (_req, res, next) => {
        try {
            const config = await getPlatformConfig.execute();
            res.json(config);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/config", async (req: RequestWithContext, res, next) => {
        try {
            const updated = await setPlatformConfig.execute(req.auth!.userId, req.body);
            res.json(updated);
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin/llm-registry", async (_req, res, next) => {
        try {
            const result = await getEffectiveLlmCatalog.execute();
            res.json({
                ...result,
                byokEnabled: true,
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin/llm-registry/seed", async (req, res, next) => {
        try {
            adminSeedLlmRegistrySchema.parse(req.body ?? {});
            const seedResult = await seedLlmCatalog.execute();
            const result = await getEffectiveLlmCatalog.execute();
            res.json({ ok: true, ...seedResult, ...result, byokEnabled: true });
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin/preset-registry", async (_req, res, next) => {
        try {
            const presets = await presetRepo.listAll();
            res.json({
                source: presets.length > 0 ? "mongo" : "static",
                presets: presets.length > 0 ? presets : PRESET_CATALOG,
            });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin/preset-registry/seed", async (req, res, next) => {
        try {
            adminSeedPresetRegistrySchema.parse(req.body ?? {});
            const result = await presetRepo.seedDefaults(PRESET_CATALOG);
            const presets = await presetRepo.listAll();
            res.json({ ok: true, ...result, presets });
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin/preset-registry/:presetId", async (req, res, next) => {
        try {
            const presetId = getRequiredRouteParam(req.params.presetId, "presetId");
            const body = adminProjectPresetPatchSchema.parse(req.body ?? {});
            const preset = await presetRepo.upsert({ id: presetId, ...body });
            res.json(preset);
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin/preset-registry/:presetId", async (req, res, next) => {
        try {
            const presetId = getRequiredRouteParam(req.params.presetId, "presetId");
            const deleted = await presetRepo.delete(presetId);
            const presets = await presetRepo.listAll();
            res.json({ ok: deleted, presets });
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin/preset-registry/draft", async (req: RequestWithContext, res, next) => {
        try {
            const body = adminDraftProjectTemplateSchema.parse(req.body ?? {});
            const result = await draftProjectTemplate.execute({
                userId: req.auth!.userId,
                instructions: body.instructions,
                category: body.category,
                labelHint: body.labelHint,
                existingDraft: body.existingDraft,
            });
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.put("/admin/llm-registry/providers/:provider/models/:modelId", async (req, res, next) => {
        try {
            const provider = getRequiredRouteParam(req.params.provider, "provider");
            const modelId = getRequiredRouteParam(req.params.modelId, "modelId");
            const body = adminLlmModelPatchSchema.parse(req.body ?? {});
            const updated = await llmCatalogRepo.upsertModel({
                provider,
                modelId,
                baseUrl: body.baseUrl,
                apiType: body.apiType,
                authType: body.authType,
                isActive: body.providerActive,
                patch: {
                    id: modelId,
                    provider,
                    displayName: body.displayName,
                    description: body.description,
                    role: body.role,
                    capabilities: body.capabilities,
                    isDefault: body.isDefault,
                    isFallback: body.isFallback,
                    isActive: body.isActive,
                    promptTemplate: body.promptTemplate,
                    focusPromptTemplate: body.focusPromptTemplate,
                    priceInputUsdPerM: body.priceInputUsdPerM,
                    priceOutputUsdPerM: body.priceOutputUsdPerM,
                },
            });
            res.json(updated);
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin/llm-registry/providers/:provider/models/:modelId", async (req, res, next) => {
        try {
            const provider = getRequiredRouteParam(req.params.provider, "provider");
            const modelId = getRequiredRouteParam(req.params.modelId, "modelId");
            const updated = await llmCatalogRepo.deleteModel(provider, modelId);
            res.json(updated);
        } catch (err) {
            next(err);
        }
    });

    // ── User management ────────────────────────────────────────────────────────
    router.get("/admin/users", async (req, res, next) => {
        try {
            const result = await listUsers.execute(req.query);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin/users", async (req, res, next) => {
        try {
            const created = await adminCreateUser.execute(req.body);
            res.status(201).json(created);
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin/users/:userId", async (req, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const detail = await getUserDetail.execute(userId);
            res.json(detail);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/block", async (req: RequestWithContext, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await blockUser.execute(userId, req.auth!.userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/roles", async (req: RequestWithContext, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await setUserRole.execute(userId, req.auth!.userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/limits", async (req, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await setUserLimits.execute(userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/profile", async (req, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await updateUserProfile.execute(userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/password-reset", async (req, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await adminResetUserPassword.execute(userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/password-reset-required", async (req, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await setUserPasswordResetRequired.execute(userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin/users/:userId", async (req: RequestWithContext, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await deleteUser.execute(userId, req.auth!.userId);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    // ── Deployment/publication control ──────────────────────────────────────────
    router.get("/admin/deployments", async (req, res, next) => {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
            const result = await deploymentRepo.listAllPaginated(page, limit);
            res.json({
                deployments: result.deployments.map(d => ({
                    id: d.id,
                    publishId: d.publishId,
                    customSlug: d.customSlug ?? null,
                    projectId: d.projectId,
                    userId: d.userId,
                    status: d.status,
                    url: d.url,
                    isAdminBlocked: d.isAdminBlocked ?? false,
                    adminBlockedAt: d.adminBlockedAt?.toISOString() ?? null,
                    createdAt: d.createdAt.toISOString(),
                    updatedAt: d.updatedAt.toISOString(),
                })),
                total: result.total,
                page,
                limit,
            });
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/deployments/:publishId/block", async (req: RequestWithContext, res, next) => {
        try {
            const publishId = getRequiredRouteParam(req.params.publishId, "publishId");
            const result = await adminTogglePublication.execute(
                publishId,
                req.auth!.userId,
                req.body,
            );
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    // ── Project management ────────────────────────────────────────────────────
    router.get("/admin/projects", async (req, res, next) => {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
            const result = await adminListProjects.execute({
                page,
                limit,
                search: req.query.search as string | undefined,
                ownerId: req.query.ownerId as string | undefined,
                presetId: req.query.presetId as string | undefined,
            });

            // Augment each project with a computed subdomainUrl for its active deployment.
            // The stored deployment.url is always a relative path (/p/publishId); subdomainUrl
            // is the correct public URL in domain-mode deployments (never stored, always derived).
            const projects = result.projects.map(p => {
                if (!p.activeDeployment) return p;
                const identifier = p.activeDeployment.customSlug ?? p.activeDeployment.publishId;
                return {
                    ...p,
                    activeDeployment: {
                        ...p.activeDeployment,
                        subdomainUrl: buildSubdomainUrlFromParts(identifier),
                    },
                };
            });

            res.json({ ...result, projects });
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin/projects/:projectId", async (req: RequestWithContext, res, next) => {
        try {
            const projectId = getRequiredRouteParam(req.params.projectId, "projectId");
            const result = await adminDeleteProject.execute(projectId, req.auth!.userId);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    // ── Service API keys ───────────────────────────────────────────────────────

    /** GET /admin/service-keys/env-status — which image/llm keys are present in env */
    router.get("/admin/service-keys/env-status", (_req, res) => {
        res.json({
            pexels: env.hasPexelsApiKey,
            pixabay: env.hasPixabayApiKey,
            unsplash: env.hasUnsplashApiKey,
            siliconflow: env.hasSiliconFlowApiKey,
            openrouter: env.hasOpenRouterApiKey,
        });
    });

    /** GET /admin/service-keys — list all platform-scoped keys (no plaintext) */
    router.get("/admin/service-keys", async (_req, res, next) => {
        try {
            const keys = await serviceKeyRepo.findAllPlatform();
            const crypto = new CryptoService(env.JWT_ACCESS_SECRET, env.MONGODB_DB_NAME);
            const dtos = await Promise.all(
                keys.map(async (k) => {
                    const plain = await serviceKeyRepo.resolvePlaintext(k);
                    return {
                        id: k.id,
                        service: k.service,
                        label: k.label,
                        category: k.category,
                        ownerType: k.ownerType,
                        enabled: k.enabled,
                        supportsVideo: k.supportsVideo,
                        isDefault: k.isDefault,
                        maskedKey: CryptoService.maskKey(plain),
                        createdAt: k.createdAt.toISOString(),
                        updatedAt: k.updatedAt.toISOString(),
                    };
                }),
            );
            res.json({ keys: dtos });
        } catch (err) {
            next(err);
        }
    });

    /** POST /admin/service-keys — create a new service key */
    router.post("/admin/service-keys", async (req: RequestWithContext, res, next) => {
        try {
            const { service, label, category, plaintextKey, enabled, supportsVideo, isDefault } = req.body as {
                service: string;
                label: string;
                category: string;
                plaintextKey: string;
                enabled?: boolean;
                supportsVideo?: boolean;
                isDefault?: boolean;
            };
            if (!service || !label || !category || !plaintextKey) {
                res.status(400).json({ error: "service, label, category and plaintextKey are required" });
                return;
            }
            const key = await serviceKeyRepo.create({
                service,
                label,
                category: category as "image" | "video" | "llm" | "other",
                ownerType: "platform",
                plaintextKey,
                enabled: enabled ?? true,
                supportsVideo: supportsVideo ?? false,
                isDefault: isDefault ?? false,
                createdByUserId: req.auth!.userId,
            });
            const plain = await serviceKeyRepo.resolvePlaintext(key);
            res.status(201).json({
                id: key.id,
                service: key.service,
                label: key.label,
                category: key.category,
                ownerType: key.ownerType,
                enabled: key.enabled,
                supportsVideo: key.supportsVideo,
                isDefault: key.isDefault,
                maskedKey: CryptoService.maskKey(plain),
                createdAt: key.createdAt.toISOString(),
                updatedAt: key.updatedAt.toISOString(),
            });
        } catch (err) {
            next(err);
        }
    });

    /** POST /admin/service-keys/seed-from-env — bootstrap DB keys from env vars (idempotent: skips services already in DB) */
    router.post("/admin/service-keys/seed-from-env", async (req: RequestWithContext, res, next) => {
        try {
            const ENV_CANDIDATES: Array<{
                service: string;
                label: string;
                category: "image" | "video" | "llm" | "other";
                supportsVideo: boolean;
                key: string | undefined;
            }> = [
                    { service: "pexels", label: "Pexels (env)", category: "image", supportsVideo: true, key: env.PEXELS_API_KEY },
                    { service: "pixabay", label: "Pixabay (env)", category: "image", supportsVideo: true, key: env.PIXABAY_API_KEY },
                    { service: "unsplash", label: "Unsplash (env)", category: "image", supportsVideo: false, key: env.UNSPLASH_ACCESS_KEY },
                ];
            const existing = await serviceKeyRepo.findAllPlatform();
            const existingServices = new Set(existing.map((k) => k.service));
            const seeded: string[] = [];
            const skipped: string[] = [];
            for (const candidate of ENV_CANDIDATES) {
                if (!candidate.key) { skipped.push(`${candidate.service} (no env key)`); continue; }
                if (existingServices.has(candidate.service)) { skipped.push(`${candidate.service} (already in DB)`); continue; }
                await serviceKeyRepo.create({
                    service: candidate.service,
                    label: candidate.label,
                    category: candidate.category,
                    ownerType: "platform",
                    plaintextKey: candidate.key,
                    enabled: true,
                    supportsVideo: candidate.supportsVideo,
                    isDefault: true,
                    createdByUserId: req.auth!.userId,
                });
                seeded.push(candidate.service);
            }
            res.json({ ok: true, seeded, skipped });
        } catch (err) {
            next(err);
        }
    });

    /** POST /admin/service-keys/seed-from-env — bootstrap DB keys from env vars (idempotent: skips services already in DB) */
    router.post("/admin/service-keys/seed-from-env", async (req: RequestWithContext, res, next) => {
        try {
            const ENV_CANDIDATES: Array<{
                service: string;
                label: string;
                category: "image" | "video" | "llm" | "other";
                supportsVideo: boolean;
                key: string | undefined;
            }> = [
                    { service: "pexels", label: "Pexels (env)", category: "image", supportsVideo: true, key: env.PEXELS_API_KEY },
                    { service: "pixabay", label: "Pixabay (env)", category: "image", supportsVideo: true, key: env.PIXABAY_API_KEY },
                    { service: "unsplash", label: "Unsplash (env)", category: "image", supportsVideo: false, key: env.UNSPLASH_ACCESS_KEY },
                ];
            const existing = await serviceKeyRepo.findAllPlatform();
            const existingServices = new Set(existing.map((k) => k.service));
            const seeded: string[] = [];
            const skipped: string[] = [];
            for (const candidate of ENV_CANDIDATES) {
                if (!candidate.key) { skipped.push(`${candidate.service} (no env key)`); continue; }
                if (existingServices.has(candidate.service)) { skipped.push(`${candidate.service} (already in DB)`); continue; }
                await serviceKeyRepo.create({
                    service: candidate.service,
                    label: candidate.label,
                    category: candidate.category,
                    ownerType: "platform",
                    plaintextKey: candidate.key,
                    enabled: true,
                    supportsVideo: candidate.supportsVideo,
                    isDefault: true,
                    createdByUserId: req.auth!.userId,
                });
                seeded.push(candidate.service);
            }
            res.json({ ok: true, seeded, skipped });
        } catch (err) {
            next(err);
        }
    });

    /** PATCH /admin/service-keys/:id — update label, enabled, supportsVideo, isDefault, or re-key */
    router.patch("/admin/service-keys/:id", async (req: RequestWithContext, res, next) => {
        try {
            const id = getRequiredRouteParam(req.params.id, "id");
            const { label, enabled, supportsVideo, isDefault, plaintextKey } = req.body as {
                label?: string;
                enabled?: boolean;
                supportsVideo?: boolean;
                isDefault?: boolean;
                plaintextKey?: string;
            };
            const key = await serviceKeyRepo.update(id, { label, enabled, supportsVideo, isDefault, plaintextKey });
            const plain = await serviceKeyRepo.resolvePlaintext(key);
            res.json({
                id: key.id,
                service: key.service,
                label: key.label,
                category: key.category,
                ownerType: key.ownerType,
                enabled: key.enabled,
                supportsVideo: key.supportsVideo,
                isDefault: key.isDefault,
                maskedKey: CryptoService.maskKey(plain),
                createdAt: key.createdAt.toISOString(),
                updatedAt: key.updatedAt.toISOString(),
            });
        } catch (err) {
            next(err);
        }
    });

    /** DELETE /admin/service-keys/:id */
    router.delete("/admin/service-keys/:id", async (req, res, next) => {
        try {
            const id = getRequiredRouteParam(req.params.id, "id");
            await serviceKeyRepo.delete(id);
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    });

    // ── Platform Brand Assets ───────────────────────────────────────────────────

    /** GET /admin/brand-assets */
    router.get("/admin/brand-assets", async (_req, res, next) => {
        try {
            const assets = await listBrandAssets.execute({ scope: "platform" });
            res.json({ assets: assets.map(toBrandAssetDto) });
        } catch (err) {
            next(err);
        }
    });

    /** POST /admin/brand-assets — text / color / url value */
    router.post("/admin/brand-assets", async (req: RequestWithContext, res, next) => {
        try {
            const body = createBrandAssetTextSchema.parse(req.body);
            const asset = await setBrandAsset.createText({ scope: "platform", ...body });
            res.status(201).json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** POST /admin/brand-assets/upload — multipart file */
    router.post("/admin/brand-assets/upload", brandUpload.single("file"), async (req: RequestWithContext, res, next) => {
        try {
            if (!req.file) {
                res.status(400).json({ error: "No file uploaded" });
                return;
            }
            const role = createBrandAssetTextSchema.shape.role.parse(req.body["role"]);
            const policy = createBrandAssetTextSchema.shape.policy.parse(req.body["policy"] ?? "prefer");
            const safeExt = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
            const safeName = path.basename(req.file.originalname, path.extname(req.file.originalname))
                .toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60);
            const storedFilename = `${randomUUID()}-${safeName}${safeExt}`;
            await brandStorage.saveUpload("platform", "brand", storedFilename, req.file.buffer, req.file.mimetype);
            const asset = await setBrandAsset.createFile({
                scope: "platform",
                role,
                policy,
                customRoleLabel: typeof req.body["customRoleLabel"] === "string" ? req.body["customRoleLabel"] : undefined,
                description: typeof req.body["description"] === "string" ? req.body["description"] : undefined,
                isActive: req.body["isActive"] !== "false",
                priority: req.body["priority"] ? Number(req.body["priority"]) : 0,
                storedFilename,
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                fileSize: req.file.size,
            });
            res.status(201).json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** POST /admin/brand-assets/promote — promote any project asset to platform brand */
    router.post("/admin/brand-assets/promote", async (req: RequestWithContext, res, next) => {
        try {
            const body = promoteBrandAssetSchema.parse(req.body);
            const source = await assetRepo.findByIdPublic(body.sourceAssetId);
            if (!source) {
                res.status(404).json({ error: "Source asset not found" });
                return;
            }
            if (!source.storedFilename) {
                res.status(422).json({ error: "Source asset has no stored file" });
                return;
            }
            const asset = await brandAssetRepo.create({
                scope: "platform",
                role: body.role,
                customRoleLabel: body.customRoleLabel,
                policy: body.policy,
                valueType: "asset_ref",
                storedFilename: source.storedFilename,
                originalName: source.originalName,
                mimeType: source.mimeType,
                fileSize: source.fileSize,
                promotedFromAssetId: source.id,
                description: body.description,
                isActive: body.isActive,
                priority: body.priority,
            });
            res.status(201).json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** PATCH /admin/brand-assets/:id */
    router.patch("/admin/brand-assets/:id", async (req: RequestWithContext, res, next) => {
        try {
            const id = getRequiredRouteParam(req.params.id, "id");
            const patch = updateBrandAssetSchema.parse(req.body);
            const asset = await brandAssetRepo.update(id, patch);
            res.json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** DELETE /admin/brand-assets/:id */
    router.delete("/admin/brand-assets/:id", async (req: RequestWithContext, res, next) => {
        try {
            const id = getRequiredRouteParam(req.params.id, "id");
            const deleted = await deleteBrandAsset.execute(id, { scopeFolder: "brand" });
            res.json({ ok: deleted });
        } catch (err) {
            next(err);
        }
    });

    /** GET /admin/brand-assets/:id/download */
    router.get("/admin/brand-assets/:id/download", async (req: RequestWithContext, res, next) => {
        try {
            const id = getRequiredRouteParam(req.params.id, "id");
            const asset = await brandAssetRepo.findById(id);
            if (!asset || asset.scope !== "platform" || asset.valueType !== "asset_ref" || !asset.storedFilename) {
                res.status(404).json({ error: "Asset not found or not downloadable" });
                return;
            }
            const filePath = brandStorage.uploadFilePath("platform", "brand", asset.storedFilename);
            const exists = await brandStorage.fileExists(filePath);
            if (!exists) {
                res.status(410).json({ error: "File no longer available" });
                return;
            }
            const actualSize = await brandStorage.fileSize(filePath).catch(() => asset.fileSize ?? 0);
            res.setHeader("Content-Type", asset.mimeType ?? "application/octet-stream");
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(asset.originalName ?? asset.storedFilename)}"`);
            if (actualSize > 0) res.setHeader("Content-Length", actualSize);
            const stream = await brandStorage.createReadStream(filePath);
            stream.pipe(res);
        } catch (err) {
            next(err);
        }
    });

    return router;
}
