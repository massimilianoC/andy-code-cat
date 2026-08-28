import type { ProjectFormSettingsInput as ProjectFormSettingsDto } from "@andy-code-cat/contracts";
import type { Project, ProjectFormSettings } from "../../domain/entities/Project";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";

export function toProjectFormSettingsDto(settings: ProjectFormSettings | undefined): ProjectFormSettingsDto | undefined {
    return settings ? { ...settings, privacyNotice: { ...settings.privacyNotice } } : undefined;
}

export class GetProjectFormSettings {
    constructor(private readonly projectRepository: ProjectRepository) {}

    async execute(projectId: string, userId: string): Promise<ProjectFormSettings | undefined> {
        const project = await this.projectRepository.findByIdForUser(projectId, userId);
        return project?.serviceConfig?.forms;
    }
}

export class SetProjectFormSettings {
    constructor(private readonly projectRepository: ProjectRepository) {}

    async execute(projectId: string, userId: string, settings: ProjectFormSettings): Promise<Project> {
        const project = await this.projectRepository.updateFormSettings(projectId, userId, settings);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }
        return project;
    }
}
