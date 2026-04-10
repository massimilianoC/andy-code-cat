import type { SiteDeployment } from "../../domain/entities/SiteDeployment";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";

export class GetSiteDeployment {
    constructor(private deploymentRepo: SiteDeploymentRepository) { }

    async findActiveByProjectId(projectId: string): Promise<SiteDeployment | null> {
        return this.deploymentRepo.findActiveByProjectId(projectId);
    }

    async findById(id: string): Promise<SiteDeployment | null> {
        return this.deploymentRepo.findById(id);
    }
}
