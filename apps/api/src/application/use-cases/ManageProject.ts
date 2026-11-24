/**
 * Creating a project and changing its name or preset — what POST/PATCH /v1/projects did in their
 * handlers, now one use case: the routes call it for the dashboard and Vibe, a background run
 * calls it for the project it creates and the preset its classification picked
 * (BACKGROUND_RUNS.md §1). A preset is resolved against the registry before it is applied
 * (AGENTS.md Rule Zero's second corollary) and seeds the moodboard where it is still empty.
 */
import { PRESET_MAP, type ProjectPreset } from "../../domain/entities/ProjectPreset";
import type { Project } from "../../domain/entities/Project";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { ProjectPresetRepository } from "../../domain/repositories/ProjectPresetRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import { HttpError } from "../../presentation/http/errors/httpError";

export function buildPresetMoodboardSeed(name: string, preset: ProjectPreset) {
    const tags = preset.defaultTags;
    const brief = preset.briefTemplate.replace(/\{\{projectName\}\}/g, name);

    return {
        inheritFromUser: false,
        ...(tags.visualTags?.length ? { visualTags: tags.visualTags } : {}),
        ...(tags.paletteTags?.length ? { paletteTags: tags.paletteTags } : {}),
        ...(tags.typographyTags?.length ? { typographyTags: tags.typographyTags } : {}),
        ...(tags.layoutTags?.length ? { layoutTags: tags.layoutTags } : {}),
        ...(tags.toneTags?.length ? { toneTags: tags.toneTags } : {}),
        ...(tags.audienceTags?.length ? { audienceTags: tags.audienceTags } : {}),
        ...(tags.featureTags?.length ? { featureTags: tags.featureTags } : {}),
        ...(tags.sectorTags?.length ? { sectorTags: tags.sectorTags } : {}),
        ...(brief ? { projectBrief: brief } : {}),
        ...(preset.styleTemplate ? { styleNotes: preset.styleTemplate } : {}),
    };
}

export class ManageProject {
    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly presetRepository: ProjectPresetRepository,
        private readonly moodboardRepository: ProjectMoodboardRepository,
    ) { }

    private async resolvePreset(presetId: string | undefined): Promise<ProjectPreset | null> {
        if (presetId === undefined) return null;
        const preset = (await this.presetRepository.findById(presetId).catch(() => null)) ?? PRESET_MAP.get(presetId) ?? null;
        if (!preset) {
            throw new HttpError(`Unknown preset: ${presetId}`, { statusCode: 400, code: "UNKNOWN_PRESET" });
        }
        return preset;
    }

    async create(input: { userId: string; name: string; presetId?: string }): Promise<Project> {
        const preset = await this.resolvePreset(input.presetId);
        const project = await this.projectRepository.create(input.userId, input.name, input.presetId);
        if (preset) {
            await this.moodboardRepository.upsert(project.id, input.userId, buildPresetMoodboardSeed(input.name, preset));
        }
        return project;
    }

    async update(input: { projectId: string; userId: string; name?: string; presetId?: string }): Promise<Project> {
        const notFound = () => new HttpError("Project not found", { statusCode: 404, code: "PROJECT_NOT_FOUND" });
        const currentProject = await this.projectRepository.findByIdForUser(input.projectId, input.userId);
        if (!currentProject) throw notFound();

        const preset = await this.resolvePreset(input.presetId);
        const project = await this.projectRepository.update(input.projectId, input.userId, {
            name: input.name,
            presetId: input.presetId,
        });
        if (!project) throw notFound();

        if (preset && currentProject.presetId !== input.presetId) {
            const existingMoodboard = await this.moodboardRepository.findByProjectId(project.id);
            const presetSeed = buildPresetMoodboardSeed(project.name, preset);

            await this.moodboardRepository.upsert(project.id, input.userId, {
                ...(existingMoodboard?.inheritFromUser === undefined ? { inheritFromUser: presetSeed.inheritFromUser } : {}),
                ...(existingMoodboard?.visualTags?.length ? {} : { visualTags: presetSeed.visualTags }),
                ...(existingMoodboard?.paletteTags?.length ? {} : { paletteTags: presetSeed.paletteTags }),
                ...(existingMoodboard?.typographyTags?.length ? {} : { typographyTags: presetSeed.typographyTags }),
                ...(existingMoodboard?.layoutTags?.length ? {} : { layoutTags: presetSeed.layoutTags }),
                ...(existingMoodboard?.toneTags?.length ? {} : { toneTags: presetSeed.toneTags }),
                ...(existingMoodboard?.audienceTags?.length ? {} : { audienceTags: presetSeed.audienceTags }),
                ...(existingMoodboard?.featureTags?.length ? {} : { featureTags: presetSeed.featureTags }),
                ...(existingMoodboard?.sectorTags?.length ? {} : { sectorTags: presetSeed.sectorTags }),
                ...(existingMoodboard?.projectBrief ? {} : { projectBrief: presetSeed.projectBrief }),
                ...(existingMoodboard?.styleNotes ? {} : { styleNotes: presetSeed.styleNotes }),
            });
        }
        return project;
    }
}
