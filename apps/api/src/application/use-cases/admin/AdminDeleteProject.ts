import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { SiteDeploymentRepository } from "../../../domain/repositories/SiteDeploymentRepository";
import type { DeleteProject } from "../DeleteProject";

/**
 * Superadmin project deletion. It is the owner's deletion (`DeleteProject`, the only one), run on
 * the owner's behalf: the same collections, files and published directories go, and a failed step
 * keeps the project exactly as it does for the owner.
 *
 * Live sites are blocked first, so they stop being served even if the deletion then fails part-way.
 */
export class AdminDeleteProject {
    constructor(
        private readonly projectRepo: ProjectRepository,
        private readonly deploymentRepo: SiteDeploymentRepository,
        private readonly deleteProject: DeleteProject,
    ) { }

    async execute(projectId: string, adminUserId: string): Promise<{ deleted: boolean }> {
        const project = await this.projectRepo.findById(projectId);
        if (!project) return { deleted: false };

        const deployments = await this.deploymentRepo.findByProjectId(projectId);
        await Promise.all(
            deployments
                .filter((d) => !d.isAdminBlocked)
                .map((d) => this.deploymentRepo.setAdminBlocked(d.publishId, true, adminUserId)),
        );

        await this.deleteProject.execute(projectId, project.ownerUserId);
        return { deleted: true };
    }
}
