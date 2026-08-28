import type { SiteDeploymentDto } from "@/lib/api";

function ensureTrailingSlash(path: string): string {
    return path.endsWith("/") ? path : `${path}/`;
}

function isLoopbackHostname(hostname: string): boolean {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function resolvePublicDeploymentUrl(
    deployment: SiteDeploymentDto,
    options?: { apiBaseUrl?: string; browserUrl?: string },
): string {
    if (deployment.subdomainUrl) return deployment.subdomainUrl;

    const path = ensureTrailingSlash(deployment.url || `/p/${deployment.publishId}`);
    const apiBaseUrl = options?.apiBaseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const browserUrl = options?.browserUrl ?? (typeof window !== "undefined" ? window.location.href : undefined);

    try {
        const apiUrl = new URL(apiBaseUrl);
        if (isLoopbackHostname(apiUrl.hostname) && browserUrl) {
            const browser = new URL(browserUrl);
            // Both compose stacks expose nginx on the browser host's default HTTP(S) port.
            // Dropping direct web/API ports keeps /p and /p/media on one CSP-safe origin.
            return new URL(path, `${browser.protocol}//${browser.hostname}`).toString();
        }
        return new URL(path, apiUrl).toString();
    } catch {
        return path;
    }
}
