import { z } from "zod";

// Slug validation: 2-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen.

/**
 * First path segments the platform itself answers at the root of its origin. A published site
 * can be addressed as `/{slug}/` (publish URL mode "path"), so none of these may ever be a slug:
 * a slug equal to an app page would either hide the page or be unreachable.
 *
 * - web: every top-level route under apps/web/app (route groups are transparent) and every
 *   top-level entry of apps/web/public. A test in apps/web fails if a new one is added here-less.
 * - api: the root mounts of apps/api/src/app.ts.
 */
export const RESERVED_ROOT_SEGMENTS = [
    // web app routes
    "login", "register", "dashboard", "workspace", "onboarding", "launch", "admin", "install",
    // web static assets (apps/web/public)
    "grapesjs",
    // api root mounts
    "v1", "p", "health", "version",
] as const;

// Blacklist: reserved root segments plus names that overlap with nginx upstreams and the
// conventional hostnames of a subdomain deployment (publish URL mode "subdomain").
export const SLUG_BLACKLIST: readonly string[] = [
    ...RESERVED_ROOT_SEGMENTS,
    "www", "api", "app", "mail", "pageforge", "cdn", "static",
];

// Single source of truth for the slug shape. 2 chars (both alphanumeric) or 3-30 with
// interior hyphens. Mirror this exactly in any client-side pre-validation.
export const SLUG_FORMAT_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/;

/** True when `segment` can address a published site at `/{segment}/`: valid shape, not reserved. */
export function isPublicSiteSlug(segment: string): boolean {
    return SLUG_FORMAT_RE.test(segment) && !SLUG_BLACKLIST.includes(segment);
}

/**
 * How the platform advertises a published site's public address. Installation-level, set by the
 * superadmin (PlatformConfig.publicSites). Serving does not depend on it: `/p/{publishId}/` and
 * `/{slug}/` are always answered; the mode only decides which address is shown and shared.
 * - "path":      `{origin}/{slug}/` (or `{origin}/p/{publishId}/` without a slug) — needs nothing
 *                beyond the app's own origin, so it survives a server or domain move unchanged.
 * - "subdomain": `https://{slug|publishId}.{publicDomain}` — needs wildcard DNS and a wildcard
 *                certificate for `*.{publicDomain}` routed to the published-site server.
 */
export const PUBLISH_URL_MODES = ["path", "subdomain"] as const;
export type PublishUrlMode = (typeof PUBLISH_URL_MODES)[number];

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
    /** Stored canonical path, always `/p/{publishId}` — never an absolute URL. */
    url: string;
    /**
     * The address to show and share, derived at read time from PlatformConfig.publicSites:
     * absolute (`https://slug.domain`) in subdomain mode, origin-relative (`/slug/`, `/p/id/`) in
     * path mode — the client resolves a relative one against its API origin.
     */
    publicUrl: string;
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
