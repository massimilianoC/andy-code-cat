import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { SiteDeploymentRepository } from "../../../domain/repositories/SiteDeploymentRepository";

/** Aggregates platform-wide statistics for the super admin dashboard. */
export class GetPlatformStats {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly siteDeploymentRepository: SiteDeploymentRepository,
    ) {}

    async execute() {
        const [totalUsers, blockedUsers, totalLiveDeployments, totalTokensConsumedLifetime] = await Promise.all([
            this.userRepository.countAll(),
            this.userRepository.countBlocked(),
            this.siteDeploymentRepository.countLive(),
            this.userRepository.sumTokensConsumedLifetime(),
        ]);

        // Role breakdown from a paginated sweep (up to 1000 users for stats)
        const { users } = await this.userRepository.listPaginated(1, 1000);
        const usersByRole: Record<string, number> = {};
        for (const u of users) {
            for (const role of u.roles) {
                usersByRole[role] = (usersByRole[role] ?? 0) + 1;
            }
        }

        return {
            totalUsers,
            blockedUsers,
            totalLiveDeployments,
            totalTokensConsumedLifetime,
            usersByRole,
        };
    }
}
