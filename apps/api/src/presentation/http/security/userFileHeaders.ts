import type { Response } from "express";

/**
 * Headers for bytes a user uploaded (project media, brand assets).
 *
 * The MIME type of an upload is the one the client declared, so it must never decide whether the
 * browser executes the file. Served on the app's origin, a `text/html` or `text/javascript` upload
 * rendered inline would run with access to the app's session (tokens live in localStorage).
 *
 * - Only passive types are shown inline; everything else is a download (`attachment`), and
 *   script-capable types lose their type (`application/octet-stream`).
 * - SVG keeps its type so `<img src>` still works, but navigating to it downloads it, and the
 *   sandbox CSP below keeps any script inside it inert even if it is rendered.
 * - `nosniff` stops the browser from second-guessing the type.
 * - `Content-Security-Policy: sandbox` gives a rendered response an opaque origin with no script.
 *   PDF is exempt: Chrome's built-in viewer refuses to render under a sandbox CSP, and PDF script
 *   runs in the viewer, not in the page's origin.
 */
const INLINE_PASSIVE_TYPES = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon",
    "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav",
    "application/pdf",
]);
const KEEP_TYPE_AS_DOWNLOAD = new Set(["image/svg+xml"]);

export const USER_FILE_CSP = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

export function userFileDisposition(declaredMimeType: string | null | undefined): { contentType: string; inline: boolean; sandbox: boolean } {
    const mime = String(declaredMimeType ?? "").toLowerCase().split(";")[0]!.trim();
    if (INLINE_PASSIVE_TYPES.has(mime)) return { contentType: mime, inline: true, sandbox: mime !== "application/pdf" };
    if (KEEP_TYPE_AS_DOWNLOAD.has(mime)) return { contentType: mime, inline: false, sandbox: true };
    return { contentType: "application/octet-stream", inline: false, sandbox: true };
}

/** Public, navigable responses (e.g. /p/media/:assetId): type, disposition, nosniff and CSP. */
export function setPublicUserFileHeaders(res: Response, declaredMimeType: string | null | undefined, filename: string): void {
    const decision = userFileDisposition(declaredMimeType);
    res.setHeader("Content-Type", decision.contentType);
    res.setHeader("Content-Disposition", `${decision.inline ? "inline" : "attachment"}; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (decision.sandbox) {
        res.removeHeader("Content-Security-Policy");
        res.setHeader("Content-Security-Policy", USER_FILE_CSP);
    }
}

/**
 * Authenticated downloads (bearer token, fetched by the app, never navigable as a document): the
 * declared type is kept because the app reads these bytes (preview data URIs, document text), but
 * nosniff and the sandbox CSP make a rendered response inert as defence in depth.
 */
export function setAuthenticatedUserFileHeaders(res: Response, declaredMimeType: string | null | undefined): void {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (userFileDisposition(declaredMimeType).sandbox) {
        res.removeHeader("Content-Security-Policy");
        res.setHeader("Content-Security-Policy", USER_FILE_CSP);
    }
}
