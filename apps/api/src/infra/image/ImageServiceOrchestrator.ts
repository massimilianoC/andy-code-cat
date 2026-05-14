import { env } from "../../config";
import type { ImageSearchParams, ImageSearchResult } from "./types";
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
    const { query, width = 800, height = 600 } = params;

    const pexelsKey = keyOverrides.pexels ?? (env.hasPexelsApiKey ? env.PEXELS_API_KEY : undefined);
    const pixabayKey = keyOverrides.pixabay ?? (env.hasPixabayApiKey ? env.PIXABAY_API_KEY : undefined);
    const unsplashKey = keyOverrides.unsplash ?? (env.hasUnsplashApiKey ? env.UNSPLASH_ACCESS_KEY : undefined);

    // 1. Pexels
    if (pexelsKey) {
        try {
            const result = await searchPexels(params, pexelsKey);
            if (result) return result;
        } catch {
            // fall through
        }
    }

    // 2. Pixabay (photos only via fallback — video is explicit caller choice)
    if (pixabayKey && params.type !== "video") {
        try {
            const result = await searchPixabay(params, pixabayKey);
            if (result) return result;
        } catch {
            // fall through
        }
    }

    // 3. Unsplash
    if (unsplashKey && params.type !== "video") {
        try {
            const result = await searchUnsplash(params, unsplashKey);
            if (result) return result;
        } catch {
            // fall through
        }
    }

    // 4. LoremFlickr — always available for photos
    if (params.type !== "video") {
        const result = await searchLoremFlickr(params);
        if (result) return result;
    }

    // 5. Picsum last resort (deterministic, non-semantic)
    const seed = encodeURIComponent(query.replace(/\s+/g, "-").toLowerCase());
    return {
        url: `https://picsum.photos/seed/${seed}/${width}/${height}`,
        attribution: "Lorem Picsum",
        width,
        height,
        mediaType: "photo",
    };
}
