"use client";

import type { CSSProperties } from "react";
import { formatCostEur, formatDuration } from "@/app/workspace/features/chat/messageUtils";

interface JournalMetaProps {
    endpoint?: string;
    provider: string;
    model: string;
    finishReason?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    durationMs: number;
    costEur: number;
}

const STAT_STYLE: CSSProperties = { fontSize: "0.72rem", color: "#94a3b8" };
const LABEL_STYLE: CSSProperties = { color: "#4b5563", marginRight: "0.3rem" };

/** The metadata row every journal entry shows: endpoint/model, tokens, duration, cost, finishReason. */
export function JournalMeta({ endpoint, provider, model, finishReason, usage, durationMs, costEur }: JournalMetaProps) {
    const truncated = finishReason === "length";
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", padding: "0.5rem 0", borderTop: "1px solid #1a2436" }}>
            <span style={STAT_STYLE}>
                <span style={LABEL_STYLE}>Model</span>
                {provider}/{model}
            </span>
            {endpoint && (
                <span style={{ ...STAT_STYLE, wordBreak: "break-all" }}>
                    <span style={LABEL_STYLE}>Endpoint</span>
                    {endpoint}
                </span>
            )}
            {usage && (
                <span style={STAT_STYLE}>
                    <span style={LABEL_STYLE}>Tokens</span>
                    {usage.promptTokens.toLocaleString()} in / {usage.completionTokens.toLocaleString()} out
                </span>
            )}
            <span style={STAT_STYLE}>
                <span style={LABEL_STYLE}>Duration</span>
                {formatDuration(durationMs)}
            </span>
            <span style={STAT_STYLE}>
                <span style={LABEL_STYLE}>Cost</span>
                {formatCostEur(costEur) || "€0"}
            </span>
            {finishReason && (
                <span
                    style={{
                        ...STAT_STYLE,
                        color: truncated ? "#f59e0b" : "#94a3b8",
                        fontWeight: truncated ? 700 : 400,
                    }}
                >
                    <span style={LABEL_STYLE}>finishReason</span>
                    {finishReason}
                </span>
            )}
        </div>
    );
}
