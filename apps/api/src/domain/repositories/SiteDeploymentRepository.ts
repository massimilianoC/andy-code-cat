import type { SiteDeployment, SiteDeploymentStatus } from "../entities/SiteDeployment";

export interface ListDeploymentsResult {
    deployments: SiteDeployment[];
    total: number;
}

export interface CreateSiteDeploymentInput {
    publishId: string;
    customSlug?: string;
    projectId: string;
    userId: string;
    snapshotId: string;
    url: string;
    filesDeployed: string[];
}

export interface SiteDeploymentRepository {
    create(input: CreateSiteDeploymentInput): Promise<SiteDeployment>;
    findById(id: string): Promise<SiteDeployment | null>;
    findByPublishId(publishId: string): Promise<SiteDeployment | null>;
    findActiveByProjectId(projectId: string): Promise<SiteDeployment | null>;
    findByProjectId(projectId: string): Promise<SiteDeployment[]>;
    /**
     * Delete-project cascade — removes every deployment row for a project. Returns the number
     * removed. This is a DB-only operation: the caller (`DeleteProject`) is responsible for
     * deleting each deployment's published files (`IFileStorage.deletePublishDir`) first, the same
     * way `UnpublishProject` does for a single deployment — one file-deletion path, reused rather
     * than duplicated.
     */
    deleteByProject(projectId: string): Promise<number>;
    updateStatus(
        id: string,
        status: SiteDeploymentStatus,
        data?: Partial<Pick<SiteDeployment, "filesDeployed" | "deployedAt" | "errorMessage" | "snapshotId" | "updatedAt">>
    ): Promise<SiteDeployment | null>;
    updateCustomSlug(id: string, customSlug: string | null): Promise<SiteDeployment | null>;
    deleteById(id: string): Promise<boolean>;
    findActivesByUserId(userId: string): Promise<SiteDeployment[]>;
    isPublishIdTaken(publishId: string): Promise<boolean>;
    isCustomSlugTaken(slug: string, excludeDeploymentId?: string): Promise<boolean>;
    // ── Admin ops ─────────────────────────────────────────────────────────────
    setAdminBlocked(publishId: string, blocked: boolean, adminUserId: string): Promise<SiteDeployment | null>;
    listAllPaginated(page: number, limit: number): Promise<ListDeploymentsResult>;
    countLive(): Promise<number>;
}
