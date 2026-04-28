import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { SiteDeploymentRepository } from "../../../domain/repositories/SiteDeploymentRepository";

/** Admin-side project deletion: blocks all live deployments, then removes the project document. */
export class AdminDeleteProject {
    constructor(
        private readonly projectRepo: ProjectRepository,
        private readonly deploymentRepo: SiteDeploymentRepository,
    ) { }

    async execute(projectId: string, adminUserId: string): Promise<{ deleted: boolean }> {
        // 1. Block all active deployments to take sites offline
        const deployments = await this.deploymentRepo.findByProjectId(projectId);
        await Promise.all(
            deployments
                .filter((d) => !d.isAdminBlocked)
                .map((d) => this.deploymentRepo.setAdminBlocked(d.publishId, true, adminUserId)),
        );

        // 2. Delete the project document
        const deleted = await this.projectRepo.adminDeleteById(projectId);
        return { deleted };
    }
}
