"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AiUsageAnalyticsDto } from "@/lib/api/assets";
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
    title = "AI usage recap",
    subtitle,
    analytics,
    loading = false,
    compact = false,
    projectId,
}: AiUsageSummaryPanelProps) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm">{title}</CardTitle>
                {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading AI analytics…</p>
                ) : !analytics ? (
                    <p className="text-sm text-muted-foreground">No AI activity yet for this scope.</p>
                ) : (
                    <>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-md border border-border bg-muted/20 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total cost</p>
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
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Image gen</p>
                                <p className="mt-1 text-lg font-semibold text-foreground">{formatMoney(analytics.totals.imageCost)}</p>
                                <p className="text-[11px] text-muted-foreground">{analytics.totals.imageRuns} runs</p>
                            </div>
                            <div className="rounded-md border border-border bg-muted/20 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">LLM spend</p>
                                <p className="mt-1 text-lg font-semibold text-foreground">{formatMoney(analytics.totals.llmCost)}</p>
                                <p className="text-[11px] text-muted-foreground">{analytics.totals.llmRuns} runs</p>
                            </div>
                            <div className="rounded-md border border-border bg-muted/20 p-3">
                                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tokens</p>
                                <p className="mt-1 text-lg font-semibold text-foreground">{formatTokens(analytics.totals.totalTokens)}</p>
                                <p className="text-[11px] text-muted-foreground">
                                    {analytics.totals.queuedImages} queued · {analytics.totals.failedImages} failed
                                </p>
                            </div>
                        </div>

                        {analytics.topModels.length > 0 ? (
                            <div className="space-y-2">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Top models</p>
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
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent requests</p>
                            {analytics.recentRequests.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No requests logged yet.</p>
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
                                            <p className="mt-2 text-sm text-foreground">{entry.promptPreview || "No prompt preview available."}</p>
                                            <p className="mt-1 text-[11px] text-muted-foreground">
                                                {new Date(entry.createdAt).toLocaleString()} · {entry.provider}
                                                {entry.totalTokens ? ` · ${formatTokens(entry.totalTokens)} tokens` : ""}
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
    );
}
