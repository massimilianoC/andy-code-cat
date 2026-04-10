import { z } from "zod";

// Slug validation: 3-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen.
// Blacklist: short reserved paths that overlap with API routes or nginx upstreams.
const SLUG_BLACKLIST = ["www", "api", "admin", "app", "mail", "pageforge", "p", "cdn", "static"];

export const customSlugSchema = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$|^[a-z0-9]{2}$/, {
        message: "Slug must be 2-30 lowercase characters (a-z, 0-9, hyphens), no leading/trailing hyphens",
    })
    .refine((s) => !SLUG_BLACKLIST.includes(s), { message: "This name is reserved" });

// ---- Publish input ----
export const publishProjectSchema = z.object({
    snapshotId: z.string().uuid().optional(),
    customSlug: customSlugSchema.optional(),
});

export type PublishProjectInput = z.infer<typeof publishProjectSchema>;

// ---- Site Deployment DTO ----
export type SiteDeploymentStatus = "deploying" | "live" | "failed";

export interface SiteDeploymentDto {
    id: string;
    publishId: string;
    projectId: string;
    status: SiteDeploymentStatus;
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

// ---- Publish History DTO ----
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
