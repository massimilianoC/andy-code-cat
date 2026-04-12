export type SiteDeploymentStatus = "deploying" | "live" | "failed";

export interface SiteDeployment {
    id: string;
    /** Short URL-safe identifier (8 chars, lowercase alphanumeric). Used in /p/{publishId}. */
    publishId: string;
    /**
     * Optional human-readable slug chosen by the user (e.g. "mia-pizzeria").
     * When set, files are also written to /data/www/{customSlug}/ so that
     * {customSlug}.yourdomain.com is served via the nginx wildcard block.
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
    /** When true, the static-serving endpoint returns HTTP 403. Set by superadmin. */
    isAdminBlocked?: boolean;
    adminBlockedAt?: Date;
    adminBlockedByUserId?: string;
    createdAt: Date;
    updatedAt: Date;
    deployedAt?: Date;
}
