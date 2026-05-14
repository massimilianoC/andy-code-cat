"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminConfig,
    updateProductGovernance,
    type ProductGovernanceDto,
    type PlatformConfigDto,
    type CookieBannerLocaleText,
    type PromptTaskSettingDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";
import { PromptTaskSettingsCard } from "@/components/admin/PromptTaskSettingsCard";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCT_KEY = "default";
const DEFAULT_PROMPT_TASK_KEY = "optimize_user_prompt";
const TEMPLATE_DRAFT_TASK_KEY = "draft_template_model";
const NGINX_RUNTIME_ENABLED = false;

const PROMPT_TASK_DEFAULTS: Record<string, PromptTaskSettingDto> = {
    [DEFAULT_PROMPT_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.7,
        maxCompletionTokens: 1200,
        systemTemplate: "",
    },
    [TEMPLATE_DRAFT_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.5,
        maxCompletionTokens: 1800,
        systemTemplate: "",
    },
    enrich_document: {
        enabled: true,
        provider: "siliconflow",
        model: "Qwen/Qwen2.5-72B-Instruct",
        temperature: 0.1,
        maxCompletionTokens: 800,
        systemTemplate: "",
    },
    enrich_image: {
        enabled: true,
        provider: "siliconflow",
        model: "Qwen/Qwen2.5-VL-72B-Instruct",
        temperature: 0.1,
        maxCompletionTokens: 600,
        systemTemplate: "",
    },
};

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
    promptTaskSettings: {
        ...PROMPT_TASK_DEFAULTS,
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
    { id: "prompts", label: "Prompt Pipeline" },
    { id: "runtime", label: "Runtime" },
];

// ── Helper components ─────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: GovernanceTab; onChange: (t: GovernanceTab) => void }) {
    return (
        <div className="admin-tab-list">
            {TABS.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange(t.id)}
                    className="admin-tab"
                    data-active={active === t.id ? "true" : undefined}
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

// ── Prompt pipeline layer helpers ────────────────────────────────────────────

type LayerSource = "hardcoded" | "preset" | "per-project" | "editable";

const LAYER_SOURCE_META: Record<LayerSource, { label: string; bg: string; color: string; border: string }> = {
    hardcoded: { label: "🔒 Hardcoded", bg: "rgba(100,100,110,0.15)", color: "var(--text-muted)", border: "1px solid rgba(100,100,110,0.25)" },
    preset: { label: "📦 Preset catalog", bg: "rgba(59,130,246,0.1)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.25)" },
    "per-project": { label: "🗂️ Per-project", bg: "rgba(245,158,11,0.1)", color: "#fcd34d", border: "1px solid rgba(245,158,11,0.25)" },
    editable: { label: "✏️ Configurable here", bg: "rgba(99,102,241,0.12)", color: "var(--accent-hover)", border: "1px solid rgba(99,102,241,0.3)" },
};

/** Static representative content for hardcoded pipeline layers (shown read-only). */
const HARDCODED_LAYER_CONTENT: Record<string, string> = {
    A: `You are Andy Code Cat Builder, a specialised AI agent for generating production-ready HTML web pages.

Platform constraints (hardcoded — cannot be overridden by any layer below):

• Produce valid, complete HTML5 — never partial fragments.
• Never insert placeholder text (lorem ipsum, [YOUR TEXT HERE], TBD, etc.).
• Never include HTML comments in the rendered output.
• All <img> elements must carry a descriptive alt attribute.
• Output is a single self-contained document; inline styles are allowed, external CDN links are not unless the preset explicitly requires them.
• Do not include <script> tags unless the project type requires interactivity.
• The MANIFEST.json block must always be emitted in full at the end of the response.`,

    "⚙": `<!-- Runtime-computed — injected at call time, not stored in governance -->

Target output: complete HTML document within token budget.
Max completion tokens: [resolved from plan limits at runtime]

Guidelines applied:
• Prioritise content density — reduce the number of sections rather than truncating sections.
• The MANIFEST.json block must always be emitted in full; never truncate it.
• If approaching the token limit, omit decorative sections before omitting structural ones.
• Do not summarise or abbreviate section content to fit the budget — reduce scope instead.`,

    "→": `<!-- Per-call metadata — ephemeral, injected last, never stored -->

request_id:         [uuid generated per request]
response_format:    structured_html_with_manifest
strict_mode:        true
pipeline_version:   [resolved at runtime]

This layer is invisible to end users. It is used internally for request tracing and
response-format enforcement. Its content changes on every call and is never persisted.`,
};

/** Descriptive info shown for dynamic (preset / per-project) layers when opened. */
const DYNAMIC_LAYER_INFO: Record<string, string> = {
    B: `Preset catalog layer — loaded dynamically at generation time.

Content depends on the active project-type preset (e.g. "landing-page-standard", "portfolio-minimal").

This layer defines:
  • Output format (section order, semantic markup pattern)
  • Required sections and their HTML structure
  • Preset-level content supplements injected into the editorial brief

Edit preset content from: Admin → Presets`,

    C: `Per-project layer — populated at generation time from the project's style profile.

Content includes:
  • Brand voice and tone directives
  • Visual identity tokens (colours, typography, spacing scale)
  • Moodboard descriptions extracted during onboarding or profiling

This layer is unique per project and cannot be configured globally.`,

    D: `Per-project layer — built at generation time from the project brief and preset supplement.

Content includes:
  • The user's editorial brief (goals, audience, CTA, contact info, style attributes)
  • Invisible preset-level editorial supplement injected by the preset catalog
  • Tone and style preferences accumulated during the project session

This layer combines the user-visible brief with a per-preset enrichment layer.`,

    "B′": `Preset catalog layer — loaded dynamically at focused-edit time.

Defines section-level focus rules and coherence constraints for the active preset:
  • Which sections can be individually targeted by a focused edit
  • Coherence guards preventing edits from breaking structural invariants
  • Focus-scope hints passed to the model

Content is managed in the preset catalog and varies per project type.`,
};

function LayerRow({ letter, name, source, description, children, isLast, initialOpen }: {
    letter: string;
    name: string;
    source: LayerSource;
    description: string;
    children?: ReactNode;
    isLast?: boolean;
    /** Editable layers default to open so the editor is immediately visible. */
    initialOpen?: boolean;
}) {
    const [isOpen, setIsOpen] = useState(initialOpen ?? false);
    const meta = LAYER_SOURCE_META[source];

    const staticContent = HARDCODED_LAYER_CONTENT[letter];
    const dynamicInfo = DYNAMIC_LAYER_INFO[letter];
    const hasBody = children != null || staticContent != null || dynamicInfo != null;

    return (
        <div style={{ display: "flex", gap: "14px" }}>
            {/* Left: badge + vertical connector */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: "34px" }}>
                <div style={{
                    width: "34px", height: "34px", borderRadius: "50%",
                    background: meta.bg, border: meta.border, color: meta.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: "0.75rem", fontFamily: "monospace", flexShrink: 0,
                }}>
                    {letter}
                </div>
                {!isLast && <div style={{ width: "2px", flex: 1, minHeight: "20px", background: "var(--border)", marginTop: "2px" }} />}
            </div>

            {/* Right: accordion */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : "20px" }}>
                {/* Header — always visible, click to toggle */}
                <button
                    type="button"
                    onClick={() => setIsOpen((o) => !o)}
                    style={{
                        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px",
                        marginBottom: "4px", background: "none", border: "none", padding: 0,
                        cursor: hasBody ? "pointer" : "default", textAlign: "left", width: "100%",
                    }}
                >
                    <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text)" }}>{name}</span>
                    <span style={{
                        fontSize: "0.6875rem", fontWeight: 500, padding: "2px 7px", borderRadius: "4px",
                        background: meta.bg, color: meta.color, border: meta.border, whiteSpace: "nowrap",
                    }}>
                        {meta.label}
                    </span>
                    {hasBody && (
                        <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-muted)", flexShrink: 0 }}>
                            {isOpen ? "▾" : "▸"}
                        </span>
                    )}
                </button>
                <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: isOpen ? "10px" : 0, lineHeight: 1.5 }}>
                    {description}
                </p>

                {/* Accordion body */}
                {isOpen && (
                    <div style={{ marginTop: "4px" }}>
                        {/* Editable layer: writable Monaco */}
                        {children}

                        {/* Hardcoded layer: read-only Monaco with static content */}
                        {!children && staticContent != null && (
                            <MonacoCodeEditor
                                language="markdown"
                                value={staticContent}
                                readOnly
                                height="160px"
                            />
                        )}

                        {/* Dynamic (preset / per-project) layer: info block */}
                        {!children && staticContent == null && dynamicInfo != null && (
                            <div style={{
                                padding: "10px 14px",
                                borderRadius: "6px",
                                background: "rgba(100,100,110,0.08)",
                                border: "1px solid var(--border)",
                                fontSize: "0.78rem",
                                color: "var(--text-muted)",
                                fontFamily: "JetBrains Mono, Fira Code, monospace",
                                whiteSpace: "pre-wrap",
                                lineHeight: 1.65,
                            }}>
                                {dynamicInfo}
                            </div>
                        )}
                    </div>
                )}
            </div>
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
            promptTaskSettings: Object.fromEntries(
                Object.entries({ ...PROMPT_TASK_DEFAULTS, ...(src.promptTaskSettings ?? {}) }).map(([taskKey, task]) => [
                    taskKey,
                    {
                        ...(PROMPT_TASK_DEFAULTS[taskKey] ?? PROMPT_TASK_DEFAULTS[DEFAULT_PROMPT_TASK_KEY]),
                        ...task,
                    },
                ]),
            ),
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

    function setPromptTaskField<K extends keyof PromptTaskSettingDto>(
        taskKey: string,
        key: K,
        value: PromptTaskSettingDto[K],
    ) {
        const defaults = PROMPT_TASK_DEFAULTS[taskKey] ?? PROMPT_TASK_DEFAULTS[DEFAULT_PROMPT_TASK_KEY];
        setGovernance((prev) => ({
            ...prev,
            promptTaskSettings: {
                ...(prev.promptTaskSettings ?? {}),
                [taskKey]: {
                    ...defaults,
                    ...(prev.promptTaskSettings?.[taskKey] ?? {}),
                    [key]: value,
                },
            },
        }));
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
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {/* ── Page header ─────────────────────────────────────────────── */}
            <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <div>
                        <h1 style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--text)", marginBottom: "0.3rem" }}>
                            Product Governance
                        </h1>
                        <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", maxWidth: "56rem", lineHeight: 1.55 }}>
                            Per-product prompt templates, HTML/JS/CSS injections, cookie banner, legal pages, and
                            nginx runtime knobs. Changes apply on the next page render.
                        </p>
                    </div>
                    <nav style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.75rem", color: "var(--text-muted)", flexShrink: 0 }}>
                        <a href="/admin" style={{ color: "var(--text-muted)", textDecoration: "none" }}>Admin</a>
                        <span>/</span>
                        <span style={{ color: "var(--text)" }}>Governance</span>
                    </nav>
                </div>
            </div>

            {error && (
                <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", fontSize: "0.8125rem", color: "var(--danger)" }}>
                    {error}
                </div>
            )}

            {/* ── Product scope toolbar ───────────────────────────────────── */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "flex-end",
                    gap: "12px",
                    marginBottom: "1.25rem",
                    padding: "1rem 1.25rem",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                }}
            >
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <p style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                        Product scope
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {productOptions.length === 0 && (
                            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>No products yet — type a key below to create one.</span>
                        )}
                        {productOptions.map((key) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => loadProductConfig(key)}
                                style={{
                                    padding: "3px 10px",
                                    borderRadius: "6px",
                                    fontSize: "0.8125rem",
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    transition: "all 0.12s",
                                    background: key === activeProductKey ? "rgba(99,102,241,0.18)" : "var(--surface-2)",
                                    color: key === activeProductKey ? "var(--accent-hover)" : "var(--text-muted)",
                                    border: key === activeProductKey ? "1px solid rgba(99,102,241,0.35)" : "1px solid var(--border)",
                                }}
                            >
                                {key}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexShrink: 0 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <Label htmlFor="product-key" style={{ fontSize: "0.72rem" }}>Product key</Label>
                        <Input
                            id="product-key"
                            value={productKeyInput}
                            onChange={(e) => setProductKeyInput(e.target.value)}
                            placeholder="default"
                            className="w-36"
                        />
                    </div>
                    <Button variant="outline" size="sm" onClick={() => loadProductConfig(productKeyInput.trim() || DEFAULT_PRODUCT_KEY)}>
                        Load
                    </Button>
                    <Button size="sm" onClick={saveGovernance} disabled={saving}>
                        {saving ? "Saving…" : saved ? "✓ Saved" : "Save Governance"}
                    </Button>
                </div>
            </div>

            {/* ── Tab bar ─────────────────────────────────────────────────── */}
            <TabBar active={activeTab} onChange={setActiveTab} />

            {/* ── Tab content ─────────────────────────────────────────────── */}
            <div style={{ paddingTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

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

                {/* ── Prompt Pipeline ────────────────────────────────────────── */}
                {activeTab === "prompts" && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Prompt Pipeline</CardTitle>
                                <CardDescription className="text-xs">
                                    All prompt layers applied in sequence for each pipeline. Hardcoded and
                                    per-project layers are shown for reference only. Layers marked
                                    "Configurable here" are backed by MongoDB and editable below.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {/* Legend */}
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "24px", padding: "10px 14px", borderRadius: "8px", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                                    {(["hardcoded", "preset", "per-project", "editable"] as LayerSource[]).map((src) => (
                                        <span key={src} style={{ fontSize: "0.6875rem", fontWeight: 500, padding: "2px 8px", borderRadius: "4px", background: LAYER_SOURCE_META[src].bg, color: LAYER_SOURCE_META[src].color, border: LAYER_SOURCE_META[src].border }}>
                                            {LAYER_SOURCE_META[src].label}
                                        </span>
                                    ))}
                                </div>

                                {/* ── Generation Pipeline ── */}
                                <p style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "16px" }}>
                                    Generation pipeline
                                </p>
                                <LayerRow letter="A" name="Base Constraints" source="hardcoded"
                                    description="Platform-level safety and coherence rules: valid HTML5, no placeholder text, no commentary blocks. Always applied first; cannot be overridden.">
                                </LayerRow>
                                <LayerRow letter="B" name="Preset / Output Module" source="preset"
                                    description="Output format, section structure, and semantic layout defined by the selected project-type preset. Loaded from the preset catalog.">
                                </LayerRow>
                                <LayerRow letter="C" name="Style Context" source="per-project"
                                    description="Brand voice, visual identity, colour palette, and moodboard extracted from the active project profile. Set per-project by the user.">
                                </LayerRow>
                                <LayerRow letter="D" name="Pre-Prompt Template" source="per-project"
                                    description="Project-level editorial brief plus an invisible preset-level supplement. The visible part is edited per-project; the supplement is injected by the preset catalog.">
                                </LayerRow>
                                <LayerRow letter="E" name="Governance Injection — Generation" source="editable" initialOpen
                                    description="Platform governance rules injected after the project context. Editable below — applies to all generation calls for this product key. Falls back to the 'default' key if no product-specific override exists.">
                                    <MonacoCodeEditor
                                        language="markdown"
                                        height="200px"
                                        value={governance.promptTemplates.generationSystem}
                                        onChange={(v) => setPrompt("generationSystem", v)}
                                    />
                                </LayerRow>
                                <LayerRow letter="⚙" name="Budget Policy" source="hardcoded"
                                    description="Token budget directives and output-length guidance. Computed from environment limits and project plan at call time; not configurable.">
                                </LayerRow>
                                <LayerRow letter="→" name="Request Override" source="hardcoded" isLast
                                    description="Ephemeral per-call metadata (request ID, response-format hint). Injected last at call time; not stored or configurable.">
                                </LayerRow>

                                {/* ── Focused Edit Pipeline ── */}
                                <div style={{ marginTop: "8px", marginBottom: "16px", borderTop: "1px solid var(--border)", paddingTop: "20px" }}>
                                    <p style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                                        Focused edit pipeline
                                    </p>
                                </div>
                                <LayerRow letter="B′" name="Preset Focus Schema" source="preset"
                                    description="Section-level focus rules and coherence constraints from the preset catalog. Governs which parts of the page a focused edit can target.">
                                </LayerRow>
                                <LayerRow letter="E′" name="Governance Injection — Focused Edit" source="editable" isLast initialOpen
                                    description="Platform governance overlay for targeted section edits. Editable below — applies to all focused-edit calls for this product key.">
                                    <MonacoCodeEditor
                                        language="markdown"
                                        height="180px"
                                        value={governance.promptTemplates.focusedEditSystem}
                                        onChange={(v) => setPrompt("focusedEditSystem", v)}
                                    />
                                </LayerRow>

                                {/* ── Review Pipeline ── */}
                                <div style={{ marginTop: "8px", marginBottom: "16px", borderTop: "1px solid var(--border)", paddingTop: "20px" }}>
                                    <p style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                                        Review pipeline
                                    </p>
                                </div>
                                <LayerRow letter="E″" name="Governance Injection — Review" source="editable" isLast initialOpen
                                    description="Platform governance rules for the content review pass. Editable below — applies to all review calls for this product key.">
                                    <MonacoCodeEditor
                                        language="markdown"
                                        height="180px"
                                        value={governance.promptTemplates.reviewSystem}
                                        onChange={(v) => setPrompt("reviewSystem", v)}
                                    />
                                </LayerRow>
                            </CardContent>
                        </Card>

                        {/* AI Helper Tasks */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">AI Helper Tasks</CardTitle>
                                <CardDescription className="text-xs">
                                    Internal AI tasks (prompt optimisation, template drafting) run on lightweight
                                    models separate from the main generation pipeline. Configure provider, model,
                                    temperature, and system templates here.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <PromptTaskSettingsCard
                                    title="Optimized preprompting"
                                    description="Controls the rewriting layer that strengthens the user brief before generation, aligned with the active project-type template model."
                                    helperText="Default fallback: SiliconFlow + MiniMax M2.5"
                                    value={governance.promptTaskSettings?.[DEFAULT_PROMPT_TASK_KEY] ?? PROMPT_TASK_DEFAULTS[DEFAULT_PROMPT_TASK_KEY]}
                                    onFieldChange={(key, value) => setPromptTaskField(DEFAULT_PROMPT_TASK_KEY, key, value)}
                                />
                                <PromptTaskSettingsCard
                                    title="AI template drafter"
                                    description="Reusable service task for superadmin-side creation and refinement of project-type template models from short natural-language instructions."
                                    helperText="This powers dedicated admin authoring flows without introducing a separate prompting stack."
                                    value={governance.promptTaskSettings?.[TEMPLATE_DRAFT_TASK_KEY] ?? PROMPT_TASK_DEFAULTS[TEMPLATE_DRAFT_TASK_KEY]}
                                    onFieldChange={(key, value) => setPromptTaskField(TEMPLATE_DRAFT_TASK_KEY, key, value)}
                                />
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
                <div
                    style={{
                        position: "sticky",
                        bottom: 0,
                        zIndex: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        borderTop: "1px solid var(--border)",
                        background: "rgba(15,17,23,0.96)",
                        backdropFilter: "blur(10px)",
                        padding: "12px 0",
                        marginTop: "8px",
                    }}
                >
                    <Button onClick={saveGovernance} disabled={saving}>
                        {saving ? "Saving…" : "Save Governance"}
                    </Button>
                    {saved && (
                        <span style={{ fontSize: "0.8125rem", color: "var(--success)" }}>✓ Saved</span>
                    )}
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: "4px" }}>
                        Scope: <code style={{ fontFamily: "monospace" }}>{activeProductKey}</code> — tab:{" "}
                        <code style={{ fontFamily: "monospace" }}>{activeTab}</code>
                    </span>
                </div>
            </div>
        </div>
    );
}
