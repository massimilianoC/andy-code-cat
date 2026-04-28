"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminLlmRegistry,
    seedAdminLlmRegistry,
    updateAdminLlmModel,
    deleteAdminLlmModel,
    type AdminLlmModelDto,
    type AdminLlmProviderDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";

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
    // Preprompt optimization roles — one per UX mode
    "preprompt_zero_effort",
    "preprompt_godmode",
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
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [source, setSource] = useState("env");
    const [providers, setProviders] = useState<AdminLlmProviderDto[]>([]);
    const [selectedProvider, setSelectedProvider] = useState("siliconflow");
    const [draft, setDraft] = useState<AdminLlmModelDto>(EMPTY_MODEL);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            router.replace("/login");
            return;
        }

        void loadRegistry(token);
    }, [router]);

    const activeProvider = useMemo(
        () => providers.find((provider) => provider.provider === selectedProvider) ?? null,
        [providers, selectedProvider],
    );

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

    function selectProvider(providerKey: string) {
        setSelectedProvider(providerKey);
        const provider = providers.find((entry) => entry.provider === providerKey);
        const firstModel = provider?.models[0] ?? null;
        setDraft(firstModel ? { ...firstModel } : { ...EMPTY_MODEL, provider: providerKey });
    }

    function selectModel(modelId: string) {
        const provider = providers.find((entry) => entry.provider === selectedProvider);
        const model = provider?.models.find((entry) => entry.id === modelId) ?? null;
        setDraft(model ? { ...model } : { ...EMPTY_MODEL, provider: selectedProvider });
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
                    <Button type="button" variant="outline" onClick={createNewModel}>
                        New model
                    </Button>
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
                            <Label>Provider</Label>
                            <select
                                value={selectedProvider}
                                onChange={(e) => selectProvider(e.target.value)}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                            >
                                {providers.map((provider) => (
                                    <option key={provider.provider} value={provider.provider}>
                                        {provider.provider}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            {(activeProvider?.models ?? []).map((model) => (
                                <Button
                                    key={model.id}
                                    type="button"
                                    variant="outline"
                                    onClick={() => selectModel(model.id)}
                                    className="w-full h-auto justify-start rounded-lg px-3 py-2 text-left"
                                >
                                    <div className="w-full">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-medium text-foreground truncate">
                                                {model.displayName || model.id}
                                            </span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${model.isActive ? "border-green-500/40 text-green-400" : "border-border text-muted-foreground"}`}>
                                                {model.isActive ? "live" : "off"}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-1 truncate">
                                            {model.id}
                                        </div>
                                    </div>
                                </Button>
                            ))}
                            {(activeProvider?.models ?? []).length === 0 ? (
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
