/**
 * Core HTTP client — ApiError, token refresh, bearer injection.
 * All domain modules import `call` and `ApiError` from here.
 */

import {
    getAccessToken,
    getRefreshToken,
    setAccessToken,
    setRefreshToken,
    setPasswordChangeRequired,
    clearSession,
    isAccessTokenExpired,
    isRefreshTokenExpired,
} from "../token-store";

export interface ApiErrorResponse {
    error?: string;
    code?: string;
    status?: number;
    userMessage?: string;
    details?: unknown;
}

function tryParseApiErrorBody(body: unknown): ApiErrorResponse {
    if (typeof body === "string") {
        const trimmed = body.trim();
        if (trimmed.startsWith("{")) {
            try {
                const parsed = JSON.parse(trimmed) as unknown;
                return tryParseApiErrorBody(parsed);
            } catch {
                return { error: trimmed };
            }
        }
        return { error: trimmed };
    }

    if (typeof body === "object" && body !== null) {
        const candidate = body as Record<string, unknown>;
        return {
            error: typeof candidate.error === "string" ? candidate.error : undefined,
            code: typeof candidate.code === "string" ? candidate.code : undefined,
            status: typeof candidate.status === "number" ? candidate.status : undefined,
            userMessage: typeof candidate.userMessage === "string" ? candidate.userMessage : undefined,
            details: candidate.details,
        };
    }

    return {};
}

export class ApiError extends Error {
    public readonly code?: string;
    public readonly details?: unknown;
    public readonly userMessage?: string;

    constructor(
        public readonly status: number,
        public readonly body: unknown
    ) {
        const parsed = tryParseApiErrorBody(body);
        super(parsed.userMessage ?? parsed.error ?? `HTTP ${status}`);
        this.name = "ApiError";
        this.code = parsed.code;
        this.details = parsed.details;
        this.userMessage = parsed.userMessage ?? parsed.error;
    }
}

// ── Shared refresh state ──────────────────────────────────────────────────────
// Exported via helpers so streamLlmChatPreview (in llm.ts) can participate in
// the same deduplication mechanism without duplicating state.

let _refreshPromise: Promise<string> | null = null;

function isAnonymousAuthPath(path: string): boolean {
    return path === "/v1/auth/login"
        || path === "/v1/auth/register"
        || path === "/v1/auth/refresh";
}

export function getSharedRefreshPromise(): Promise<string> | null {
    return _refreshPromise;
}
export function setSharedRefreshPromise(p: Promise<string> | null): void {
    _refreshPromise = p;
}

function getApiBaseUrl(): string {
    const configured = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
    return configured.length > 0 ? configured : "http://localhost:4000";
}

// ── Refresh ───────────────────────────────────────────────────────────────────

/**
 * Attempts a silent token refresh.
 * Fires "session-needs-relogin" when the refresh token is absent/expired or the
 * refresh endpoint rejects the request, then throws so the caller can surface the
 * modal and abort the pending API call.
 */
export async function refreshAccessToken(): Promise<string> {
    if (isRefreshTokenExpired()) {
        clearSession();
        window.dispatchEvent(new CustomEvent("session-needs-relogin"));
        throw new ApiError(401, { error: "Sessione scaduta — effettua nuovamente il login" });
    }

    const refreshToken = getRefreshToken()!;
    const baseUrl = getApiBaseUrl();

    let response: Response;
    try {
        response = await fetch(`${baseUrl}/v1/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
        });
    } catch {
        throw new ApiError(0, { error: "Rete non raggiungibile durante il refresh della sessione" });
    }

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
        clearSession();
        window.dispatchEvent(new CustomEvent("session-needs-relogin"));
        throw new ApiError(response.status, json);
    }

    const payload = json as { accessToken: string; refreshToken?: string; requiresPasswordChange?: boolean };
    const newAccessToken = payload.accessToken;
    setAccessToken(newAccessToken);
    if (payload.refreshToken) {
        setRefreshToken(payload.refreshToken);
    }
    setPasswordChangeRequired(payload.requiresPasswordChange === true);
    return newAccessToken;
}

// ── Core call ────────────────────────────────────────────────────────────────

export async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    isRetry = false
): Promise<T> {
    const baseUrl = getApiBaseUrl();

    let resolvedHeaders: Record<string, string> = { ...headers };
    if (!isRetry && !isAnonymousAuthPath(path) && resolvedHeaders.Authorization) {
        if (isAccessTokenExpired()) {
            try {
                if (!_refreshPromise) {
                    _refreshPromise = refreshAccessToken();
                }
                const freshToken = await _refreshPromise;
                _refreshPromise = null;
                resolvedHeaders = { ...resolvedHeaders, Authorization: `Bearer ${freshToken}` };
            } catch {
                _refreshPromise = null;
                throw new ApiError(401, { error: "Sessione scaduta" });
            }
        } else {
            const stored = getAccessToken();
            if (stored) {
                resolvedHeaders = { ...resolvedHeaders, Authorization: `Bearer ${stored}` };
            }
        }
    }

    const requestInit: RequestInit = {
        method,
        cache: "no-store",
        headers: {
            "Content-Type": "application/json",
            ...resolvedHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    };

    let res: Response;
    try {
        res = await fetch(`${baseUrl}${path}`, requestInit);
    } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
            res = await fetch(`${baseUrl}${path}`, requestInit);
        } catch {
            throw new ApiError(0, {
                error: "API non raggiungibile. Verifica che il servizio backend sia attivo su http://localhost:4000",
                path,
                method,
            });
        }
    }

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
        if (res.status === 401 && !isRetry && !isAnonymousAuthPath(path)) {
            try {
                if (!_refreshPromise) {
                    _refreshPromise = refreshAccessToken();
                }
                const newAccessToken = await _refreshPromise;
                _refreshPromise = null;

                return call<T>(method, path, body, {
                    ...resolvedHeaders,
                    Authorization: `Bearer ${newAccessToken}`,
                }, true);
            } catch {
                _refreshPromise = null;
                throw new ApiError(res.status, json);
            }
        }

        throw new ApiError(res.status, json);
    }

    return json as T;
}
