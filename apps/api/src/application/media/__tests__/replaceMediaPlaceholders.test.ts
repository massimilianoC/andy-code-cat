import { describe, expect, it } from "vitest";
import { extractMediaPlaceholderKeys, replaceMediaPlaceholders } from "../replaceMediaPlaceholders";

describe("media placeholder helpers", () => {
    it("extracts unique media keys from HTML and CSS", () => {
        const keys = extractMediaPlaceholderKeys({
            html: '<img src="asset://media/hero-main"><section data-media-key="hero-bg"></section>',
            css: '.hero{background-image:url("asset://media/hero-bg")}',
        });

        expect(keys.sort()).toEqual(["hero-bg", "hero-main"]);
    });

    it("replaces placeholders in both HTML and CSS", () => {
        const replacements = new Map([
            ["hero-main", "http://api.test/p/media/asset-1"],
            ["hero-bg", "http://api.test/p/media/asset-2"],
        ]);

        const result = replaceMediaPlaceholders({
            html: '<img src="asset://media/hero-main">',
            css: '.hero{background-image:url("asset://media/hero-bg")}',
            js: "",
        }, replacements);

        expect(result.artifacts.html).toContain("http://api.test/p/media/asset-1");
        expect(result.artifacts.css).toContain("http://api.test/p/media/asset-2");
        expect(result.unresolvedKeys).toEqual([]);
    });

    it("preserves media keys on inline image placeholders so edit regeneration can use keyed route", () => {
        const result = replaceMediaPlaceholders({
            html: '<img src="asset://media/hero-main" alt="Hero">',
            css: "",
            js: "",
        }, new Map([["hero-main", "http://api.test/p/media/asset-1"]]));

        expect(result.artifacts.html).toContain('src="http://api.test/p/media/asset-1"');
        expect(result.artifacts.html).toContain('data-media-key="hero-main"');
        expect(result.unresolvedKeys).toEqual([]);
    });

    it("does not overwrite an existing media key marker", () => {
        const result = replaceMediaPlaceholders({
            html: '<img src="asset://media/hero-main" data-media-key="existing-key" alt="Hero">',
            css: "",
            js: "",
        }, new Map([["hero-main", "http://api.test/p/media/asset-1"]]));

        expect(result.artifacts.html).toContain('data-media-key="existing-key"');
        expect(result.artifacts.html).not.toContain('data-media-key="hero-main"');
    });
});
