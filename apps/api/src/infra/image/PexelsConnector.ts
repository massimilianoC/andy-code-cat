import type { ImageSearchParams, ImageSearchResult } from "./types";

const PEXELS_PHOTO_API = "https://api.pexels.com/v1/search";
const PEXELS_VIDEO_API = "https://api.pexels.com/videos/search";

interface PexelsPhotoHit {
    src: { original: string; large2x: string; large: string; medium: string };
    photographer: string;
    width: number;
    height: number;
}

interface PexelsVideoFile {
    link: string;
    width: number;
    height: number;
    quality: string;
}

interface PexelsVideoHit {
    video_files: PexelsVideoFile[];
    user: { name: string };
    width: number;
    height: number;
}

/**
 * Pexels connector — photo and video search.
 * Requires PEXELS_API_KEY env var (200 req/h free, no credit card).
 * Photo endpoint: https://api.pexels.com/v1/search
 * Video endpoint: https://api.pexels.com/videos/search
 */
export async function searchPexels(
    params: ImageSearchParams,
    apiKey: string,
): Promise<ImageSearchResult | null> {
    const { query, width = 800, height = 600, type = "photo", perPage = 1 } = params;

    const base = type === "video" ? PEXELS_VIDEO_API : PEXELS_PHOTO_API;
    const url = `${base}?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;

    const res = await fetch(url, {
        headers: { Authorization: apiKey },
    });

    if (!res.ok) return null;

    if (type === "video") {
        const json = (await res.json()) as { videos: PexelsVideoHit[] };
        const hit = json.videos?.[0];
        if (!hit) return null;
        // Prefer HD file
        const file =
            hit.video_files.find((f) => f.quality === "hd") ??
            hit.video_files[0];
        if (!file) return null;
        return {
            url: file.link,
            attribution: `Pexels — ${hit.user.name}`,
            width: file.width ?? hit.width,
            height: file.height ?? hit.height,
            mediaType: "video",
        };
    }

    const json = (await res.json()) as { photos: PexelsPhotoHit[] };
    const hit = json.photos?.[0];
    if (!hit) return null;

    // Pick the best-fit size
    const src =
        width >= 1200
            ? hit.src.large2x
            : width >= 800
                ? hit.src.large
                : hit.src.medium;

    return {
        url: src,
        attribution: `Pexels — ${hit.photographer}`,
        width: hit.width,
        height: hit.height,
        mediaType: "photo",
    };
}
