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

export type SlugCheckReason = "ok" | "taken" | "invalid" | "reserved";

export interface SlugCheckResponse {
    available: boolean;
    slug: string;
    reason: SlugCheckReason;
}

/**
 * Check if a custom slug is available (no auth required).
 * Pass `excludeDeploymentId` when editing an existing deployment so its own
 * current slug is reported as available instead of "taken".
 */
export function checkSlugAvailability(slug: string, excludeDeploymentId?: string) {
    const qs = new URLSearchParams({ slug });
    if (excludeDeploymentId) qs.set("excludeDeploymentId", excludeDeploymentId);
    return call<SlugCheckResponse>(
        "GET",
        `/v1/publish/check-slug?${qs.toString()}`,
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
