"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminConfig,
    updateProductGovernance,
    type ProductGovernanceDto,
    type PlatformConfigDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";

const DEFAULT_PRODUCT_KEY = "default";

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
        googleTagManagerId: "",
        googleAnalyticsId: "",
        matomoSiteId: "",
        matomoUrl: "",
    },
    nginx: {
        publicDomain: "",
        publishSubdomainPattern: "{publishId}",
        cacheTtlSeconds: 300,
        clientMaxBodySizeMb: 20,
        extraServerDirectives: "",
    },
};

export default function AdminGovernancePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [config, setConfig] = useState<PlatformConfigDto | null>(null);
    const [productKeyInput, setProductKeyInput] = useState(DEFAULT_PRODUCT_KEY);
    const [activeProductKey, setActiveProductKey] = useState(DEFAULT_PRODUCT_KEY);
    const [governance, setGovernance] = useState<ProductGovernanceDto>(EMPTY_GOVERNANCE);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            router.replace("/login");
            return;
        }

        getAdminConfig(token)
            .then((nextConfig) => {
                setConfig(nextConfig);
                const selected = nextConfig.governanceByProduct?.[DEFAULT_PRODUCT_KEY] ?? EMPTY_GOVERNANCE;
                setGovernance({
                    promptTemplates: { ...selected.promptTemplates },
                    injections: { ...selected.injections },
                    nginx: { ...selected.nginx },
                });
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load governance config"))
            .finally(() => setLoading(false));
    }, [router]);

    const productOptions = useMemo(
        () => Object.keys(config?.governanceByProduct ?? {}).sort(),
        [config]
    );

    function loadProductConfig(productKey: string) {
        const selected = config?.governanceByProduct?.[productKey] ?? EMPTY_GOVERNANCE;
        setGovernance({
            promptTemplates: { ...selected.promptTemplates },
            injections: { ...selected.injections },
            nginx: { ...selected.nginx },
        });
        setActiveProductKey(productKey);
        setProductKeyInput(productKey);
    }

    async function saveGovernance() {
        const token = getToken();
        if (!token) {
            return;
        }

        const productKey = productKeyInput.trim();
        if (!productKey) {
            setError("Product key is required");
            return;
        }

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

    if (loading) {
        return <p className="text-sm text-muted-foreground">Loading governance…</p>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold">Global Product Governance</h1>
                    <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                        Configure per-product prompt templates, global HTML/JS injections and nginx runtime knobs.
                        This section is designed for governance-level controls and remains backward-compatible with current generation flows.
                    </p>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <a href="/admin" className="hover:text-foreground transition-colors">Admin</a>
                    <span>/</span>
                    <span className="text-foreground">Governance</span>
                </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Product Scope</CardTitle>
                    <CardDescription className="text-xs">
                        Select a product key to edit. Unknown keys create a new configuration namespace.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {productOptions.map((key) => (
                            <Button key={key} variant={key === activeProductKey ? "default" : "outline"} size="sm" onClick={() => loadProductConfig(key)}>
                                {key}
                            </Button>
                        ))}
                    </div>
                    <div className="flex gap-3 items-end max-w-xl">
                        <div className="flex-1 space-y-1">
                            <Label htmlFor="product-key">Product key</Label>
                            <Input
                                id="product-key"
                                value={productKeyInput}
                                onChange={(e) => setProductKeyInput(e.target.value)}
                                placeholder="default"
                            />
                        </div>
                        <Button variant="outline" onClick={() => loadProductConfig(productKeyInput.trim() || DEFAULT_PRODUCT_KEY)}>
                            Load
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Prompt Templates</CardTitle>
                    <CardDescription className="text-xs">
                        Centralized instruction blocks used by generation, focused edit and review pipelines.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <Label>Generation system prompt</Label>
                        <MonacoCodeEditor language="markdown" value={governance.promptTemplates.generationSystem} onChange={(next) => setGovernance((prev) => ({ ...prev, promptTemplates: { ...prev.promptTemplates, generationSystem: next } }))} />
                    </div>
                    <div className="space-y-1">
                        <Label>Focused edit system prompt</Label>
                        <MonacoCodeEditor language="markdown" value={governance.promptTemplates.focusedEditSystem} onChange={(next) => setGovernance((prev) => ({ ...prev, promptTemplates: { ...prev.promptTemplates, focusedEditSystem: next } }))} />
                    </div>
                    <div className="space-y-1">
                        <Label>Review system prompt</Label>
                        <MonacoCodeEditor language="markdown" value={governance.promptTemplates.reviewSystem} onChange={(next) => setGovernance((prev) => ({ ...prev, promptTemplates: { ...prev.promptTemplates, reviewSystem: next } }))} />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Global Injection Snippets</CardTitle>
                    <CardDescription className="text-xs">
                        HTML/JS snippets to inject in generated pages: head, layout wrappers and script areas.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label>Google Tag Manager ID</Label>
                            <Input value={governance.injections.googleTagManagerId} onChange={(e) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, googleTagManagerId: e.target.value } }))} placeholder="GTM-XXXXXXX" />
                        </div>
                        <div className="space-y-1">
                            <Label>Google Analytics ID</Label>
                            <Input value={governance.injections.googleAnalyticsId} onChange={(e) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, googleAnalyticsId: e.target.value } }))} placeholder="G-XXXXXXXXXX" />
                        </div>
                        <div className="space-y-1">
                            <Label>Matomo URL</Label>
                            <Input value={governance.injections.matomoUrl} onChange={(e) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, matomoUrl: e.target.value } }))} placeholder="https://analytics.example.com" />
                        </div>
                        <div className="space-y-1">
                            <Label>Matomo Site ID</Label>
                            <Input value={governance.injections.matomoSiteId} onChange={(e) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, matomoSiteId: e.target.value } }))} placeholder="1" />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label>Common &lt;head&gt; HTML</Label>
                        <MonacoCodeEditor language="html" value={governance.injections.headHtml} onChange={(next) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, headHtml: next } }))} />
                    </div>
                    <div className="space-y-1">
                        <Label>Global Header HTML</Label>
                        <MonacoCodeEditor language="html" value={governance.injections.headerHtml} onChange={(next) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, headerHtml: next } }))} />
                    </div>
                    <div className="space-y-1">
                        <Label>Global Footer HTML</Label>
                        <MonacoCodeEditor language="html" value={governance.injections.footerHtml} onChange={(next) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, footerHtml: next } }))} />
                    </div>
                    <div className="space-y-1">
                        <Label>Script in &lt;head&gt;</Label>
                        <MonacoCodeEditor language="javascript" value={governance.injections.scriptInHead} onChange={(next) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, scriptInHead: next } }))} />
                    </div>
                    <div className="space-y-1">
                        <Label>Script before &lt;/body&gt;</Label>
                        <MonacoCodeEditor language="javascript" value={governance.injections.scriptBeforeBodyClose} onChange={(next) => setGovernance((prev) => ({ ...prev, injections: { ...prev.injections, scriptBeforeBodyClose: next } }))} />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Nginx Runtime Parameters</CardTitle>
                    <CardDescription className="text-xs">
                        Product-level nginx tuning values to standardize installation templates and deployment sessions.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label>Public domain</Label>
                            <Input value={governance.nginx.publicDomain} onChange={(e) => setGovernance((prev) => ({ ...prev, nginx: { ...prev.nginx, publicDomain: e.target.value } }))} placeholder="example.com" />
                        </div>
                        <div className="space-y-1">
                            <Label>Subdomain pattern</Label>
                            <Input value={governance.nginx.publishSubdomainPattern} onChange={(e) => setGovernance((prev) => ({ ...prev, nginx: { ...prev.nginx, publishSubdomainPattern: e.target.value } }))} placeholder="{publishId}" />
                        </div>
                        <div className="space-y-1">
                            <Label>Cache TTL (seconds)</Label>
                            <Input type="number" value={String(governance.nginx.cacheTtlSeconds)} onChange={(e) => setGovernance((prev) => ({ ...prev, nginx: { ...prev.nginx, cacheTtlSeconds: Number(e.target.value) || 0 } }))} />
                        </div>
                        <div className="space-y-1">
                            <Label>Client max body size (MB)</Label>
                            <Input type="number" value={String(governance.nginx.clientMaxBodySizeMb)} onChange={(e) => setGovernance((prev) => ({ ...prev, nginx: { ...prev.nginx, clientMaxBodySizeMb: Number(e.target.value) || 1 } }))} />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label>Extra server directives</Label>
                        <MonacoCodeEditor language="nginx" value={governance.nginx.extraServerDirectives} onChange={(next) => setGovernance((prev) => ({ ...prev, nginx: { ...prev.nginx, extraServerDirectives: next } }))} />
                    </div>
                </CardContent>
            </Card>

            <div className="flex items-center gap-3">
                <Button onClick={saveGovernance} disabled={saving}>
                    {saving ? "Saving…" : "Save Governance"}
                </Button>
                {saved && <span className="text-sm text-green-500">Saved</span>}
                <span className="text-xs text-muted-foreground">Scope: {activeProductKey}</span>
            </div>
        </div>
    );
}
