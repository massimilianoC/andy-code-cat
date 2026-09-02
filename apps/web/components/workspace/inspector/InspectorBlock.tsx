"use client";

import type { ReactNode } from "react";

interface InspectorBlockProps {
    title: string;
    /** e.g. "€0.03 · 4.2s" — already formatted by the caller. */
    subtitle?: string;
    /** Small pill shown in the collapsed row too — e.g. a TRUNCATED warning (spec §3, §6.6). */
    badge?: { label: string; tone: "warning" | "neutral" };
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}

/**
 * One of the three collapsible blocks (Vibe / Zero Effort / Generation) in the Session Inspector.
 *
 * Controlled, not self-managed: the caller decides open/closed state so it can fetch the session
 * detail the first time ANY block opens (docs/specs/SESSION_INSPECTOR_SPEC.md §5.5) and share that
 * one fetch across all three, rather than each block owning its own lazy-load.
 */
export function InspectorBlock({ title, subtitle, badge, open, onToggle, children }: InspectorBlockProps) {
    return (
        <div
            style={{
                marginBottom: "0.75rem",
                border: "1px solid #1f2a3c",
                borderRadius: "8px",
                overflow: "hidden",
                background: "#0c1523",
            }}
        >
            <button
                type="button"
                onClick={onToggle}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    width: "100%",
                    padding: "0.6rem 0.85rem",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                }}
            >
                <span style={{ fontSize: "0.75rem", color: "#6b7280", flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#e2e8f0" }}>{title}</span>
                {badge && (
                    <span
                        style={{
                            fontSize: "0.65rem",
                            fontWeight: 700,
                            letterSpacing: "0.03em",
                            padding: "0.1rem 0.45rem",
                            borderRadius: "9999px",
                            background: badge.tone === "warning" ? "#f59e0b22" : "#6b728022",
                            color: badge.tone === "warning" ? "#f59e0b" : "#9ca3af",
                            border: `1px solid ${badge.tone === "warning" ? "#f59e0b55" : "#6b728055"}`,
                        }}
                    >
                        {badge.label}
                    </span>
                )}
                {subtitle && (
                    <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#6b7280", flexShrink: 0 }}>{subtitle}</span>
                )}
            </button>
            {open && (
                <div style={{ padding: "0.85rem", borderTop: "1px solid #1f2a3c" }}>{children}</div>
            )}
        </div>
    );
}
