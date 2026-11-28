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
    // The Arcade is full-screen: the floating trigger would cover the game's HUD. Runs that land
    // while playing are announced by the Arcade itself.
    const isArcade = pathname === "/arcade" || (pathname?.startsWith("/arcade/") ?? false);

    return (
        <I18nProvider>
            <SessionProvider>
                <NotificationsProvider>
                    <SessionRefreshModal />
                    {children}
                    <NotificationPanel hideTrigger={isWorkspace || isArcade} />
                </NotificationsProvider>
            </SessionProvider>
        </I18nProvider>
    );
}
