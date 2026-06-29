import { z } from "zod";

// Slug validation: 2-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen.
// Blacklist: short reserved paths that overlap with API routes or nginx upstreams.
export const SLUG_BLACKLIST = ["www", "api", "admin", "app", "mail", "pageforge", "p", "cdn", "static"];

// Single source of truth for the slug shape. 2 chars (both alphanumeric) or 3-30 with
// interior hyphens. Mirror this exactly in any client-side pre-validation.
export const SLUG_FORMAT_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/;

export const customSlugSchema = z
    .string()
    .regex(SLUG_FORMAT_RE, {
        message: "Slug must be 2-30 lowercase characters (a-z, 0-9, hyphens), no leading/trailing hyphens",
    })
    .refine((s) => !SLUG_BLACKLIST.includes(s), { message: "This name is reserved" });

// Why this exists: the availability endpoint must give the UI a single, coherent answer
// for *every* outcome — not just available/taken. Conflating "reserved" and "bad format"
// with "taken" produced misleading UX ("already in use" for a word like `admin`).
export type SlugCheckReason = "ok" | "taken" | "invalid" | "reserved";

export interface SlugCheckResponse {
    available: boolean;
    slug: string;
    reason: SlugCheckReason;
}

/**
 * Classify a raw slug string into a coherent reason without touching the database.
 * Returns `reason: "ok"` only when the format is valid and the name is not reserved —
 * the caller still has to check uniqueness for the final verdict.
 */
export function classifySlugFormat(raw: string): { normalized: string; reason: Exclude<SlugCheckReason, "taken"> } {
    const normalized = raw.trim().toLowerCase();
    if (SLUG_BLACKLIST.includes(normalized)) return { normalized, reason: "reserved" };
    if (!SLUG_FORMAT_RE.test(normalized)) return { normalized, reason: "invalid" };
    return { normalized, reason: "ok" };
}

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
