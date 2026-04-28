"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNotifications, type SystemNotification } from "../lib/notifications";

function NotificationRow({ n, onRemove }: { n: SystemNotification; onRemove: () => void }) {
    const { t } = useTranslation();
    const isRunning = n.status === "running";
    const isDone = n.status === "done";
    const isError = n.status === "error";

    return (
        <div className="flex items-start gap-3 border-b border-border px-3 py-3 text-sm last:border-b-0">
            <div
                className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                    isRunning && "border-primary/30 bg-primary/10",
                    isDone && "border-success/30 bg-success/10",
                    isError && "border-destructive/30 bg-destructive/10"
                )}
            >
                {isRunning ? (
                    <Loader2 className="size-4 animate-spin text-primary" />
                ) : isDone ? (
                    <CheckCircle2 className="size-4 text-success" />
                ) : (
                    <XCircle className="size-4 text-destructive" />
                )}
            </div>

            <div className="min-w-0 flex-1">
                <div className={cn("truncate font-medium", isError ? "text-destructive" : "text-foreground")}>
                    {n.label}
                </div>

                {isRunning && typeof n.progress === "number" && (
                    <div className="mt-1.5">
                        <Badge variant="outline" className="text-[11px]">
                            {Math.min(100, n.progress)}%
                        </Badge>
                    </div>
                )}

                {n.message && (
                    <div className={cn("mt-1 text-xs break-words", isError ? "text-destructive/90" : "text-muted-foreground")}>
                        {n.message}
                    </div>
                )}
            </div>

            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={onRemove}
                title={t("notifications.close")}
                aria-label={t("notifications.close")}
            >
                <X className="size-4" />
            </Button>
        </div>
    );
}

export function NotificationPanel({ hideTrigger = false }: { hideTrigger?: boolean }) {
    const { t } = useTranslation();
    const { notifications, remove, panelOpen, setPanelOpen } = useNotifications();
    const panelRef = useRef<HTMLDivElement>(null);

    const orderedNotifications = useMemo(
        () =>
            [...notifications].sort((a, b) => {
                const aRunning = a.status === "running";
                const bRunning = b.status === "running";

                if (aRunning !== bRunning) {
                    return aRunning ? -1 : 1;
                }

                return (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt);
            }),
        [notifications]
    );

    const runningCount = orderedNotifications.filter((n) => n.status === "running").length;
    const doneCount = orderedNotifications.filter((n) => n.status === "done").length;
    const errorCount = orderedNotifications.filter((n) => n.status === "error").length;
    const hasAny = orderedNotifications.length > 0;

    // Animate badge when a new notification is added
    const [bumped, setBumped] = useState(false);
    const prevCountRef = useRef(orderedNotifications.length);
    useEffect(() => {
        const curr = orderedNotifications.length;
        if (curr > prevCountRef.current) {
            setBumped(true);
            const timer = setTimeout(() => setBumped(false), 450);
            prevCountRef.current = curr;
            return () => clearTimeout(timer);
        }
        prevCountRef.current = curr;
    }, [orderedNotifications.length]);

    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setPanelOpen(false);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [setPanelOpen]);

    if (!hasAny && !panelOpen) return null;

    return (
        <div
            ref={panelRef}
            className="fixed right-4 top-[52px] z-[1000] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
            aria-live="polite"
        >
            {!hideTrigger && hasAny && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card/95 p-2 shadow-xl backdrop-blur">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPanelOpen(!panelOpen)}
                        title={panelOpen ? t("notifications.hide") : t("notifications.show")}
                        className={cn(
                            "gap-2 border-border bg-transparent",
                            runningCount > 0 && "border-primary/40 text-primary"
                        )}
                    >
                        {runningCount > 0 ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
                        <span className="max-w-44 truncate">
                            {runningCount > 0
                                ? t("notifications.running", { count: runningCount })
                                : t("notifications.completed", { count: doneCount || orderedNotifications.length })}
                        </span>
                        <Badge
                            variant={runningCount > 0 ? "accent" : "outline"}
                            className={cn(
                                "ml-1 transition-all duration-200",
                                bumped && "scale-150 ring-2 ring-primary/60"
                            )}
                        >
                            {runningCount > 0 ? runningCount : orderedNotifications.length}
                        </Badge>
                    </Button>

                    {doneCount > 0 && (
                        <Badge variant="success" className="hidden md:inline-flex">
                            {doneCount} ✓
                        </Badge>
                    )}

                    {errorCount > 0 && (
                        <Badge variant="destructive" className="hidden md:inline-flex">
                            {errorCount} !
                        </Badge>
                    )}
                </div>
            )}

            {panelOpen && hasAny && (
                <div className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t("notifications.title")}
                        </div>

                        {orderedNotifications.some((n) => n.status !== "running") && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                onClick={() => orderedNotifications.forEach((n) => n.status !== "running" && remove(n.id))}
                                title={t("notifications.clearTitle")}
                            >
                                {t("notifications.clear")}
                            </Button>
                        )}
                    </div>

                    <div className="max-h-[24rem] overflow-y-auto">
                        {orderedNotifications.map((n) => (
                            <NotificationRow key={n.id} n={n} onRemove={() => remove(n.id)} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
