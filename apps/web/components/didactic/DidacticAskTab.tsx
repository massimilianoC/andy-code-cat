"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, X, Loader2, MessageSquare, Crosshair, ChevronDown } from "lucide-react";
import { streamDidacticAsk, listDidacticQna } from "@/lib/api/didactic";
import type { DidacticQnaEntry } from "@andy-code-cat/contracts";

interface DidacticAskTabProps {
    projectId: string;
    snapshotId: string;
    token: string;
    focus?: {
        kind: "preview" | "html" | "css" | "js";
        pfId?: string;
        outerHtml?: string;
        lineRange?: [number, number];
        selectedText?: string;
    } | null;
    onClearFocus?: () => void;
    /** Called after a successful ask so callers can refresh cost totals. */
    onCostUpdated?: () => void;
}

// ---------------------------------------------------------------------------
// Answer parsing — the backend LLM may return a raw JSON blob in the same
// format as build-mode chat: { "chat": { "summary": "...", "bullets": [...] } }
// This parser handles both raw JSON and code-fenced JSON gracefully, so the
// UI never displays raw JSON strings to the user.
// ---------------------------------------------------------------------------
interface ParsedAnswer {
    summary: string;
    bullets: string[];
    nextActions: string[];
}

function parseStructuredAnswer(content: string): ParsedAnswer | null {
    if (!content) return null;
    let text = content.trim();

    // Strip markdown code fences if present.
    if (text.startsWith("```")) {
        text = text.replace(/^```(?:json)?\s*\n?/i, "");
        const lastFence = text.lastIndexOf("```");
        if (lastFence > 0) text = text.slice(0, lastFence).trim();
    }

    if (!text.startsWith("{")) return null;

    try {
        const parsed = JSON.parse(text) as {
            chat?: { summary?: string; bullets?: unknown; nextActions?: unknown };
        };
        if (parsed?.chat?.summary) {
            return {
                summary: String(parsed.chat.summary),
                bullets: Array.isArray(parsed.chat.bullets)
                    ? (parsed.chat.bullets as unknown[]).map(String)
                    : [],
                nextActions: Array.isArray(parsed.chat.nextActions)
                    ? (parsed.chat.nextActions as unknown[]).map(String)
                    : [],
            };
        }
    } catch {
        // Fall through — render as plain text.
    }

    return null;
}

// ---------------------------------------------------------------------------
// Lightweight inline markdown renderer — handles the subset LLMs typically
// produce: **bold**, *italic*, `code`, no external dependencies required.
// ---------------------------------------------------------------------------
function renderInlineMarkdown(text: string): React.ReactNode[] {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
    return parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
            return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*"))
            return <em key={i}>{part.slice(1, -1)}</em>;
        if (part.startsWith("`") && part.endsWith("`"))
            return <code key={i} className="bg-muted px-1 rounded text-[11px] font-mono">{part.slice(1, -1)}</code>;
        return part;
    });
}

function renderMarkdown(text: string): React.ReactNode {
    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];
    const pending: string[] = [];

    const flushList = () => {
        if (pending.length === 0) return;
        elements.push(
            <ul key={`ul-${elements.length}`} className="pl-4 list-disc space-y-0.5 my-1">
                {pending.map((item, i) => (
                    <li key={i}>{renderInlineMarkdown(item)}</li>
                ))}
            </ul>
        );
        pending.length = 0;
    };

    lines.forEach((line, i) => {
        const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
        if (headingMatch) {
            flushList();
            const level = headingMatch[1].length;
            const cls =
                level === 1
                    ? "text-sm font-bold mt-2 mb-0.5"
                    : level === 2
                    ? "text-xs font-bold mt-2 mb-0.5"
                    : "text-xs font-semibold mt-1.5 mb-0.5";
            elements.push(
                <p key={i} className={cls}>
                    {renderInlineMarkdown(headingMatch[2])}
                </p>
            );
            return;
        }
        const listMatch = line.match(/^[-*]\s+(.*)/);
        if (listMatch) {
            pending.push(listMatch[1]);
            return;
        }
        flushList();
        if (line.trim() === "") return;
        elements.push(
            <p key={i} className="leading-relaxed">
                {renderInlineMarkdown(line)}
            </p>
        );
    });

    flushList();
    return elements.length === 1 ? elements[0] : <>{elements}</>;
}

// ---------------------------------------------------------------------------
// Shared answer renderer — used for live answer and Q&A history entries.
// ---------------------------------------------------------------------------
export function AnswerContent({ content, compact = false }: { content: string; compact?: boolean }) {
    const structured = parseStructuredAnswer(content);

    if (!structured) {
        if (compact) {
            const firstLine = content.split("\n").find((l) => l.trim()) ?? content;
            return <span className="line-clamp-3 whitespace-pre-wrap">{firstLine}</span>;
        }
        return <div className="space-y-1">{renderMarkdown(content)}</div>;
    }

    return (
        <div className="space-y-1.5">
            <div className={compact ? "line-clamp-3" : undefined}>
                {renderMarkdown(structured.summary)}
            </div>
            {!compact && structured.bullets.length > 0 && (
                <ul className="pl-4 space-y-0.5 list-disc">
                    {structured.bullets.map((b, i) => (
                        <li key={i}>{renderInlineMarkdown(b)}</li>
                    ))}
                </ul>
            )}
            {!compact && structured.nextActions.length > 0 && (
                <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-2 mb-0.5">
                        Prossimi passi
                    </div>
                    <ol className="pl-4 space-y-0.5 list-decimal">
                        {structured.nextActions.map((a, i) => (
                            <li key={i}>{renderInlineMarkdown(a)}</li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function DidacticAskTab({
    projectId,
    snapshotId,
    token,
    focus,
    onClearFocus,
    onCostUpdated,
}: DidacticAskTabProps) {
    const [question, setQuestion] = useState("");
    const [displayedAnswer, setDisplayedAnswer] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [history, setHistory] = useState<DidacticQnaEntry[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const loadHistory = async () => {
        setLoadingHistory(true);
        try {
            const res = await listDidacticQna(token, projectId);
            setHistory(res.entries);
        } catch {
            // silently fail
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => {
        loadHistory();
    }, [projectId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [displayedAnswer, streaming]);

    const handleSend = async () => {
        if (!question.trim() || streaming) return;
        setStreaming(true);
        setDisplayedAnswer("");

        try {
            await streamDidacticAsk(
                token,
                projectId,
                {
                    snapshotId,
                    question: question.trim(),
                    focus: focus
                        ? {
                              kind: focus.kind,
                              pfId: focus.pfId,
                              outerHtml: focus.outerHtml,
                              lineRange: focus.lineRange,
                              selectedText: focus.selectedText,
                          }
                        : undefined,
                    uiLanguage: "it",
                },
                (event) => {
                    if (event.type === "token") {
                        setDisplayedAnswer((prev) => prev + event.content);
                    } else if (event.type === "answer") {
                        // backward compat: single-chunk delivery
                        setDisplayedAnswer(event.content);
                    }
                }
            );
            await loadHistory();
            onCostUpdated?.();
        } catch (e) {
            setDisplayedAnswer(
                (prev) =>
                    (prev ? prev + "\n\n" : "") +
                    "[Errore: " +
                    (e instanceof Error ? e.message : "richiesta fallita") +
                    "]"
            );
        } finally {
            setStreaming(false);
            setQuestion("");
        }
    };

    const focusLabel = focus
        ? focus.kind === "preview"
            ? `Elemento <${focus.pfId ?? "preview"}>`
            : `${focus.kind.toUpperCase()} L${focus.lineRange?.[0] ?? "?"}-${focus.lineRange?.[1] ?? "?"}`
        : null;

    return (
        <div className="flex flex-col h-full">
            {/* Chat area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {displayedAnswer && (
                    <div className="bg-muted/40 rounded-lg p-3 text-sm">
                        <AnswerContent content={displayedAnswer} />
                        {streaming && (
                            <span className="inline-block w-1.5 h-3.5 bg-primary/60 animate-pulse ml-0.5 align-middle rounded-sm" />
                        )}
                    </div>
                )}
                {!displayedAnswer && !streaming && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                        Fai una domanda sull&apos;artifact. Puoi selezionare un elemento nel preview o nel
                        codice per contestualizzare la risposta.
                    </p>
                )}
                {streaming && !displayedAnswer && (
                    <div className="flex items-center text-xs text-muted-foreground">
                        <Loader2 className="animate-spin mr-2" size={12} />
                        Generazione risposta...
                    </div>
                )}
            </div>

            {/* Q&A history — collapsible accordion, closed by default */}
            <div className="border-t border-border">
                <button
                    type="button"
                    className="flex items-center justify-between w-full px-4 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setHistoryOpen((v) => !v)}
                >
                    <span className="flex items-center gap-1.5">
                        <MessageSquare size={11} />
                        Cronologia Q&amp;A
                        {history.length > 0 && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 min-w-[1.25rem]">
                                {history.length}
                            </Badge>
                        )}
                    </span>
                    <ChevronDown
                        size={12}
                        className={`transition-transform duration-200 ${historyOpen ? "rotate-180" : ""}`}
                    />
                </button>

                {historyOpen && (
                    <div className="px-4 pb-4 space-y-2 max-h-64 overflow-y-auto">
                        {loadingHistory && (
                            <Loader2 className="animate-spin text-muted-foreground" size={14} />
                        )}
                        {!loadingHistory && history.length === 0 && (
                            <p className="text-xs text-muted-foreground">Nessuna domanda precedente.</p>
                        )}
                        {history.map((entry) => (
                            <div
                                key={entry.id}
                                className="rounded border border-border/50 p-2 space-y-1"
                            >
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-[10px]">
                                        {entry.snapshotId.slice(-6)}
                                    </Badge>
                                    <span className="text-xs font-medium truncate">{entry.question}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    <AnswerContent content={entry.answer} compact />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Input area */}
            <div className="p-3 border-t border-border space-y-2">
                {focusLabel && (
                    <div className="flex items-center gap-2">
                        <Badge variant="accent" className="text-[10px] gap-1">
                            <Crosshair size={10} />
                            {focusLabel}
                        </Badge>
                        {onClearFocus && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={onClearFocus}
                            >
                                <X size={10} />
                            </Button>
                        )}
                    </div>
                )}
                <div className="flex gap-2">
                    <Input
                        placeholder="Chiedi qualcosa sull'artifact..."
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleSend();
                            }
                        }}
                        disabled={streaming}
                        className="text-sm"
                    />
                    <Button
                        type="button"
                        size="icon"
                        onClick={() => void handleSend()}
                        disabled={!question.trim() || streaming}
                    >
                        {streaming ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                    </Button>
                </div>
            </div>
        </div>
    );
}
