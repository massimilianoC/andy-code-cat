import type { ProjectMoodboard, CreateProjectMoodboardInput, UpdateProjectMoodboardInput } from "../entities/ProjectMoodboard";

export interface ProjectMoodboardRepository {
    findByProjectId(projectId: string): Promise<ProjectMoodboard | null>;

    /** Upsert — creates if missing, updates if present. */
    upsert(projectId: string, userId: string, input: UpdateProjectMoodboardInput): Promise<ProjectMoodboard>;

    /** Initialise with inherit-from-user defaults when a project is first accessed. */
    initForProject(input: CreateProjectMoodboardInput): Promise<ProjectMoodboard>;

    deleteByProjectId(projectId: string): Promise<void>;
}
