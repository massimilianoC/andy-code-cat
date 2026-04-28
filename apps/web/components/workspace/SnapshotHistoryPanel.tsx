"use client";

import React, { useState, useRef, useEffect } from "react";
import type { PreviewSnapshot } from "../../lib/api";

interface SnapshotHistoryPanelProps {
    snapshots: PreviewSnapshot[];
    selectedId: string | null;
    loading: boolean;
    onSelect: (id: string) => void;
    onActivate: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onRecover: () => void;
}

export function SnapshotHistoryPanel({
    snapshots,
    selectedId,
    loading,
    onSelect,
    onActivate,
    onDelete,
    onRecover,
}: SnapshotHistoryPanelProps) {
    const [open, setOpen] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const activeSnapshot = snapshots.find((s) => s.isActive) ?? snapshots[0] ?? null;
    const selectedSnapshot = snapshots.find((s) => s.id === selectedId) ?? activeSnapshot;
    const selectedIndex = snapshots.findIndex((s) => s.id === selectedSnapshot?.id);
    const selectedVersionNumber = selectedIndex === -1 ? snapshots.length : snapshots.length - selectedIndex;
    const isViewingOld = selectedSnapshot?.id !== activeSnapshot?.id;

    return (
        <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {/* Trigger */}
            <button
                type="button"
                className="secondary"
                onClick={() => setOpen((v) => !v)}
                style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0.55rem" }}
            >
                {loading ? (
                    <span style={{ color: "var(--text-muted)" }}>…</span>
                ) : (
                    <>
                        <span style={{ fontWeight: 700 }}>v{selectedVersionNumber}</span>
                        {selectedSnapshot?.metadata?.model && (
                            <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                                {selectedSnapshot.metadata.model.split("/").pop()}
                            </span>
                        )}
                        <span style={{ color: "var(--text-muted)" }}>▾</span>
                    </>
                )}
            </button>

            {/* Recupera button (visible when viewing a non-active snapshot) */}
            {isViewingOld && (
                <button
                    type="button"
                    className="secondary"
                    onClick={onRecover}
                    style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", color: "var(--accent-text)" }}
                    title="Torna alla versione attiva"
                >
                    Recupera
                </button>
            )}

            {/* Dropdown panel */}
            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        right: 0,
                        zIndex: 200,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
                        minWidth: 340,
                        maxHeight: 420,
                        overflowY: "auto",
                    }}
                >
                    <div
                        style={{
                            padding: "0.55rem 0.85rem 0.35rem",
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            color: "var(--text-muted)",
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            borderBottom: "1px solid var(--border)",
                        }}
                    >
                        Cronologia Preview · {snapshots.length} versioni
                    </div>

                    {snapshots.map((snap, i) => {
                        const vn = snapshots.length - i;
                        const isSel = snap.id === selectedId;
                        const isAct = snap.isActive;
                        const time = new Date(snap.createdAt).toLocaleTimeString("it-IT", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                        });
                        const tokens = snap.metadata?.tokenUsage?.totalTokens;
                        const model = snap.metadata?.model?.split("/").pop() ?? snap.metadata?.model;
                        const isEmpty = !snap.artifacts?.html;

                        return (
                            <div
                                key={snap.id}
                                onClick={() => {
                                    onSelect(snap.id);
                                    setOpen(false);
                                    if (!snap.isActive) void onActivate(snap.id);
                                }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.6rem",
                                    padding: "0.6rem 0.85rem",
                                    cursor: "pointer",
                                    background: isSel ? "var(--surface-2)" : "transparent",
                                    borderBottom: i < snapshots.length - 1 ? "1px solid var(--border-subtle, var(--border))" : "none",
                                    transition: "background 0.1s",
                                }}
                                onMouseEnter={(e) => {
                                    if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-2)";
                                }}
                                onMouseLeave={(e) => {
                                    if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent";
                                }}
                            >
                                {/* Version number */}
                                <span
                                    style={{
                                        fontSize: "0.82rem",
                                        fontWeight: 800,
                                        color: isAct ? "#22c55e" : "var(--text-muted)",
                                        minWidth: 30,
                                        fontVariantNumeric: "tabular-nums",
                                    }}
                                >
                                    v{vn}
                                </span>

                                {/* Meta */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
                                        {snap.metadata?.finishReason === "manual-save" ? (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(125,211,252,0.15)", color: "#7dd3fc", border: "1px solid rgba(125,211,252,0.3)" }}>✏ manuale</span>
                                        ) : snap.metadata?.finishReason === "wysiwyg-edit-light" ? (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(250,204,21,0.15)", color: "#facc15", border: "1px solid rgba(250,204,21,0.3)" }}>✎ EDIT</span>
                                        ) : snap.metadata?.finishReason === "wysiwyg-grapesjs" ? (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>⊕ GJS</span>
                                        ) : (
                                            model && <span className="badge purple" style={{ fontSize: "0.65rem" }}>{model}</span>
                                        )}
                                        {snap.metadata?.provider && snap.metadata.finishReason !== "manual-save" && snap.metadata.finishReason !== "wysiwyg-edit-light" && snap.metadata.finishReason !== "wysiwyg-grapesjs" && (
                                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                                                {snap.metadata.provider}
                                            </span>
                                        )}
                                        {isAct && (
                                            <span className="badge green" style={{ fontSize: "0.65rem" }}>attiva</span>
                                        )}
                                        {isEmpty && (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }} title="HTML vuoto – versione corrotta">⚠ vuota</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.15rem", display: "flex", gap: "0.5rem" }}>
                                        <span>{time}</span>
                                        {tokens && <span>{tokens.toLocaleString()} tok</span>}
                                        {snap.metadata?.durationMs && (
                                            <span>{(snap.metadata.durationMs / 1000).toFixed(1)}s</span>
                                        )}
                                    </div>
                                </div>

                                {/* Delete button (only on non-active snapshots) */}
                                {!isAct && (
                                    <button
                                        type="button"
                                        className="secondary"
                                        style={{
                                            fontSize: "0.72rem",
                                            padding: "0.15rem 0.35rem",
                                            flexShrink: 0,
                                            color: "var(--danger, #ef4444)",
                                            lineHeight: 1,
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmDeleteId(snap.id);
                                        }}
                                        title="Elimina questa versione"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Delete confirmation modal */}
            {confirmDeleteId && (() => {
                const snapIdx = snapshots.findIndex((s) => s.id === confirmDeleteId);
                const versionLabel = snapIdx === -1 ? "?" : String(snapshots.length - snapIdx);
                return (
                    <div
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 9999,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.5)",
                        }}
                        onClick={() => { if (!deleting) setConfirmDeleteId(null); }}
                    >
                        <div
                            style={{
                                background: "var(--surface)",
                                border: "1px solid var(--border)",
                                borderRadius: "var(--radius, 8px)",
                                padding: "1.5rem",
                                maxWidth: 360,
                                width: "90%",
                                boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h4 style={{ margin: "0 0 0.6rem", fontSize: "0.95rem", fontWeight: 700 }}>
                                Elimina versione v{versionLabel}?
                            </h4>
                            <p style={{ margin: "0 0 1.2rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                                Questa azione è irreversibile. La versione verrà eliminata definitivamente.
                            </p>
                            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                                <button
                                    type="button"
                                    className="secondary"
                                    style={{ fontSize: "0.78rem", padding: "0.3rem 0.8rem" }}
                                    onClick={() => setConfirmDeleteId(null)}
                                    disabled={deleting}
                                >
                                    Annulla
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        fontSize: "0.78rem",
                                        padding: "0.3rem 0.8rem",
                                        background: "var(--danger, #ef4444)",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: "var(--radius, 6px)",
                                        cursor: deleting ? "wait" : "pointer",
                                        opacity: deleting ? 0.6 : 1,
                                    }}
                                    disabled={deleting}
                                    onClick={async () => {
                                        setDeleting(true);
                                        try {
                                            await onDelete(confirmDeleteId);
                                        } catch { /* silent */ }
                                        setDeleting(false);
                                        setConfirmDeleteId(null);
                                    }}
                                >
                                    {deleting ? "Eliminazione…" : "Elimina"}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
