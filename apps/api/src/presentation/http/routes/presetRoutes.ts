import { Router } from "express";
import { PRESET_CATALOG } from "../../../domain/entities/ProjectPreset";

/**
 * Public endpoint — no auth required.
 * GET /v1/presets → { presets: ProjectPreset[] }
 */
export function createPresetRoutes(): Router {
    const router = Router();

    router.get("/presets", (_req, res) => {
        res.json({ presets: PRESET_CATALOG });
    });

    return router;
}
