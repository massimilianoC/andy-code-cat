"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { clearSession, saveSession } from "./token-store";

interface SessionContextType {
    /** True while the session-expired modal is visible. */
    isSessionExpired: boolean;
    /**
     * True when the refresh token is also gone and the user must supply
     * their credentials again (inline login form in the modal).
     */
    requiresFullLogin: boolean;
    setIsSessionExpired: (expired: boolean) => void;
    /** Called by the inline login form after a successful re-authentication. */
    onLoginSuccess: (accessToken: string, refreshToken: string, projectId: string) => void;
    clearSession: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [isSessionExpired, setIsSessionExpired] = useState(false);
    const [requiresFullLogin, setRequiresFullLogin] = useState(false);

    useEffect(() => {
        // "session-expired": access token gone but refresh might still work
        // (kept for backward-compat; proactive check in api.ts now covers this).
        const handleSessionExpired = () => {
            setRequiresFullLogin(false);
            setIsSessionExpired(true);
        };

        // "session-needs-relogin": both tokens are gone / invalid — show login form.
        const handleNeedsRelogin = () => {
            setRequiresFullLogin(true);
            setIsSessionExpired(true);
        };

        window.addEventListener("session-expired", handleSessionExpired);
        window.addEventListener("session-needs-relogin", handleNeedsRelogin);

        return () => {
            window.removeEventListener("session-expired", handleSessionExpired);
            window.removeEventListener("session-needs-relogin", handleNeedsRelogin);
        };
    }, []);

    const handleClearSession = () => {
        clearSession();
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
