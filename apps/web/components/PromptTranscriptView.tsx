"use client";

import { useMemo, useState } from "react";
import { splitIntoSegments } from "./promptTranscriptSegments";

export interface PromptTranscriptMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface PromptTranscriptViewProps {
    /** Conversation turns as they were sent to the provider, in order. */
    messages: PromptTranscriptMessage[];
    /** Header label per role — passed in so the caller keeps ownership of i18n. */
    labels: { user: string; assistant: string; system: string };
    /**
     * Which turn starts open. "last" mirrors reading order (the turn under discussion);
     * "none" is for pure inspection, where every turn should start folded.
     */
    initiallyOpen?: "last" | "none";
}

/** Lines of a code island shown while collapsed — enough to recognize it, short enough to scroll past. */
const CODE_PEEK_LINES = 3;
/** A prose run longer than this gets its own "show more" control. */
const PROSE_CLAMP_CHARS = 700;

function CodeIsland({ text, lang }: { text: string; lang?: string }) {
    const [open, setOpen] = useState(false);
    const lines = text.split("\n");
    const hidden = Math.max(0, lines.length - CODE_PEEK_LINES);
    const shown = open ? text : lines.slice(0, CODE_PEEK_LINES).join("\n");

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
                    padding: "0.3rem 0.6rem",
                    background: "#0d1728",
                    border: "none",
                    borderBottom: open ? "1px solid #24354d" : "none",
                    color: "#7dd3fc",
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    fontFamily: "monospace",
                    cursor: "pointer",
                    textAlign: "left",
                }}
            >
                <span style={{ flexShrink: 0 }}>{open ? "▼" : "▶"}</span>
                <span>{lang ? lang.toUpperCase() : "CODE"}</span>
                <span style={{ marginLeft: "auto", color: "#4b5563", fontWeight: 500 }}>
                    {open || hidden === 0 ? `${lines.length} righe` : `+${hidden} righe`}
                </span>
            </button>
            <pre
                style={{
                    margin: 0,
                    padding: "0.5rem 0.75rem",
                    background: "#060b14",
                    color: "#7f8ea3",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                    fontSize: "0.72rem",
                    lineHeight: 1.55,
                    whiteSpace: "pre",
                    overflowX: "auto",
                    maxHeight: open ? "22rem" : undefined,
                    overflowY: open ? "auto" : "hidden",
                }}
            >
                {shown}
                {!open && hidden > 0 ? "\n…" : ""}
            </pre>
        </div>
    );
}

function ProseBlock({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false);
    const needsClamp = text.length > PROSE_CLAMP_CHARS;
    const shown = needsClamp && !expanded ? `${text.slice(0, PROSE_CLAMP_CHARS)}…` : text;

    return (
        <div>
            <pre
                style={{
                    margin: 0,
                    padding: "0.4rem 0",
                    background: "transparent",
                    color: "#94a3b8",
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                    fontSize: "0.76rem",
                    lineHeight: 1.65,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                }}
            >
                {shown}
            </pre>
            {needsClamp && (
                <button
                    type="button"
                    onClick={() => setExpanded((prev) => !prev)}
                    style={{
                        background: "transparent",
                        border: "none",
                        color: "#7dd3fc",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: 0,
                    }}
                >
                    {expanded ? "mostra meno" : `mostra tutto (${text.length} caratteri)`}
                </button>
            )}
        </div>
    );
}

function TranscriptTurn({
    message,
    index,
    label,
    accent,
    startOpen,
}: {
    message: PromptTranscriptMessage;
    index: number;
    label: string;
    accent: string;
    startOpen: boolean;
}) {
    const [open, setOpen] = useState(startOpen);
    const segments = useMemo(() => splitIntoSegments(message.content), [message.content]);
    const codeCount = segments.filter((segment) => segment.kind === "code").length;
    const firstProse = segments.find((segment) => segment.kind === "prose")?.text ?? "";
    const preview = firstProse.replace(/\s+/g, " ").trim().slice(0, 90);

    return (
        <div style={{ marginTop: "0.5rem", border: "1px solid #1f2a3c", borderRadius: "6px", overflow: "hidden" }}>
            <div
                onClick={() => setOpen((prev) => !prev)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.4rem 0.7rem",
                    background: "#0c1523",
                    cursor: "pointer",
                    userSelect: "none",
                }}
            >
                <span style={{ fontSize: "0.7rem", color: "#6b7280", flexShrink: 0 }}>{open ? "▼" : "▶"}</span>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, color: accent, flexShrink: 0 }}>
                    {index + 1}. {label}
                </span>
                {!open && preview && (
                    <span
                        style={{
                            fontSize: "0.7rem",
                            color: "#4b5563",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                        }}
                    >
                        {preview}
                    </span>
                )}
                <span style={{ fontSize: "0.66rem", color: "#4b5563", marginLeft: "auto", flexShrink: 0 }}>
                    {codeCount > 0 ? `${codeCount} blocchi · ` : ""}
                    {message.content.length} char
                </span>
            </div>
            {open && (
                <div style={{ padding: "0.5rem 0.75rem", background: "#080e1a" }}>
                    {segments.map((segment, i) =>
                        segment.kind === "code" ? (
                            <CodeIsland key={`seg-${i}`} text={segment.text} lang={segment.lang} />
                        ) : (
                            <ProseBlock key={`seg-${i}`} text={segment.text} />
                        ),
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Conversation history as it was actually sent to the provider, folded.
 *
 * The previous rendering printed every turn as a fully expanded block. Once an artifact exists,
 * each turn carries the generated HTML/CSS/JS, so a handful of turns buried the conversation
 * under thousands of lines of markup and the panel stopped being usable for its one job:
 * letting a human read what the model received.
 *
 * Every turn is therefore collapsed to a one-line header, and code inside an open turn is folded
 * again into its own island — you expand only the turn, and only the block, you care about.
 */
export default function PromptTranscriptView({ messages, labels, initiallyOpen = "last" }: PromptTranscriptViewProps) {
    const turns = messages.filter((message) => message.role !== "system");
    if (turns.length === 0) return null;

    return (
        <div style={{ marginTop: "1rem" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", marginBottom: "0.35rem" }}>
                CRONOLOGIA INVIATA · {turns.length} messaggi
            </div>
            {turns.map((message, index) => (
                <TranscriptTurn
                    key={`turn-${index}`}
                    message={message}
                    index={index}
                    label={message.role === "assistant" ? labels.assistant : labels.user}
                    accent={message.role === "assistant" ? "#a78bfa" : "#7dd3fc"}
                    startOpen={initiallyOpen === "last" && index === turns.length - 1}
                />
            ))}
        </div>
    );
}
