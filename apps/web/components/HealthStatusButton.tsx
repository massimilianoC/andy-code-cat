"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { healthCheck } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export function HealthStatusButton() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
    const [detail, setDetail] = useState<string>("");

    function handleOpen() {
        setOpen(true);
        if (status === "idle" || status === "error") {
            doCheck();
        }
    }

    function doCheck() {
        setStatus("loading");
        setDetail("");
        healthCheck()
            .then((r) => { setStatus("ok"); setDetail(JSON.stringify(r, null, 2)); })
            .catch((e) => { setStatus("error"); setDetail(String(e)); });
    }

    return (
        <>
            <Button
                variant="ghost"
                size="icon"
                onClick={handleOpen}
                aria-label={t("health.title")}
                className="text-muted-foreground hover:text-foreground"
            >
                <Info className="w-4 h-4" />
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2.5">
                            <span>{t("health.title")}</span>
                            {status === "loading" && (
                                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            )}
                            {status === "ok" && (
                                <Badge variant="success">Online</Badge>
                            )}
                            {status === "error" && (
                                <Badge variant="destructive">Offline</Badge>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        {status === "loading" && (
                            <p className="text-sm text-muted-foreground">{t("health.checking")}</p>
                        )}
                        {status === "ok" && (
                            <div className="flex items-center gap-2 text-success text-sm font-medium">
                                <CheckCircle2 className="w-4 h-4" />
                                {t("health.ok")}
                            </div>
                        )}
                        {status === "error" && (
                            <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                                <XCircle className="w-4 h-4" />
                                {t("health.error")}
                            </div>
                        )}
                        {detail && (
                            <pre className="text-xs text-muted-foreground bg-secondary rounded-md p-3 overflow-auto max-h-40 font-mono leading-relaxed">
                                {detail}
                            </pre>
                        )}
                        {(status === "ok" || status === "error") && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={doCheck}
                            >
                                {t("health.recheck")}
                            </Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
