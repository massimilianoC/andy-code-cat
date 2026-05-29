import { env } from "../../config";
import type { ImageProviderId, ImageResolutionAttempt, ImageSearchParams, ImageSearchResult, ResolvedImageSearchResult } from "./types";
import { searchPexels } from "./PexelsConnector";
import { searchPixabay } from "./PixabayConnector";
import { searchUnsplash } from "./UnsplashConnector";
import { searchLoremFlickr } from "./LoremFlickrConnector";

/** Optional key overrides that take priority over env vars.
 *  Populated from MongoDB ServiceApiKey records when a keyRepo is available. */
export interface ImageKeyOverrides {
    pexels?: string;
    pixabay?: string;
    unsplash?: string;
}

/**
 * Priority fallback chain for image resolution:
 *   1. Pexels  (keyOverrides.pexels OR env PEXELS_API_KEY)
 *   2. Pixabay (keyOverrides.pixabay OR env PIXABAY_API_KEY)
 *   3. Unsplash (keyOverrides.unsplash OR env UNSPLASH_ACCESS_KEY)
 *   4. LoremFlickr (always available, no key required)
 *   5. Picsum deterministic (last resort, non-semantic)
 *
 * keyOverrides allows callers to inject keys resolved from MongoDB so that
 * admin-managed keys take precedence over deployment env vars.
 * Each step is tried only if the previous returns null or throws.
 */
export async function resolveImage(
    params: ImageSearchParams,
    keyOverrides: ImageKeyOverrides = {},
): Promise<ImageSearchResult> {
    return resolveImageWithTrace(params, keyOverrides);
}

export async function resolveImageWithTrace(
    params: ImageSearchParams,
    keyOverrides: ImageKeyOverrides = {},
    providerOrder?: ImageProviderId[],
): Promise<ResolvedImageSearchResult> {
    const { query, width = 800, height = 600 } = params;
    const attempts: ImageResolutionAttempt[] = [];

    const pexelsKey = keyOverrides.pexels ?? (env.hasPexelsApiKey ? env.PEXELS_API_KEY : undefined);
    const pixabayKey = keyOverrides.pixabay ?? (env.hasPixabayApiKey ? env.PIXABAY_API_KEY : undefined);
    const unsplashKey = keyOverrides.unsplash ?? (env.hasUnsplashApiKey ? env.UNSPLASH_ACCESS_KEY : undefined);

    const order = providerOrder?.length
        ? providerOrder
        : ["pexels", "pixabay", "unsplash", "loremflickr", "picsum"] as ImageProviderId[];

    const success = (provider: ImageProviderId, result: ImageSearchResult): ResolvedImageSearchResult => ({
        ...result,
        provider,
        fallbackUsed: attempts.some((attempt) => attempt.status === "failed" || attempt.status === "skipped"),
        attemptedProviders: [...attempts, { provider, status: "success" }],
    });

    for (const provider of order) {
        if (provider === "pexels") {
            if (!pexelsKey) {
                attempts.push({ provider, status: "skipped", reason: "missing-api-key" });
                continue;
            }
            try {
                const result = await searchPexels(params, pexelsKey);
                if (result) return success(provider, result);
                attempts.push({ provider, status: "failed", reason: "no-result" });
            } catch (error) {
                attempts.push({ provider, status: "failed", reason: error instanceof Error ? error.message : "connector-error" });
            }
            continue;
        }

        if (provider === "pixabay") {
            if (params.type === "video") {
                attempts.push({ provider, status: "skipped", reason: "video-explicit-provider-only" });
                continue;
            }
            if (!pixabayKey) {
                attempts.push({ provider, status: "skipped", reason: "missing-api-key" });
                continue;
            }
            try {
                const result = await searchPixabay(params, pixabayKey);
                if (result) return success(provider, result);
                attempts.push({ provider, status: "failed", reason: "no-result" });
            } catch (error) {
                attempts.push({ provider, status: "failed", reason: error instanceof Error ? error.message : "connector-error" });
            }
            continue;
        }

        if (provider === "unsplash") {
            if (params.type === "video") {
                attempts.push({ provider, status: "skipped", reason: "photo-only-provider" });
                continue;
            }
            if (!unsplashKey) {
                attempts.push({ provider, status: "skipped", reason: "missing-api-key" });
                continue;
            }
            try {
                const result = await searchUnsplash(params, unsplashKey);
                if (result) return success(provider, result);
                attempts.push({ provider, status: "failed", reason: "no-result" });
            } catch (error) {
                attempts.push({ provider, status: "failed", reason: error instanceof Error ? error.message : "connector-error" });
            }
            continue;
        }

        if (provider === "loremflickr") {
            if (params.type === "video") {
                attempts.push({ provider, status: "skipped", reason: "photo-only-provider" });
                continue;
            }
            const result = await searchLoremFlickr(params);
            if (result) return success(provider, result);
            attempts.push({ provider, status: "failed", reason: "no-result" });
            continue;
        }

        if (provider === "picsum") {
            break;
        }
    }

    if (!order.includes("picsum")) {
        throw new Error(`No stock image provider resolved "${query}" from configured order: ${order.join(", ")}`);
    }

    const seed = encodeURIComponent(query.replace(/\s+/g, "-").toLowerCase());
    return {
        url: `https://picsum.photos/seed/${seed}/${width}/${height}`,
        attribution: "Lorem Picsum",
        width,
        height,
        mediaType: "photo",
        provider: "picsum",
        fallbackUsed: attempts.length > 0,
        attemptedProviders: [...attempts, { provider: "picsum", status: "success" }],
    };
}
