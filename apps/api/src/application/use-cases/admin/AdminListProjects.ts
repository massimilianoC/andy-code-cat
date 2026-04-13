import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { SiteDeploymentRepository } from "../../../domain/repositories/SiteDeploymentRepository";

export interface AdminProjectItem {
    id: string;
    name: string;
    presetId?: string;
    ownerUserId: string;
    ownerEmail: string;
    ownerFirstName?: string;
    ownerLastName?: string;
    ownerIsBlocked: boolean;
    activeDeployment?: {
        publishId: string;
        customSlug?: string;
        url: string;
        isAdminBlocked: boolean;
    };
    createdAt: string;
}

export interface AdminListProjectsInput {
    page: number;
    limit: number;
    search?: string;
    ownerId?: string;
    presetId?: string;
}

export class AdminListProjects {
    constructor(
        private readonly projectRepo: ProjectRepository,
        private readonly userRepo: UserRepository,
        private readonly deploymentRepo: SiteDeploymentRepository,
    ) { }

    async execute(input: AdminListProjectsInput): Promise<{
        projects: AdminProjectItem[];
        total: number;
        page: number;
        limit: number;
    }> {
        const { projects, total } = await this.projectRepo.listAllPaginated(
            input.page,
            input.limit,
            { search: input.search, ownerId: input.ownerId, presetId: input.presetId },
        );

        // Batch-fetch unique owners (one query per unique userId)
        const ownerIds = [...new Set(projects.map((p) => p.ownerUserId))];
        const ownerResults = await Promise.all(ownerIds.map((id) => this.userRepo.findById(id)));
        const ownerMap = new Map(ownerResults.filter(Boolean).map((u) => [u!.id, u!]));

        // Fetch active deployments per project in parallel
        const deployments = await Promise.all(
            projects.map((p) => this.deploymentRepo.findActiveByProjectId(p.id)),
        );

        const items: AdminProjectItem[] = projects.map((p, i) => {
            const owner = ownerMap.get(p.ownerUserId);
            const deployment = deployments[i];
            return {
                id: p.id,
                name: p.name,
                presetId: p.presetId,
                ownerUserId: p.ownerUserId,
                ownerEmail: owner?.email ?? "(unknown)",
                ownerFirstName: owner?.firstName,
                ownerLastName: owner?.lastName,
                ownerIsBlocked: owner?.isBlocked ?? false,
                ...(deployment
                    ? {
                        activeDeployment: {
                            publishId: deployment.publishId,
                            customSlug: deployment.customSlug,
                            url: deployment.url,
                            isAdminBlocked: deployment.isAdminBlocked ?? false,
                        },
                    }
                    : {}),
                createdAt: p.createdAt.toISOString(),
            };
        });

        return { projects: items, total, page: input.page, limit: input.limit };
    }
}
