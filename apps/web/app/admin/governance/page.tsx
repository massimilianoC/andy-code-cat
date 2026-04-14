"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminConfig,
    updateProductGovernance,
    type ProductGovernanceDto,
    type PlatformConfigDto,
    type CookieBannerLocaleText,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCT_KEY = "default";
const NGINX_RUNTIME_ENABLED = false;

/** Supported locales shown in the cookie banner and legal pages editors. */
const LOCALES = [
    { code: "en", label: "English" },
    { code: "it", label: "Italiano" },
    { code: "fr", label: "Français" },
    { code: "de", label: "Deutsch" },
    { code: "es", label: "Español" },
];

const EMPTY_GOVERNANCE: ProductGovernanceDto = {
    promptTemplates: {
        generationSystem: "",
        focusedEditSystem: "",
        reviewSystem: "",
    },
    injections: {
        headHtml: "",
        headerHtml: "",
        footerHtml: "",
        scriptInHead: "",
        scriptBeforeBodyClose: "",
        globalCss: "",
        googleTagManagerId: "",
        googleAnalyticsId: "",
        matomoSiteId: "",
        matomoUrl: "",
    },
    cookieBanner: {
        enabled: false,
        position: "bottom",
        texts: {},
    },
    legal: {
        privacyPolicyUrls: {},
        cookiePolicyUrls: {},
        privacyPolicyHtml: {},
        cookiePolicyHtml: {},
    },
    nginx: {
        publicDomain: "",
        publishSubdomainPattern: "{publishId}",
        cacheTtlSeconds: 300,
        clientMaxBodySizeMb: 20,
        extraServerDirectives: "",
    },
};

// ── Tab types ─────────────────────────────────────────────────────────────────

type GovernanceTab = "analytics" | "legal" | "html" | "scripts" | "styles" | "prompts" | "runtime";

const TABS: { id: GovernanceTab; label: string }[] = [
    { id: "analytics", label: "Analytics" },
    { id: "legal", label: "Cookie & Legal" },
    { id: "html", label: "HTML Injection" },
    { id: "scripts", label: "JS Injection" },
    { id: "styles", label: "CSS Injection" },
    { id: "prompts", label: "Prompt Templates" },
    { id: "runtime", label: "Runtime" },
];

// ── Helper components ─────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: GovernanceTab; onChange: (t: GovernanceTab) => void }) {
    return (
        <div className="flex gap-0 border-b border-border overflow-x-auto shrink-0">
            {TABS.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange(t.id)}
                    className={cn(
                        "whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                        active === t.id
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

/**
 * Row of text inputs for a locale-keyed string record.
 * `label` is the field name shown per locale; `record` is the current value map.
 */
function LocaleStringInputs({
    label,
    record,
    onChange,
}: {
    label: string;
    record: Record<string, string>;
    onChange: (next: Record<string, string>) => void;
}) {
    return (
        <div className="space-y-2">
            {LOCALES.map(({ code, label: localeLabel }) => (
                <div key={code} className="grid grid-cols-[7rem_1fr] gap-3 items-center">
                    <Label className="text-xs text-right text-muted-foreground">{localeLabel}</Label>
                    <Input
                        value={record[code] ?? ""}
                        onChange={(e) => onChange({ ...record, [code]: e.target.value })}
                        placeholder={`${label} (${code})…`}
                    />
                </div>
            ))}
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminGovernancePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<GovernanceTab>("analytics");

    const [config, setConfig] = useState<PlatformConfigDto | null>(null);
    const [productKeyInput, setProductKeyInput] = useState(DEFAULT_PRODUCT_KEY);
    const [activeProductKey, setActiveProductKey] = useState(DEFAULT_PRODUCT_KEY);
    const [governance, setGovernance] = useState<ProductGovernanceDto>(EMPTY_GOVERNANCE);

    useEffect(() => {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }

        getAdminConfig(token)
            .then((nextConfig) => {
                setConfig(nextConfig);
                const selected = nextConfig.governanceByProduct?.[DEFAULT_PRODUCT_KEY] ?? EMPTY_GOVERNANCE;
                setGovernance(mergeWithEmpty(selected));
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load governance config"))
            .finally(() => setLoading(false));
    }, [router]);

    function mergeWithEmpty(src: Partial<ProductGovernanceDto>): ProductGovernanceDto {
        return {
            promptTemplates: { ...EMPTY_GOVERNANCE.promptTemplates, ...src.promptTemplates },
            injections: { ...EMPTY_GOVERNANCE.injections, ...src.injections },
            cookieBanner: { ...EMPTY_GOVERNANCE.cookieBanner, ...src.cookieBanner },
            legal: { ...EMPTY_GOVERNANCE.legal, ...src.legal },
            nginx: { ...EMPTY_GOVERNANCE.nginx, ...src.nginx },
        };
    }

    const productOptions = useMemo(
        () => Object.keys(config?.governanceByProduct ?? {}).sort(),
        [config],
    );

    function loadProductConfig(productKey: string) {
        const selected = config?.governanceByProduct?.[productKey] ?? EMPTY_GOVERNANCE;
        setGovernance(mergeWithEmpty(selected));
        setActiveProductKey(productKey);
        setProductKeyInput(productKey);
    }

    async function saveGovernance() {
        const token = getToken();
        if (!token) return;
        const productKey = productKeyInput.trim();
        if (!productKey) { setError("Product key is required"); return; }

        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const updated = await updateProductGovernance(token, productKey, governance);
            setConfig(updated);
            setActiveProductKey(productKey);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to save governance config");
        } finally {
            setSaving(false);
        }
    }

    // ── Governance setters ────────────────────────────────────────────────────

    function setInjection<K extends keyof ProductGovernanceDto["injections"]>(key: K, value: ProductGovernanceDto["injections"][K]) {
        setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, [key]: value } }));
    }

    function setPrompt<K extends keyof ProductGovernanceDto["promptTemplates"]>(key: K, value: string) {
        setGovernance((prev) => ({ ...prev, promptTemplates: { ...prev.promptTemplates, [key]: value } }));
    }

    function setNginx<K extends keyof ProductGovernanceDto["nginx"]>(key: K, value: ProductGovernanceDto["nginx"][K]) {
        setGovernance((prev) => ({ ...prev, nginx: { ...prev.nginx, [key]: value } }));
    }

    function setCookieBanner<K extends keyof NonNullable<ProductGovernanceDto["cookieBanner"]>>(
        key: K,
        value: NonNullable<ProductGovernanceDto["cookieBanner"]>[K],
    ) {
        setGovernance((prev) => ({
            ...prev,
            cookieBanner: { ...EMPTY_GOVERNANCE.cookieBanner!, ...prev.cookieBanner, [key]: value },
        }));
    }

    function setCookieBannerLocale(locale: string, patch: Partial<CookieBannerLocaleText>) {
        const current = governance.cookieBanner?.texts ?? {};
        const existing = current[locale] ?? { message: "", acceptLabel: "", rejectLabel: "" };
        setCookieBanner("texts", { ...current, [locale]: { ...existing, ...patch } });
    }

    function setLegal<K extends keyof NonNullable<ProductGovernanceDto["legal"]>>(
        key: K,
        value: NonNullable<ProductGovernanceDto["legal"]>[K],
    ) {
        setGovernance((prev) => ({
            ...prev,
            legal: { ...EMPTY_GOVERNANCE.legal!, ...prev.legal, [key]: value },
        }));
    }

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) return <p className="text-sm text-muted-foreground">Loading governance…</p>;

    const cookieBanner = governance.cookieBanner ?? EMPTY_GOVERNANCE.cookieBanner!;
    const legal = governance.legal ?? EMPTY_GOVERNANCE.legal!;

    return (
        <div className="space-y-0">
            {/* Page header */}
            <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Global Product Governance</h1>
                    <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                        Per-product prompt templates, HTML/JS/CSS injections, cookie banner, legal pages, and
                        nginx runtime knobs. Changes take effect on the next page render.
                    </p>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <a href="/admin" className="hover:text-foreground transition-colors">Admin</a>
                    <span>/</span>
                    <span className="text-foreground">Governance</span>
                </div>
            </div>

            {error && <p className="text-sm text-destructive mb-4">{error}</p>}

            {/* Product scope selector */}
            <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-lg border border-border bg-card">
                <div>
                    <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Product scope</p>
                    <div className="flex flex-wrap gap-2">
                        {productOptions.map((key) => (
                            <Button
                                key={key}
                                variant={key === activeProductKey ? "default" : "outline"}
                                size="sm"
                                onClick={() => loadProductConfig(key)}
                            >
                                {key}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-2 items-end ml-auto">
                    <div className="space-y-1">
                        <Label htmlFor="product-key" className="text-xs">Product key</Label>
                        <Input
                            id="product-key"
                            value={productKeyInput}
                            onChange={(e) => setProductKeyInput(e.target.value)}
                            placeholder="default"
                            className="w-40"
                        />
                    </div>
                    <Button variant="outline" onClick={() => loadProductConfig(productKeyInput.trim() || DEFAULT_PRODUCT_KEY)}>
                        Load
                    </Button>
                    <Button onClick={saveGovernance} disabled={saving}>
                        {saving ? "Saving…" : "Save Governance"}
                    </Button>
                    {saved && <span className="text-sm text-green-500 self-center">Saved!</span>}
                </div>
            </div>

            {/* Tab bar */}
            <TabBar active={activeTab} onChange={setActiveTab} />

            {/* Tab content */}
            <div className="pt-6 space-y-6">

                {/* ── Analytics ─────────────────────────────────────────────── */}
                {activeTab === "analytics" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Third-party Analytics</CardTitle>
                                <CardDescription className="text-xs">
                                    Tag Manager and analytics platform identifiers. These IDs are injected
                                    into generated pages using the standard tracking snippets.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <Label>Google Tag Manager ID</Label>
                                        <Input
                                            value={governance.injections.googleTagManagerId}
                                            onChange={(e) => setInjection("googleTagManagerId", e.target.value)}
                                            placeholder="GTM-XXXXXXX"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Google Analytics ID</Label>
                                        <Input
                                            value={governance.injections.googleAnalyticsId}
                                            onChange={(e) => setInjection("googleAnalyticsId", e.target.value)}
                                            placeholder="G-XXXXXXXXXX"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Matomo URL</Label>
                                        <Input
                                            value={governance.injections.matomoUrl}
                                            onChange={(e) => setInjection("matomoUrl", e.target.value)}
                                            placeholder="https://analytics.example.com"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Matomo Site ID</Label>
                                        <Input
                                            value={governance.injections.matomoSiteId}
                                            onChange={(e) => setInjection("matomoSiteId", e.target.value)}
                                            placeholder="1"
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* ── Cookie & Legal ─────────────────────────────────────────── */}
                {activeTab === "legal" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Cookie Banner</CardTitle>
                                <CardDescription className="text-xs">
                                    Configure the cookie consent banner shown to visitors. Texts are multilingual:
                                    fill in the locales you need and leave others blank.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                                    <div>
                                        <p className="text-sm font-medium">Cookie banner enabled</p>
                                        <p className="text-xs text-muted-foreground">Inject the cookie consent widget into generated pages.</p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant={cookieBanner.enabled ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCookieBanner("enabled", !cookieBanner.enabled)}
                                    >
                                        {cookieBanner.enabled ? "Enabled" : "Disabled"}
                                    </Button>
                                </div>

                                <div className="space-y-1">
                                    <Label>Banner position</Label>
                                    <select
                                        value={cookieBanner.position ?? "bottom"}
                                        onChange={(e) => setCookieBanner("position", e.target.value as "bottom" | "top" | "bottom-left" | "bottom-right")}
                                        className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                                    >
                                        <option value="bottom">Bottom (full width)</option>
                                        <option value="top">Top (full width)</option>
                                        <option value="bottom-left">Bottom-left corner</option>
                                        <option value="bottom-right">Bottom-right corner</option>
                                    </select>
                                </div>

                                {LOCALES.map(({ code, label: localeLabel }) => (
                                    <div key={code} className="rounded-lg border border-border p-4 space-y-3">
                                        <p className="text-sm font-medium">{localeLabel} <span className="text-xs text-muted-foreground font-mono">({code})</span></p>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Message</Label>
                                                <Input
                                                    value={cookieBanner.texts?.[code]?.message ?? ""}
                                                    onChange={(e) => setCookieBannerLocale(code, { message: e.target.value })}
                                                    placeholder={`Cookie message in ${localeLabel}…`}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Accept label</Label>
                                                <Input
                                                    value={cookieBanner.texts?.[code]?.acceptLabel ?? ""}
                                                    onChange={(e) => setCookieBannerLocale(code, { acceptLabel: e.target.value })}
                                                    placeholder="Accept"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Reject label</Label>
                                                <Input
                                                    value={cookieBanner.texts?.[code]?.rejectLabel ?? ""}
                                                    onChange={(e) => setCookieBannerLocale(code, { rejectLabel: e.target.value })}
                                                    placeholder="Reject"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Privacy Policy</CardTitle>
                                <CardDescription className="text-xs">
                                    Per-locale privacy policy URLs. URL takes precedence over inline HTML when both are set.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">URLs</p>
                                    <LocaleStringInputs
                                        label="Privacy policy URL"
                                        record={legal.privacyPolicyUrls ?? {}}
                                        onChange={(v) => setLegal("privacyPolicyUrls", v)}
                                    />
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Inline HTML (fallback)</p>
                                    {LOCALES.map(({ code, label: localeLabel }) => (
                                        <div key={code} className="mb-3">
                                            <Label className="text-xs mb-1 block">{localeLabel}</Label>
                                            <MonacoCodeEditor
                                                language="html"
                                                height="120px"
                                                value={legal.privacyPolicyHtml?.[code] ?? ""}
                                                onChange={(v) => setLegal("privacyPolicyHtml", { ...legal.privacyPolicyHtml, [code]: v })}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Cookie Policy</CardTitle>
                                <CardDescription className="text-xs">
                                    Per-locale cookie policy URLs and optional inline HTML pages.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">URLs</p>
                                    <LocaleStringInputs
                                        label="Cookie policy URL"
                                        record={legal.cookiePolicyUrls ?? {}}
                                        onChange={(v) => setLegal("cookiePolicyUrls", v)}
                                    />
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Inline HTML (fallback)</p>
                                    {LOCALES.map(({ code, label: localeLabel }) => (
                                        <div key={code} className="mb-3">
                                            <Label className="text-xs mb-1 block">{localeLabel}</Label>
                                            <MonacoCodeEditor
                                                language="html"
                                                height="120px"
                                                value={legal.cookiePolicyHtml?.[code] ?? ""}
                                                onChange={(v) => setLegal("cookiePolicyHtml", { ...legal.cookiePolicyHtml, [code]: v })}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* ── HTML Injection ─────────────────────────────────────────── */}
                {activeTab === "html" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">HTML Injections</CardTitle>
                                <CardDescription className="text-xs">
                                    HTML snippets injected into generated pages. Use these for global layout
                                    additions: meta tags, link elements, navigation wrappers, footer markup.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="space-y-1">
                                    <Label>Common &lt;head&gt; HTML</Label>
                                    <p className="text-xs text-muted-foreground">Appended inside the <code>&lt;head&gt;</code> tag of every generated page.</p>
                                    <MonacoCodeEditor
                                        language="html"
                                        value={governance.injections.headHtml}
                                        onChange={(v) => setInjection("headHtml", v)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Global Header HTML</Label>
                                    <p className="text-xs text-muted-foreground">Inserted at the top of the <code>&lt;body&gt;</code>.</p>
                                    <MonacoCodeEditor
                                        language="html"
                                        value={governance.injections.headerHtml}
                                        onChange={(v) => setInjection("headerHtml", v)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Global Footer HTML</Label>
                                    <p className="text-xs text-muted-foreground">Inserted before <code>&lt;/body&gt;</code>, after the page content.</p>
                                    <MonacoCodeEditor
                                        language="html"
                                        value={governance.injections.footerHtml}
                                        onChange={(v) => setInjection("footerHtml", v)}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* ── JS Injection ───────────────────────────────────────────── */}
                {activeTab === "scripts" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">JavaScript Injections</CardTitle>
                                <CardDescription className="text-xs">
                                    JavaScript injected into generated pages. Place initialisation code (analytics,
                                    consent management, feature flags) in the head script. Place non-critical
                                    scripts before the closing body tag for performance.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="space-y-1">
                                    <Label>Script in &lt;head&gt;</Label>
                                    <p className="text-xs text-muted-foreground">Wrapped in a <code>&lt;script&gt;</code> tag and placed inside <code>&lt;head&gt;</code>.</p>
                                    <MonacoCodeEditor
                                        language="javascript"
                                        value={governance.injections.scriptInHead}
                                        onChange={(v) => setInjection("scriptInHead", v)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Script before &lt;/body&gt;</Label>
                                    <p className="text-xs text-muted-foreground">Wrapped in a <code>&lt;script&gt;</code> tag, placed just before <code>&lt;/body&gt;</code>.</p>
                                    <MonacoCodeEditor
                                        language="javascript"
                                        value={governance.injections.scriptBeforeBodyClose}
                                        onChange={(v) => setInjection("scriptBeforeBodyClose", v)}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* ── CSS Injection ──────────────────────────────────────────── */}
                {activeTab === "styles" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Global CSS Injection</CardTitle>
                                <CardDescription className="text-xs">
                                    CSS injected into generated pages. Wrapped in a <code>&lt;style&gt;</code> tag
                                    in the <code>&lt;head&gt;</code>. Use for global typography overrides, brand
                                    colours, or utility classes common to all products.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <MonacoCodeEditor
                                    language="css"
                                    height="380px"
                                    value={governance.injections.globalCss}
                                    onChange={(v) => setInjection("globalCss", v)}
                                />
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* ── Prompt Templates ───────────────────────────────────────── */}
                {activeTab === "prompts" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Prompt Templates</CardTitle>
                                <CardDescription className="text-xs">
                                    Centralised instruction blocks injected into the system prompts for each
                                    pipeline stage. Write in Markdown; keep instructions clear and concise.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <div className="space-y-1">
                                    <Label>Generation system prompt</Label>
                                    <p className="text-xs text-muted-foreground">Appended to the generation pipeline system message.</p>
                                    <MonacoCodeEditor
                                        language="markdown"
                                        value={governance.promptTemplates.generationSystem}
                                        onChange={(v) => setPrompt("generationSystem", v)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Focused edit system prompt</Label>
                                    <p className="text-xs text-muted-foreground">Appended to the focused-edit pipeline system message.</p>
                                    <MonacoCodeEditor
                                        language="markdown"
                                        value={governance.promptTemplates.focusedEditSystem}
                                        onChange={(v) => setPrompt("focusedEditSystem", v)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Review system prompt</Label>
                                    <p className="text-xs text-muted-foreground">Appended to the review pipeline system message.</p>
                                    <MonacoCodeEditor
                                        language="markdown"
                                        value={governance.promptTemplates.reviewSystem}
                                        onChange={(v) => setPrompt("reviewSystem", v)}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* ── Runtime (Nginx) ────────────────────────────────────────── */}
                {activeTab === "runtime" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Nginx Runtime Parameters</CardTitle>
                                <CardDescription className="text-xs">
                                    Product-level nginx tuning values for installation templates and deployment sessions.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {!NGINX_RUNTIME_ENABLED && (
                                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                                        Future feature: these fields are configuration-only and are not yet applied automatically
                                        to runtime nginx files, domain switches, or SSL certificate generation.
                                    </p>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <Label>Public domain</Label>
                                        <Input
                                            disabled={!NGINX_RUNTIME_ENABLED}
                                            value={governance.nginx.publicDomain}
                                            onChange={(e) => setNginx("publicDomain", e.target.value)}
                                            placeholder="example.com"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Subdomain pattern</Label>
                                        <Input
                                            disabled={!NGINX_RUNTIME_ENABLED}
                                            value={governance.nginx.publishSubdomainPattern}
                                            onChange={(e) => setNginx("publishSubdomainPattern", e.target.value)}
                                            placeholder="{publishId}"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Cache TTL (seconds)</Label>
                                        <Input
                                            disabled={!NGINX_RUNTIME_ENABLED}
                                            type="number"
                                            value={String(governance.nginx.cacheTtlSeconds)}
                                            onChange={(e) => setNginx("cacheTtlSeconds", Number(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Client max body size (MB)</Label>
                                        <Input
                                            disabled={!NGINX_RUNTIME_ENABLED}
                                            type="number"
                                            value={String(governance.nginx.clientMaxBodySizeMb)}
                                            onChange={(e) => setNginx("clientMaxBodySizeMb", Number(e.target.value) || 1)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label>Extra server directives</Label>
                                    <div className={!NGINX_RUNTIME_ENABLED ? "pointer-events-none opacity-60" : ""}>
                                        <MonacoCodeEditor
                                            language="nginx"
                                            value={governance.nginx.extraServerDirectives}
                                            onChange={(v) => setNginx("extraServerDirectives", v)}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* Save bar — always visible at page bottom */}
                <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-border bg-background/95 backdrop-blur py-4">
                    <Button onClick={saveGovernance} disabled={saving}>
                        {saving ? "Saving…" : "Save Governance"}
                    </Button>
                    {saved && <span className="text-sm text-green-500">Saved!</span>}
                    <span className="text-xs text-muted-foreground ml-2">
                        Scope: <span className="font-mono">{activeProductKey}</span> — tab: {activeTab}
                    </span>
                </div>
            </div>
        </div>
    );
}
