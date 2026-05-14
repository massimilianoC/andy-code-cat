export type ImageMediaType = "photo" | "video";

export interface ImageSearchParams {
    query: string;
    width?: number;
    height?: number;
    type?: ImageMediaType;
    perPage?: number;
}

export interface ImageSearchResult {
    /** Direct URL ready to embed in HTML */
    url: string;
    /** Human-readable attribution text (connector name + author if available) */
    attribution: string;
    /** Width in px, if known */
    width?: number;
    /** Height in px, if known */
    height?: number;
    mediaType: ImageMediaType;
}
