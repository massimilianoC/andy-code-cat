"use client";

import type { CSSProperties } from "react";
import type { VibeIntakeDetailDto, PromptExecutionLogDetailDto } from "@andy-code-cat/contracts";
import { getPublicAssetUrl } from "@/lib/api/assets";
import { RawTextBlock } from "./RawTextBlock";
import { JournalMeta } from "./JournalMeta";
import { formatBytes } from "./formatters";

interface VibeBlockProps {
    intake: VibeIntakeDetailDto;
    /** The vibe_classify journal row, when the classifier actually ran. */
    classifyLog?: PromptExecutionLogDetailDto;
    costEur: number;
}

const SECTION_LABEL: CSSProperties = {
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "0.35rem",
};

/**
 * Vibe block (SESSION_INSPECTOR_SPEC.md §3): the prompt exactly as typed — not a rendered prompt,
 * not an excerpt — attachments, the model override if set, then the classify call.
 */
export function VibeBlock({ intake, classifyLog, costEur }: VibeBlockProps) {
    return (
        <div>
            <div style={SECTION_LABEL}>Prompt</div>
            {/* Byte-identical to vibe_intakes.prompt — no trim, no truncation, no markdown pass. */}
            <pre
                style={{
                    margin: "0 0 0.85rem",
                    padding: "0.65rem 0.8rem",
                    background: "#080e1a",
                    border: "1px solid #1a2436",
                    borderRadius: "6px",
                    color: "#e2e8f0",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                    fontSize: "0.8rem",
                    lineHeight: 1.65,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                }}
            >
                {intake.prompt}
            </pre>

            {intake.attachments.length > 0 && (
                <>
                    <div style={SECTION_LABEL}>Attachments ({intake.attachments.length})</div>
                    <ul style={{ listStyle: "none", margin: "0 0 0.85rem", padding: 0, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                        {intake.attachments.map((attachment, i) => (
                            <li
                                key={`${attachment.assetId ?? attachment.filename ?? i}`}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                    fontSize: "0.78rem",
                                    color: "#cbd5e1",
                                    padding: "0.35rem 0.6rem",
                                    background: "#0d1728",
                                    border: "1px solid #1a2436",
                                    borderRadius: "6px",
                                }}
                            >
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {attachment.filename ?? "(untitled)"}
                                </span>
                                <span style={{ color: "#6b7280", fontSize: "0.7rem" }}>{attachment.mimeType ?? "—"}</span>
                                <span style={{ color: "#6b7280", fontSize: "0.7rem" }}>{formatBytes(attachment.sizeBytes)}</span>
                                {attachment.assetId && (
                                    <a
                                        href={getPublicAssetUrl(attachment.assetId)}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: "#7dd3fc", fontSize: "0.7rem", fontWeight: 600, textDecoration: "none" }}
                                    >
                                        Download
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {(intake.requestedProvider || intake.requestedModel) && (
                <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginBottom: "0.85rem" }}>
                    <span style={{ color: "#4b5563", marginRight: "0.3rem" }}>Model override</span>
                    {intake.requestedProvider ?? "—"}/{intake.requestedModel ?? "—"}
                </div>
            )}

            {classifyLog && (
                <>
                    <div style={SECTION_LABEL}>Classify call</div>
                    <RawTextBlock label="Prompt sent" text={classifyLog.renderedUserPrompt ?? classifyLog.inputPrompt} />
                    {classifyLog.rawResponse && <RawTextBlock label="Raw reply" text={classifyLog.rawResponse} />}
                    <JournalMeta
                        endpoint={classifyLog.endpoint}
                        provider={classifyLog.provider}
                        model={classifyLog.model}
                        finishReason={classifyLog.finishReason}
                        usage={classifyLog.usage}
                        durationMs={classifyLog.durationMs}
                        costEur={costEur}
                    />
                </>
            )}
        </div>
    );
}
