export type SiteDeploymentStatus = "deploying" | "live" | "failed";

export interface SiteDeployment {
    id: string;
    /** Short URL-safe identifier (8 chars, lowercase alphanumeric). Used in /p/{publishId}. */
    publishId: string;
    /**
     * Optional human-readable slug chosen by the user (e.g. "mia-pizzeria").
     * When set, files are also written to /data/www/{customSlug}/ so that
     * {customSlug}.sitowebinun.click is served via the nginx wildcard block.
     * The canonical path URL /p/{publishId} always remains valid.
     */
    customSlug?: string;
    projectId: string;
    userId: string;
    snapshotId: string;
    status: SiteDeploymentStatus;
    /** Relative URL path: /p/{publishId} */
    url: string;
    filesDeployed: string[];
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
    deployedAt?: Date;
}
