import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { SiteDeploymentRepository } from "../../../domain/repositories/SiteDeploymentRepository";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";

/** Aggregates platform-wide statistics for the super admin dashboard. */
export class GetPlatformStats {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly siteDeploymentRepository: SiteDeploymentRepository,
        private readonly projectRepository: ProjectRepository,
    ) {}

    async execute() {
        const [totalUsers, blockedUsers, totalLiveDeployments, totalTokensConsumedLifetime, totalProjects] = await Promise.all([
            this.userRepository.countAll(),
            this.userRepository.countBlocked(),
            this.siteDeploymentRepository.countLive(),
            this.userRepository.sumTokensConsumedLifetime(),
            this.projectRepository.countAll(),
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
            totalProjects,
            totalLiveDeployments,
            totalTokensConsumedLifetime,
            usersByRole,
        };
    }
}
