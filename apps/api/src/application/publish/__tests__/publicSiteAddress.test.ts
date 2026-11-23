import { describe, it, expect } from "vitest";
import { publicSitesConfigSchema } from "@andy-code-cat/contracts";
import {
    DEFAULT_PUBLIC_SITES_CONFIG,
    resolvePublicSitesConfig,
    resolvePublicSiteUrl,
} from "../publicSiteAddress";

const withSlug = { publishId: "ab12cd34", customSlug: "antares" };
const withoutSlug = { publishId: "ab12cd34", customSlug: null };

describe("resolvePublicSiteUrl — the one address rule", () => {
    it("path mode: /{slug}/ for a slugged site, /p/{publishId}/ otherwise (origin-relative)", () => {
        const cfg = { urlMode: "path" as const, publicDomain: "" };
        expect(resolvePublicSiteUrl(withSlug, cfg)).toBe("/antares/");
        expect(resolvePublicSiteUrl(withoutSlug, cfg)).toBe("/p/ab12cd34/");
    });

    it("path mode ignores a stored domain — the address follows the installation's own origin", () => {
        const cfg = { urlMode: "path" as const, publicDomain: "old-domain.example" };
        expect(resolvePublicSiteUrl(withSlug, cfg)).toBe("/antares/");
    });

    it("subdomain mode: https://{slug|publishId}.{domain}", () => {
        const cfg = { urlMode: "subdomain" as const, publicDomain: "sitowebinun.click" };
        expect(resolvePublicSiteUrl(withSlug, cfg)).toBe("https://antares.sitowebinun.click");
        expect(resolvePublicSiteUrl(withoutSlug, cfg)).toBe("https://ab12cd34.sitowebinun.click");
    });

    it("subdomain mode without a domain (document edited outside the API) is addressed by path", () => {
        expect(resolvePublicSiteUrl(withSlug, { urlMode: "subdomain", publicDomain: "" })).toBe("/antares/");
    });

    it("an empty or whitespace slug counts as no slug", () => {
        expect(resolvePublicSiteUrl({ publishId: "ab12cd34", customSlug: "  " }, DEFAULT_PUBLIC_SITES_CONFIG)).toBe("/p/ab12cd34/");
    });
});

describe("resolvePublicSitesConfig", () => {
    it("defaults to path mode when the setting was never saved", () => {
        expect(resolvePublicSitesConfig(null)).toEqual({ urlMode: "path", publicDomain: "" });
        expect(resolvePublicSitesConfig({ publicSites: undefined })).toEqual({ urlMode: "path", publicDomain: "" });
    });

    it("normalises the stored domain", () => {
        expect(resolvePublicSitesConfig({ publicSites: { urlMode: "subdomain", publicDomain: " Example.COM " } }))
            .toEqual({ urlMode: "subdomain", publicDomain: "example.com" });
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
