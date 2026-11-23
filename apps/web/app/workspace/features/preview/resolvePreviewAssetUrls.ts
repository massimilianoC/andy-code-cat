import { downloadProjectAssetDataUrl } from "@/lib/api";

const PROJECT_ASSET_DOWNLOAD_PATH_RE = /\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/download(?:$|\?)/i;
const PUBLIC_MEDIA_PATH_RE = /\/p\/media\/([^/?#]+)/i;
const ARTIFACT_URL_RE = /(?:https?:\/\/[^"'()\s]+|\/(?:p\/media|v1\/projects)\/[^"'()\s]+)/gi;

/**
 * Ids taken from generated HTML go into an authenticated fetch, so they must be plain ids: a
 * decoded `%2F..%2F` would otherwise steer the bearer-token request to any API path and hand the
 * response to the sandboxed page as a data URI. Project ids are Mongo ObjectIds, asset ids UUIDs.
 */
const PROJECT_ID_RE = /^[a-f0-9]{24}$/i;
const ASSET_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function parseProtectedAssetDownloadUrl(rawSrc: string): { projectId: string; assetId: string } | null {
    const trimmed = String(rawSrc ?? "").trim();
    if (!trimmed || typeof window === "undefined") return null;
    try {
        const match = new URL(trimmed, window.location.origin).pathname.match(PROJECT_ASSET_DOWNLOAD_PATH_RE);
        if (!match?.[1] || !match?.[2]) return null;
        const projectId = decodeURIComponent(match[1]);
        const assetId = decodeURIComponent(match[2]);
        if (!PROJECT_ID_RE.test(projectId) || !ASSET_ID_RE.test(assetId)) return null;
        return { projectId, assetId };
    } catch {
        return null;
    }
}

function parsePublicMediaUrl(rawSrc: string): { assetId: string } | null {
    const trimmed = String(rawSrc ?? "").trim();
    if (!trimmed || typeof window === "undefined") return null;
    try {
        const match = new URL(trimmed, window.location.origin).pathname.match(PUBLIC_MEDIA_PATH_RE);
        if (!match?.[1]) return null;
        const assetId = decodeURIComponent(match[1]);
        return ASSET_ID_RE.test(assetId) ? { assetId } : null;
    } catch {
        return null;
    }
}

export async function resolvePreviewAssetUrls(input: {
    html: string;
    css: string;
    token: string;
    projectId: string;
}): Promise<{ html: string; css: string; replacements: Map<string, string> }> {
    const urls = Array.from(new Set(`${input.html}\n${input.css}`.match(ARTIFACT_URL_RE) ?? []));
    if (urls.length === 0) return { html: input.html, css: input.css, replacements: new Map() };

    const replacements = new Map<string, string>();
    await Promise.all(urls.map(async (url) => {
        const protectedAsset = parseProtectedAssetDownloadUrl(url);
        const publicAsset = parsePublicMediaUrl(url);
        const assetId = protectedAsset?.assetId ?? publicAsset?.assetId;
        if (!assetId) return;
        // Only this project's assets: a URL naming another project is left as it is.
        if (protectedAsset && protectedAsset.projectId !== input.projectId) return;
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
    // Returned so the caller can undo this substitution before persisting — see
    // reversePreviewAssetReplacements. This map is the only record of which data URIs in the
    // rendered DOM came from the pipeline rather than the model; without it AL-009 cannot be
    // enforced on save.
    return { html, css, replacements };
}

/**
 * AL-009 — undoes the base64 inlining above before an edited DOM is persisted as a version.
 * The preview iframe is sandboxed and cannot send an auth header, so resolvePreviewAssetUrls
 * rewrites project-asset URLs into data URIs for `srcdoc`. WYSIWYG EDIT then reads that DOM
 * back; without reversing the substitution here, the data URIs get saved as the artifact's
 * source instead of the original URLs — one measured case went from 10.703 to 131.884
 * characters, 107.725 of them base64.
 *
 * Reverses longest-data-URI-first: two resolved images never share a data URI, but nothing
 * stops one from being a prefix of another, and replacing the shorter one first would splice
 * garbage into the middle of the longer image's payload. Data URIs not present in the map are
 * left untouched — the model may legitimately author one itself, and AL-009 only forbids the
 * ones this pipeline introduced.
 */
export function reversePreviewAssetReplacements(html: string, replacements: Map<string, string>): string {
    if (!html || replacements.size === 0) return html;
    const dataUrlToOriginal = Array.from(replacements.entries())
        .map(([original, dataUrl]) => [dataUrl, original] as const)
        .sort((a, b) => b[0].length - a[0].length);

    let result = html;
    for (const [dataUrl, original] of dataUrlToOriginal) {
        result = result.split(dataUrl).join(original);
    }
    return result;
}
