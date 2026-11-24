"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    BACKGROUND_RUN_TERMINAL_STATUSES,
    type BackgroundRunDto,
    type SystemNotificationDto,
} from "@andy-code-cat/contracts";
import { listBackgroundRuns, type BackgroundRunUserLimits } from "./api/backgroundRuns";
import { listNotifications, markNotificationRead } from "./api/notifications";
import { getAccessToken } from "./token-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationStatus = "running" | "done" | "error";

/**
 * Fired on `window` when the user's projects changed without this page doing it — a background
 * run created, renamed or finished one. The dashboard reloads its list on it, no page refresh.
 */
export const PROJECTS_CHANGED_EVENT = "andy:projects-changed";

/** Polling of the background runs: fast while one is in flight, slow otherwise. */
const BACKGROUND_RUN_ACTIVE_POLL_MS = 4_000;
const BACKGROUND_RUN_IDLE_POLL_MS = 30_000;

const TERMINAL_RUN_STATUSES = new Set<string>(BACKGROUND_RUN_TERMINAL_STATUSES);

export function isBackgroundRunActive(run: Pick<BackgroundRunDto, "status">): boolean {
    return !TERMINAL_RUN_STATUSES.has(run.status);
}

/** A place a notification leads to; the panel renders the label for the kind. */
export interface NotificationLink {
    kind: "workspace" | "site" | "launch";
    href: string;
}

export interface SystemNotification {
    id: string;
    remoteId?: string;
    /** Short label shown in the panel (e.g. "Export ZIP", "Cattura JPG") */
    label: string;
    status: NotificationStatus;
    /**
     * 0-100 for deterministic progress → renders a progress bar.
     * undefined → renders a spinner.
     */
    progress?: number;
    /** Optional detail line (e.g. error message, completion note) */
    message?: string;
    startedAt: number;
    completedAt?: number;
    links?: NotificationLink[];
    /** The background run this entry follows (live progress, deep links, slug proposal). */
    backgroundRun?: BackgroundRunDto;
    /** Set on a persistent notice that belongs to a background run. */
    backgroundRunId?: string;
}

interface NotificationsContextValue {
    notifications: SystemNotification[];
    /** Add a new notification. Returns the generated id. */
    add: (n: Omit<SystemNotification, "id" | "startedAt">) => string;
    /** Partially update an existing notification. */
    update: (id: string, patch: Partial<Omit<SystemNotification, "id">>) => void;
    /** Remove a notification from the panel. */
    remove: (id: string) => void;
    /** Whether the panel is visible. */
    panelOpen: boolean;
    setPanelOpen: (open: boolean) => void;
    /** Shows a run the page just started, before the next poll sees it, and polls fast. */
    trackBackgroundRun: (run: BackgroundRunDto) => void;
    /** Replaces a run with a fresher copy (e.g. after a cancel). */
    refreshBackgroundRuns: () => Promise<void>;
    /** Runs in flight and the user's limit; null until the first answer. */
    backgroundRunLimits: BackgroundRunUserLimits | null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
    const [notifications, setNotifications] = useState<SystemNotification[]>([]);
    const [panelOpen, setPanelOpen] = useState(false);
    const counterRef = useRef(0);
    const [backgroundRuns, setBackgroundRuns] = useState<BackgroundRunDto[]>([]);
    const [backgroundRunLimits, setBackgroundRunLimits] = useState<BackgroundRunUserLimits | null>(null);
    const [dismissedRunIds, setDismissedRunIds] = useState<Set<string>>(() => new Set());
    /** Runs seen in flight during this page's life: they stay in the panel once finished. */
    const seenActiveRunIdsRef = useRef<Set<string>>(new Set());
    const runSignatureRef = useRef<string | null>(null);
    const anyRunActiveRef = useRef(false);
    const wakeRunPollRef = useRef<(() => void) | null>(null);

    const applyRuns = useCallback((runs: BackgroundRunDto[]) => {
        runs.filter(isBackgroundRunActive).forEach((run) => seenActiveRunIdsRef.current.add(run.id));
        anyRunActiveRef.current = runs.some(isBackgroundRunActive);
        // A run changes the project list when it creates the project, renames it from the brief
        // and when it finishes; the home listens and reloads.
        const signature = runs.map((run) => `${run.id}:${run.status}:${run.projectName ?? ""}`).join("|");
        if (runSignatureRef.current !== null && runSignatureRef.current !== signature) {
            window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT));
        }
        runSignatureRef.current = signature;
        setBackgroundRuns(runs);
    }, []);

    const refreshBackgroundRuns = useCallback(async () => {
        const token = getAccessToken();
        if (!token) return;
        try {
            const { runs, limits } = await listBackgroundRuns(token, 10);
            applyRuns(runs);
            if (limits) setBackgroundRunLimits(limits);
        } catch {
            // Polling must not disturb the page; the next turn tries again.
        }
    }, [applyRuns]);

    const trackBackgroundRun = useCallback((run: BackgroundRunDto) => {
        seenActiveRunIdsRef.current.add(run.id);
        anyRunActiveRef.current = true;
        setBackgroundRuns((prev) => [run, ...prev.filter((existing) => existing.id !== run.id)]);
        // Counted at once, so the limit applies before the next poll confirms it.
        setBackgroundRunLimits((prev) => prev ? { ...prev, active: prev.active + 1 } : prev);
        window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT));
        wakeRunPollRef.current?.();
    }, []);

    useEffect(() => {
        let stopped = false;
        let timer: number | undefined;
        const loop = async () => {
            await refreshBackgroundRuns();
            if (stopped) return;
            await new Promise<void>((resolve) => {
                timer = window.setTimeout(resolve, anyRunActiveRef.current ? BACKGROUND_RUN_ACTIVE_POLL_MS : BACKGROUND_RUN_IDLE_POLL_MS);
                wakeRunPollRef.current = () => { window.clearTimeout(timer); resolve(); };
            });
            wakeRunPollRef.current = null;
            if (!stopped) void loop();
        };
        void loop();
        return () => {
            stopped = true;
            window.clearTimeout(timer);
        };
    }, [refreshBackgroundRuns]);

    const add = useCallback((n: Omit<SystemNotification, "id" | "startedAt">): string => {
        const id = `notif-${Date.now()}-${++counterRef.current}`;
        setNotifications((prev) => [
            ...prev,
            { ...n, id, startedAt: Date.now() },
        ]);
        return id;
    }, []);

    const update = useCallback((id: string, patch: Partial<Omit<SystemNotification, "id">>) => {
        setNotifications((prev) =>
            prev.map((n) => {
                if (n.id !== id) return n;

                const nextStatus = patch.status ?? n.status;
                return {
                    ...n,
                    ...patch,
                    completedAt:
                        patch.completedAt ??
                        (nextStatus === "running" ? n.completedAt : Date.now()),
                    progress: nextStatus === "running" ? patch.progress ?? n.progress : 100,
                };
            })
        );
    }, []);

    const remove = useCallback((id: string) => {
        if (id.startsWith("bgrun-")) {
            const runId = id.slice("bgrun-".length);
            const notice = notifications.find((n) => n.backgroundRunId === runId && n.remoteId);
            const token = getAccessToken();
            if (notice?.remoteId && token) {
                markNotificationRead(token, notice.remoteId).catch(() => { /* best-effort */ });
            }
            setDismissedRunIds((prev) => new Set(prev).add(runId));
            setNotifications((prev) => prev.filter((n) => n.backgroundRunId !== runId));
            return;
        }
        const current = notifications.find((n) => n.id === id);
        const token = getAccessToken();
        if (current?.remoteId && token) {
            markNotificationRead(token, current.remoteId).catch(() => { /* best-effort */ });
        }
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, [notifications]);

    useEffect(() => {
        let cancelled = false;

        async function loadPersistentNotifications() {
            const token = getAccessToken();
            if (!token) return;

            try {
                const result = await listNotifications(token);
                if (cancelled) return;

                const mapped = result.notifications.map(mapPersistentNotification);
                setNotifications((prev) => {
                    const local = prev.filter((n) => !n.remoteId);
                    const existingRemoteIds = new Set(prev.map((n) => n.remoteId).filter(Boolean));
                    const remote = mapped.map((incoming) => {
                        const previous = prev.find((n) => n.remoteId === incoming.remoteId);
                        return previous ?? incoming;
                    });
                    const missingExisting = prev.filter((n) => n.remoteId && !existingRemoteIds.has(n.remoteId));
                    return [...local, ...missingExisting, ...remote];
                });
            } catch {
                // Notification polling must not disturb the workspace UI.
            }
        }

        void loadPersistentNotifications();
        const interval = window.setInterval(loadPersistentNotifications, 30000);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, []);

    // A run is one entry: its live state while it runs, then its outcome, merged with the
    // persistent notice the worker wrote (which is what survives a reload until dismissed).
    const visibleNotifications = useMemo(() => {
        const noticeByRun = new Map(
            notifications.filter((n) => n.backgroundRunId).map((n) => [n.backgroundRunId!, n] as const),
        );
        const runEntries: SystemNotification[] = backgroundRuns
            .filter((run) => !dismissedRunIds.has(run.id))
            .filter((run) => isBackgroundRunActive(run) || seenActiveRunIdsRef.current.has(run.id) || noticeByRun.has(run.id))
            .map((run) => ({
                id: `bgrun-${run.id}`,
                remoteId: noticeByRun.get(run.id)?.remoteId,
                label: run.projectName || run.prompt.slice(0, 60),
                status: run.status === "done" ? "done" : isBackgroundRunActive(run) ? "running" : "error",
                startedAt: Date.parse(run.createdAt),
                completedAt: run.finishedAt ? Date.parse(run.finishedAt) : undefined,
                backgroundRun: run,
            }));
        const followed = new Set(runEntries.map((entry) => entry.backgroundRun!.id));
        return [
            ...notifications.filter((n) => !(n.backgroundRunId && (followed.has(n.backgroundRunId) || dismissedRunIds.has(n.backgroundRunId)))),
            ...runEntries,
        ];
    }, [notifications, backgroundRuns, dismissedRunIds]);

    return (
        <NotificationsContext.Provider
            value={{
                notifications: visibleNotifications,
                add,
                update,
                remove,
                panelOpen,
                setPanelOpen,
                trackBackgroundRun,
                refreshBackgroundRuns,
                backgroundRunLimits,
            }}
        >
            {children}
        </NotificationsContext.Provider>
    );
}

function mapPersistentNotification(notification: SystemNotificationDto): SystemNotification {
    const severityToStatus: Record<SystemNotificationDto["severity"], NotificationStatus> = {
        info: "done",
        warning: "done",
        error: "error",
    };

    const metadata = notification.metadata ?? {};
    const text = (key: string) => (typeof metadata[key] === "string" ? metadata[key] as string : undefined);
    const backgroundRunId = text("backgroundRunId");
    const links: NotificationLink[] = [];
    const workspacePath = text("workspacePath");
    const publicUrl = text("publicUrl");
    if (workspacePath?.startsWith("/workspace/")) links.push({ kind: "workspace", href: workspacePath });
    if (publicUrl && /^(https?:\/\/|\/)/.test(publicUrl)) links.push({ kind: "site", href: publicUrl });

    return {
        id: `persistent-${notification.id}`,
        remoteId: notification.id,
        label: notification.title,
        status: severityToStatus[notification.severity],
        message: notification.message,
        startedAt: new Date(notification.createdAt).getTime(),
        completedAt: new Date(notification.createdAt).getTime(),
        ...(links.length > 0 ? { links } : {}),
        ...(backgroundRunId ? { backgroundRunId } : {}),
    };
}

export function useNotifications(): NotificationsContextValue {
    const ctx = useContext(NotificationsContext);
    if (!ctx) {
        throw new Error("useNotifications must be used inside NotificationsProvider");
    }
    return ctx;
}
