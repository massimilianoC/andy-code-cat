import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { MongoUserStyleProfileRepository } from "../../../infra/repositories/MongoUserStyleProfileRepository";
import { GetUserStyleProfile } from "../../../application/use-cases/GetUserStyleProfile";
import { UpdateUserStyleProfile } from "../../../application/use-cases/UpdateUserStyleProfile";
import { STYLE_TAG_CATALOG } from "../../../domain/entities/StyleTag";
import type { RequestWithContext } from "../types";

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
    const getProfile = new GetUserStyleProfile(profileRepo);
    const updateProfile = new UpdateUserStyleProfile(profileRepo);

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

    return router;
}
