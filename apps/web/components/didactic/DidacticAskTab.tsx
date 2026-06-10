"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Send, X, Loader2, MessageSquare, Crosshair } from "lucide-react";
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
}

export function DidacticAskTab({ projectId, snapshotId, token, focus, onClearFocus }: DidacticAskTabProps) {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [streaming, setStreaming] = useState(false);
    const [history, setHistory] = useState<DidacticQnaEntry[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
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
    }, [answer, streaming]);

    const handleSend = async () => {
        if (!question.trim() || streaming) return;
        setStreaming(true);
        setAnswer("");

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
                    if (event.type === "answer") {
                        setAnswer((prev) => prev + event.content);
                    }
                }
            );
            await loadHistory();
        } catch (e) {
            setAnswer((prev) => prev + "\n\n[Errore: " + (e instanceof Error ? e.message : "richiesta fallita") + "]");
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
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {answer && (
                    <div className="bg-muted/40 rounded-lg p-3 text-sm whitespace-pre-wrap">
                        {answer}
                    </div>
                )}
                {!answer && !streaming && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                        Fai una domanda sull&apos;artifact. Puoi selezionare un elemento nel preview o nel codice per contestualizzare la risposta.
                    </p>
                )}
                {streaming && !answer && (
                    <div className="flex items-center text-xs text-muted-foreground">
                        <Loader2 className="animate-spin mr-2" size={12} />
                        Generazione risposta...
                    </div>
                )}

                <Separator />

                {/* History */}
                <div className="space-y-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                        <MessageSquare size={10} />
                        Cronologia Q&A
                    </h4>
                    {loadingHistory && <Loader2 className="animate-spin text-muted-foreground" size={14} />}
                    {history.length === 0 && !loadingHistory && (
                        <p className="text-xs text-muted-foreground">Nessuna domanda precedente.</p>
                    )}
                    {history.map((entry) => (
                        <div key={entry.id} className="rounded border border-border/50 p-2 space-y-1">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[10px]">{entry.snapshotId.slice(-6)}</Badge>
                                <span className="text-xs font-medium truncate">{entry.question}</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-3">{entry.answer}</p>
                        </div>
                    ))}
                </div>
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
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={onClearFocus}>
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
                                handleSend();
                            }
                        }}
                        disabled={streaming}
                        className="text-sm"
                    />
                    <Button type="button" size="icon" onClick={handleSend} disabled={!question.trim() || streaming}>
                        {streaming ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                    </Button>
                </div>
            </div>
        </div>
    );
}
