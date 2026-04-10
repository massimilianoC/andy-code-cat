import type { SiteDeployment } from "../../domain/entities/SiteDeployment";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";
import type { LocalFileStorage } from "../../infra/storage/LocalFileStorage";

export class UnpublishProject {
    constructor(
        private deploymentRepo: SiteDeploymentRepository,
        private storage: LocalFileStorage,
    ) { }

    async execute(deploymentId: string, userId: string): Promise<void> {
        const deployment = await this.deploymentRepo.findById(deploymentId);
        if (!deployment) {
            throw Object.assign(new Error("Deployment not found"), { statusCode: 404 });
        }
        if (deployment.userId !== userId) {
            throw Object.assign(new Error("Access denied"), { statusCode: 403 });
        }

        // Delete published files (publishId dir + optional customSlug dir)
        await this.storage.deletePublishDir(deployment.publishId);
        if (deployment.customSlug) {
            await this.storage.deletePublishDir(deployment.customSlug).catch(() => { /* best-effort */ });
        }

        // Delete DB record
        await this.deploymentRepo.deleteById(deploymentId);
    }
}
