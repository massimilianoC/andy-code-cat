import { describe, expect, it } from "vitest";
import { tryParseStructuredJson } from "../llmParser";

const BASE_REQUEST = {
    key: "hero-main",
    kind: "image",
    role: "hero",
    sourceStrategy: "stock",
    semanticQuery: "creative design studio",
    alt: "Creative studio",
    priority: 10,
};

describe("llmParser mediaManifest", () => {
    it("preserves valid mediaManifest at root level", () => {
        const raw = JSON.stringify({
            chat: { summary: "Generated page", bullets: [], nextActions: [] },
            artifacts: {
                html: '<img src="asset://media/hero-main" alt="Creative studio">',
                css: "",
                js: "",
            },
            mediaManifest: {
                version: "media-manifest-v1",
                requests: [BASE_REQUEST],
            },
        });

        const parsed = tryParseStructuredJson(raw);

        expect(parsed.parseValid).toBe(true);
        expect(parsed.structured?.mediaManifest?.requests[0]?.key).toBe("hero-main");
        expect(parsed.structured?.mediaManifest?.requests[0]?.semanticQuery).toBe("creative design studio");
    });

    it("rescues mediaManifest placed inside artifacts (MiniMax / wrong-key LLM behavior)", () => {
        // Some models (e.g. MiniMax M2.5) put the manifest inside artifacts instead of at root.
        const raw = JSON.stringify({
            chat: { summary: "Generated page", bullets: [], nextActions: [] },
            artifacts: {
                html: '<img src="asset://media/hero-acoustic" alt="Acoustic panels">',
                css: "",
                js: "",
                mediaManifest: {
                    version: "media-manifest-v1",
                    requests: [{
                        ...BASE_REQUEST,
                        key: "hero-acoustic",
                        semanticQuery: "acoustic panels studio wall treatment",
                        alt: "Acoustic panels",
                    }],
                },
            },
            // mediaManifest NOT at root — the fix should rescue it from artifacts
        });

        const parsed = tryParseStructuredJson(raw);

        expect(parsed.parseValid).toBe(true);
        expect(parsed.structured?.mediaManifest?.requests[0]?.key).toBe("hero-acoustic");
        expect(parsed.structured?.mediaManifest?.requests[0]?.semanticQuery).toBe("acoustic panels studio wall treatment");
    });

    it("rescues mediaManifest emitted as a JSON-encoded STRING (double-encoded)", () => {
        // Real MiniMax case seen in Mongo: artifacts.mediaManifest is a JSON string, not an object.
        const manifestString = JSON.stringify({
            version: "media-manifest-v1",
            requests: [{
                ...BASE_REQUEST,
                key: "hero-acoustic",
                semanticQuery: "acoustic panels studio wall",
                alt: "Acoustic panels",
            }],
        });
        const raw = JSON.stringify({
            chat: { summary: "Generated page", bullets: [], nextActions: [] },
            artifacts: {
                html: '<img src="asset://media/hero-acoustic" alt="Acoustic panels">',
                css: "",
                js: "",
                mediaManifest: manifestString, // <-- string, not object
            },
        });

        const parsed = tryParseStructuredJson(raw);

        expect(parsed.parseValid).toBe(true);
        expect(parsed.structured?.mediaManifest?.requests[0]?.key).toBe("hero-acoustic");
    });

    it("rescues a root-level mediaManifest emitted as a JSON string", () => {
        const raw = JSON.stringify({
            chat: { summary: "Generated page", bullets: [], nextActions: [] },
            artifacts: { html: '<img src="asset://media/hero-main">', css: "", js: "" },
            mediaManifest: JSON.stringify({ version: "media-manifest-v1", requests: [BASE_REQUEST] }),
        });

        const parsed = tryParseStructuredJson(raw);

        expect(parsed.parseValid).toBe(true);
        expect(parsed.structured?.mediaManifest?.requests[0]?.key).toBe("hero-main");
    });

    it("tolerates extra unknown fields added by LLM (no strict rejection)", () => {
        const raw = JSON.stringify({
            chat: { summary: "Generated page", bullets: [], nextActions: [] },
            artifacts: { html: '<img src="asset://media/hero-main">', css: "", js: "" },
            mediaManifest: {
                version: "media-manifest-v1",
                requests: [{
                    ...BASE_REQUEST,
                    // Extra fields that LLMs commonly add — must not fail validation
                    description: "A creative team working together",
                    caption: "Hero image",
                    tags: ["studio", "creative"],
                }],
            },
        });

        const parsed = tryParseStructuredJson(raw);

        expect(parsed.parseValid).toBe(true);
        // Unknown fields are stripped, known fields preserved
        expect(parsed.structured?.mediaManifest?.requests[0]?.key).toBe("hero-main");
    });

    it("drops malformed mediaManifest silently (warn, do not throw)", () => {
        const raw = JSON.stringify({
            chat: { summary: "Generated page", bullets: [], nextActions: [] },
            artifacts: { html: '<section data-media-key="hero-bg"></section>', css: "", js: "" },
            mediaManifest: {
                version: "media-manifest-v1",
                requests: [{ key: "INVALID KEY WITH SPACES" }], // invalid key format
            },
        });

        // Should not throw — invalid manifest is dropped, parseValid is still true for the artifact
        expect(() => tryParseStructuredJson(raw)).not.toThrow();
        const parsed = tryParseStructuredJson(raw);
        expect(parsed.parseValid).toBe(true);
        // Manifest was invalid so it should be undefined
        expect(parsed.structured?.mediaManifest).toBeUndefined();
    });
});
