import { CURRENT_PASSWORD_POLICY_VERSION } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";

export class GetUserDetail {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly projectRepository: ProjectRepository,
    ) { }

    async execute(userId: string) {
        const user = await this.userRepository.findById(userId);
        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        const projects = await this.projectRepository.listForUser(userId);

        return {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            emailVerified: user.emailVerified,
            isBlocked: user.isBlocked,
            requiresPasswordChange: (user.passwordPolicyVersion ?? 1) < CURRENT_PASSWORD_POLICY_VERSION,
            roles: user.roles,
            limits: user.limits,
            tokensConsumedLifetime: user.tokensConsumedLifetime ?? 0,
            createdAt: user.createdAt.toISOString(),
            projects: projects.map(p => ({
                id: p.id,
                name: p.name,
                presetId: p.presetId,
                createdAt: p.createdAt.toISOString(),
            })),
        };
    }
}
