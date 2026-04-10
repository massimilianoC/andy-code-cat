import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";

export class DeleteProject {
    constructor(
        private readonly projectRepo: ProjectRepository,
        private readonly moodboardRepo: ProjectMoodboardRepository,
    ) { }

    async execute(projectId: string, userId: string): Promise<void> {
        // Verify ownership before doing anything
        const project = await this.projectRepo.findByIdForUser(projectId, userId);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }

        // Clean up moodboard (best effort — don't fail if missing)
        try {
            await this.moodboardRepo.deleteByProjectId(projectId);
        } catch {
            // best effort
        }

        await this.projectRepo.deleteById(projectId, userId);
    }
}
