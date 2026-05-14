"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import { getAdminConfig, updateAdminConfig, type PlatformConfigDto, type UserLimitsDto } from "@/lib/api/admin";
import { getAdminCostDashboard, updateCostRates, type CostRatesDto, type ResourceTypeCostPolicyDto } from "@/lib/api/cost";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// ── Cost policy groups ─────────────────────────────────────────────────────────
const COST_TYPE_GROUPS: Array<{
    label: string;
    note: string;
    rateField: "tokenRateEurPer1k" | "assetRateEur" | null;
    rateLabel: string | null;
    types: Array<{ key: string; label: string }>;
}> = [
    {
        label: "LLM Calls",
        note: "Token-based cost. OpenRouter reports actual USD cost and it is used directly; SiliconFlow uses token-count estimate.",
        rateField: "tokenRateEurPer1k",
        rateLabel: "\u20ac/1k tokens",
        types: [
            { key: "llm.chat",           label: "Chat" },
            { key: "llm.preprompt",      label: "Pre-prompt" },
            { key: "llm.prompt_opt",     label: "Prompt optimizer" },
            { key: "llm.template_draft", label: "Template draft" },
            { key: "llm.embedding",      label: "Embedding" },
            { key: "llm.background",     label: "Background task" },
        ],
    },
    {
        label: "Image Generation",
        note: "Per-asset billing. Provider reports USD per image where available.",
        rateField: "assetRateEur",
        rateLabel: "\u20ac/asset",
        types: [
            { key: "image.gen",        label: "Image generation" },
            { key: "image.prompt_opt", label: "Image prompt opt." },
            { key: "image.suggest",    label: "Image suggestion" },
        ],
    },
    {
        label: "Video",
        note: "Per-asset billing.",
        rateField: "assetRateEur",
        rateLabel: "\u20ac/asset",
        types: [{ key: "video.gen", label: "Video generation" }],
    },
    {
        label: "Compute",
        note: "Internal tasks \u2014 no provider cost. Use fixedFeeEur for a flat charge per execution.",
        rateField: null,
        rateLabel: null,
        types: [
            { key: "compute.task",    label: "Compute task" },
            { key: "compute.gpu",     label: "GPU compute" },
            { key: "compute.lambda",  label: "Lambda" },
            { key: "compute.storage", label: "Storage" },
        ],
    },
    {
        label: "Platform Fees",
        note: "Fixed platform charges. Set fixedFeeEur to the amount billed per transaction.",
        rateField: null,
        rateLabel: null,
        types: [
            { key: "platform.export", label: "Export" },
            { key: "platform.domain", label: "Domain" },
            { key: "platform.event",  label: "Event" },
            { key: "platform.fixed",  label: "Fixed" },
        ],
    },
];

export default function AdminConfigPage() {
    const router = useRouter();
    const [config, setConfig] = useState<PlatformConfigDto | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Form state — access control
    const [registrationOpen, setRegistrationOpen] = useState(true);
    const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);
    const [defaultLimits, setDefaultLimits] = useState<Partial<UserLimitsDto>>({});

    // Form state — cost policy
    const [costRatesLoaded, setCostRatesLoaded] = useState(false);
    const [rateForm, setRateForm] = useState<Partial<CostRatesDto>>({});
    const [perTypeForm, setPerTypeForm] = useState<Record<string, Partial<ResourceTypeCostPolicyDto>>>({});
    const [savingRates, setSavingRates] = useState(false);
    const [savedRates, setSavedRates] = useState(false);
    const [ratesError, setRatesError] = useState<string | null>(null);

    useEffect(() => {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }

        // Load platform config and cost rates in parallel
        Promise.allSettled([
            getAdminConfig(token),
            getAdminCostDashboard(),
        ]).then(([configResult, costResult]) => {
            if (configResult.status === "fulfilled") {
                const c = configResult.value;
                setConfig(c);
                setRegistrationOpen(c.registrationOpen);
                setEmailVerificationRequired(c.emailVerificationRequired);
                setDefaultLimits(c.defaultUserLimits ?? {});
            } else {
                setError(configResult.reason instanceof Error ? configResult.reason.message : "Failed to load config");
            }
            if (costResult.status === "fulfilled" && costResult.value.currentRates) {
                const r = costResult.value.currentRates;
                setRateForm({
                    usdToEurRate:        r.usdToEurRate,
                    platformMarkupPct:   r.platformMarkupPct,
                    infraCostPct:        r.infraCostPct,
                    textEurPer1kTokens:  r.textEurPer1kTokens,
                    imageEurPerAsset:    r.imageEurPerAsset,
                    videoEurPerAsset:    r.videoEurPerAsset,
                });
                setPerTypeForm(r.perType ?? {});
                setCostRatesLoaded(true);
            } else {
                // No rates in DB yet — form stays empty, user sets values from scratch
                setCostRatesLoaded(true);
            }
        }).finally(() => setLoading(false));
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

    async function handleSaveRates() {
        setSavingRates(true);
        setSavedRates(false);
        setRatesError(null);
        try {
            // Strip undefined-valued keys from each per-type policy before sending
            const cleanPerType: Record<string, Partial<ResourceTypeCostPolicyDto>> = {};
            for (const [typeKey, policy] of Object.entries(perTypeForm)) {
                const clean: Partial<ResourceTypeCostPolicyDto> = {};
                for (const [k, v] of Object.entries(policy)) {
                    if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
                }
                if (Object.keys(clean).length > 0) cleanPerType[typeKey] = clean;
            }
            await updateCostRates({ ...rateForm, perType: cleanPerType });
            setSavedRates(true);
            setTimeout(() => setSavedRates(false), 3000);
        } catch (e: unknown) {
            setRatesError(e instanceof Error ? e.message : "Failed to save cost policy");
        } finally {
            setSavingRates(false);
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

            {/* ── Cost Policy ─────────────────────────────────────────────── */}
            <div className="pt-6 space-y-4">
                <div>
                    <h2 className="text-xl font-semibold">Cost Policy</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Configure markup, infra share, and fixed fees per transaction type.
                        Leave a field blank to inherit the global default.
                        Where the provider reports actual cost (e.g. OpenRouter), that value is used
                        directly as the base; for others (e.g. SiliconFlow) cost is estimated from
                        token counts using the configured rate.
                    </p>
                </div>

                {ratesError && <p className="text-destructive text-sm">{ratesError}</p>}

                {/* ── Global defaults ──────────────────────────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Global Defaults</CardTitle>
                        <CardDescription className="text-xs">
                            Applied to all transaction types unless a per-type override is set below.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {([
                                { id: "g-usd",    label: "USD → EUR rate",     key: "usdToEurRate",       placeholder: "0.92" },
                                { id: "g-markup", label: "Platform markup",     key: "platformMarkupPct",  placeholder: "0.10 = 10%" },
                                { id: "g-infra",  label: "Infra share",         key: "infraCostPct",       placeholder: "0.05 = 5%" },
                                { id: "g-token",  label: "€ / 1k tokens (LLM)",key: "textEurPer1kTokens", placeholder: "0.005" },
                                { id: "g-img",    label: "€ / image asset",     key: "imageEurPerAsset",   placeholder: "0.10" },
                                { id: "g-vid",    label: "€ / video asset",     key: "videoEurPerAsset",   placeholder: "0.20" },
                            ] as const).map(({ id, label, key, placeholder }) => (
                                <div key={id} className="flex flex-col gap-1">
                                    <Label htmlFor={id} className="text-xs">{label}</Label>
                                    <Input
                                        id={id}
                                        type="number"
                                        step="any"
                                        placeholder={placeholder}
                                        value={rateForm[key] !== undefined ? String(rateForm[key]) : ""}
                                        onChange={(e) => setRateForm((f) => ({
                                            ...f,
                                            [key]: e.target.value === "" ? undefined : Number(e.target.value),
                                        }))}
                                    />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* ── Per-type overrides ───────────────────────────────────── */}
                {COST_TYPE_GROUPS.map((group) => (
                    <Card key={group.label}>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">{group.label}</CardTitle>
                            <CardDescription className="text-xs">{group.note}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Column header row */}
                            <div className={`grid gap-2 mb-2 px-1 text-xs font-medium text-muted-foreground ${group.rateField ? "grid-cols-[minmax(140px,1fr)_80px_80px_80px_80px]" : "grid-cols-[minmax(140px,1fr)_80px_80px_80px]"}`}>
                                <span>Type</span>
                                <span>Markup&nbsp;%</span>
                                <span>Infra&nbsp;%</span>
                                <span>Fixed&nbsp;€</span>
                                {group.rateField && <span>{group.rateLabel}</span>}
                            </div>
                            <div className="space-y-1.5">
                                {group.types.map((typeInfo) => {
                                    const policy = perTypeForm[typeInfo.key] ?? {};
                                    const upd = (patch: Partial<ResourceTypeCostPolicyDto>) =>
                                        setPerTypeForm((f) => ({ ...f, [typeInfo.key]: { ...(f[typeInfo.key] ?? {}), ...patch } }));
                                    const numVal = (v: number | undefined) => v !== undefined ? String(v) : "";
                                    const onNum = (field: keyof ResourceTypeCostPolicyDto) =>
                                        (e: React.ChangeEvent<HTMLInputElement>) =>
                                            upd({ [field]: e.target.value === "" ? undefined : Number(e.target.value) });
                                    return (
                                        <div
                                            key={typeInfo.key}
                                            className={`grid gap-2 items-center ${group.rateField ? "grid-cols-[minmax(140px,1fr)_80px_80px_80px_80px]" : "grid-cols-[minmax(140px,1fr)_80px_80px_80px]"}`}
                                        >
                                            <div>
                                                <p className="text-xs font-medium leading-tight">{typeInfo.label}</p>
                                                <p className="text-[10px] font-mono text-muted-foreground">{typeInfo.key}</p>
                                            </div>
                                            <Input type="number" step="any" className="h-7 text-xs px-2"
                                                placeholder={rateForm.platformMarkupPct !== undefined ? String(rateForm.platformMarkupPct) : "global"}
                                                value={numVal(policy.markupPct)} onChange={onNum("markupPct")} />
                                            <Input type="number" step="any" className="h-7 text-xs px-2"
                                                placeholder={rateForm.infraCostPct !== undefined ? String(rateForm.infraCostPct) : "global"}
                                                value={numVal(policy.infraPct)} onChange={onNum("infraPct")} />
                                            <Input type="number" step="any" className="h-7 text-xs px-2"
                                                placeholder="0.000"
                                                value={numVal(policy.fixedFeeEur)} onChange={onNum("fixedFeeEur")} />
                                            {group.rateField && (
                                                <Input type="number" step="any" className="h-7 text-xs px-2"
                                                    placeholder="global"
                                                    value={numVal(policy[group.rateField])} onChange={onNum(group.rateField)} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                ))}

                <div className="flex items-center gap-3">
                    <Button onClick={handleSaveRates} disabled={savingRates} variant="outline">
                        {savingRates ? "Saving rates…" : "Save Cost Policy"}
                    </Button>
                    {savedRates && <span className="text-sm text-green-400">Saved!</span>}
                </div>
            </div>
        </div>
    );
}
