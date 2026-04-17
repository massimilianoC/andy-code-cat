"use client";

import { usePathname } from "next/navigation";
import { SessionProvider } from "../lib/SessionContext";
import { SessionRefreshModal } from "../lib/SessionRefreshModal";
import { NotificationsProvider } from "../lib/notifications";
import { NotificationPanel } from "../components/NotificationPanel";
import { I18nProvider } from "../components/I18nProvider";
import type { ReactNode } from "react";

export function RootClientWrapper({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const isWorkspace = pathname?.startsWith("/workspace/") ?? false;

    return (
        <I18nProvider>
            <SessionProvider>
                <NotificationsProvider>
                    <SessionRefreshModal />
                    {children}
                    <NotificationPanel hideTrigger={isWorkspace} />
                </NotificationsProvider>
            </SessionProvider>
        </I18nProvider>
    );
}
