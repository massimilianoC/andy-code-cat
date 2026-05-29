import { env } from "../../config";

const ALLOWED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
]);

const ALLOWED_HOST_SUFFIXES = [
    "pexels.com",
    "pixabay.com",
    "unsplash.com",
    "loremflickr.com",
    "flickr.com",
    "staticflickr.com",
    "picsum.photos",
];

export interface DownloadedExternalImage {
    buffer: Buffer;
    mimeType: string;
    bytes: number;
    finalUrl: string;
}

export interface ExternalImageDownloader {
    download(url: string): Promise<DownloadedExternalImage>;
}

export class FetchExternalImageDownloader implements ExternalImageDownloader {
    constructor(
        private readonly fetchImpl: typeof fetch = globalThis.fetch,
        private readonly timeoutMs = 10_000,
        private readonly maxBytes = Math.min(env.UPLOAD_MAX_SIZE_BYTES, 8 * 1024 * 1024),
    ) { }

    async download(url: string): Promise<DownloadedExternalImage> {
        const parsed = this.validateUrl(url);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const res = await this.fetchImpl(parsed.toString(), {
                redirect: "follow",
                signal: controller.signal,
            });

            if (!res.ok) {
                throw Object.assign(new Error(`Image download failed with HTTP ${res.status}`), { statusCode: 502 });
            }

            const finalUrl = res.url || parsed.toString();
            this.validateUrl(finalUrl);

            const rawContentType = res.headers.get("content-type") ?? "";
            const mimeType = rawContentType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
            if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
                throw Object.assign(new Error(`Unsupported image content-type: ${mimeType}`), { statusCode: 415 });
            }

            const contentLength = Number(res.headers.get("content-length") ?? 0);
            if (Number.isFinite(contentLength) && contentLength > this.maxBytes) {
                throw Object.assign(new Error("Image exceeds maximum allowed size"), { statusCode: 413 });
            }

            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            if (buffer.byteLength > this.maxBytes) {
                throw Object.assign(new Error("Image exceeds maximum allowed size"), { statusCode: 413 });
            }

            return {
                buffer,
                mimeType,
                bytes: buffer.byteLength,
                finalUrl,
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    private validateUrl(rawUrl: string): URL {
        let parsed: URL;
        try {
            parsed = new URL(rawUrl);
        } catch {
            throw Object.assign(new Error("Invalid image URL"), { statusCode: 400 });
        }

        if (parsed.protocol !== "https:") {
            throw Object.assign(new Error("Only HTTPS image URLs are allowed"), { statusCode: 400 });
        }

        const hostname = parsed.hostname.toLowerCase();
        const allowed = ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
        if (!allowed) {
            throw Object.assign(new Error(`Image host is not allowed: ${hostname}`), { statusCode: 400 });
        }

        return parsed;
    }
}
