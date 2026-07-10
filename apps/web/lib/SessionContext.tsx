"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { refreshAccessToken } from "./api/call";
import {
    clearSession as clearStoredSession,
    getRefreshToken,
    isAccessTokenExpired,
    isRefreshTokenExpired,
    saveSession,
} from "./token-store";

const SESSION_POLL_INTERVAL_MS = 30_000;

interface SessionContextType {
    /** True while the session-expired modal is visible. */
    isSessionExpired: boolean;
    /** True when the refresh token is also gone and the user must login again. */
    requiresFullLogin: boolean;
    setIsSessionExpired: (expired: boolean) => void;
    /** Kept for embedded login callers that still need to restore tokens. */
    onLoginSuccess: (accessToken: string, refreshToken: string, projectId: string) => void;
    clearSession: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [isSessionExpired, setIsSessionExpired] = useState(false);
    const [requiresFullLogin, setRequiresFullLogin] = useState(false);

    useEffect(() => {
        let refreshInFlight = false;

        const requireRelogin = () => {
            clearStoredSession();
            setRequiresFullLogin(true);
            setIsSessionExpired(true);
        };

        const checkSession = async () => {
            if (!getRefreshToken()) return;

            if (isRefreshTokenExpired()) {
                requireRelogin();
                return;
            }

            if (!isAccessTokenExpired() || refreshInFlight) {
                return;
            }

            refreshInFlight = true;
            try {
                await refreshAccessToken();
                setRequiresFullLogin(false);
                setIsSessionExpired(false);
            } catch {
                // Network-only failures are surfaced by the original request.
                // Invalid/expired refresh tokens emit session-needs-relogin below.
            } finally {
                refreshInFlight = false;
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void checkSession();
            }
        };

        // "session-expired": access token gone but refresh might still work.
        const handleSessionExpired = () => {
            setRequiresFullLogin(false);
            setIsSessionExpired(true);
        };

        // "session-needs-relogin": refresh is gone/invalid, so force a login page.
        const handleNeedsRelogin = requireRelogin;

        window.addEventListener("session-expired", handleSessionExpired);
        window.addEventListener("session-needs-relogin", handleNeedsRelogin);
        window.addEventListener("focus", checkSession);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        const interval = window.setInterval(() => void checkSession(), SESSION_POLL_INTERVAL_MS);
        void checkSession();

        return () => {
            window.removeEventListener("session-expired", handleSessionExpired);
            window.removeEventListener("session-needs-relogin", handleNeedsRelogin);
            window.removeEventListener("focus", checkSession);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.clearInterval(interval);
        };
    }, []);

    const handleClearSession = () => {
        clearStoredSession();
        setIsSessionExpired(false);
        setRequiresFullLogin(false);
    };

    const handleLoginSuccess = (
        accessToken: string,
        refreshToken: string,
        projectId: string
    ) => {
        saveSession(accessToken, refreshToken, projectId);
        setIsSessionExpired(false);
        setRequiresFullLogin(false);
        // Notify all subscribers (e.g. workspace page) that fresh tokens are available
        window.dispatchEvent(new CustomEvent("session-restored", { detail: { accessToken } }));
    };

    return (
        <SessionContext.Provider
            value={{
                isSessionExpired,
                requiresFullLogin,
                setIsSessionExpired,
                onLoginSuccess: handleLoginSuccess,
                clearSession: handleClearSession,
            }}
        >
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used within SessionProvider");
    }
    return context;
}
