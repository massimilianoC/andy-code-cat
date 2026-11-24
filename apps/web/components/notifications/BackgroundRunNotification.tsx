"use client";

/**
 * A background run in the notification manager (docs/specs/BACKGROUND_RUNS.md §3.5): while it
 * runs, the step in flight, a progress bar and the estimated time to go; once done, the deep links
 * to the Workspace and to the site (new window) and the proposed address; once failed, why.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ExternalLink, PenSquare } from "lucide-react";
import { BACKGROUND_RUN_STEP_COUNT, computeBackgroundRunProgress, type BackgroundRunDto } from "@andy-code-cat/contracts";
import { Button } from "@/components/ui/button";
import { cancelBackgroundRun } from "@/lib/api/backgroundRuns";
import { updateDeploymentSlug } from "@/lib/api/publish";
import { getAccessToken } from "@/lib/token-store";
import { isBackgroundRunActive, useNotifications, type NotificationLink } from "@/lib/notifications";

function useNow(active: boolean, everyMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setNow(Date.now()), everyMs);
        return () => window.clearInterval(timer);
    }, [active, everyMs]);
    return now;
}

function workspaceHref(run: BackgroundRunDto): string {
    return run.conversationId
        ? `/workspace/${run.projectId}?conv=${encodeURIComponent(run.conversationId)}`
        : `/workspace/${run.projectId}`;
}

/** The deep links of a notification, rendered with the platform's own names for the places. */
export function NotificationLinks({ links }: { links: NotificationLink[] }) {
    const { t } = useTranslation();
    if (links.length === 0) return null;
    return (
        <div className="mt-2 flex flex-wrap gap-2">
            {links.map((link) => link.kind === "site" ? (
                <Button key={link.kind} asChild size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                    <a href={link.href} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-3.5" />
                        {t("notifications.backgroundRun.openSite")}
                    </a>
                </Button>
            ) : (
                <Button key={link.kind} asChild size="sm" variant={link.kind === "workspace" ? "default" : "outline"} className="h-7 gap-1.5 px-2 text-xs">
                    <Link href={link.href}>
                        <PenSquare className="size-3.5" />
                        {link.kind === "workspace" ? t("notifications.backgroundRun.openWorkspace") : t("notifications.backgroundRun.completeBrief")}
                    </Link>
                </Button>
            ))}
        </div>
    );
}

function formatRemaining(ms: number, t: ReturnType<typeof useTranslation>["t"]): string {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return t("notifications.backgroundRun.remainingUnderMinute");
    return t("notifications.backgroundRun.remainingMinutes", { count: minutes });
}

export function BackgroundRunNotificationBody({ run }: { run: BackgroundRunDto }) {
    const { t } = useTranslation();
    const { refreshBackgroundRuns } = useNotifications();
    const active = isBackgroundRunActive(run);
    const now = useNow(active);
    const progress = computeBackgroundRunProgress(run, now);
    const [cancelling, setCancelling] = useState(false);
    const [slugState, setSlugState] = useState<{ status: "idle" | "saving" | "saved" | "error"; url?: string }>({ status: "idle" });

    async function cancel() {
        const token = getAccessToken();
        if (!token) return;
        setCancelling(true);
        try {
            await cancelBackgroundRun(token, run.id);
            await refreshBackgroundRuns();
        } finally {
            setCancelling(false);
        }
    }

    async function adoptSlug(slug: string) {
        const token = getAccessToken();
        if (!token) return;
        setSlugState({ status: "saving" });
        try {
            const deployment = await updateDeploymentSlug(token, run.projectId, slug);
            setSlugState({ status: "saved", url: deployment.publicUrl ?? undefined });
        } catch {
            setSlugState({ status: "error" });
        }
    }

    if (active) {
        const stepLabel = progress.step ? t(`notifications.backgroundRun.steps.${progress.step}`) : "";
        return (
            <div className="mt-1 space-y-1.5">
                <div className="text-xs text-muted-foreground">
                    {run.status === "queued"
                        ? t("notifications.backgroundRun.queued")
                        : t("notifications.backgroundRun.step", { number: progress.stepNumber, total: BACKGROUND_RUN_STEP_COUNT, label: stepLabel })}
                    {run.cancelRequested ? ` · ${t("notifications.backgroundRun.cancelling")}` : ""}
                </div>
                <progress
                    value={progress.percent}
                    max={100}
                    aria-label={t("notifications.backgroundRun.progressLabel", { percent: progress.percent })}
                    className="h-1.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
                />
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                        {progress.percent}%
                        {progress.remainingMs !== null ? ` · ${formatRemaining(progress.remainingMs, t)}` : ""}
                    </span>
                    {!run.cancelRequested && (
                        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" disabled={cancelling} onClick={() => void cancel()}>
                            {t("notifications.backgroundRun.cancel")}
                        </Button>
                    )}
                </div>
            </div>
        );
    }

    if (run.status === "done") {
        const siteUrl = slugState.url ?? run.site?.publicUrl;
        const links: NotificationLink[] = [{ kind: "workspace", href: workspaceHref(run) }];
        if (siteUrl) links.push({ kind: "site", href: siteUrl });
        const slug = run.site?.proposedSlug;
        return (
            <div className="mt-1">
                <div className="text-xs text-muted-foreground">{t("notifications.backgroundRun.done")}</div>
                <NotificationLinks links={links} />
                {slug && slugState.status !== "saved" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{t("notifications.backgroundRun.proposedSlug", { slug })}</span>
                        <Button type="button" variant="link" size="sm" className="h-6 px-0 text-xs" disabled={slugState.status === "saving"} onClick={() => void adoptSlug(slug)}>
                            {t("notifications.backgroundRun.adoptSlug")}
                        </Button>
                        {slugState.status === "error" && <span className="text-destructive">{t("notifications.backgroundRun.slugError")}</span>}
                    </div>
                )}
                {slugState.status === "saved" && (
                    <div className="mt-2 text-xs text-success">{t("notifications.backgroundRun.slugSaved", { slug })}</div>
                )}
            </div>
        );
    }

    // failed or cancelled: before the launch the brief can still be completed by hand.
    const beforeLaunch = !run.conversationId;
    return (
        <div className="mt-1">
            <div className="text-xs break-words text-destructive/90">
                {run.status === "cancelled"
                    ? t("notifications.backgroundRun.cancelled")
                    : run.error
                        ? t(`notifications.backgroundRun.errors.${run.error.code}`, { defaultValue: run.error.message })
                        : t("notifications.backgroundRun.failed")}
            </div>
            <NotificationLinks links={[beforeLaunch
                ? { kind: "launch", href: `/launch/${run.projectId}` }
                : { kind: "workspace", href: workspaceHref(run) }]}
            />
        </div>
    );
}
