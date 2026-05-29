import type { ImageSearchParams, ImageSearchResult } from "./types";

const PIXABAY_PHOTO_API = "https://pixabay.com/api/";
const PIXABAY_VIDEO_API = "https://pixabay.com/api/videos/";

interface PixabayPhotoHit {
    largeImageURL: string;
    webformatURL: string;
    imageWidth: number;
    imageHeight: number;
    user: string;
}

interface PixabayVideoVariant {
    url: string;
    width: number;
    height: number;
}

interface PixabayVideoHit {
    videos: { large: PixabayVideoVariant; medium: PixabayVideoVariant; small: PixabayVideoVariant };
    user: string;
}

/**
 * Pixabay connector — photo and video search.
 * Requires PIXABAY_API_KEY env var (100 req/min free, CC0 license).
 * Photo endpoint: https://pixabay.com/api/
 * Video endpoint: https://pixabay.com/api/videos/
 */
export async function searchPixabay(
    params: ImageSearchParams,
    apiKey: string,
): Promise<ImageSearchResult | null> {
    const { query, width = 800, type = "photo", perPage = 3, resultIndex = 0 } = params;

    const base = type === "video" ? PIXABAY_VIDEO_API : PIXABAY_PHOTO_API;
    const url =
        `${base}?key=${apiKey}` +
        `&q=${encodeURIComponent(query)}` +
        `&per_page=${perPage}` +
        (type === "photo" ? "&image_type=photo&orientation=horizontal" : "");

    const res = await fetch(url);
    if (!res.ok) return null;

    if (type === "video") {
        const json = (await res.json()) as { hits: PixabayVideoHit[] };
        const hit = json.hits?.[Math.max(0, Math.min(resultIndex, json.hits.length - 1))];
        if (!hit) return null;
        const variant =
            hit.videos.large?.url
                ? hit.videos.large
                : hit.videos.medium?.url
                    ? hit.videos.medium
                    : hit.videos.small;
        if (!variant?.url) return null;
        return {
            url: variant.url,
            attribution: `Pixabay — ${hit.user}`,
            width: variant.width,
            height: variant.height,
            mediaType: "video",
        };
    }

    const json = (await res.json()) as { hits: PixabayPhotoHit[] };
    const hit = json.hits?.[Math.max(0, Math.min(resultIndex, json.hits.length - 1))];
    if (!hit) return null;

    const src = width >= 1000 ? hit.largeImageURL : hit.webformatURL;
    return {
        url: src,
        attribution: `Pixabay — ${hit.user}`,
        width: hit.imageWidth,
        height: hit.imageHeight,
        mediaType: "photo",
    };
}
