"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormDeliveryMode, ProjectFormSettingsInput } from "@andy-code-cat/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProjectFormSettings, updateProjectFormSettings } from "@/lib/api";

/** What the dialog edits: both modes' fields, so switching mode does not lose the recipient. */
interface EditableFormSettings {
    enabled: boolean;
    mode: FormDeliveryMode;
    recipientEmail: string;
    privacyNotice: ProjectFormSettingsInput["privacyNotice"];
}

const EMPTY_SETTINGS: EditableFormSettings = {
    enabled: false,
    mode: "capture",
    recipientEmail: "",
    privacyNotice: {
        version: "1.0",
        url: "",
        controllerName: "",
        contactEmail: "",
    },
};

function fromStored(settings: ProjectFormSettingsInput): EditableFormSettings {
    return {
        enabled: settings.enabled,
        mode: settings.mode,
        recipientEmail: settings.recipientEmail ?? "",
        privacyNotice: { ...settings.privacyNotice },
    };
}

/** The recipient is required for mailto only; capture sends it only when one is kept. */
function toPayload(settings: EditableFormSettings): ProjectFormSettingsInput {
    if (settings.mode === "mailto") {
        return { enabled: settings.enabled, mode: "mailto", recipientEmail: settings.recipientEmail, privacyNotice: settings.privacyNotice };
    }
    const recipientEmail = settings.recipientEmail.trim();
    return {
        enabled: settings.enabled,
        mode: "capture",
        privacyNotice: settings.privacyNotice,
        ...(recipientEmail ? { recipientEmail } : {}),
    };
}

interface FormSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    token: string;
    projectId: string;
}

/**
 * Owner settings of the project's operational forms: on/off, delivery mode (mailto hand-off or
 * capture on the published site) and the privacy notice shown with every form.
 */
export function FormSettingsDialog({ open, onOpenChange, token, projectId }: FormSettingsDialogProps) {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<EditableFormSettings>(EMPTY_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        let active = true;
        setLoading(true);
        setMessage(null);
        getProjectFormSettings(token, projectId)
            .then(({ settings: loaded }) => {
                if (active) setSettings(loaded ? fromStored(loaded) : EMPTY_SETTINGS);
            })
            .catch(() => {
                if (active) setMessage(t("config.forms.loadError"));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [open, projectId, t, token]);

    const updatePrivacy = (key: keyof EditableFormSettings["privacyNotice"], value: string) => {
        setSettings((current) => ({
            ...current,
            privacyNotice: { ...current.privacyNotice, [key]: value },
        }));
    };

    const setMode = (mode: FormDeliveryMode) => setSettings((current) => ({ ...current, mode }));

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const response = await updateProjectFormSettings(token, projectId, toPayload(settings));
            setSettings(fromStored(response.settings));
            setMessage(t("config.forms.saved"));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : t("config.forms.saveError"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl" data-testid="form-settings-dialog">
                <DialogHeader>
                    <DialogTitle>{t("config.forms.title")}</DialogTitle>
                    <DialogDescription>{t("config.forms.explanation")}</DialogDescription>
                </DialogHeader>

                {loading ? (
                    <p className="text-xs text-muted-foreground">{t("config.loading")}</p>
                ) : (
                    <div className="space-y-4" data-testid="project-form-settings">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Badge variant={settings.enabled ? "success" : "secondary"}>
                                    {settings.enabled ? t("config.forms.enabled") : t("config.forms.disabled")}
                                </Badge>
                                <Badge variant="outline">{settings.mode} v1</Badge>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                variant={settings.enabled ? "outline" : "default"}
                                onClick={() => setSettings((current) => ({ ...current, enabled: !current.enabled }))}
                            >
                                {settings.enabled ? t("config.forms.disable") : t("config.forms.enable")}
                            </Button>
                        </div>

                        <div className="space-y-1.5">
                            <Label>{t("config.forms.mode")}</Label>
                            <div className="flex gap-2" role="group" aria-label={t("config.forms.mode")}>
                                <Button type="button" size="sm" variant={settings.mode === "capture" ? "default" : "outline"} aria-pressed={settings.mode === "capture"} onClick={() => setMode("capture")}>
                                    {t("config.forms.modeCapture")}
                                </Button>
                                <Button type="button" size="sm" variant={settings.mode === "mailto" ? "default" : "outline"} aria-pressed={settings.mode === "mailto"} onClick={() => setMode("mailto")}>
                                    {t("config.forms.modeMailto")}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {settings.mode === "capture" ? t("config.forms.captureExplanation") : t("config.forms.mailtoExplanation")}
                            </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            {settings.mode === "mailto" ? (
                                <div className="space-y-1.5">
                                    <Label htmlFor="form-recipient">{t("config.forms.recipient")}</Label>
                                    <Input id="form-recipient" type="email" value={settings.recipientEmail} onChange={(event) => setSettings((current) => ({ ...current, recipientEmail: event.target.value }))} />
                                </div>
                            ) : null}
                            <div className="space-y-1.5">
                                <Label htmlFor="form-controller">{t("config.forms.controller")}</Label>
                                <Input id="form-controller" value={settings.privacyNotice.controllerName} onChange={(event) => updatePrivacy("controllerName", event.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="form-privacy-contact">{t("config.forms.privacyContact")}</Label>
                                <Input id="form-privacy-contact" type="email" value={settings.privacyNotice.contactEmail} onChange={(event) => updatePrivacy("contactEmail", event.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="form-privacy-version">{t("config.forms.privacyVersion")}</Label>
                                <Input id="form-privacy-version" value={settings.privacyNotice.version} onChange={(event) => updatePrivacy("version", event.target.value)} />
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                                <Label htmlFor="form-privacy-url">{t("config.forms.privacyUrl")}</Label>
                                <Input id="form-privacy-url" type="url" value={settings.privacyNotice.url} onChange={(event) => updatePrivacy("url", event.target.value)} />
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground">{t("config.forms.republishHint")}</p>
                    </div>
                )}

                <DialogFooter className="items-center gap-2">
                    <p className="text-xs text-muted-foreground sm:mr-auto" role="status">{message}</p>
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        {t("config.forms.close")}
                    </Button>
                    <Button type="button" onClick={save} disabled={saving || loading}>
                        {saving ? t("config.forms.saving") : t("config.forms.save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
