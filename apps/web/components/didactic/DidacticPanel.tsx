"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, MessageCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { getDidacticKnowledge, generateDidacticKnowledge } from "@/lib/api/didactic";
import type { DidacticArtifactKnowledge, DidacticKnowledgeStatusDto } from "@andy-code-cat/contracts";
import { DidacticExploreTab } from "./DidacticExploreTab";
import { DidacticAskTab } from "./DidacticAskTab";

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
}

export function DidacticPanel({ projectId, snapshotId, token, focus, onClearFocus }: DidacticPanelProps) {
    const [activeTab, setActiveTab] = useState<"explore" | "ask">("explore");
    const [statusDto, setStatusDto] = useState<DidacticKnowledgeStatusDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        try {
            const res = await generateDidacticKnowledge(token, projectId, { snapshotId, uiLanguage: "it" });
            setStatusDto({ status: "ready", knowledge: res.knowledge });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Errore generazione");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-card border-l border-border">
            {/* Tab bar */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
                <Button
                    type="button"
                    variant={activeTab === "explore" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab("explore")}
                    className="text-xs gap-1"
                >
                    <BookOpen size={13} />
                    Esplora
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
                    <Badge variant="outline" className="ml-auto text-[10px] gap-1">
                        <AlertTriangle size={10} />
                        Da rigenerare
                    </Badge>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0">
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

                {activeTab === "explore" && (
                    <ScrollArea className="h-full">
                        <DidacticExploreTab
                            status={statusDto?.status ?? "absent"}
                            knowledge={statusDto?.knowledge}
                            onGenerate={handleGenerate}
                            onRegenerate={handleGenerate}
                            generating={generating}
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
                    />
                )}
            </div>
        </div>
    );
}
