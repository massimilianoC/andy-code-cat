import { z } from "zod";
import type { Project } from "../../domain/entities/Project";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { LlmPromptConfigRepository } from "../../domain/repositories/LlmPromptConfigRepository";

const duplicateSchema = z.object({
    name: z.string().trim().min(3).max(80).optional(),
});

export class DuplicateProject {
    constructor(
        private readonly projectRepo: ProjectRepository,
        private readonly promptConfigRepo: LlmPromptConfigRepository,
    ) { }

    async execute(sourceProjectId: string, userId: string, rawInput: unknown): Promise<Project> {
        // Verify ownership
        const source = await this.projectRepo.findByIdForUser(sourceProjectId, userId);
        if (!source) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }

        const { name } = duplicateSchema.parse(rawInput ?? {});
        const newName = name ?? `${source.name} (copia)`;

        const newProject = await this.projectRepo.create(userId, newName);

        // Copy the LLM prompt config (system prompt template) if it exists
        const sourceConfig = await this.promptConfigRepo.findByProjectId(sourceProjectId);
        if (sourceConfig) {
            await this.promptConfigRepo.upsertForProject(newProject.id, {
                enabled: sourceConfig.enabled,
                responseFormatVersion: sourceConfig.responseFormatVersion,
                prePromptTemplate: sourceConfig.prePromptTemplate,
            });
        }

        return newProject;
    }
}
