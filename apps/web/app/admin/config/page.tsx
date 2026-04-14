"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import { getAdminConfig, updateAdminConfig, type PlatformConfigDto, type UserLimitsDto } from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function AdminConfigPage() {
    const router = useRouter();
    const [config, setConfig] = useState<PlatformConfigDto | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Form state
    const [registrationOpen, setRegistrationOpen] = useState(true);
    const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
    const [defaultLimits, setDefaultLimits] = useState<Partial<UserLimitsDto>>({});

    useEffect(() => {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }
        getAdminConfig(token)
            .then((c) => {
                setConfig(c);
                setRegistrationOpen(c.registrationOpen);
                setEmailVerificationRequired(c.emailVerificationRequired);
                setDefaultLimits(c.defaultUserLimits ?? {});
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load config"))
            .finally(() => setLoading(false));
    }, [router]);

    async function handleSave() {
        const token = getToken();
        if (!token) return;
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const updated = await updateAdminConfig(token, {
                registrationOpen,
                emailVerificationRequired,
                defaultUserLimits: defaultLimits,
            });
            setConfig(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;

    function ToggleField({
        label,
        description,
        checked,
        onToggle,
    }: {
        label: string;
        description: string;
        checked: boolean;
        onToggle: () => void;
    }) {
        return (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/60 px-4 py-3">
                <div className="space-y-1">
                    <Label className="text-sm font-medium">{label}</Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Button
                    type="button"
                    variant={checked ? "default" : "outline"}
                    size="sm"
                    className="min-w-24"
                    onClick={onToggle}
                    aria-pressed={checked}
                >
                    {checked ? "Enabled" : "Disabled"}
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Platform Configuration</h1>

            {error && <p className="text-destructive text-sm">{error}</p>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Access Control */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Access Control</CardTitle>
                        <CardDescription className="text-xs">
                            Control who can sign up and how accounts are verified.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <ToggleField
                            label="Registration open"
                            description="When off, the /register endpoint returns 403 for regular signups. The superadmin can still create users via the admin panel."
                            checked={registrationOpen}
                            onToggle={() => setRegistrationOpen((v) => !v)}
                        />

                        <ToggleField
                            label="Email verification required"
                            description="When on, unverified users are blocked from accessing the platform."
                            checked={emailVerificationRequired}
                            onToggle={() => setEmailVerificationRequired((v) => !v)}
                        />
                    </CardContent>
                </Card>

                {/* Default User Limits */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Default User Limits</CardTitle>
                        <CardDescription className="text-xs">
                            Applied to newly created users. Use -1 for unlimited. Individual overrides take precedence.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="dl-plan" className="text-xs">Plan name</Label>
                                <Input
                                    id="dl-plan"
                                    value={defaultLimits.plan ?? ""}
                                    onChange={(e) => setDefaultLimits((f) => ({ ...f, plan: e.target.value }))}
                                    placeholder="unlimited"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="dl-projects" className="text-xs">Max projects (-1 = ∞)</Label>
                                <Input
                                    id="dl-projects"
                                    type="number"
                                    value={defaultLimits.maxProjects ?? ""}
                                    onChange={(e) => setDefaultLimits((f) => ({ ...f, maxProjects: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="dl-tokens" className="text-xs">Max tokens/month (K)</Label>
                                <Input
                                    id="dl-tokens"
                                    type="number"
                                    value={defaultLimits.maxMonthlyTokensK ?? ""}
                                    onChange={(e) => setDefaultLimits((f) => ({ ...f, maxMonthlyTokensK: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="dl-storage" className="text-xs">Max storage (MB)</Label>
                                <Input
                                    id="dl-storage"
                                    type="number"
                                    value={defaultLimits.maxStorageMb ?? ""}
                                    onChange={(e) => setDefaultLimits((f) => ({ ...f, maxStorageMb: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="dl-sites" className="text-xs">Max published sites</Label>
                                <Input
                                    id="dl-sites"
                                    type="number"
                                    value={defaultLimits.maxPublishedSites ?? ""}
                                    onChange={(e) => setDefaultLimits((f) => ({ ...f, maxPublishedSites: Number(e.target.value) }))}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Last updated */}
            {config && (
                <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(config.updatedAt).toLocaleString()}
                </p>
            )}

            <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save Configuration"}
                </Button>
                {saved && <span className="text-sm text-green-400">Saved!</span>}
            </div>
        </div>
    );
}
