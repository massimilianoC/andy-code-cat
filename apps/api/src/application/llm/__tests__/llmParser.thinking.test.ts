import { describe, expect, it } from "vitest";

import { tryParseStructuredJson } from "../llmParser";

const finalJson = JSON.stringify({
    chat: {
        summary: "Done",
        bullets: [],
        nextActions: [],
    },
    artifacts: {
        html: "<main>Final artifact</main>",
        css: "",
        js: "",
    },
});

describe("tryParseStructuredJson MiniMax thinking handling", () => {
    it("parses the final artifact after a leading think block", () => {
        const result = tryParseStructuredJson(
            `<think>Draft only: {"artifacts":{"html":"<main>Wrong draft</main>"}}</think>${finalJson}`,
        );

        expect(result.parseValid).toBe(true);
        expect(result.structured?.artifacts.html).toBe("<main>Final artifact</main>");
    });

    it("does not salvage draft JSON from an unfinished think block", () => {
        const result = tryParseStructuredJson(
            '<think>Still planning: {"chat":{"summary":"Draft"},"artifacts":{"html":"<main>Wrong draft</main>","css":"","js":""}}',
        );

        expect(result.parseValid).toBe(false);
        expect(result.structured).toBeNull();
    });

    it("normalizes strict-schema null optionals in media manifests", () => {
        const result = tryParseStructuredJson(JSON.stringify({
            chat: { summary: "Done", bullets: [], nextActions: [] },
            artifacts: { html: "<main>Final artifact</main>", css: "", js: "" },
            mediaManifest: {
                version: "media-manifest-v1",
                requests: [{
                    key: "hero-main",
                    kind: "background",
                    role: "hero",
                    sourceStrategy: "stock",
                    semanticQuery: "modern office",
                    generationPrompt: null,
                    alt: "Modern office",
                    width: null,
                    height: null,
                    aspectRatio: null,
                    priority: 10,
                    constraints: null,
                    context: null,
                }],
            },
            focusPatch: null,
        }));

        expect(result.parseValid).toBe(true);
        expect(result.structured?.mediaManifest?.requests[0]).toEqual(expect.objectContaining({
            key: "hero-main",
            semanticQuery: "modern office",
        }));
    });
});
