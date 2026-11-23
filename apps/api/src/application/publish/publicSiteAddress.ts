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
export const DEFAULT_PUBLIC_SITES_CONFIG: PublicSitesConfig = { urlMode: "path", publicDomain: "", sitesOrigin: "" };

export function resolvePublicSitesConfig(config: Pick<PlatformConfig, "publicSites"> | null | undefined): PublicSitesConfig {
    const stored = config?.publicSites;
    if (!stored) return { ...DEFAULT_PUBLIC_SITES_CONFIG };
    return {
        urlMode: stored.urlMode === "subdomain" ? "subdomain" : "path",
        publicDomain: (stored.publicDomain ?? "").trim().toLowerCase(),
        sitesOrigin: (stored.sitesOrigin ?? "").trim().replace(/\/+$/, ""),
    };
}

export interface AddressableDeployment {
    publishId: string;
    customSlug?: string | null;
}

/**
 * Subdomain mode: `https://{slug|publishId}.{publicDomain}` (absolute).
 * Path mode: `{sitesOrigin}/{slug}/`, or `{sitesOrigin}/p/{publishId}/` for a site without a slug.
 * Without a sitesOrigin the address is origin-relative — the client resolves it against its API
 * origin (a separate host on a split app/api deployment).
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
    const path = slug ? `/${slug}/` : `/p/${deployment.publishId}/`;
    return config.sitesOrigin ? `${config.sitesOrigin}${path}` : path;
}

// ── Site content is never executed on the app's origin ────────────────────────────────────────
//
// A published site runs code written by any user. On the app's own origin that code shares the
// app's storage — the session tokens in localStorage — so a site opened by a logged-in superadmin
// could act as them. Requests for site content that arrive on an app host are therefore redirected
// to the site's own address, or refused when the installation has none to offer.

/** Hostnames of the app's own origins, from CORS_ORIGIN ("*" or unset: none known, e.g. local dev). */
export function appHostnames(corsOrigin: string | undefined): string[] {
    return (corsOrigin ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry && entry !== "*")
        .map((entry) => {
            try { return new URL(entry).hostname.toLowerCase(); } catch { return ""; }
        })
        .filter(Boolean);
}

export type SiteRequestDecision =
    | { action: "serve" }
    | { action: "redirect"; location: string }
    | { action: "refuse"; reason: string };

/**
 * `sitePath` is the part of the request after the site's own prefix (`/{slug}` or `/p/{id}`),
 * query string included — "/" for the index, "/style.css", "/data/rows.json".
 */
export function decideSiteRequest(input: {
    requestHostname: string;
    appHosts: string[];
    config: PublicSitesConfig;
    deployment: AddressableDeployment | null;
    publishId: string;
    sitePath: string;
}): SiteRequestDecision {
    const host = input.requestHostname.toLowerCase();

    // A configured sites origin is an allow-list, not a deny-list of app hosts: site content is
    // served on that host only, so an app hostname missing from CORS_ORIGIN (or CORS_ORIGIN="*")
    // cannot reopen same-origin execution. Every other host is sent to the same file there.
    if (input.config.urlMode === "path" && input.config.sitesOrigin) {
        const sitesHost = new URL(input.config.sitesOrigin).hostname.toLowerCase();
        // A sites origin on an app host is no separation at all: refuse rather than serve there.
        if (input.appHosts.includes(sitesHost)) {
            return { action: "refuse", reason: "the configured sites origin is an app host; set a separate host in /admin/config" };
        }
        if (host === sitesHost) return { action: "serve" };
        const target = resolvePublicSiteUrl(input.deployment ?? { publishId: input.publishId, customSlug: null }, input.config);
        const location = `${target.replace(/\/+$/, "")}${input.sitePath.startsWith("/") ? input.sitePath : `/${input.sitePath}`}`;
        return { action: "redirect", location };
    }

    if (!input.appHosts.includes(host)) return { action: "serve" };

    const target = resolvePublicSiteUrl(input.deployment ?? { publishId: input.publishId, customSlug: null }, input.config);
    if (/^https?:\/\//i.test(target)) {
        const base = target.replace(/\/+$/, "");
        const location = `${base}${input.sitePath.startsWith("/") ? input.sitePath : `/${input.sitePath}`}`;
        if (new URL(location).hostname.toLowerCase() !== host) return { action: "redirect", location };
    }
    return {
        action: "refuse",
        reason: "published sites are not served on the app origin; set a sites origin (path mode) or a public domain (subdomain mode) in /admin/config",
    };
}
