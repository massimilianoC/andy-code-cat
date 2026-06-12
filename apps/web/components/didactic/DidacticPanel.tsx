"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, MessageCircle, HelpCircle, Loader2, AlertTriangle } from "lucide-react";
import { getDidacticKnowledge, generateDidacticKnowledge } from "@/lib/api/didactic";
import type { DidacticKnowledgeStatusDto } from "@andy-code-cat/contracts";
import { DidacticExploreTab } from "./DidacticExploreTab";
import { DidacticAskTab } from "./DidacticAskTab";

const GENERATION_PHASES: { ms: number; text: string }[] = [
    { ms: 0, text: "🔍 Analizzando HTML/CSS/JS..." },
    { ms: 3000, text: "🧠 Generando argomenti..." },
    { ms: 7000, text: "❓ Creando quiz..." },
    { ms: 12000, text: "✅ Quasi pronto..." },
];

interface DidacticPanelProps {
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
    /** Called when the user clicks a topic anchor — lets the workspace switch to the relevant code tab. */
    onAnchorFocus?: (kind: "html" | "css" | "js", lineRange?: [number, number]) => void;
    /** Called after a successful generate or ask operation so callers can refresh cost totals. */
    onCostUpdated?: () => void;
}

export function DidacticPanel({
    projectId,
    snapshotId,
    token,
    focus,
    onClearFocus,
    onAnchorFocus,
    onCostUpdated,
}: DidacticPanelProps) {
    const [activeTab, setActiveTab] = useState<"analyze" | "quiz" | "ask">("analyze");
    const [statusDto, setStatusDto] = useState<DidacticKnowledgeStatusDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [generatingPhase, setGeneratingPhase] = useState("");
    const [error, setError] = useState<string | null>(null);
    const phaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getDidacticKnowledge(token, projectId, snapshotId);
            setStatusDto(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Errore di caricamento");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [projectId, snapshotId]);

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);

        // Simulate generation phases for perceived progress feedback.
        phaseTimersRef.current.forEach(clearTimeout);
        phaseTimersRef.current = GENERATION_PHASES.map(({ ms, text }) =>
            setTimeout(() => setGeneratingPhase(text), ms)
        );

        try {
            const res = await generateDidacticKnowledge(token, projectId, { snapshotId, uiLanguage: "it" });
            setStatusDto({ status: "ready", knowledge: res.knowledge });
            setActiveTab("analyze");
            onCostUpdated?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Errore generazione");
        } finally {
            phaseTimersRef.current.forEach(clearTimeout);
            phaseTimersRef.current = [];
            setGenerating(false);
            setGeneratingPhase("");
        }
    };

    const hasKnowledge = statusDto?.status !== "absent" && !!statusDto?.knowledge;
    const quizCount = statusDto?.knowledge?.quizzes?.length ?? 0;

    return (
        <div className="flex flex-col h-full bg-card border-l border-border">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
                <Button
                    type="button"
                    variant={activeTab === "analyze" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab("analyze")}
                    className="text-xs gap-1"
                >
                    <BookOpen size={13} />
                    Analisi
                </Button>
                <Button
                    type="button"
                    variant={activeTab === "quiz" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab("quiz")}
                    className="text-xs gap-1"
                    disabled={!hasKnowledge}
                    title={!hasKnowledge ? "Genera prima un'analisi" : undefined}
                >
                    <HelpCircle size={13} />
                    Quiz
                    {hasKnowledge && quizCount > 0 && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 min-w-[1rem]">
                            {quizCount}
                        </Badge>
                    )}
                </Button>
                <Button
                    type="button"
                    variant={activeTab === "ask" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab("ask")}
                    className="text-xs gap-1"
                >
                    <MessageCircle size={13} />
                    Chiedi
                </Button>
                {statusDto?.status === "stale" && (
                    <Badge variant="outline" className="ml-auto text-[10px] gap-1 shrink-0">
                        <AlertTriangle size={10} />
                        Da rigenerare
                    </Badge>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 relative">
                {/* Panel-level generation overlay with phase progress. */}
                {generating && (
                    <div className="absolute inset-0 z-20 bg-card/85 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 space-y-3">
                        <Loader2 className="animate-spin text-primary" size={36} />
                        <div className="space-y-1">
                            <p className="text-sm font-medium">
                                {generatingPhase || "Analisi didattica in corso..."}
                            </p>
                            <p className="text-xs text-muted-foreground max-w-[240px]">
                                L&apos;AI esamina il codice e costruisce argomenti, quiz e risposte.
                            </p>
                        </div>
                    </div>
                )}

                {loading && !statusDto && (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                        <Loader2 className="animate-spin mr-2" size={14} />
                        Caricamento...
                    </div>
                )}

                {error && (
                    <div className="p-4 space-y-2">
                        <p className="text-sm text-destructive">{error}</p>
                        <Button type="button" size="sm" variant="outline" onClick={load}>
                            Riprova
                        </Button>
                    </div>
                )}

                {activeTab !== "ask" && (
                    <ScrollArea className="h-full">
                        <DidacticExploreTab
                            status={statusDto?.status ?? "absent"}
                            knowledge={statusDto?.knowledge}
                            onGenerate={handleGenerate}
                            onRegenerate={handleGenerate}
                            generating={generating}
                            section={activeTab === "analyze" ? "analyze" : "quiz"}
                            onAnchorClick={onAnchorFocus}
                        />
                    </ScrollArea>
                )}

                {activeTab === "ask" && (
                    <DidacticAskTab
                        projectId={projectId}
                        snapshotId={snapshotId}
                        token={token}
                        focus={focus}
                        onClearFocus={onClearFocus}
                        onCostUpdated={onCostUpdated}
                    />
                )}
            </div>
        </div>
    );
}
