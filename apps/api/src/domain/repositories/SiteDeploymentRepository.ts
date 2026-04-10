import type { SiteDeployment, SiteDeploymentStatus } from "../entities/SiteDeployment";

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
    updateStatus(
        id: string,
        status: SiteDeploymentStatus,
        data?: Partial<Pick<SiteDeployment, "filesDeployed" | "deployedAt" | "errorMessage" | "snapshotId" | "updatedAt">>
    ): Promise<SiteDeployment | null>;
    updateCustomSlug(id: string, customSlug: string | null): Promise<SiteDeployment | null>;
    deleteById(id: string): Promise<boolean>;
    isPublishIdTaken(publishId: string): Promise<boolean>;
    isCustomSlugTaken(slug: string, excludeDeploymentId?: string): Promise<boolean>;
}
