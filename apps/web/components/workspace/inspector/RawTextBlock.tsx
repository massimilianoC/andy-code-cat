"use client";

import { useState } from "react";

interface RawTextBlockProps {
    label: string;
    text: string;
    /** Extra text shown next to the char count, e.g. a finishReason or contentHash. */
    meta?: string;
    defaultOpen?: boolean;
}

/**
 * A small collapsible raw-text viewer — used for anything the spec wants shown verbatim but not
 * summarized (classify prompts, the canonical brief, a raw model reply). Starts collapsed so
 * expanding a block never dumps tens of thousands of characters onto the screen at once; the
 * bytes themselves are already in memory (the parent block's single detail fetch), so opening
 * this costs no extra network call.
 */
export function RawTextBlock({ label, text, meta, defaultOpen = false }: RawTextBlockProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div style={{ border: "1px solid #24354d", borderRadius: "6px", overflow: "hidden", margin: "0.5rem 0" }}>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    width: "100%",
                    padding: "0.35rem 0.65rem",
                    background: "#0d1728",
                    border: "none",
                    borderBottom: open ? "1px solid #24354d" : "none",
                    color: "#7dd3fc",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    textAlign: "left",
                }}
            >
                <span style={{ flexShrink: 0 }}>{open ? "▼" : "▶"}</span>
                <span>{label}</span>
                <span style={{ marginLeft: "auto", color: "#4b5563", fontWeight: 500 }}>
                    {meta ? `${meta} · ` : ""}
                    {text.length.toLocaleString()} char
                </span>
            </button>
            {open && (
                <pre
                    style={{
                        margin: 0,
                        padding: "0.65rem 0.85rem",
                        background: "#080e1a",
                        color: "#94a3b8",
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                        fontSize: "0.75rem",
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflowX: "auto",
                        maxHeight: "26rem",
                        overflowY: "auto",
                    }}
                >
                    {text}
                </pre>
            )}
        </div>
    );
}
