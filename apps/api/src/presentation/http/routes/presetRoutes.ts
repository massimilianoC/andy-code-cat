import { Router } from "express";
import { PRESET_CATALOG } from "../../../domain/entities/ProjectPreset";
import { MongoProjectPresetRepository } from "../../../infra/repositories/MongoProjectPresetRepository";

/**
 * Public endpoint — no auth required.
 * GET /v1/presets → { presets: ProjectPreset[] }
 */
export function createPresetRoutes(): Router {
    const router = Router();
    const presetRepository = new MongoProjectPresetRepository();

    router.get("/presets", async (_req, res, next) => {
        try {
            const presets = await presetRepository.listActive().catch(() => []);
            res.json({ presets: presets.length > 0 ? presets : PRESET_CATALOG });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
