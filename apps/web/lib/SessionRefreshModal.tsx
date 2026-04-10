"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "./SessionContext";
import { LoginForm } from "../components/LoginForm";
import type { LoginResult } from "./api";

export function SessionRefreshModal() {
    const { t } = useTranslation();
    const { isSessionExpired, requiresFullLogin, onLoginSuccess, clearSession } = useSession();

    if (!isSessionExpired) {
        return null;
    }

    function handleLoginSuccess(data: LoginResult) {
        onLoginSuccess(data.accessToken, data.refreshToken, data.activeProjectId);
    }

    function handleLogout() {
        clearSession();
        window.location.href = "/login";
    }

    return (
        <div className="session-modal-overlay">
            <div className="session-modal">
                <div className="session-modal-header">
                    <h2>{t("session.expired")}</h2>
                </div>

                <div className="session-modal-body">
                    {requiresFullLogin ? (
                        <>
                            <p className="session-modal-message" style={{ marginBottom: "1rem" }}>
                                {t("session.requiresLogin")}
                            </p>
                            <LoginForm onSuccess={handleLoginSuccess} embedded />
                        </>
                    ) : (
                        // Access token expired but refresh token may be valid.
                        // The proactive refresh in api.ts normally handles this silently;
                        // this path is a safety fallback shown during edge-case races.
                        <>
                            <p className="session-modal-message">
                                {t("session.tokenExpired")}
                            </p>
                            <div style={{ marginTop: "1rem" }}>
                                <LoginForm onSuccess={handleLoginSuccess} embedded />
                            </div>
                        </>
                    )}
                </div>

                <div className="session-modal-footer">
                    <button
                        className="btn btn-secondary"
                        onClick={handleLogout}
                    >
                        {t("session.logout")}
                    </button>
                </div>
            </div>
            <style jsx>{`
                .session-modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: rgba(0, 0, 0, 0.6);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                }

                .session-modal {
                    background-color: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
                    max-width: 420px;
                    width: 90%;
                    overflow: hidden;
                }

                .session-modal-header {
                    padding: 24px;
                    border-bottom: 1px solid #e5e5e5;
                }

                .session-modal-header h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 600;
                    color: #1a1a1a;
                }

                .session-modal-body {
                    padding: 24px;
                }

                .session-modal-message {
                    margin: 0;
                    font-size: 14px;
                    line-height: 1.5;
                    color: #666;
                }

                .session-modal-footer {
                    padding: 16px 24px;
                    border-top: 1px solid #e5e5e5;
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }

                .btn {
                    padding: 10px 16px;
                    font-size: 14px;
                    font-weight: 500;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .btn-primary {
                    background-color: #2563eb;
                    color: white;
                }

                .btn-primary:hover:not(:disabled) {
                    background-color: #1d4ed8;
                }

                .btn-secondary {
                    background-color: #f3f4f6;
                    color: #1a1a1a;
                    border: 1px solid #d1d5db;
                }

                .btn-secondary:hover:not(:disabled) {
                    background-color: #e5e7eb;
                }
            `}</style>
        </div>
    );
}
