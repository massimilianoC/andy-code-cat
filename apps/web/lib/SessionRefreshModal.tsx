"use client";

import React from "react";
import { AlertTriangle, LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "./SessionContext";

export function SessionRefreshModal() {
    const { t } = useTranslation();
    const { isSessionExpired, clearSession } = useSession();

    function handleRelogin() {
        clearSession();
        const params = new URLSearchParams({ expired: "1" });
        const currentPath = `${window.location.pathname}${window.location.search}`;
        if (!currentPath.startsWith("/login")) {
            params.set("next", currentPath);
        }
        window.location.href = `/login?${params.toString()}`;
    }

    return (
        <Dialog open={isSessionExpired} onOpenChange={() => undefined}>
            <DialogContent
                className="max-w-md"
                hideClose
                onEscapeKeyDown={(event) => event.preventDefault()}
                onPointerDownOutside={(event) => event.preventDefault()}
            >
                <DialogHeader>
                    <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive">
                        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <DialogTitle>{t("session.expired", "Sessione scaduta")}</DialogTitle>
                    <DialogDescription>
                        {t(
                            "session.reloginRequired",
                            "La sessione non è più valida. Per evitare errori mascherati o operazioni parziali, torna al login e accedi di nuovo.",
                        )}
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter>
                    <Button type="button" onClick={handleRelogin} className="gap-2">
                        <LogIn className="h-4 w-4" aria-hidden="true" />
                        {t("session.relogin", "Vai al login")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
