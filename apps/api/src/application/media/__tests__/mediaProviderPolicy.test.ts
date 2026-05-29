import { describe, expect, it } from "vitest";
import { buildStockProviderOrder, resolveMediaProviderPolicy } from "../mediaProviderPolicy";

describe("mediaProviderPolicy", () => {
    it("uses the default primary provider and explicit fallback chain", () => {
        const policy = resolveMediaProviderPolicy(null);

        expect(policy.stockImage.primaryProvider).toBe("pexels");
        expect(buildStockProviderOrder(policy)).toEqual([
            "pexels",
            "pixabay",
            "unsplash",
            "loremflickr",
            "picsum",
        ]);
    });

    it("disables fallbacks when configured by platform policy", () => {
        const policy = resolveMediaProviderPolicy({
            mediaProviderPolicy: {
                stockImage: {
                    primaryProvider: "pixabay",
                    fallbackEnabled: false,
                    fallbackProviders: ["loremflickr"],
                    allowPicsumFallback: false,
                },
            },
        });

        expect(buildStockProviderOrder(policy)).toEqual(["pixabay"]);
    });

    it("deduplicates fallback providers and removes the primary provider from fallback order", () => {
        const policy = resolveMediaProviderPolicy({
            mediaProviderPolicy: {
                stockImage: {
                    primaryProvider: "unsplash",
                    fallbackEnabled: true,
                    fallbackProviders: ["unsplash", "pixabay", "pixabay", "loremflickr", "picsum"],
                    allowPicsumFallback: false,
                },
            },
        });

        expect(buildStockProviderOrder(policy)).toEqual(["unsplash", "pixabay", "loremflickr"]);
    });
});
