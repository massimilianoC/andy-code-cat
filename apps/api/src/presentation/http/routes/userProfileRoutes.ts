import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { MongoUserStyleProfileRepository } from "../../../infra/repositories/MongoUserStyleProfileRepository";
import { MongoProjectAssetRepository } from "../../../infra/repositories/MongoProjectAssetRepository";
import { GetUserStyleProfile } from "../../../application/use-cases/GetUserStyleProfile";
import { UpdateUserStyleProfile } from "../../../application/use-cases/UpdateUserStyleProfile";
import { ListUserMediaLibrary } from "../../../application/use-cases/ListUserMediaLibrary";
import { STYLE_TAG_CATALOG } from "../../../domain/entities/StyleTag";
import type { RequestWithContext } from "../types";
import type { ProjectAssetDto } from "@andy-code-cat/contracts";

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

export function createUserProfileRoutes(): Router {
    const router = Router();
    const profileRepo = new MongoUserStyleProfileRepository();
    const assetRepo = new MongoProjectAssetRepository();
    const getProfile = new GetUserStyleProfile(profileRepo);
    const updateProfile = new UpdateUserStyleProfile(profileRepo);
    const listUserLibrary = new ListUserMediaLibrary(assetRepo);

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

    return router;
}
