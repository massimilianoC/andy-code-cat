"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNotifications, type SystemNotification } from "../lib/notifications";

// ---------------------------------------------------------------------------
// Spinner (CSS-based, no external lib)
// ---------------------------------------------------------------------------
function Spinner() {
    return (
        <span
            style={{
                display: "inline-block",
                width: 14,
                height: 14,
                border: "2px solid var(--border)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
                animation: "pf-spin 0.7s linear infinite",
                flexShrink: 0,
            }}
        />
    );
}

// ---------------------------------------------------------------------------
// Single notification row
// ---------------------------------------------------------------------------
function NotificationRow({ n, onRemove }: { n: SystemNotification; onRemove: () => void }) {
    const { t } = useTranslation();
    const isRunning = n.status === "running";
    const isDone = n.status === "done";
    const isError = n.status === "error";

    const iconColor = isRunning
        ? "var(--accent)"
        : isDone
        ? "var(--success)"
        : "var(--danger)";

    const statusIcon = isRunning ? null : isDone ? "✓" : "✕";

    return (
        <div
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.5rem 0.55rem",
                borderBottom: "1px solid var(--border)",
                fontSize: "0.78rem",
            }}
        >
            {/* Status indicator */}
            <div style={{ paddingTop: 1, flexShrink: 0, color: iconColor }}>
                {isRunning ? (
                    <Spinner />
                ) : (
                    <span style={{ fontWeight: 700, fontSize: 12 }}>{statusIcon}</span>
                )}
            </div>

            {/* Main content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        color: isError ? "var(--danger)" : "var(--text)",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {n.label}
                </div>

                {/* Progress bar (deterministic) */}
                {isRunning && typeof n.progress === "number" && (
                    <div
                        style={{
                            marginTop: "0.3rem",
                            height: 4,
                            background: "var(--border)",
                            borderRadius: 2,
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                height: "100%",
                                width: `${Math.min(100, n.progress)}%`,
                                background: "var(--accent)",
                                transition: "width 0.3s ease",
                            }}
                        />
                    </div>
                )}

                {/* Message detail */}
                {n.message && (
                    <div
                        style={{
                            color: isError ? "var(--danger)" : "var(--text-muted)",
                            marginTop: "0.2rem",
                            fontSize: "0.72rem",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {n.message}
                    </div>
                )}
            </div>

            {/* Close button — always visible */}
            <button
                onClick={onRemove}
                title={t("notifications.close")}
                style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontSize: 13,
                    lineHeight: 1,
                    padding: "0 2px",
                    flexShrink: 0,
                }}
            >
                ×
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Panel + toggle button (Chrome-download style — bottom-right fixed)
// ---------------------------------------------------------------------------
export function NotificationPanel() {
    const { t } = useTranslation();
    const { notifications, remove, panelOpen, setPanelOpen } = useNotifications();
    const panelRef = useRef<HTMLDivElement>(null);

    const runningCount = notifications.filter((n) => n.status === "running").length;
    const hasAny = notifications.length > 0;

    // Close panel on outside click
    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setPanelOpen(false);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [setPanelOpen]);

    // Don't render anything when no notifications exist
    if (!hasAny && !panelOpen) return null;

    return (
        <>
            {/* Keyframe for spinner — injected once */}
            <style>{`@keyframes pf-spin { to { transform: rotate(360deg); } }`}</style>

            <div
                ref={panelRef}
                style={{
                    position: "fixed",
                    bottom: "3.5rem",
                    left: "1rem",
                    zIndex: 1000,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "0.35rem",
                }}
            >
                {/* Panel */}
                {panelOpen && hasAny && (
                    <div
                        style={{
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius)",
                            width: 280,
                            maxHeight: 360,
                            overflowY: "auto",
                            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
                        }}
                    >
                        {/* Header */}
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "0.45rem 0.6rem",
                                borderBottom: "1px solid var(--border)",
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                                fontWeight: 600,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                            }}
                        >
                            <span>{t("notifications.title")}</span>
                            {notifications.some((n) => n.status !== "running") && (
                                <button
                                    onClick={() => notifications.forEach((n) => n.status !== "running" && remove(n.id))}
                                    style={{
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        color: "var(--text-muted)",
                                        fontSize: "0.7rem",
                                        padding: 0,
                                    }}
                                    title={t("notifications.clearTitle")}
                                >
                                    {t("notifications.clear")}
                                </button>
                            )}
                        </div>

                        {/* Notification rows */}
                        {notifications.map((n) => (
                            <NotificationRow
                                key={n.id}
                                n={n}
                                onRemove={() => remove(n.id)}
                            />
                        ))}
                    </div>
                )}

                {/* Toggle button (Chrome-download style) */}
                {hasAny && (
                    <button
                        onClick={() => setPanelOpen(!panelOpen)}
                        title={panelOpen ? t("notifications.hide") : t("notifications.show")}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius)",
                            color: runningCount > 0 ? "var(--accent)" : "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                            padding: "0.35rem 0.65rem",
                            boxShadow: runningCount > 0
                                ? "0 0 0 2px rgba(99,102,241,0.25)"
                                : "none",
                            transition: "box-shadow 0.2s",
                        }}
                    >
                        {/* Icon */}
                        {runningCount > 0 ? <Spinner /> : <span style={{ fontSize: 13 }}>⬇</span>}

                        {/* Badge */}
                        {runningCount > 0 ? (
                            <span>
                                {t("notifications.running", { count: runningCount })}
                            </span>
                        ) : (
                            <span>{t("notifications.completed", { count: notifications.length })}</span>
                        )}
                    </button>
                )}
            </div>
        </>
    );
}
