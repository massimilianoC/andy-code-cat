import { downloadProjectAssetDataUrl } from "@/lib/api";

const PROJECT_ASSET_DOWNLOAD_PATH_RE = /\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/download(?:$|\?)/i;
const PUBLIC_MEDIA_PATH_RE = /\/p\/media\/([^/?#]+)/i;
const ARTIFACT_URL_RE = /(?:https?:\/\/[^"'()\s]+|\/(?:p\/media|v1\/projects)\/[^"'()\s]+)/gi;

export function parseProtectedAssetDownloadUrl(rawSrc: string): { projectId: string; assetId: string } | null {
    const trimmed = String(rawSrc ?? "").trim();
    if (!trimmed || typeof window === "undefined") return null;
    try {
        const match = new URL(trimmed, window.location.origin).pathname.match(PROJECT_ASSET_DOWNLOAD_PATH_RE);
        if (!match?.[1] || !match?.[2]) return null;
        return { projectId: decodeURIComponent(match[1]), assetId: decodeURIComponent(match[2]) };
    } catch {
        return null;
    }
}

function parsePublicMediaUrl(rawSrc: string): { assetId: string } | null {
    const trimmed = String(rawSrc ?? "").trim();
    if (!trimmed || typeof window === "undefined") return null;
    try {
        const match = new URL(trimmed, window.location.origin).pathname.match(PUBLIC_MEDIA_PATH_RE);
        return match?.[1] ? { assetId: decodeURIComponent(match[1]) } : null;
    } catch {
        return null;
    }
}

export async function resolvePreviewAssetUrls(input: {
    html: string;
    css: string;
    token: string;
    projectId: string;
}): Promise<{ html: string; css: string }> {
    const urls = Array.from(new Set(`${input.html}\n${input.css}`.match(ARTIFACT_URL_RE) ?? []));
    if (urls.length === 0) return { html: input.html, css: input.css };

    const replacements = new Map<string, string>();
    await Promise.all(urls.map(async (url) => {
        const protectedAsset = parseProtectedAssetDownloadUrl(url);
        const publicAsset = parsePublicMediaUrl(url);
        const assetId = protectedAsset?.assetId ?? publicAsset?.assetId;
        if (!assetId) return;
        try {
            const dataUrl = await downloadProjectAssetDataUrl(
                input.token,
                protectedAsset?.projectId ?? input.projectId,
                assetId,
            );
            if (dataUrl) replacements.set(url, dataUrl);
        } catch {
            // Preserve the source URL so preview rendering degrades without blocking.
        }
    }));

    let html = input.html;
    let css = input.css;
    for (const [from, to] of replacements) {
        html = html.split(from).join(to);
        css = css.split(from).join(to);
    }
    return { html, css };
}
