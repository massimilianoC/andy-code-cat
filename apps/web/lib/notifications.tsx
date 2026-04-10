"use client";

import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
    type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationStatus = "running" | "done" | "error";

export interface SystemNotification {
    id: string;
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
        // Auto-open panel when a process starts
        setPanelOpen(true);
        return id;
    }, []);

    const update = useCallback((id: string, patch: Partial<Omit<SystemNotification, "id">>) => {
        setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, ...patch } : n))
        );
    }, []);

    const remove = useCallback((id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, []);

    return (
        <NotificationsContext.Provider
            value={{ notifications, add, update, remove, panelOpen, setPanelOpen }}
        >
            {children}
        </NotificationsContext.Provider>
    );
}

export function useNotifications(): NotificationsContextValue {
    const ctx = useContext(NotificationsContext);
    if (!ctx) {
        throw new Error("useNotifications must be used inside NotificationsProvider");
    }
    return ctx;
}
