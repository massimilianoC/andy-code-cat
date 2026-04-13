"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { changePassword, ApiError } from "@/lib/api";
import { clearSession, setPasswordChangeRequired } from "@/lib/token-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface PasswordChangeDialogProps {
    open: boolean;
    token: string;
    onCompleted: () => void;
}

export function PasswordChangeDialog({ open, token, onCompleted }: PasswordChangeDialogProps) {
    const { t } = useTranslation();
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);

        if (newPassword !== confirmPassword) {
            setError(t("security.passwordChange.errors.confirmationMismatch"));
            return;
        }

        setSubmitting(true);
        try {
            const result = await changePassword(token, {
                currentPassword,
                newPassword,
            });

            setPasswordChangeRequired(result.requiresPasswordChange);

            if (result.reauthRequired) {
                clearSession();
                window.location.href = "/login";
                return;
            }

            onCompleted();
        } catch (err) {
            if (err instanceof ApiError) {
                if (typeof err.body === "object" && err.body !== null && "error" in err.body) {
                    setError(String((err.body as { error: unknown }).error));
                } else {
                    setError(`HTTP ${err.status}`);
                }
            } else {
                setError(err instanceof Error ? err.message : t("security.passwordChange.errors.generic"));
            }
        } finally {
            setSubmitting(false);
        }
    }

    function handleLogout() {
        clearSession();
        window.location.href = "/login";
    }

    return (
        <Dialog open={open}>
            <DialogContent className="sm:max-w-md" onInteractOutside={(event) => event.preventDefault()}>
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <DialogTitle>{t("security.passwordChange.title")}</DialogTitle>
                        <Badge variant="accent">{t("security.passwordChange.badge")}</Badge>
                    </div>
                    <DialogDescription>
                        {t("security.passwordChange.description")}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="current-password">{t("security.passwordChange.currentPassword")}</Label>
                        <Input
                            id="current-password"
                            type="password"
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="new-password">{t("security.passwordChange.newPassword")}</Label>
                        <Input
                            id="new-password"
                            type="password"
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            minLength={12}
                            required
                        />
                        <p className="text-xs text-muted-foreground">{t("security.passwordChange.policyHint")}</p>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="confirm-password">{t("security.passwordChange.confirmPassword")}</Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            minLength={12}
                            required
                        />
                    </div>

                    {error ? (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {error}
                        </div>
                    ) : null}

                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button type="button" variant="outline" onClick={handleLogout} disabled={submitting}>
                            {t("security.passwordChange.logout")}
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? t("security.passwordChange.submitting") : t("security.passwordChange.submit")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}