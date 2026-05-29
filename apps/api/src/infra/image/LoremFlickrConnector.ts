import type { ImageSearchParams, ImageSearchResult } from "./types";

/**
 * LoremFlickr — free, no-API-key, semantically matched photos from Flickr CC0.
 * Always available as primary fallback when no paid key is present.
 * Endpoint: https://loremflickr.com/{W}/{H}/{keyword}
 */
export async function searchLoremFlickr(params: ImageSearchParams): Promise<ImageSearchResult | null> {
    const { query, width = 800, height = 600, resultIndex = 0 } = params;
    const keyword = encodeURIComponent(query.split(" ")[0] ?? "nature");
    const lock = Number.isFinite(resultIndex) && resultIndex > 0 ? `?lock=${Math.floor(resultIndex)}` : "";
    const url = `https://loremflickr.com/${width}/${height}/${keyword}${lock}`;
    return {
        url,
        attribution: "LoremFlickr (Flickr CC0)",
        width,
        height,
        mediaType: "photo",
    };
}
