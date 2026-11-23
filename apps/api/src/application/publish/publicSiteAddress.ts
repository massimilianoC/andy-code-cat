import type { PlatformConfig, PublicSitesConfig } from "../../domain/entities/PlatformConfig";

/**
 * The one rule for a published site's public address (Rule Zero: one rule, one place).
 *
 * Every response that shows or shares a site link — the publish dialog, the project list, the
 * superadmin project registry — goes through `resolvePublicSiteUrl`. Nothing stores the result:
 * deployments keep only `/p/{publishId}` plus an optional `customSlug`, so changing the mode or
 * the domain (a server or domain move) re-addresses every existing site at once.
 *
 * Serving never depends on the mode: the API answers `/p/{publishId}/` and `/{slug}/` in both.
 */

/** Installations that predate the setting, and fresh ones, address sites by path. */
export const DEFAULT_PUBLIC_SITES_CONFIG: PublicSitesConfig = { urlMode: "path", publicDomain: "" };

export function resolvePublicSitesConfig(config: Pick<PlatformConfig, "publicSites"> | null | undefined): PublicSitesConfig {
    const stored = config?.publicSites;
    if (!stored) return { ...DEFAULT_PUBLIC_SITES_CONFIG };
    return {
        urlMode: stored.urlMode === "subdomain" ? "subdomain" : "path",
        publicDomain: (stored.publicDomain ?? "").trim().toLowerCase(),
    };
}

export interface AddressableDeployment {
    publishId: string;
    customSlug?: string | null;
}

/**
 * Subdomain mode: `https://{slug|publishId}.{publicDomain}` (absolute).
 * Path mode: `/{slug}/`, or `/p/{publishId}/` for a site without a slug (origin-relative — the
 * client resolves it against its own API origin, so it follows the installation wherever it runs).
 *
 * The superadmin cannot save subdomain mode without a valid domain (publicSitesConfigSchema), so an
 * empty domain here means a document edited outside the API; it is addressed by path rather than
 * producing `https://slug.` — the same result the platform gave before the setting existed.
 */
export function resolvePublicSiteUrl(deployment: AddressableDeployment, config: PublicSitesConfig): string {
    const slug = deployment.customSlug?.trim() || null;
    if (config.urlMode === "subdomain" && config.publicDomain) {
        return `https://${slug ?? deployment.publishId}.${config.publicDomain}`;
    }
    return slug ? `/${slug}/` : `/p/${deployment.publishId}/`;
}
