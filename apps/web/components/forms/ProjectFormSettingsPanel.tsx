"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectFormSettingsInput } from "@andy-code-cat/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProjectFormSettings, updateProjectFormSettings } from "@/lib/api";

const EMPTY_SETTINGS: ProjectFormSettingsInput = {
    enabled: false,
    mode: "mailto",
    recipientEmail: "",
    privacyNotice: {
        version: "1.0",
        url: "",
        controllerName: "",
        contactEmail: "",
    },
};

interface ProjectFormSettingsPanelProps {
    token: string;
    projectId: string;
}

export function ProjectFormSettingsPanel({ token, projectId }: ProjectFormSettingsPanelProps) {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<ProjectFormSettingsInput>(EMPTY_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        getProjectFormSettings(token, projectId)
            .then(({ settings: loaded }) => {
                if (active) setSettings(loaded ?? EMPTY_SETTINGS);
            })
            .catch(() => {
                if (active) setMessage(t("config.forms.loadError"));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [projectId, t, token]);

    const updatePrivacy = (key: keyof ProjectFormSettingsInput["privacyNotice"], value: string) => {
        setSettings((current) => ({
            ...current,
            privacyNotice: { ...current.privacyNotice, [key]: value },
        }));
    };

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const response = await updateProjectFormSettings(token, projectId, settings);
            setSettings(response.settings);
            setMessage(t("config.forms.saved"));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : t("config.forms.saveError"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <p className="text-xs text-muted-foreground">{t("config.loading")}</p>;
    }

    return (
        <div className="space-y-4" data-testid="project-form-settings">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Badge variant={settings.enabled ? "success" : "secondary"}>
                        {settings.enabled ? t("config.forms.enabled") : t("config.forms.disabled")}
                    </Badge>
                    <Badge variant="outline">mailto v1</Badge>
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

            <p className="text-xs text-muted-foreground">{t("config.forms.explanation")}</p>

            <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor="form-recipient">{t("config.forms.recipient")}</Label>
                    <Input id="form-recipient" type="email" value={settings.recipientEmail} onChange={(event) => setSettings((current) => ({ ...current, recipientEmail: event.target.value }))} />
                </div>
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

            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground" role="status">{message}</p>
                <Button type="button" size="sm" onClick={save} disabled={saving}>
                    {saving ? t("config.forms.saving") : t("config.forms.save")}
                </Button>
            </div>
        </div>
    );
}
