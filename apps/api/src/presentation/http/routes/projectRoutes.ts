import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoProjectMoodboardRepository } from "../../../infra/repositories/MongoProjectMoodboardRepository";
import { MongoLlmPromptConfigRepository } from "../../../infra/repositories/MongoLlmPromptConfigRepository";
import { MongoSessionRepository } from "../../../infra/repositories/MongoSessionRepository";
import { MongoProjectPresetRepository } from "../../../infra/repositories/MongoProjectPresetRepository";
import { DeleteProject } from "../../../application/use-cases/DeleteProject";
import { DuplicateProject } from "../../../application/use-cases/DuplicateProject";
import { GetProjectMoodboard } from "../../../application/use-cases/GetProjectMoodboard";
import { UpdateProjectMoodboard } from "../../../application/use-cases/UpdateProjectMoodboard";
import { hashPassword } from "../../../infra/security/password";
import { signRefreshToken, verifyRefreshToken } from "../../../infra/security/jwt";
import { PRESET_MAP } from "../../../domain/entities/ProjectPreset";
import type { RequestWithContext } from "../types";

const createProjectSchema = z.object({
    name: z.string().trim().min(3).max(80),
    presetId: z.string().optional(),
});

function mapMoodboardToDto(m: import("../../../domain/entities/ProjectMoodboard").ProjectMoodboard) {
    return {
        id: m.id,
        projectId: m.projectId,
        userId: m.userId,
        inheritFromUser: m.inheritFromUser,
        visualTags: m.visualTags ?? [],
        paletteTags: m.paletteTags ?? [],
        typographyTags: m.typographyTags ?? [],
        layoutTags: m.layoutTags ?? [],
        toneTags: m.toneTags ?? [],
        audienceTags: m.audienceTags ?? [],
        featureTags: m.featureTags ?? [],
        sectorTags: m.sectorTags ?? [],
        referenceTags: m.referenceTags ?? [],
        eraTags: m.eraTags ?? [],
        projectBrief: m.projectBrief,
        targetBusiness: m.targetBusiness,
        styleNotes: m.styleNotes,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
    };
}

export function createProjectRoutes(): Router {
    const router = Router();
    const projectRepository = new MongoProjectRepository();
    const sessionRepository = new MongoSessionRepository();
    const moodboardRepository = new MongoProjectMoodboardRepository();
    const promptConfigRepository = new MongoLlmPromptConfigRepository();
    const presetRepository = new MongoProjectPresetRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const deleteProject = new DeleteProject(projectRepository, moodboardRepository);
    const duplicateProject = new DuplicateProject(projectRepository, promptConfigRepository);
    const getProjectMoodboard = new GetProjectMoodboard(moodboardRepository, projectRepository);
    const updateProjectMoodboard = new UpdateProjectMoodboard(moodboardRepository, projectRepository);

    router.use(authMiddleware);

    router.get("/projects", async (req: RequestWithContext, res, next) => {
        try {
            const projects = await projectRepository.listForUser(req.auth!.userId);
            res.json({ projects });
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects", async (req: RequestWithContext, res, next) => {
        try {
            const { name, presetId } = createProjectSchema.parse(req.body);

            const preset = presetId
                ? (await presetRepository.findById(presetId).catch(() => null)) ?? PRESET_MAP.get(presetId) ?? null
                : null;

            if (presetId !== undefined && !preset) {
                res.status(400).json({ error: `Unknown preset: ${presetId}` });
                return;
            }

            const project = await projectRepository.create(req.auth!.userId, name, presetId);

            // Seed moodboard from preset defaults when presetId is provided
            if (preset) {
                const tags = preset.defaultTags;
                const brief = preset.briefTemplate.replace(/\{\{projectName\}\}/g, name);
                await moodboardRepository.upsert(project.id, req.auth!.userId, {
                    inheritFromUser: false,
                    ...(tags.visualTags?.length ? { visualTags: tags.visualTags } : {}),
                    ...(tags.paletteTags?.length ? { paletteTags: tags.paletteTags } : {}),
                    ...(tags.typographyTags?.length ? { typographyTags: tags.typographyTags } : {}),
                    ...(tags.layoutTags?.length ? { layoutTags: tags.layoutTags } : {}),
                    ...(tags.toneTags?.length ? { toneTags: tags.toneTags } : {}),
                    ...(tags.audienceTags?.length ? { audienceTags: tags.audienceTags } : {}),
                    ...(tags.featureTags?.length ? { featureTags: tags.featureTags } : {}),
                    ...(brief ? { projectBrief: brief } : {}),
                    ...(preset.styleTemplate ? { styleNotes: preset.styleTemplate } : {}),
                });
            }

            res.status(201).json({ project });
        } catch (error) {
            next(error);
        }
    });

    // GET /v1/projects/:projectId — fetch a single project (ownership verified via sandbox)
    router.get("/projects/:projectId", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const project = await projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId);
            if (!project) {
                res.status(404).json({ error: "Project not found" });
                return;
            }
            res.json({ project });
        } catch (error) {
            next(error);
        }
    });

    // PATCH /v1/projects/:projectId — rename a project
    router.patch("/projects/:projectId", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const { name } = z.object({ name: z.string().trim().min(3).max(80) }).parse(req.body);
            const project = await projectRepository.rename(req.sandbox!.projectId, req.auth!.userId, name);
            if (!project) {
                res.status(404).json({ error: "Project not found" });
                return;
            }
            res.json({ project });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/projects/:projectId", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            await deleteProject.execute(req.sandbox!.projectId, req.auth!.userId);
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects/:projectId/duplicate", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const project = await duplicateProject.execute(req.sandbox!.projectId, req.auth!.userId, req.body);
            res.status(201).json({ project });
        } catch (error) {
            next(error);
        }
    });

    router.get("/projects/:projectId/moodboard", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const moodboard = await getProjectMoodboard.execute(req.sandbox!.projectId, req.auth!.userId);
            res.json({ moodboard: mapMoodboardToDto(moodboard) });
        } catch (error) {
            next(error);
        }
    });

    router.put("/projects/:projectId/moodboard", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const moodboard = await updateProjectMoodboard.execute(req.sandbox!.projectId, req.auth!.userId, req.body);
            res.json({ moodboard: mapMoodboardToDto(moodboard) });
        } catch (error) {
            next(error);
        }
    });

    router.post("/projects/:projectId/sessions", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const tokenId = randomUUID();
            const refreshToken = signRefreshToken({ sub: req.auth!.userId, sid: tokenId });
            const refreshPayload = verifyRefreshToken(refreshToken);
            await sessionRepository.create({
                userId: req.auth!.userId,
                projectId: req.sandbox!.projectId,
                tokenId,
                refreshTokenHash: await hashPassword(refreshToken),
                expiresAt: new Date((refreshPayload.exp ?? 0) * 1000),
                ip: req.ip,
                userAgent: req.headers["user-agent"]
            });

            res.status(201).json({ message: "Session created", projectId: req.sandbox!.projectId });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
