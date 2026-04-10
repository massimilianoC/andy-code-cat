import { call } from "./call";

export interface SiteDeploymentDto {
    id: string;
    publishId: string;
    projectId: string;
    status: "deploying" | "live" | "failed";
    url: string;
    subdomainUrl: string | null;
    customSlug: string | null;
    filesDeployed: string[];
    snapshotId?: string;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    deployedAt?: string;
}

export interface PublishHistoryEntryDto {
    id: string;
    projectId: string;
    userId: string;
    publishId: string;
    deploymentId: string;
    snapshotId: string;
    action: "publish" | "republish";
    publishedAt: string;
}

export function publishProject(token: string, projectId: string, snapshotId?: string, customSlug?: string) {
    return call<SiteDeploymentDto>(
        "POST",
        `/v1/projects/${projectId}/publish`,
        { ...(snapshotId ? { snapshotId } : {}), ...(customSlug ? { customSlug } : {}) },
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function getPublishStatus(token: string, projectId: string) {
    return call<SiteDeploymentDto>(
        "GET",
        `/v1/projects/${projectId}/publish`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function unpublishProject(token: string, projectId: string, deploymentId: string) {
    return call<void>(
        "DELETE",
        `/v1/projects/${projectId}/publish/${deploymentId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

/** Check if a custom slug is available (no auth required). */
export function checkSlugAvailability(slug: string) {
    return call<{ available: boolean; slug: string }>(
        "GET",
        `/v1/publish/check-slug?slug=${encodeURIComponent(slug)}`,
        undefined,
        {}
    );
}

/** Update the custom slug of the active deployment for a project. Pass null to clear. */
export function updateDeploymentSlug(
    token: string,
    projectId: string,
    customSlug: string | null
) {
    return call<SiteDeploymentDto>(
        "PATCH",
        `/v1/projects/${projectId}/publish/slug`,
        { customSlug },
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function getPublishHistory(token: string, projectId: string) {
    return call<{ history: PublishHistoryEntryDto[] }>(
        "GET",
        `/v1/projects/${projectId}/publish/history`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}
