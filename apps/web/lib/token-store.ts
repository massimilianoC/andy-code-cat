/**
 * Browser-only token store.
 * Uses localStorage. No cookies, no server state — purely for testing the flow.
 */

const ACCESS_TOKEN_KEY = "pf_access_token";
const REFRESH_TOKEN_KEY = "pf_refresh_token";
const PROJECT_KEY = "pf_active_project";

// ── JWT expiry helpers ──────────────────────────────────────────────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        // base64url → base64
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = base64.length % 4;
        const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
        return JSON.parse(atob(padded)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Returns true when the access token is absent or expired (with a 30-second safety buffer).
 * Decodes the JWT payload client-side — no server round-trip needed.
 */
export function isAccessTokenExpired(): boolean {
    const token = getAccessToken();
    if (!token) return true;
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== "number") return true;
    // 30-second buffer to avoid edge case where token expires mid-request
    return Date.now() / 1000 >= payload.exp - 30;
}

/**
 * Returns true when the refresh token is absent or expired.
 */
export function isRefreshTokenExpired(): boolean {
    const token = getRefreshToken();
    if (!token) return true;
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== "number") return true;
    return Date.now() / 1000 >= payload.exp;
}

export function saveSession(accessToken: string, refreshToken: string, projectId: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(PROJECT_KEY, projectId);
}

export function getAccessToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setAccessToken(token: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function setRefreshToken(token: string) {
    if (typeof window === "undefined") return;
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function getActiveProject(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(PROJECT_KEY);
}

export function clearSession() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(PROJECT_KEY);
}

// Deprecated: kept for backward compatibility
export function getToken(): string | null {
    return getAccessToken();
}
