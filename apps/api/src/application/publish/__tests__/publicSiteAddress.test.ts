import { describe, it, expect } from "vitest";
import { publicSitesConfigSchema } from "@andy-code-cat/contracts";
import {
    appHostnames,
    decideSiteRequest,
    DEFAULT_PUBLIC_SITES_CONFIG,
    resolvePublicSitesConfig,
    resolvePublicSiteUrl,
} from "../publicSiteAddress";

const withSlug = { publishId: "ab12cd34", customSlug: "antares" };
const withoutSlug = { publishId: "ab12cd34", customSlug: null };

describe("resolvePublicSiteUrl — the one address rule", () => {
    it("path mode: /{slug}/ for a slugged site, /p/{publishId}/ otherwise (origin-relative)", () => {
        const cfg = { urlMode: "path" as const, publicDomain: "", sitesOrigin: "" };
        expect(resolvePublicSiteUrl(withSlug, cfg)).toBe("/antares/");
        expect(resolvePublicSiteUrl(withoutSlug, cfg)).toBe("/p/ab12cd34/");
    });

    it("path mode ignores a stored domain — the address follows the installation's own origin", () => {
        const cfg = { urlMode: "path" as const, publicDomain: "old-domain.example", sitesOrigin: "" };
        expect(resolvePublicSiteUrl(withSlug, cfg)).toBe("/antares/");
    });

    it("subdomain mode: https://{slug|publishId}.{domain}", () => {
        const cfg = { urlMode: "subdomain" as const, publicDomain: "sitowebinun.click", sitesOrigin: "" };
        expect(resolvePublicSiteUrl(withSlug, cfg)).toBe("https://antares.sitowebinun.click");
        expect(resolvePublicSiteUrl(withoutSlug, cfg)).toBe("https://ab12cd34.sitowebinun.click");
    });

    it("subdomain mode without a domain (document edited outside the API) is addressed by path", () => {
        expect(resolvePublicSiteUrl(withSlug, { urlMode: "subdomain", publicDomain: "", sitesOrigin: "" })).toBe("/antares/");
    });

    it("an empty or whitespace slug counts as no slug", () => {
        expect(resolvePublicSiteUrl({ publishId: "ab12cd34", customSlug: "  " }, DEFAULT_PUBLIC_SITES_CONFIG)).toBe("/p/ab12cd34/");
    });
});

describe("resolvePublicSitesConfig", () => {
    it("defaults to path mode when the setting was never saved", () => {
        expect(resolvePublicSitesConfig(null)).toEqual({ urlMode: "path", publicDomain: "", sitesOrigin: "" });
        expect(resolvePublicSitesConfig({ publicSites: undefined })).toEqual({ urlMode: "path", publicDomain: "", sitesOrigin: "" });
    });

    it("normalises the stored domain", () => {
        expect(resolvePublicSitesConfig({ publicSites: { urlMode: "subdomain", publicDomain: " Example.COM ", sitesOrigin: "https://sites.example.com/" } }))
            .toEqual({ urlMode: "subdomain", publicDomain: "example.com", sitesOrigin: "https://sites.example.com" });
    });
});

describe("publicSitesConfigSchema — what the superadmin can save", () => {
    it("accepts path mode with or without a domain", () => {
        expect(publicSitesConfigSchema.safeParse({ urlMode: "path", publicDomain: "" }).success).toBe(true);
        expect(publicSitesConfigSchema.safeParse({ urlMode: "path" }).success).toBe(true);
    });

    it("accepts subdomain mode only with a bare public domain", () => {
        expect(publicSitesConfigSchema.safeParse({ urlMode: "subdomain", publicDomain: "sitowebinun.click" }).success).toBe(true);
        for (const bad of ["", "localhost", "andy.camillucci.com:8443", "https://example.com", "example.com/sites", "dev.localhost", "nodot"]) {
            expect(publicSitesConfigSchema.safeParse({ urlMode: "subdomain", publicDomain: bad }).success, bad).toBe(false);
        }
    });

    it("rejects an unknown mode", () => {
        expect(publicSitesConfigSchema.safeParse({ urlMode: "folder", publicDomain: "" }).success).toBe(false);
    });
});

describe("path mode with a separate sites origin", () => {
    const cfg = { urlMode: "path" as const, publicDomain: "", sitesOrigin: "https://siti.camillucci.com:8443" };

    it("addresses sites on the sites origin", () => {
        expect(resolvePublicSiteUrl(withSlug, cfg)).toBe("https://siti.camillucci.com:8443/antares/");
        expect(resolvePublicSiteUrl(withoutSlug, cfg)).toBe("https://siti.camillucci.com:8443/p/ab12cd34/");
    });

    it("rejects a sites origin with a path, a non-http scheme or no scheme", () => {
        for (const bad of ["https://siti.example.com/x", "ftp://siti.example.com", "siti.example.com"]) {
            expect(publicSitesConfigSchema.safeParse({ urlMode: "path", sitesOrigin: bad }).success, bad).toBe(false);
        }
        expect(publicSitesConfigSchema.parse({ urlMode: "path", sitesOrigin: "https://siti.example.com:8443/" }).sitesOrigin)
            .toBe("https://siti.example.com:8443");
    });
});

describe("decideSiteRequest — site code never runs on the app origin", () => {
    const appHosts = appHostnames("https://andy.camillucci.com:8443");
    const path = { urlMode: "path" as const, publicDomain: "", sitesOrigin: "https://siti.camillucci.com:8443" };

    it("reads app hostnames from CORS_ORIGIN, ignoring * and garbage", () => {
        expect(appHostnames("https://app.example.com, https://admin.example.com:8443")).toEqual(["app.example.com", "admin.example.com"]);
        expect(appHostnames("*")).toEqual([]);
        expect(appHostnames(undefined)).toEqual([]);
        expect(appHostnames("not a url")).toEqual([]);
    });

    it("serves on any host that is not an app host", () => {
        expect(decideSiteRequest({ requestHostname: "siti.camillucci.com", appHosts, config: path, deployment: withSlug, publishId: "ab12cd34", sitePath: "/" }))
            .toEqual({ action: "serve" });
        const noOrigin = { urlMode: "path" as const, publicDomain: "", sitesOrigin: "" };
        expect(decideSiteRequest({ requestHostname: "anything", appHosts: [], config: noOrigin, deployment: withSlug, publishId: "ab12cd34", sitePath: "/" }))
            .toEqual({ action: "serve" });
    });

    it("with a sites origin, only the sites host serves — any other host (even one missing from CORS_ORIGIN) is redirected", () => {
        expect(decideSiteRequest({ requestHostname: "forgotten-alias.example", appHosts: [], config: path, deployment: withSlug, publishId: "ab12cd34", sitePath: "/x.css" }))
            .toEqual({ action: "redirect", location: "https://siti.camillucci.com:8443/antares/x.css" });
    });

    it("redirects an app-host request to the same file on the site's own address — old links keep working", () => {
        expect(decideSiteRequest({ requestHostname: "andy.camillucci.com", appHosts, config: path, deployment: withSlug, publishId: "ab12cd34", sitePath: "/" }))
            .toEqual({ action: "redirect", location: "https://siti.camillucci.com:8443/antares/" });
        expect(decideSiteRequest({ requestHostname: "andy.camillucci.com", appHosts, config: path, deployment: withSlug, publishId: "ab12cd34", sitePath: "/style.css?v=1" }))
            .toEqual({ action: "redirect", location: "https://siti.camillucci.com:8443/antares/style.css?v=1" });
        expect(decideSiteRequest({ requestHostname: "andy.camillucci.com", appHosts, config: path, deployment: withoutSlug, publishId: "ab12cd34", sitePath: "/data/rows.json" }))
            .toEqual({ action: "redirect", location: "https://siti.camillucci.com:8443/p/ab12cd34/data/rows.json" });
    });

    it("redirects to the subdomain in subdomain mode", () => {
        const sub = { urlMode: "subdomain" as const, publicDomain: "sitowebinun.click", sitesOrigin: "" };
        expect(decideSiteRequest({ requestHostname: "app.sitowebinun.click", appHosts: ["app.sitowebinun.click"], config: sub, deployment: withSlug, publishId: "ab12cd34", sitePath: "/" }))
            .toEqual({ action: "redirect", location: "https://antares.sitowebinun.click/" });
    });

    it("refuses on the app host when the installation has no separate address to send it to", () => {
        const noOrigin = { urlMode: "path" as const, publicDomain: "", sitesOrigin: "" };
        expect(decideSiteRequest({ requestHostname: "andy.camillucci.com", appHosts, config: noOrigin, deployment: withSlug, publishId: "ab12cd34", sitePath: "/" }).action)
            .toBe("refuse");
        const sameHost = { urlMode: "path" as const, publicDomain: "", sitesOrigin: "https://andy.camillucci.com:8443" };
        expect(decideSiteRequest({ requestHostname: "andy.camillucci.com", appHosts, config: sameHost, deployment: withSlug, publishId: "ab12cd34", sitePath: "/" }).action)
            .toBe("refuse");
    });
});
