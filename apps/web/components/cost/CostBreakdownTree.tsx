"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CostTypeBreakdownDto, CostTransactionDto } from "@andy-code-cat/contracts";

interface ResourceGroup {
    breakdown: CostTypeBreakdownDto;
    transactions: CostTransactionDto[];
}

interface CostBreakdownTreeProps {
    groups: ResourceGroup[];
    loading?: boolean;
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
    "llm.chat": "Chat LLM",
    "llm.preprompt": "Pre-prompt LLM",
    "llm.prompt_opt": "Ottimizzazione prompt",
    "llm.template_draft": "Bozza template LLM",
    "llm.embedding": "Embedding LLM",
    "llm.background": "LLM background",
    "image.gen": "Generazione immagine",
    "image.prompt_opt": "Ottimizzazione prompt immagine",
    "image.suggest": "Suggerimento immagine",
    "video.gen": "Generazione video",
    "compute.task": "Task computazione",
    "compute.gpu": "GPU",
    "compute.lambda": "Lambda",
    "compute.storage": "Storage",
    "platform.export": "Export",
    "platform.domain": "Dominio",
    "platform.event": "Evento",
    "platform.fixed": "Costo fisso",
};

function labelFor(type: string): string {
    return RESOURCE_TYPE_LABELS[type] ?? type;
}

function formatEur(n: number): string {
    if (n < 0.001) return `€${n.toFixed(4)}`;
    if (n < 0.01) return `€${n.toFixed(3)}`;
    return `€${n.toFixed(2)}`;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function TransactionRow({ tx }: { tx: CostTransactionDto }) {
    return (
        <div className="flex items-center justify-between py-1.5 pl-8 pr-2 text-xs text-muted-foreground border-l border-border/40 ml-4">
            <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-mono text-[10px] truncate text-muted-foreground/60">
                    {tx.txId}
                </span>
                <span>{formatDate(tx.createdAt)}</span>
                {tx.resourceSubtype && (
                    <span className="text-[10px] truncate">{tx.resourceSubtype}</span>
                )}
            </div>
            <div className="flex items-center gap-2 ml-2 shrink-0">
                {tx.status === "voided" && (
                    <Badge variant="destructive" className="text-[10px] px-1 py-0">
                        void
                    </Badge>
                )}
                <span className={cn("font-mono font-medium", tx.status === "voided" && "line-through opacity-40")}>
                    {formatEur(tx.totalEur)}
                </span>
            </div>
        </div>
    );
}

function GroupRow({ group }: { group: ResourceGroup }) {
    const [open, setOpen] = useState(false);
    const { breakdown, transactions } = group;

    return (
        <div className="rounded border border-border/50 overflow-hidden">
            <Button
                type="button"
                variant="ghost"
                className="w-full flex items-center justify-between h-auto px-3 py-2.5 rounded-none hover:bg-muted/50"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {open ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm font-medium truncate">{labelFor(breakdown.resourceType)}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {breakdown.txCount}
                    </Badge>
                </div>
                <span className="font-mono text-sm font-semibold shrink-0 ml-4">
                    {formatEur(breakdown.totalEur)}
                </span>
            </Button>

            {open && (
                <div className="bg-muted/20 py-1">
                    {/* Cost breakdown sub-row */}
                    <div className="flex gap-4 px-3 py-1.5 text-xs text-muted-foreground border-b border-border/30">
                        <span>Provider: <span className="font-mono">{formatEur(breakdown.providerCostEur)}</span></span>
                        <span>Infra: <span className="font-mono">{formatEur(breakdown.infraCostEur)}</span></span>
                        <span>Markup: <span className="font-mono">{formatEur(breakdown.platformMarkupEur)}</span></span>
                    </div>
                    {transactions.length === 0 ? (
                        <p className="pl-8 py-2 text-xs text-muted-foreground">Nessuna transazione recente</p>
                    ) : (
                        transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
                    )}
                </div>
            )}
        </div>
    );
}

export default function CostBreakdownTree({ groups, loading }: CostBreakdownTreeProps) {
    if (loading) {
        return (
            <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 rounded bg-muted animate-pulse" />
                ))}
            </div>
        );
    }

    if (groups.length === 0) {
        return <p className="text-sm text-muted-foreground py-4 text-center">Nessun dato di costo disponibile.</p>;
    }

    return (
        <div className="space-y-1.5">
            {groups.map((g) => (
                <GroupRow key={g.breakdown.resourceType} group={g} />
            ))}
        </div>
    );
}
