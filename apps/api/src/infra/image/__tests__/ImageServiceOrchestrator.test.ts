import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        hasPexelsApiKey: false,
        hasPixabayApiKey: false,
        hasUnsplashApiKey: false,
        PEXELS_API_KEY: undefined,
        PIXABAY_API_KEY: undefined,
        UNSPLASH_ACCESS_KEY: undefined,
    },
}));

import { resolveImageWithTrace } from "../ImageServiceOrchestrator";

describe("ImageServiceOrchestrator", () => {
    it("records skipped providers before the no-key LoremFlickr fallback", async () => {
        const result = await resolveImageWithTrace({ query: "modern office", width: 1200, height: 600 });

        expect(result.provider).toBe("loremflickr");
        expect(result.fallbackUsed).toBe(true);
        expect(result.url).toContain("https://loremflickr.com/1200/600/modern");
        expect(result.attemptedProviders.map((attempt) => `${attempt.provider}:${attempt.status}`)).toEqual([
            "pexels:skipped",
            "pixabay:skipped",
            "unsplash:skipped",
            "loremflickr:success",
        ]);
    });

    it("does not apply Picsum when configured provider order excludes it", async () => {
        await expect(resolveImageWithTrace(
            { query: "modern office", width: 1200, height: 600 },
            {},
            ["pexels"],
        )).rejects.toThrow("No stock image provider resolved");
    });
});
