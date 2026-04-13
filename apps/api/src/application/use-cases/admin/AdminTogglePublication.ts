import { adminBlockDeploymentSchema } from "@andy-code-cat/contracts";
import type { SiteDeploymentRepository } from "../../../domain/repositories/SiteDeploymentRepository";

export class AdminTogglePublication {
    constructor(private readonly deploymentRepository: SiteDeploymentRepository) {}

    async execute(publishId: string, callerUserId: string, rawInput: unknown) {
        const { blocked } = adminBlockDeploymentSchema.parse(rawInput);
        const deployment = await this.deploymentRepository.setAdminBlocked(publishId, blocked, callerUserId);
        if (!deployment) {
            throw Object.assign(new Error("Deployment not found"), { statusCode: 404 });
        }
        return {
            publishId: deployment.publishId,
            isAdminBlocked: deployment.isAdminBlocked ?? false,
            adminBlockedAt: deployment.adminBlockedAt?.toISOString(),
        };
    }
}
