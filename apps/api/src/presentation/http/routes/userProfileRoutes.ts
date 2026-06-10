import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { authMiddleware } from "../middlewares/authMiddleware";
import { MongoUserStyleProfileRepository } from "../../../infra/repositories/MongoUserStyleProfileRepository";
import { MongoUserPreferencesRepository } from "../../../infra/repositories/MongoUserPreferencesRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { MongoBrandAssetRepository } from "../../../infra/repositories/MongoBrandAssetRepository";
import { GetUserStyleProfile } from "../../../application/use-cases/GetUserStyleProfile";
import { UpdateUserStyleProfile } from "../../../application/use-cases/UpdateUserStyleProfile";
import { GetUserPreferences } from "../../../application/use-cases/GetUserPreferences";
import { UpdateUserPreferences } from "../../../application/use-cases/UpdateUserPreferences";
import { ListUserMediaLibrary } from "../../../application/use-cases/ListUserMediaLibrary";
import { SetBrandAsset } from "../../../application/use-cases/SetBrandAsset";
import { ListBrandAssets } from "../../../application/use-cases/ListBrandAssets";
import { DeleteBrandAsset } from "../../../application/use-cases/DeleteBrandAsset";
import { getFileStorage } from "../../../infra/storage/StorageFactory";
import { STYLE_TAG_CATALOG } from "../../../domain/entities/StyleTag";
import { createBrandAssetTextSchema, promoteBrandAssetSchema, updateBrandAssetSchema } from "@andy-code-cat/contracts";
import type { BrandAsset } from "../../../domain/entities/BrandAsset";
import type { RequestWithContext } from "../types";
import type { BrandAssetDto, ProjectAssetDto, UserPreferencesDto } from "@andy-code-cat/contracts";

function mapToDto(profile: import("../../../domain/entities/UserStyleProfile").UserStyleProfile) {
    return {
        id: profile.id,
        userId: profile.userId,
        onboardingCompleted: profile.onboardingCompleted,
        onboardingStep: profile.onboardingStep,
        identityTags: profile.identityTags,
        sectorTags: profile.sectorTags,
        audienceTags: profile.audienceTags,
        visualTags: profile.visualTags,
        paletteTags: profile.paletteTags,
        typographyTags: profile.typographyTags,
        layoutTags: profile.layoutTags,
        toneTags: profile.toneTags,
        referenceTags: profile.referenceTags,
        featureTags: profile.featureTags,
        brandBio: profile.brandBio,
        preferredColorText: profile.preferredColorText,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
    };
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
        id: asset.id, scope: asset.scope, ownerUserId: asset.ownerUserId, projectId: asset.projectId,
        role: asset.role, customRoleLabel: asset.customRoleLabel, policy: asset.policy,
        valueType: asset.valueType, originalName: asset.originalName, mimeType: asset.mimeType,
        fileSize: asset.fileSize, textValue: asset.textValue, description: asset.description,
        isActive: asset.isActive, priority: asset.priority, downloadUrl,
        createdAt: asset.createdAt.toISOString(), updatedAt: asset.updatedAt.toISOString(),
    };
}

export function createUserProfileRoutes(): Router {
    const router = Router();
    const profileRepo = new MongoUserStyleProfileRepository();
    const preferencesRepo = new MongoUserPreferencesRepository();
    const assetRepo = new MongoProjectAssetRepository();
    const brandAssetRepo = new MongoBrandAssetRepository();
    const brandStorage = getFileStorage();
    const brandUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    const getProfile = new GetUserStyleProfile(profileRepo);
    const updateProfile = new UpdateUserStyleProfile(profileRepo);
    const getPreferences = new GetUserPreferences(preferencesRepo);
    const updatePreferences = new UpdateUserPreferences(preferencesRepo);
    const listUserLibrary = new ListUserMediaLibrary(assetRepo);
    const setBrandAsset = new SetBrandAsset(brandAssetRepo, assetRepo);
    const listBrandAssets = new ListBrandAssets(brandAssetRepo);
    const deleteBrandAsset = new DeleteBrandAsset(brandAssetRepo, brandStorage);

    // Public — style tag catalog (no auth needed)
    // Returns { catalog: { "TC-IDENTITY": [...], "TC-SECTOR": [...], ... } }
    router.get("/style-tags", (_req, res) => {
        const catalog: Record<string, typeof STYLE_TAG_CATALOG> = {};
        for (const tag of STYLE_TAG_CATALOG) {
            const key = `TC-${tag.category.toUpperCase()}`;
            if (!catalog[key]) catalog[key] = [];
            catalog[key].push(tag);
        }
        res.json({ catalog });
    });

    // Protected — user profile
    router.use(authMiddleware);

    router.get("/users/me/profile", async (req: RequestWithContext, res, next) => {
        try {
            const profile = await getProfile.execute(req.auth!.userId);
            res.json({ profile: mapToDto(profile) });
        } catch (err) {
            next(err);
        }
    });

    router.put("/users/me/profile", async (req: RequestWithContext, res, next) => {
        try {
            const profile = await updateProfile.execute(req.auth!.userId, req.body);
            res.json({ profile: mapToDto(profile) });
        } catch (err) {
            next(err);
        }
    });

    // ── User Preferences ────────────────────────────────────────────────────────

    router.get("/users/me/preferences", async (req: RequestWithContext, res, next) => {
        try {
            const prefs = await getPreferences.execute(req.auth!.userId);
            const dto: UserPreferencesDto = {
                id: prefs.id,
                userId: prefs.userId,
                preferredLanguage: prefs.preferredLanguage,
                preferredModel: prefs.preferredModel,
                preferredProvider: prefs.preferredProvider,
                createdAt: prefs.createdAt.toISOString(),
                updatedAt: prefs.updatedAt.toISOString(),
            };
            res.json({ preferences: dto });
        } catch (err) {
            next(err);
        }
    });

    router.put("/users/me/preferences", async (req: RequestWithContext, res, next) => {
        try {
            const prefs = await updatePreferences.execute(req.auth!.userId, req.body);
            const dto: UserPreferencesDto = {
                id: prefs.id,
                userId: prefs.userId,
                preferredLanguage: prefs.preferredLanguage,
                preferredModel: prefs.preferredModel,
                preferredProvider: prefs.preferredProvider,
                createdAt: prefs.createdAt.toISOString(),
                updatedAt: prefs.updatedAt.toISOString(),
            };
            res.json({ preferences: dto });
        } catch (err) {
            next(err);
        }
    });

    // User media library — all assets owned by the user across all projects
    router.get("/users/me/media-library", async (req: RequestWithContext, res, next) => {
        try {
            const assets = await listUserLibrary.execute(req.auth!.userId);
            const dtos: ProjectAssetDto[] = assets.map((asset) => ({
                id: asset.id,
                projectId: asset.projectId,
                originalName: asset.originalName,
                mimeType: asset.mimeType,
                fileSize: asset.fileSize,
                source: asset.source as ProjectAssetDto["source"],
                scope: (asset.scope as ProjectAssetDto["scope"]) ?? "project",
                label: asset.label,
                useInProject: asset.useInProject,
                styleRole: asset.styleRole as ProjectAssetDto["styleRole"],
                descriptionText: asset.descriptionText,
                externalUrl: asset.externalUrl,
                generationStatus: asset.generationStatus,
                generationPrompt: asset.generationPrompt,
                generationMetadata: asset.generationMetadata ? {
                    ...asset.generationMetadata,
                    requestedAt: asset.generationMetadata.requestedAt.toISOString(),
                    completedAt: asset.generationMetadata.completedAt?.toISOString(),
                } : undefined,
                semanticMetadata: asset.semanticMetadata ? {
                    ...asset.semanticMetadata,
                    mediaKind: asset.semanticMetadata.mediaKind as NonNullable<ProjectAssetDto["semanticMetadata"]>["mediaKind"],
                    classifiedAt: asset.semanticMetadata.classifiedAt.toISOString(),
                } : undefined,
                createdAt: asset.createdAt.toISOString(),
            }));
            res.json({ assets: dtos });
        } catch (err) {
            next(err);
        }
    });

    // ── User Brand Assets ───────────────────────────────────────────────────────

    /** GET /users/me/brand-assets */
    router.get("/users/me/brand-assets", async (req: RequestWithContext, res, next) => {
        try {
            const assets = await listBrandAssets.execute({ scope: "user", userId: req.auth!.userId });
            res.json({ assets: assets.map(toBrandAssetDto) });
        } catch (err) {
            next(err);
        }
    });

    /** POST /users/me/brand-assets — text / color / url value */
    router.post("/users/me/brand-assets", async (req: RequestWithContext, res, next) => {
        try {
            const body = createBrandAssetTextSchema.parse(req.body);
            const asset = await setBrandAsset.createText({ scope: "user", ownerUserId: req.auth!.userId, ...body });
            res.status(201).json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** POST /users/me/brand-assets/upload — multipart file */
    router.post("/users/me/brand-assets/upload", brandUpload.single("file"), async (req: RequestWithContext, res, next) => {
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
            await brandStorage.saveUpload(req.auth!.userId, "brand", storedFilename, req.file.buffer, req.file.mimetype);
            const asset = await setBrandAsset.createFile({
                scope: "user",
                ownerUserId: req.auth!.userId,
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

    /** POST /users/me/brand-assets/promote — promote own project asset to user brand */
    router.post("/users/me/brand-assets/promote", async (req: RequestWithContext, res, next) => {
        try {
            const body = promoteBrandAssetSchema.parse(req.body);
            const sourceProjectId = typeof req.body["sourceProjectId"] === "string" ? req.body["sourceProjectId"] : undefined;
            if (!sourceProjectId) {
                res.status(400).json({ error: "sourceProjectId is required" });
                return;
            }
            const asset = await setBrandAsset.promote({
                scope: "user",
                ownerUserId: req.auth!.userId,
                role: body.role,
                customRoleLabel: body.customRoleLabel,
                policy: body.policy,
                description: body.description,
                isActive: body.isActive,
                priority: body.priority,
                sourceAssetId: body.sourceAssetId,
                sourceProjectId,
                sourceUserId: req.auth!.userId,
            });
            res.status(201).json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** PATCH /users/me/brand-assets/:id */
    router.patch("/users/me/brand-assets/:id", async (req: RequestWithContext, res, next) => {
        try {
            const id = req.params.id;
            if (!id) { res.status(400).json({ error: "Missing id" }); return; }
            const existing = await brandAssetRepo.findById(id);
            if (!existing || existing.scope !== "user" || existing.ownerUserId !== req.auth!.userId) {
                res.status(404).json({ error: "Brand asset not found" });
                return;
            }
            const patch = updateBrandAssetSchema.parse(req.body);
            const asset = await brandAssetRepo.update(id, patch);
            res.json({ asset: toBrandAssetDto(asset) });
        } catch (err) {
            next(err);
        }
    });

    /** DELETE /users/me/brand-assets/:id */
    router.delete("/users/me/brand-assets/:id", async (req: RequestWithContext, res, next) => {
        try {
            const id = req.params.id;
            if (!id) { res.status(400).json({ error: "Missing id" }); return; }
            const existing = await brandAssetRepo.findById(id);
            if (!existing || existing.scope !== "user" || existing.ownerUserId !== req.auth!.userId) {
                res.status(404).json({ error: "Brand asset not found" });
                return;
            }
            const deleted = await deleteBrandAsset.execute(id, { scopeFolder: "brand" });
            res.json({ ok: deleted });
        } catch (err) {
            next(err);
        }
    });

    /** GET /users/me/brand-assets/:id/download */
    router.get("/users/me/brand-assets/:id/download", async (req: RequestWithContext, res, next) => {
        try {
            const id = req.params.id;
            if (!id) { res.status(400).json({ error: "Missing id" }); return; }
            const asset = await brandAssetRepo.findById(id);
            if (!asset || asset.scope !== "user" || asset.ownerUserId !== req.auth!.userId
                || asset.valueType !== "asset_ref" || !asset.storedFilename) {
                res.status(404).json({ error: "Asset not found or not downloadable" });
                return;
            }
            const filePath = brandStorage.uploadFilePath(req.auth!.userId, "brand", asset.storedFilename);
            const exists = await brandStorage.fileExists(filePath);
            if (!exists) { res.status(410).json({ error: "File no longer available" }); return; }
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
