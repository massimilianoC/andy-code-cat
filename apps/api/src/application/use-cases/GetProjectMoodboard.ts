import type { ProjectMoodboard } from "../../domain/entities/ProjectMoodboard";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";

export class GetProjectMoodboard {
    constructor(
        private readonly moodboardRepo: ProjectMoodboardRepository,
        private readonly projectRepo: ProjectRepository,
    ) { }

    async execute(projectId: string, userId: string): Promise<ProjectMoodboard> {
        // Verify ownership (double sandbox)
        const project = await this.projectRepo.findByIdForUser(projectId, userId);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }

        const existing = await this.moodboardRepo.findByProjectId(projectId);
        if (existing) return existing;

        // Auto-create with inherit-from-user defaults
        return this.moodboardRepo.initForProject({ projectId, userId, inheritFromUser: true });
    }
}
