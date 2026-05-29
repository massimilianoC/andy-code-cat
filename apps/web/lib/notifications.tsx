"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import type { SystemNotificationDto } from "@andy-code-cat/contracts";
import { listNotifications, markNotificationRead } from "./api/notifications";
import { getAccessToken } from "./token-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationStatus = "running" | "done" | "error";

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
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
    const [notifications, setNotifications] = useState<SystemNotification[]>([]);
    const [panelOpen, setPanelOpen] = useState(false);
    const counterRef = useRef(0);

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

    return (
        <NotificationsContext.Provider
            value={{ notifications, add, update, remove, panelOpen, setPanelOpen }}
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

    return {
        id: `persistent-${notification.id}`,
        remoteId: notification.id,
        label: notification.title,
        status: severityToStatus[notification.severity],
        message: notification.message,
        startedAt: new Date(notification.createdAt).getTime(),
        completedAt: new Date(notification.createdAt).getTime(),
    };
}

export function useNotifications(): NotificationsContextValue {
    const ctx = useContext(NotificationsContext);
    if (!ctx) {
        throw new Error("useNotifications must be used inside NotificationsProvider");
    }
    return ctx;
}
