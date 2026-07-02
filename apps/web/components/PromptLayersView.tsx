"use client";

import { useState } from "react";
import type { PromptLayerEntryDto } from "@/lib/api/llm";

const PF_LAYER_OPEN_RE = /<!-- PF_LAYER id=([A-Z]) key=([a-z0-9-]+) -->/g;

// Sentence-case, mirroring the canonical registry label style
// (PROMPT_LAYER_DESCRIPTORS: "Layer A — Base constraints", not "Base Constraints").
// The persisted layers[] carry the exact SSOT labels; this reconstruction is a
// best-effort fallback for legacy/focused traces that lack the persisted array,
// which is why entries built here are tagged source "trace-marker".
function humanizeLayerKey(key: string): string {
    const words = key.split("-").filter(Boolean).join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function parseLayersFromMarkers(fullText: string): PromptLayerEntryDto[] {
    const entries: PromptLayerEntryDto[] = [];

    for (const match of fullText.matchAll(PF_LAYER_OPEN_RE)) {
        const id = match[1];
        const key = match[2];
        const marker = match[0];
        const start = match.index ?? -1;
        if (start < 0) continue;

        const closeMarker = `<!-- /PF_LAYER id=${id} -->`;
        const end = fullText.indexOf(closeMarker, start + marker.length);
        if (end < 0) continue;

        const sliceEnd = end + closeMarker.length;
        entries.push({
            id,
            key,
            label: `Layer ${id} — ${humanizeLayerKey(key)}`,
            source: "trace-marker",
            chars: fullText.slice(start + marker.length, end).trim().length,
            span: [start, sliceEnd],
        });
    }

    return entries;
}

interface PromptLayersViewProps {
    /** "sent" = persisted trace of a real generation; "dry-run" = preview of next request. */
    mode: "sent" | "dry-run";
    /** Full system prompt text (trace.effectiveSystemPrompt or preview.effectiveSystemPrompt). */
    fullText: string;
    /** Structured breakdown; entries with chars === 0 are rendered as collapsed "not injected" rows. */
    layers: PromptLayerEntryDto[];
    /** Header metadata line (model, provider, timestamp) — already formatted by the caller. */
    subtitle?: string;
    /** When true, the Raw toggle starts ON (used when `layers` is empty — legacy/focused-mode traces). */
    defaultRaw?: boolean;
}

/**
 * Single renderer for both "prompt actually sent" (persisted trace) and
 * "dry-run preview" (next-request estimate) states. Renders ONLY from the
 * `layers`/`fullText` props — no client-side recomposition, no heuristic
 * text-splitting, no mock/fallback content. See docs/specs/PROMPT_LAYER_SSOT_SPEC.md.
 */
export default function PromptLayersView({ mode, fullText, layers, subtitle, defaultRaw }: PromptLayersViewProps) {
    const resolvedLayers = layers.length > 0 ? layers : parseLayersFromMarkers(fullText);
    const [raw, setRaw] = useState(Boolean(defaultRaw) && resolvedLayers.length === 0);
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});

    const badgeLabel = mode === "sent" ? "PROMPT REALMENTE INVIATO" : "DRY-RUN — PROSSIMA RICHIESTA";
    const badgeColor = mode === "sent" ? "#34d399" : "#f59e0b";

    return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    marginBottom: "0.75rem",
                    flexWrap: "wrap",
                }}
            >
                <span
                    style={{
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        color: badgeColor,
                        letterSpacing: "0.03em",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "9999px",
                        background: `${badgeColor}22`,
                        border: `1px solid ${badgeColor}55`,
                    }}
                >
                    {badgeLabel}
                </span>
                {subtitle && (
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)" }}>{subtitle}</span>
                )}
                <button
                    type="button"
                    onClick={() => setRaw((r) => !r)}
                    style={{
                        marginLeft: "auto",
                        fontSize: "0.72rem",
                        padding: "0.2rem 0.6rem",
                        background: raw ? badgeColor : "transparent",
                        color: raw ? "#0b1220" : "var(--text-muted, #94a3b8)",
                        border: `1px solid ${badgeColor}`,
                        borderRadius: "var(--radius, 4px)",
                        cursor: "pointer",
                        fontWeight: 600,
                    }}
                >
                    Raw
                </button>
            </div>

            {raw ? (
                <pre
                    style={{
                        margin: 0,
                        padding: "0.75rem 1rem",
                        background: "#080e1a",
                        color: "#94a3b8",
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                        fontSize: "0.78rem",
                        lineHeight: 1.65,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflowX: "auto",
                        overflowY: "auto",
                    }}
                >
                    {fullText}
                </pre>
            ) : (
                resolvedLayers.map((entry, i) => {
                    const isEmpty = entry.chars === 0;
                    const isOpen = !isEmpty && Boolean(expanded[i]);
                    return (
                        <div
                            key={`${entry.id}-${i}`}
                            style={{
                                marginBottom: "0.75rem",
                                border: `1px solid ${isEmpty ? "#2a3040" : "#2a3a50"}`,
                                borderRadius: "6px",
                                overflow: "hidden",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                    padding: "0.45rem 0.75rem",
                                    background: isEmpty ? "#111827" : "#0f1e35",
                                    cursor: isEmpty ? "default" : "pointer",
                                    userSelect: "none",
                                }}
                                onClick={() => {
                                    if (isEmpty) return;
                                    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));
                                }}
                            >
                                <span style={{ fontSize: "0.72rem", color: "#6b7280", flexShrink: 0 }}>
                                    {isEmpty ? "—" : isOpen ? "▼" : "▶"}
                                </span>
                                <span
                                    style={{
                                        fontSize: "0.8rem",
                                        fontWeight: 700,
                                        color: isEmpty ? "#4b5563" : "#e2e8f0",
                                        fontFamily: "monospace",
                                    }}
                                >
                                    {entry.label}
                                </span>
                                <span
                                    style={{
                                        fontSize: "0.68rem",
                                        padding: "0.1rem 0.45rem",
                                        borderRadius: "9999px",
                                        background: isEmpty ? "#6b728022" : "#7dd3fc22",
                                        color: isEmpty ? "#6b7280" : "#7dd3fc",
                                        border: `1px solid ${isEmpty ? "#6b728055" : "#7dd3fc55"}`,
                                        fontWeight: 600,
                                        flexShrink: 0,
                                    }}
                                >
                                    {entry.source}
                                </span>
                                <span style={{ fontSize: "0.68rem", color: "#4b5563", marginLeft: "auto", textAlign: "right" }}>
                                    {isEmpty ? "0 → non iniettato" : `${entry.chars} chars`}
                                </span>
                            </div>
                            {isOpen && (
                                <pre
                                    style={{
                                        margin: 0,
                                        padding: "0.75rem 1rem",
                                        background: "#080e1a",
                                        color: "#94a3b8",
                                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                                        fontSize: "0.78rem",
                                        lineHeight: 1.65,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                        overflowX: "auto",
                                    }}
                                >
                                    {fullText.slice(entry.span[0], entry.span[1])}
                                </pre>
                            )}
                        </div>
                    );
                })
            )}
        </div>
    );
}
