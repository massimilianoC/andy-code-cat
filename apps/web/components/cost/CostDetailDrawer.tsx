"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import CostBreakdownTree from "./CostBreakdownTree";
import {
    getProjectCostSummary,
    getProjectCostTransactions,
    getUserCostSummary,
    type ProjectCostSummaryDto,
    type UserCostSummaryDto,
    type CostTypeBreakdownDto,
    type CostTransactionDto,
} from "@/lib/api/cost";

interface CostDetailDrawerProps {
    open: boolean;
    onClose: () => void;
    projectId?: string;
    userId?: string;
    scope: "project" | "user" | "system";
    label?: string;
}

function KpiCard({ title, value }: { title: string; value: string }) {
    return (
        <Card className="bg-card">
            <CardContent className="p-3 flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{title}</span>
                <span className="text-lg font-bold font-mono">{value}</span>
            </CardContent>
        </Card>
    );
}

function formatEur(n: number): string {
    if (n < 0.001) return `€${n.toFixed(4)}`;
    if (n < 0.01) return `€${n.toFixed(3)}`;
    return `€${n.toFixed(2)}`;
}

type LoadState = "idle" | "loading" | "loaded" | "error";

interface CostData {
    breakdown: CostTypeBreakdownDto[];
    transactions: CostTransactionDto[];
    totalEur: number;
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    txCount: number;
}

export default function CostDetailDrawer({
    open,
    onClose,
    projectId,
    scope,
    label,
}: CostDetailDrawerProps) {
    const [state, setState] = useState<LoadState>("idle");
    const [data, setData] = useState<CostData | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setState("loading");

        const fetchAll = async () => {
            try {
                let summaryData: ProjectCostSummaryDto | UserCostSummaryDto;
                let txData: CostTransactionDto[] = [];

                if (scope === "project" && projectId) {
                    const [summary, txResult] = await Promise.all([
                        getProjectCostSummary(projectId),
                        getProjectCostTransactions(projectId, 1, 50),
                    ]);
                    summaryData = summary;
                    txData = txResult.items;
                } else {
                    summaryData = await getUserCostSummary();
                }

                setData({
                    breakdown: summaryData.breakdown,
                    transactions: txData,
                    totalEur: summaryData.summary.totalEur,
                    providerCostEur: summaryData.summary.providerCostEur,
                    infraCostEur: summaryData.summary.infraCostEur,
                    platformMarkupEur: summaryData.summary.platformMarkupEur,
                    txCount: summaryData.summary.txCount,
                });
                setState("loaded");
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : "Errore nel caricamento dei dati di costo");
                setState("error");
            }
        };

        void fetchAll();
    }, [open, projectId, scope]);

    // Group transactions by resourceType for the tree
    const groups = (() => {
        if (!data) return [];
        const txByType = new Map<string, CostTransactionDto[]>();
        for (const tx of data.transactions) {
            const existing = txByType.get(tx.resourceType) ?? [];
            existing.push(tx);
            txByType.set(tx.resourceType, existing);
        }
        return data.breakdown.map((b) => ({
            breakdown: b,
            transactions: txByType.get(b.resourceType) ?? [],
        }));
    })();

    const scopeLabel = scope === "project" ? "Progetto" : scope === "user" ? "Utente" : "Piattaforma";
    const title = label ? `Costi — ${label}` : `Dettaglio costi — ${scopeLabel}`;

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="max-w-xl w-full p-0 gap-0 bg-background">
                <DialogHeader className="px-5 pt-5 pb-3">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                        Analisi dettagliata delle transazioni di costo. I valori sono in EUR.
                    </DialogDescription>
                </DialogHeader>

                <Separator />

                <ScrollArea className="max-h-[75vh]">
                    <div className="px-5 py-4 space-y-5">
                        {/* KPI summary */}
                        {state === "loading" && (
                            <div className="grid grid-cols-2 gap-2">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="h-16 rounded bg-muted animate-pulse" />
                                ))}
                            </div>
                        )}

                        {state === "error" && (
                            <p className="text-sm text-destructive py-2">{errorMsg}</p>
                        )}

                        {state === "loaded" && data && (
                            <>
                                <div className="grid grid-cols-2 gap-2">
                                    <KpiCard title="Totale" value={formatEur(data.totalEur)} />
                                    <KpiCard title="Transazioni" value={String(data.txCount)} />
                                    <KpiCard title="Costo provider" value={formatEur(data.providerCostEur)} />
                                    <KpiCard title="Infra + markup" value={formatEur(data.infraCostEur + data.platformMarkupEur)} />
                                </div>

                                <Separator />

                                {/* Breakdown tree */}
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground mb-2">Per tipo di risorsa</h3>
                                    <CostBreakdownTree groups={groups} />
                                </div>
                            </>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
