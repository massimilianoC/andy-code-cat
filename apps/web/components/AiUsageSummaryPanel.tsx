"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DisclosurePanel } from "@/components/ui/disclosure-panel";
import type { AiUsageAnalyticsDto, AiUsageRecentRequestDto } from "@/lib/api/assets";
import CostBadge from "@/components/cost/CostBadge";

interface AiUsageSummaryPanelProps {
    title?: string;
    subtitle?: string;
    analytics: AiUsageAnalyticsDto | null;
    loading?: boolean;
    compact?: boolean;
    /** When provided, the "Total cost" KPI becomes a clickable CostBadge opening the ledger drawer. */
    projectId?: string;
}

function formatMoney(amount: number | undefined): string {
    const value = Number(amount ?? 0);
    if (value <= 0) return "€0.00";
    if (value < 0.01) return `€${value.toFixed(4)}`;
    if (value < 1) return `€${value.toFixed(3)}`;
    return `€${value.toFixed(2)}`;
}

function formatTokens(value: number | undefined): string {
    const total = Number(value ?? 0);
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
    if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K`;
    return String(total);
}

export default function AiUsageSummaryPanel({
    title,
    subtitle,
    analytics,
    loading = false,
    compact = false,
    projectId,
}: AiUsageSummaryPanelProps) {
    const { t } = useTranslation();
    const [selectedRequest, setSelectedRequest] = useState<AiUsageRecentRequestDto | null>(null);
    const resolvedTitle = title ?? t("aiUsagePanel.title");
    const resolvedSubtitle = subtitle ?? undefined;

    return (
        <>
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{resolvedTitle}</CardTitle>
                    {resolvedSubtitle ? <p className="text-xs text-muted-foreground">{resolvedSubtitle}</p> : null}
                </CardHeader>
                <CardContent className="space-y-4">
                    {loading ? (
                        <p className="text-sm text-muted-foreground">{t("aiUsagePanel.loading")}</p>
                    ) : !analytics ? (
                        <p className="text-sm text-muted-foreground">{t("aiUsagePanel.emptyState")}</p>
                    ) : (
                        <>
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-md border border-border bg-muted/20 p-3">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.totalCost")}</p>
                                    <p className="mt-1 text-lg font-semibold text-foreground">
                                        {projectId ? (
                                            <CostBadge
                                                amount={analytics.totals.totalCost ?? 0}
                                                projectId={projectId}
                                                scope="project"
                                                variant="kpi"
                                            />
                                        ) : (
                                            formatMoney(analytics.totals.totalCost)
                                        )}
                                    </p>
                                </div>
                                <div className="rounded-md border border-border bg-muted/20 p-3">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.imageGen")}</p>
                                    <p className="mt-1 text-lg font-semibold text-foreground">{formatMoney(analytics.totals.imageCost)}</p>
                                    <p className="text-[11px] text-muted-foreground">{t("aiUsagePanel.runs", { count: analytics.totals.imageRuns })}</p>
                                </div>
                                <div className="rounded-md border border-border bg-muted/20 p-3">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.llmSpend")}</p>
                                    <p className="mt-1 text-lg font-semibold text-foreground">{formatMoney(analytics.totals.llmCost)}</p>
                                    <p className="text-[11px] text-muted-foreground">{t("aiUsagePanel.runs", { count: analytics.totals.llmRuns })}</p>
                                </div>
                                <div className="rounded-md border border-border bg-muted/20 p-3">
                                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.tokens")}</p>
                                    <p className="mt-1 text-lg font-semibold text-foreground">{formatTokens(analytics.totals.totalTokens)}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                        {t("aiUsagePanel.queuedFailed", {
                                            queued: analytics.totals.queuedImages,
                                            failed: analytics.totals.failedImages,
                                        })}
                                    </p>
                                </div>
                            </div>

                            {analytics.topModels.length > 0 ? (
                                <div className="space-y-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.topModels")}</p>
                                    <div className="flex flex-wrap gap-2">
                                        {analytics.topModels.slice(0, compact ? 4 : 8).map((entry) => (
                                            <Badge key={`${entry.kind}-${entry.provider}-${entry.model}`} variant="outline" className="text-[10px]">
                                                {entry.kind} · {entry.model} · {formatMoney(entry.totalCost)}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            {!compact ? <Separator /> : null}

                            <div className="space-y-2">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.recentRequests")}</p>
                                {analytics.recentRequests.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{t("aiUsagePanel.noRequests")}</p>
                                ) : (
                                    <div className="space-y-2">
                                        {analytics.recentRequests.slice(0, compact ? 4 : 8).map((entry) => (
                                            <div key={`${entry.kind}-${entry.id}`} className="rounded-md border border-border bg-background/60 p-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant={entry.kind === "image" ? "secondary" : "outline"} className="text-[10px] uppercase">
                                                        {entry.kind}
                                                    </Badge>
                                                    <Badge variant={entry.status === "failed" ? "destructive" : "outline"} className="text-[10px] uppercase">
                                                        {entry.status}
                                                    </Badge>
                                                    <span className="text-xs font-medium text-foreground">{entry.model ?? entry.provider}</span>
                                                    <span className="ml-auto text-xs text-muted-foreground">{formatMoney(entry.costEur)}</span>
                                                </div>
                                                <p className="mt-2 text-sm text-foreground">{entry.promptPreview || t("aiUsagePanel.noPromptPreview")}</p>
                                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                    {entry.mediaResolution ? (
                                                        <>
                                                            <Badge
                                                                variant={entry.mediaResolution.degraded ? "secondary" : "success"}
                                                                className="text-[10px] uppercase"
                                                            >
                                                                {t("aiUsagePanel.mediaOkCount", { count: entry.mediaResolution.resolvedCount })}
                                                            </Badge>
                                                            {entry.mediaResolution.failedCount > 0 ? (
                                                                <Badge variant="destructive" className="text-[10px] uppercase">
                                                                    {t("aiUsagePanel.failedCount", { count: entry.mediaResolution.failedCount })}
                                                                </Badge>
                                                            ) : null}
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-6 px-2 text-[10px]"
                                                                onClick={() => setSelectedRequest(entry)}
                                                            >
                                                                {t("aiUsagePanel.details")}
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                </div>
                                                <p className="mt-1 text-[11px] text-muted-foreground">
                                                    {new Date(entry.createdAt).toLocaleString()} · {entry.provider}
                                                    {entry.totalTokens ? ` · ${formatTokens(entry.totalTokens)} ${t("aiUsagePanel.tokensLower")}` : ""}
                                                    {entry.imageSize ? ` · ${entry.imageSize}` : ""}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <Dialog open={Boolean(selectedRequest)} onOpenChange={(open) => !open && setSelectedRequest(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t("aiUsagePanel.dialogTitle")}</DialogTitle>
                        <DialogDescription>
                            {t("aiUsagePanel.dialogDescription")}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedRequest ? (
                        <ScrollArea className="max-h-[70vh] pr-4">
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="text-[10px] uppercase">{selectedRequest.kind}</Badge>
                                    <Badge
                                        variant={selectedRequest.mediaResolution?.degraded ? "secondary" : "outline"}
                                        className="text-[10px] uppercase"
                                    >
                                        {selectedRequest.status}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] uppercase">{selectedRequest.provider}</Badge>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    <div className="rounded-md border border-border bg-muted/20 p-3">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.model")}</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{selectedRequest.model ?? "—"}</p>
                                    </div>
                                    <div className="rounded-md border border-border bg-muted/20 p-3">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.cost")}</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{formatMoney(selectedRequest.costEur)}</p>
                                    </div>
                                    <div className="rounded-md border border-border bg-muted/20 p-3">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.tokens")}</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{formatTokens(selectedRequest.totalTokens)}</p>
                                    </div>
                                    <div className="rounded-md border border-border bg-muted/20 p-3">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.created")}</p>
                                        <p className="mt-1 text-sm font-medium text-foreground">{new Date(selectedRequest.createdAt).toLocaleString()}</p>
                                    </div>
                                </div>

                                {selectedRequest.mediaResolution ? (
                                    <div className="rounded-lg border border-border bg-background/60 p-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant="success" className="text-[10px] uppercase">
                                                {t("aiUsagePanel.resolvedCount", { count: selectedRequest.mediaResolution.resolvedCount })}
                                            </Badge>
                                            <Badge
                                                variant={selectedRequest.mediaResolution.failedCount > 0 ? "destructive" : "outline"}
                                                className="text-[10px] uppercase"
                                            >
                                                {t("aiUsagePanel.failedCount", { count: selectedRequest.mediaResolution.failedCount })}
                                            </Badge>
                                            <Badge
                                                variant={selectedRequest.mediaResolution.degraded ? "secondary" : "success"}
                                                className="text-[10px] uppercase"
                                            >
                                                {selectedRequest.mediaResolution.degraded ? t("aiUsagePanel.degraded") : t("aiUsagePanel.clean")}
                                            </Badge>
                                        </div>
                                    </div>
                                ) : null}

                                <DisclosurePanel
                                    title={t("aiUsagePanel.promptPreviewTitle")}
                                    subtitle={t("aiUsagePanel.promptPreviewSubtitle")}
                                    defaultOpen
                                >
                                    <p className="whitespace-pre-wrap text-sm text-foreground">
                                        {selectedRequest.promptPreview || t("aiUsagePanel.noPromptPreview")}
                                    </p>
                                </DisclosurePanel>

                                <DisclosurePanel
                                    title={t("aiUsagePanel.technicalSummaryTitle")}
                                    subtitle={t("aiUsagePanel.technicalSummarySubtitle")}
                                >
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="rounded-md border border-border bg-muted/20 p-3">
                                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.requestId")}</p>
                                            <p className="mt-1 break-all font-mono text-sm text-foreground">{selectedRequest.id}</p>
                                        </div>
                                        <div className="rounded-md border border-border bg-muted/20 p-3">
                                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("aiUsagePanel.imageSize")}</p>
                                            <p className="mt-1 text-sm font-medium text-foreground">{selectedRequest.imageSize ?? "—"}</p>
                                        </div>
                                    </div>
                                </DisclosurePanel>
                            </div>
                        </ScrollArea>
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    );
}
