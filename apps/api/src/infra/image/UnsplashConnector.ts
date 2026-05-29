import type { ImageSearchParams, ImageSearchResult } from "./types";

const UNSPLASH_SEARCH_API = "https://api.unsplash.com/search/photos";

interface UnsplashPhotoHit {
    urls: { full: string; regular: string; small: string };
    user: { name: string };
    width: number;
    height: number;
}

/**
 * Unsplash connector — photo search only (no video).
 * Requires UNSPLASH_ACCESS_KEY env var (50 req/h free).
 * Endpoint: https://api.unsplash.com/search/photos
 */
export async function searchUnsplash(
    params: ImageSearchParams,
    accessKey: string,
): Promise<ImageSearchResult | null> {
    const { query, width = 800, perPage = 1, resultIndex = 0 } = params;

    const url =
        `${UNSPLASH_SEARCH_API}?query=${encodeURIComponent(query)}` +
        `&per_page=${perPage}&orientation=landscape`;

    const res = await fetch(url, {
        headers: { Authorization: `Client-ID ${accessKey}` },
    });

    if (!res.ok) return null;

    const json = (await res.json()) as { results: UnsplashPhotoHit[] };
    const hit = json.results?.[Math.max(0, Math.min(resultIndex, json.results.length - 1))];
    if (!hit) return null;

    const src =
        width >= 1200 ? hit.urls.full : width >= 600 ? hit.urls.regular : hit.urls.small;

    return {
        url: src,
        attribution: `Unsplash — ${hit.user.name}`,
        width: hit.width,
        height: hit.height,
        mediaType: "photo",
    };
}
