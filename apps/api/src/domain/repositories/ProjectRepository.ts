import type { Project } from "../entities/Project";

export interface ProjectRepository {
    create(ownerUserId: string, name: string, presetId?: string): Promise<Project>;
    listForUser(userId: string): Promise<Project[]>;
    findByIdForUser(projectId: string, userId: string): Promise<Project | null>;
    /** Delete a project; returns false if not found or not owned by userId. */
    deleteById(projectId: string, userId: string): Promise<boolean>;
    /** Rename a project; returns updated project or null if not found / not owned. */
    rename(projectId: string, userId: string, name: string): Promise<Project | null>;
}
