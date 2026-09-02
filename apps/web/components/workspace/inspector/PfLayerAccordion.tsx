"use client";

import { useState } from "react";
import { splitPfLayers, pfLayersOnly } from "./pfLayerSplit";

interface PfLayerAccordionProps {
    /** The rendered system prompt exactly as sent — verified bytes (assertPromptTraceParity). */
    fullText: string;
}

/**
 * Renders a rendered system prompt split into its PF_LAYER-marked layers (spec §3, §6.5). Each
 * row's content is a byte-exact slice of `fullText` at that layer's span — nothing is
 * recomposed or reconstructed, only sliced.
 */
export function PfLayerAccordion({ fullText }: PfLayerAccordionProps) {
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    const layers = pfLayersOnly(splitPfLayers(fullText));

    if (layers.length === 0) {
        // No markers at all (legacy row predating PF_LAYER, or a non-generation call) — show the
        // raw text rather than claiming a layer breakdown that doesn't exist.
        return (
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
                {fullText}
            </pre>
        );
    }

    return (
        <div>
            {layers.map((layer, i) => {
                const isOpen = Boolean(expanded[i]);
                return (
                    <div
                        key={`${layer.id}-${i}`}
                        style={{ marginBottom: "0.6rem", border: "1px solid #2a3a50", borderRadius: "6px", overflow: "hidden" }}
                    >
                        <div
                            onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                padding: "0.4rem 0.7rem",
                                background: "#0f1e35",
                                cursor: "pointer",
                                userSelect: "none",
                            }}
                        >
                            <span style={{ fontSize: "0.7rem", color: "#6b7280", flexShrink: 0 }}>{isOpen ? "▼" : "▶"}</span>
                            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
                                Layer {layer.id} — {layer.label}
                            </span>
                            <span style={{ fontSize: "0.66rem", color: "#4b5563", marginLeft: "auto" }}>{layer.chars} chars</span>
                        </div>
                        {isOpen && (
                            <pre
                                style={{
                                    margin: 0,
                                    padding: "0.65rem 0.9rem",
                                    background: "#080e1a",
                                    color: "#94a3b8",
                                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                                    fontSize: "0.75rem",
                                    lineHeight: 1.6,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    overflowX: "auto",
                                }}
                            >
                                {layer.content}
                            </pre>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
