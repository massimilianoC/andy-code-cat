"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminLlmRegistry,
    refreshAdminLlmRegistry,
    seedAdminLlmRegistry,
    updateAdminLlmModel,
    deleteAdminLlmModel,
    setAdminLlmModelsActive,
    type AdminLlmModelDto,
    type AdminLlmProviderDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";
import { ProviderModelPicker, familyLabel } from "@/components/llm/ProviderModelPicker";

const LIVE_MODEL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const ROLE_OPTIONS = [
    "dialogue",
    "dialogue_fast",
    "coding",
    "coding_fast",
    "vision",
    "vision_fast",
    "quality_check",
    "image_gen",
    "image_gen_fast",
    "embeddings",
] as const;

const EMPTY_MODEL: AdminLlmModelDto = {
    id: "",
    provider: "siliconflow",
    role: "dialogue",
    capabilities: ["chat"],
    isDefault: false,
    isFallback: true,
    isActive: true,
    displayName: "",
    description: "",
    promptTemplate: "",
    focusPromptTemplate: "",
};

export default function AdminModelsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [refreshingLive, setRefreshingLive] = useState(false);
    const [lastLiveRefreshAt, setLastLiveRefreshAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [source, setSource] = useState("env");
    const [providers, setProviders] = useState<AdminLlmProviderDto[]>([]);
    const [selectedProvider, setSelectedProvider] = useState("siliconflow");
    const [draft, setDraft] = useState<AdminLlmModelDto>(EMPTY_MODEL);
    const [activating, setActivating] = useState<string | null>(null);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            router.replace("/login");
            return;
        }

        void loadRegistry(token);
    }, [router]);

    useEffect(() => {
        const token = getToken();
        if (!token) return;
        const interval = window.setInterval(() => {
            void (async () => {
                try {
                    const result = await refreshAdminLlmRegistry(token);
                    setProviders(result.providers ?? []);
                    setSource(result.source ?? "env");
                    setLastLiveRefreshAt(result.refreshedAt);
                } catch {
                    // Quiet periodic refresh; manual refresh surfaces errors.
                }
            })();
        }, LIVE_MODEL_REFRESH_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, []);

    const activeProvider = useMemo(
        () => providers.find((provider) => provider.provider === selectedProvider) ?? null,
        [providers, selectedProvider],
    );

    /**
     * Models of the selected provider, grouped by author. Granularity stays per model — this is
     * only how they are laid out, because a provider that lists two hundred models is unusable as
     * a flat list, and "everything from this author" is the decision an operator actually makes.
     */
    const modelGroups = useMemo(() => {
        const groups = new Map<string, AdminLlmModelDto[]>();
        for (const model of activeProvider?.models ?? []) {
            const family = familyLabel(model.id);
            const bucket = groups.get(family);
            if (bucket) bucket.push(model);
            else groups.set(family, [model]);
        }
        return [...groups.entries()]
            .map(([family, models]) => ({
                family,
                models: [...models].sort((left, right) => left.id.localeCompare(right.id)),
                activeCount: models.filter((model) => model.isActive).length,
                deprecatedCount: models.filter((model) => model.availability === "deprecated").length,
            }))
            .sort((left, right) => left.family.localeCompare(right.family));
    }, [activeProvider]);

    const providerActiveCount = (activeProvider?.models ?? []).filter((model) => model.isActive).length;
    const providerTotalCount = (activeProvider?.models ?? []).length;

    /**
     * One request per decision, whatever its size: a single model, an author group, or the whole
     * provider. The response carries the refreshed registry, so what is rendered afterwards is
     * what was persisted rather than an optimistic guess that a failed write would leave lying.
     */
    async function applyActivation(scope: string, modelIds: string[], isActive: boolean) {
        const token = getToken();
        if (!token || modelIds.length === 0) return;
        setActivating(scope);
        setError(null);
        try {
            const result = await setAdminLlmModelsActive(token, selectedProvider, modelIds, isActive);
            setProviders(result.providers ?? []);
            setSource(result.source ?? "env");
            if (result.unknown?.length) {
                setError(`${result.unknown.length} model(s) no longer offered by the provider were skipped.`);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not change model activation");
        } finally {
            setActivating(null);
        }
    }

    async function loadRegistry(token: string) {
        setLoading(true);
        setError(null);
        try {
            const registry = await getAdminLlmRegistry(token);
            const nextProviders = registry.providers ?? [];
            setProviders(nextProviders);
            setSource(registry.source ?? "env");

            const firstProvider = nextProviders.find((provider) => provider.provider === selectedProvider) ?? nextProviders[0] ?? null;
            if (firstProvider) {
                setSelectedProvider(firstProvider.provider);
                const firstModel = firstProvider.models[0] ?? null;
                if (firstModel) {
                    setDraft({ ...firstModel });
                } else {
                    setDraft({ ...EMPTY_MODEL, provider: firstProvider.provider });
                }
            } else {
                setDraft({ ...EMPTY_MODEL });
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load model registry");
        } finally {
            setLoading(false);
        }
    }

    function selectProviderModel(providerKey: string, modelId?: string) {
        setSelectedProvider(providerKey);
        const provider = providers.find((entry) => entry.provider === providerKey);
        const model = modelId
            ? provider?.models.find((entry) => entry.id === modelId) ?? null
            : provider?.models[0] ?? null;
        setDraft(model ? { ...model } : { ...EMPTY_MODEL, provider: providerKey });
    }

    function createNewModel() {
        setDraft({ ...EMPTY_MODEL, provider: selectedProvider || providers[0]?.provider || "siliconflow" });
        setSaved(false);
        setError(null);
    }

    async function syncSeed() {
        const token = getToken();
        if (!token) return;

        setSyncing(true);
        setError(null);
        try {
            const result = await seedAdminLlmRegistry(token);
            setProviders(result.providers ?? []);
            setSource("mongo");
            const firstProvider = result.providers?.[0] ?? null;
            if (firstProvider) {
                setSelectedProvider(firstProvider.provider);
                setDraft(firstProvider.models[0] ?? { ...EMPTY_MODEL, provider: firstProvider.provider });
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to sync the seed into MongoDB");
        } finally {
            setSyncing(false);
        }
    }

    async function refreshLiveModels(tokenOverride?: string, options?: { quiet?: boolean }) {
        const token = tokenOverride ?? getToken();
        if (!token) return;

        if (!options?.quiet) {
            setRefreshingLive(true);
            setError(null);
        }
        try {
            const result = await refreshAdminLlmRegistry(token);
            const nextProviders = result.providers ?? [];
            setProviders(nextProviders);
            setSource(result.source ?? source);
            setLastLiveRefreshAt(result.refreshedAt);

            const provider = nextProviders.find((entry) => entry.provider === selectedProvider) ?? nextProviders[0] ?? null;
            if (!provider) return;
            setSelectedProvider(provider.provider);
            const currentModel = provider.models.find((model) => model.id === draft.id) ?? provider.models[0] ?? null;
            setDraft(currentModel ? { ...currentModel } : { ...EMPTY_MODEL, provider: provider.provider });
        } catch (e: unknown) {
            if (!options?.quiet) {
                setError(e instanceof Error ? e.message : "Failed to refresh live provider models");
            }
        } finally {
            if (!options?.quiet) {
                setRefreshingLive(false);
            }
        }
    }

    async function saveModel() {
        const token = getToken();
        if (!token) return;
        if (!draft.provider.trim() || !draft.id.trim()) {
            setError("Provider and model id are required");
            return;
        }

        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            await updateAdminLlmModel(token, draft.provider, draft.id, {
                displayName: draft.displayName,
                description: draft.description,
                role: draft.role,
                capabilities: draft.capabilities,
                isDefault: draft.isDefault,
                isFallback: draft.isFallback,
                isActive: draft.isActive,
                promptTemplate: draft.promptTemplate,
                focusPromptTemplate: draft.focusPromptTemplate,
            });
            await loadRegistry(token);
            setSelectedProvider(draft.provider);
            setSaved(true);
            setTimeout(() => setSaved(false), 2200);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to save the model");
        } finally {
            setSaving(false);
        }
    }

    async function removeModel() {
        const token = getToken();
        if (!token || !draft.id || !draft.provider) return;
        if (!window.confirm(`Delete model ${draft.id}?`)) return;

        setSaving(true);
        setError(null);
        try {
            await deleteAdminLlmModel(token, draft.provider, draft.id);
            await loadRegistry(token);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to delete the model");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <p className="text-sm text-muted-foreground">Loading model registry…</p>;
    }

    return (
        <div className="flex flex-col gap-6 max-w-[1400px]">
            <div>
                <h1 className="text-[1.375rem] font-bold text-foreground mb-1">Advanced Runtime LLM Catalog</h1>
                <p className="text-sm text-muted-foreground max-w-4xl">
                    This page is secondary infrastructure only. The main superadmin work discussed in chat now lives in Template Models and Preprompting.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => router.push("/admin/presets")}>Open Template Models</Button>
                    <Button type="button" variant="outline" onClick={() => router.push("/admin/governance")}>Open Preprompting</Button>
                </div>
            </div>

            {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Advanced Runtime Source</CardTitle>
                    <CardDescription className="text-xs">
                        Effective source: {source.toUpperCase()}. This optional catalog controls low-level runtime providers and is not the primary template-model governance surface.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 items-center">
                    <Button onClick={syncSeed} disabled={syncing}>
                        {syncing ? "Syncing…" : "Sync seed → Mongo"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void refreshLiveModels()} disabled={refreshingLive}>
                        {refreshingLive ? "Refreshing…" : "Refresh live models"}
                    </Button>
                    <Button type="button" variant="outline" onClick={createNewModel}>
                        New model
                    </Button>
                    {lastLiveRefreshAt ? (
                        <span className="text-xs text-muted-foreground">
                            Live refreshed {new Date(lastLiveRefreshAt).toLocaleTimeString()}
                        </span>
                    ) : null}
                    {saved ? <span className="text-sm text-green-400">✓ Saved</span> : null}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Providers & Models</CardTitle>
                        <CardDescription className="text-xs">
                            Published models are controlled by the active toggle. Defaults drive automatic runtime selection.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-1">
                            <Label>Provider & model</Label>
                            <ProviderModelPicker
                                providers={providers}
                                valueProvider={selectedProvider}
                                valueModel={draft.id}
                                onChange={({ provider, model }) => selectProviderModel(provider, model)}
                                includeInactive
                            />
                        </div>

                        <div className="space-y-3">
                            {/* Whole-provider switch. A new model arrives off, so this is the
                                "I trust this provider" shortcut - and the way back out of it. */}
                            {providerTotalCount > 0 ? (
                                <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-foreground truncate">{selectedProvider}</div>
                                        <div className="text-[11px] text-muted-foreground">
                                            {providerActiveCount} of {providerTotalCount} active
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={activating !== null || providerActiveCount === providerTotalCount}
                                            onClick={() => applyActivation(
                                                "provider",
                                                (activeProvider?.models ?? []).map((model) => model.id),
                                                true,
                                            )}
                                        >
                                            {activating === "provider" ? "…" : "All on"}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={activating !== null || providerActiveCount === 0}
                                            onClick={() => applyActivation(
                                                "provider",
                                                (activeProvider?.models ?? []).map((model) => model.id),
                                                false,
                                            )}
                                        >
                                            All off
                                        </Button>
                                    </div>
                                </div>
                            ) : null}

                            {modelGroups.map((group) => (
                                <div key={group.family} className="rounded-lg border border-border">
                                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold text-foreground truncate">{group.family}</div>
                                            <div className="text-[10px] text-muted-foreground">
                                                {group.activeCount}/{group.models.length} active
                                                {group.deprecatedCount > 0 ? " · " + group.deprecatedCount + " deprecated" : ""}
                                            </div>
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="h-6 px-2 text-[10px]"
                                                disabled={activating !== null || group.activeCount === group.models.length}
                                                onClick={() => applyActivation(
                                                    "family:" + group.family,
                                                    group.models.map((model) => model.id),
                                                    true,
                                                )}
                                            >
                                                {activating === "family:" + group.family ? "…" : "on"}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="h-6 px-2 text-[10px]"
                                                disabled={activating !== null || group.activeCount === 0}
                                                onClick={() => applyActivation(
                                                    "family:" + group.family,
                                                    group.models.map((model) => model.id),
                                                    false,
                                                )}
                                            >
                                                off
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="divide-y divide-border">
                                        {group.models.map((model) => (
                                            <div key={model.id} className="flex items-center gap-2 px-3 py-2">
                                                <button
                                                    type="button"
                                                    onClick={() => selectProviderModel(selectedProvider, model.id)}
                                                    className="min-w-0 flex-1 text-left"
                                                >
                                                    <div className="text-sm font-medium text-foreground truncate">
                                                        {model.displayName || model.id}
                                                    </div>
                                                    <div className="text-[11px] text-muted-foreground truncate">
                                                        {model.id}
                                                        {model.availability === "deprecated" ? " · no longer offered" : ""}
                                                    </div>
                                                </button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-6 shrink-0 px-2 text-[10px]"
                                                    disabled={activating !== null}
                                                    onClick={() => applyActivation("model:" + model.id, [model.id], !model.isActive)}
                                                    title={model.isActive ? "Deactivate" : "Activate"}
                                                >
                                                    {activating === "model:" + model.id
                                                        ? "…"
                                                        : model.isActive ? "on" : "off"}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {providerTotalCount === 0 ? (
                                <p className="text-xs text-muted-foreground">No models found for this provider yet.</p>
                            ) : null}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Model Editor</CardTitle>
                        <CardDescription className="text-xs">
                            Edit prompt layers per model and publish changes directly from the superadmin area.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label>Provider</Label>
                                <Input
                                    value={draft.provider}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, provider: e.target.value }))}
                                    placeholder="siliconflow"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label>Model ID</Label>
                                <Input
                                    value={draft.id}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value }))}
                                    placeholder="provider/model-name"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label>Display name</Label>
                                <Input
                                    value={draft.displayName ?? ""}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, displayName: e.target.value }))}
                                    placeholder="Friendly label"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label>Role</Label>
                                <select
                                    value={draft.role}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, role: e.target.value }))}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                                >
                                    {ROLE_OPTIONS.map((role) => (
                                        <option key={role} value={role}>{role}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Description</Label>
                            <Input
                                value={draft.description ?? ""}
                                onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                                placeholder="When to use this model"
                            />
                        </div>

                        <div className="space-y-1">
                            <Label>Capabilities</Label>
                            <Input
                                value={draft.capabilities.join(", ")}
                                onChange={(e) => setDraft((prev) => ({
                                    ...prev,
                                    capabilities: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                                }))}
                                placeholder="chat, vision"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button type="button" variant={draft.isActive ? "default" : "outline"} onClick={() => setDraft((prev) => ({ ...prev, isActive: !prev.isActive }))}>
                                {draft.isActive ? "Published" : "Unpublished"}
                            </Button>
                            <Button type="button" variant={draft.isDefault ? "default" : "outline"} onClick={() => setDraft((prev) => ({ ...prev, isDefault: !prev.isDefault }))}>
                                {draft.isDefault ? "Default" : "Set default"}
                            </Button>
                            <Button type="button" variant={draft.isFallback ? "secondary" : "outline"} onClick={() => setDraft((prev) => ({ ...prev, isFallback: !prev.isFallback }))}>
                                {draft.isFallback ? "Fallback" : "Set fallback"}
                            </Button>
                        </div>

                        <div className="space-y-1">
                            <Label>Generation prompt template</Label>
                            <MonacoCodeEditor
                                language="markdown"
                                height="220px"
                                value={draft.promptTemplate ?? ""}
                                onChange={(value) => setDraft((prev) => ({ ...prev, promptTemplate: value }))}
                            />
                        </div>

                        <div className="space-y-1">
                            <Label>Focused-edit prompt template</Label>
                            <MonacoCodeEditor
                                language="markdown"
                                height="180px"
                                value={draft.focusPromptTemplate ?? ""}
                                onChange={(value) => setDraft((prev) => ({ ...prev, focusPromptTemplate: value }))}
                            />
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Button onClick={saveModel} disabled={saving}>
                                {saving ? "Saving…" : "Save model"}
                            </Button>
                            <Button type="button" variant="destructive" onClick={removeModel} disabled={saving || !draft.id}>
                                Delete model
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
