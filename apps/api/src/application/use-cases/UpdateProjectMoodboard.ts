import { updateProjectMoodboardSchema } from "@andy-code-cat/contracts";
import type { ProjectMoodboard } from "../../domain/entities/ProjectMoodboard";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import { VALID_TAG_IDS, MAX_TAGS_PER_CATEGORY } from "../../domain/entities/StyleTag";

export class UpdateProjectMoodboard {
    constructor(
        private readonly moodboardRepo: ProjectMoodboardRepository,
        private readonly projectRepo: ProjectRepository,
    ) { }

    async execute(projectId: string, userId: string, rawInput: unknown): Promise<ProjectMoodboard> {
        // Verify ownership
        const project = await this.projectRepo.findByIdForUser(projectId, userId);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }

        const input = updateProjectMoodboardSchema.parse(rawInput);

        const tagFields = [
            input.visualTags,
            input.paletteTags,
            input.typographyTags,
            input.layoutTags,
            input.toneTags,
            input.audienceTags,
            input.featureTags,
            input.referenceTags,
            input.eraTags,
        ].filter((arr): arr is string[] => Array.isArray(arr));

        for (const arr of tagFields) {
            if (arr.length > MAX_TAGS_PER_CATEGORY) {
                throw Object.assign(new Error(`Maximum ${MAX_TAGS_PER_CATEGORY} tags per category`), { statusCode: 400 });
            }
            for (const id of arr) {
                if (!VALID_TAG_IDS.has(id)) {
                    throw Object.assign(new Error(`Unknown tag id: ${id}`), { statusCode: 400 });
                }
            }
        }

        return this.moodboardRepo.upsert(projectId, userId, input);
    }
}
