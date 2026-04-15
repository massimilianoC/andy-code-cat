"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    deleteAdminPreset,
    draftAdminPreset,
    getAdminLlmRegistry,
    getAdminPresetRegistry,
    seedAdminPresetRegistry,
    updateAdminPreset,
    type AdminProjectPresetDto,
    type AdminLlmProviderDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";
import { PromptWorkbenchPanel } from "@/components/admin/PromptWorkbenchPanel";

const EMPTY_PRESET: AdminProjectPresetDto = {
    id: "",
    label: "",
    labelIt: "",
    labelEn: "",
    hint: "",
    icon: "Sparkles",
    category: "custom",
    categoryLabel: "Custom",
    categoryHint: "",
    tags: [],
    sortOrder: 999,
    isActive: true,
    scope: "global",
    status: "published",
    outputSpec: {
        pageModel: "single_page",
        sectionModel: "scroll",
        printReady: false,
        systemPromptModule: "",
    },
    defaultTags: {},
    briefTemplate: "",
    styleTemplate: "",
    briefGuideQuestions: [],
};

export default function AdminPresetsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState("static");
    const [presets, setPresets] = useState<AdminProjectPresetDto[]>([]);
    const [providers, setProviders] = useState<AdminLlmProviderDto[]>([]);
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [draft, setDraft] = useState<AdminProjectPresetDto>(EMPTY_PRESET);
    const [assistantInstructions, setAssistantInstructions] = useState("");
    const [assistantBusy, setAssistantBusy] = useState(false);
    const [assistantStatus, setAssistantStatus] = useState<string | null>(null);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            router.replace("/login");
            return;
        }
        void loadAll(token);
    }, [router]);

    async function loadAll(token: string) {
        setLoading(true);
        setError(null);
        try {
            const [presetRegistry, llmRegistry] = await Promise.all([
                getAdminPresetRegistry(token),
                getAdminLlmRegistry(token).catch(() => ({ source: "env", providers: [] })),
            ]);
            const nextPresets = (presetRegistry.presets ?? []).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
            setSource(presetRegistry.source ?? "static");
            setPresets(nextPresets);
            setProviders(llmRegistry.providers ?? []);
            if (nextPresets[0]) {
                setDraft(nextPresets[0]);
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load preset registry");
        } finally {
            setLoading(false);
        }
    }

    const categories = useMemo(() => {
        const seen = new Map<string, string>();
        for (const preset of presets) {
            seen.set(preset.category ?? "custom", preset.categoryLabel ?? "Custom");
        }
        return [...seen.entries()].map(([key, label]) => ({ key, label }));
    }, [presets]);

    const visiblePresets = useMemo(() => {
        const sorted = [...presets].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
        return selectedCategory === "all"
            ? sorted
            : sorted.filter((preset) => (preset.category ?? "custom") === selectedCategory);
    }, [presets, selectedCategory]);

    function selectPreset(presetId: string) {
        const preset = presets.find((entry) => entry.id === presetId);
        if (preset) {
            setDraft({ ...preset });
            setSaved(false);
            setError(null);
        }
    }

    function createPreset() {
        setDraft({ ...EMPTY_PRESET, id: "new-preset", label: "New preset", labelIt: "Nuovo preset", labelEn: "New preset" });
        setSaved(false);
        setError(null);
    }

    async function handleSeed() {
        const token = getToken();
        if (!token) return;
        setSyncing(true);
        setError(null);
        try {
            const result = await seedAdminPresetRegistry(token);
            const nextPresets = (result.presets ?? []).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
            setSource("mongo");
            setPresets(nextPresets);
            if (nextPresets[0]) setDraft(nextPresets[0]);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to sync preset seed");
        } finally {
            setSyncing(false);
        }
    }

    async function handleSave() {
        const token = getToken();
        if (!token) return;
        if (!draft.id.trim()) {
            setError("Preset id is required");
            return;
        }
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const savedPreset = await updateAdminPreset(token, draft.id, {
                ...draft,
                tags: draft.tags ?? [],
                briefGuideQuestions: draft.briefGuideQuestions ?? [],
            });
            const next = [...presets.filter((entry) => entry.id !== savedPreset.id), savedPreset]
                .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
            setPresets(next);
            setDraft(savedPreset);
            setSaved(true);
            setTimeout(() => setSaved(false), 2200);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to save preset");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        const token = getToken();
        if (!token || !draft.id) return;
        if (!window.confirm(`Delete preset ${draft.id}?`)) return;
        setSaving(true);
        setError(null);
        try {
            const result = await deleteAdminPreset(token, draft.id);
            const nextPresets = (result.presets ?? []).sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
            setPresets(nextPresets);
            setDraft(nextPresets[0] ?? EMPTY_PRESET);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to delete preset");
        } finally {
            setSaving(false);
        }
    }

    function applyDraftPatch(patch: Partial<AdminProjectPresetDto>) {
        setDraft((prev) => ({
            ...prev,
            ...patch,
            tags: patch.tags ?? prev.tags,
            defaultTags: { ...prev.defaultTags, ...(patch.defaultTags ?? {}) },
            briefGuideQuestions: patch.briefGuideQuestions ?? prev.briefGuideQuestions,
            recommendedModel: patch.recommendedModel ?? prev.recommendedModel,
            outputSpec: { ...prev.outputSpec, ...(patch.outputSpec ?? {}) },
        }));
    }

    async function handleAiDraft() {
        const token = getToken();
        if (!token || !assistantInstructions.trim()) return;
        setAssistantBusy(true);
        setAssistantStatus(null);
        setError(null);
        try {
            const result = await draftAdminPreset(token, {
                instructions: assistantInstructions,
                category: draft.category,
                labelHint: draft.labelIt || draft.label || draft.id || undefined,
                existingDraft: draft,
            });
            applyDraftPatch(result.draft);
            setAssistantStatus(`AI draft applied · ${result.provider} · ${result.model}`);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to generate AI draft for the template model");
        } finally {
            setAssistantBusy(false);
        }
    }

    if (loading) {
        return <p className="text-sm text-muted-foreground">Loading preset registry…</p>;
    }

    return (
        <div className="flex flex-col gap-6 max-w-[1460px]">
            <div>
                <h1 className="text-[1.375rem] font-bold text-foreground mb-1">Project Template Models</h1>
                <p className="text-sm text-muted-foreground max-w-4xl">
                    Main superadmin surface for project-type template models: landing, website, videogame, free runner, serious game, 3D game, VR with A-Frame, onepager, posters, presentations, and future families.
                </p>
            </div>

            {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                </div>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Template Model Source</CardTitle>
                    <CardDescription className="text-xs">
                        Source: {source.toUpperCase()}. Sync imports or updates the starter catalog in Mongo without resetting the existing database.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 items-center">
                    <Button onClick={handleSeed} disabled={syncing}>{syncing ? "Syncing…" : "Sync template models → Mongo"}</Button>
                    <Button type="button" variant="outline" onClick={createPreset}>New template model</Button>
                    {saved ? <span className="text-sm text-green-400">✓ Saved</span> : null}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Template Model Library</CardTitle>
                        <CardDescription className="text-xs">
                            These are project-type models, not LLMs. Filter by category and control the start experience order.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant={selectedCategory === "all" ? "default" : "outline"} onClick={() => setSelectedCategory("all")}>All</Button>
                            {categories.map((category) => (
                                <Button key={category.key} size="sm" variant={selectedCategory === category.key ? "default" : "outline"} onClick={() => setSelectedCategory(category.key)}>
                                    {category.label}
                                </Button>
                            ))}
                        </div>

                        <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                            {visiblePresets.map((preset) => (
                                <Button
                                    key={preset.id}
                                    type="button"
                                    variant="outline"
                                    onClick={() => selectPreset(preset.id)}
                                    className="w-full h-auto justify-start rounded-lg px-3 py-2 text-left"
                                >
                                    <div className="w-full">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-medium text-foreground truncate">{preset.labelIt || preset.label}</span>
                                            <Badge variant={preset.isActive ? "success" : "outline"} className="text-[10px]">
                                                #{preset.sortOrder ?? 999}
                                            </Badge>
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-1 truncate">{preset.categoryLabel ?? "Custom"} · {preset.id}</div>
                                    </div>
                                </Button>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <PromptWorkbenchPanel
                        title="AI Template Workbench"
                        description="Draft assistant for the current template model. Write a short brief, run it, and the generated draft is applied automatically to the fields below for review and save."
                        editorLabel="Draft instructions"
                        value={assistantInstructions}
                        onChange={setAssistantInstructions}
                        onRun={() => void handleAiDraft()}
                        runLabel="Apply AI draft to form"
                        running={assistantBusy}
                        helperText="This is a guided bozza editor: no manual copy-paste is required. Example: neon free runner mobile-first, or VR museum experience in A-Frame for education."
                        statusText={assistantStatus}
                    />

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Template Model Editor</CardTitle>
                        <CardDescription className="text-xs">
                            Edit the project-type template, its category, its start copy, and the optimized preprompt module that guides generation.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label>Preset ID</Label>
                                <Input value={draft.id} onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value }))} placeholder="landing" />
                            </div>
                            <div className="space-y-1">
                                <Label>Sort order</Label>
                                <Input type="number" value={draft.sortOrder ?? 999} onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: Number(e.target.value) || 999 }))} />
                            </div>
                            <div className="space-y-1">
                                <Label>Label IT</Label>
                                <Input value={draft.labelIt} onChange={(e) => setDraft((prev) => ({ ...prev, labelIt: e.target.value, label: e.target.value || prev.label }))} />
                            </div>
                            <div className="space-y-1">
                                <Label>Label EN</Label>
                                <Input value={draft.labelEn} onChange={(e) => setDraft((prev) => ({ ...prev, labelEn: e.target.value }))} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1">
                                <Label>Category key</Label>
                                <Input value={draft.category ?? ""} onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))} placeholder="web" />
                            </div>
                            <div className="space-y-1">
                                <Label>Category label</Label>
                                <Input value={draft.categoryLabel ?? ""} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLabel: e.target.value }))} placeholder="Web" />
                            </div>
                            <div className="space-y-1">
                                <Label>Category hint</Label>
                                <Input value={draft.categoryHint ?? ""} onChange={(e) => setDraft((prev) => ({ ...prev, categoryHint: e.target.value }))} placeholder="Sites & forms" />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Short description</Label>
                            <Input value={draft.hint} onChange={(e) => setDraft((prev) => ({ ...prev, hint: e.target.value }))} placeholder="Very short UX-first help text" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label>Tags</Label>
                                <Input
                                    value={(draft.tags ?? []).join(", ")}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, tags: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
                                    placeholder="cta, lead-gen, pitch"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label>Icon name</Label>
                                <Input value={draft.icon} onChange={(e) => setDraft((prev) => ({ ...prev, icon: e.target.value }))} placeholder="Sparkles" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label>Suggested runtime provider</Label>
                                <select
                                    value={draft.recommendedModel?.provider ?? ""}
                                    onChange={(e) => setDraft((prev) => ({
                                        ...prev,
                                        recommendedModel: {
                                            provider: e.target.value,
                                            modelId: prev.recommendedModel?.modelId ?? "",
                                            label: prev.recommendedModel?.label,
                                        },
                                    }))}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                                >
                                    <option value="">None</option>
                                    {providers.map((provider) => (
                                        <option key={provider.provider} value={provider.provider}>{provider.provider}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Label>Suggested runtime model ID</Label>
                                <Input
                                    value={draft.recommendedModel?.modelId ?? ""}
                                    onChange={(e) => setDraft((prev) => ({
                                        ...prev,
                                        recommendedModel: {
                                            provider: prev.recommendedModel?.provider ?? "",
                                            modelId: e.target.value,
                                            label: prev.recommendedModel?.label,
                                        },
                                    }))}
                                    placeholder="MiniMaxAI/MiniMax-M2.5"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Start badge</Label>
                            <Input
                                value={draft.recommendedModel?.label ?? ""}
                                onChange={(e) => setDraft((prev) => ({
                                    ...prev,
                                    recommendedModel: {
                                        provider: prev.recommendedModel?.provider ?? "",
                                        modelId: prev.recommendedModel?.modelId ?? "",
                                        label: e.target.value,
                                    },
                                }))}
                                placeholder="Fast start"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1">
                                <Label>Page model</Label>
                                <select
                                    value={draft.outputSpec.pageModel}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, outputSpec: { ...prev.outputSpec, pageModel: e.target.value as AdminProjectPresetDto["outputSpec"]["pageModel"] } }))}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                                >
                                    <option value="single_page">single_page</option>
                                    <option value="multi_page">multi_page</option>
                                    <option value="slide_deck">slide_deck</option>
                                    <option value="print_a4">print_a4</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Label>Section model</Label>
                                <select
                                    value={draft.outputSpec.sectionModel}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, outputSpec: { ...prev.outputSpec, sectionModel: e.target.value as AdminProjectPresetDto["outputSpec"]["sectionModel"] } }))}
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                                >
                                    <option value="scroll">scroll</option>
                                    <option value="paginated">paginated</option>
                                    <option value="masonry">masonry</option>
                                    <option value="stepped_form">stepped_form</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <Label>Print ready</Label>
                                <Button type="button" variant={draft.outputSpec.printReady ? "default" : "outline"} className="w-full" onClick={() => setDraft((prev) => ({ ...prev, outputSpec: { ...prev.outputSpec, printReady: !prev.outputSpec.printReady } }))}>
                                    {draft.outputSpec.printReady ? "Enabled" : "Disabled"}
                                </Button>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button type="button" variant={draft.isActive ? "default" : "outline"} onClick={() => setDraft((prev) => ({ ...prev, isActive: !prev.isActive }))}>
                                {draft.isActive ? "Published" : "Hidden"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setDraft((prev) => ({ ...prev, status: prev.status === "published" ? "draft" : "published" }))}>
                                Status: {draft.status}
                            </Button>
                        </div>

                        <div className="space-y-1">
                            <Label>Brief starter template</Label>
                            <MonacoCodeEditor language="markdown" height="140px" value={draft.briefTemplate} onChange={(value) => setDraft((prev) => ({ ...prev, briefTemplate: value }))} />
                        </div>

                        <div className="space-y-1">
                            <Label>Style direction template</Label>
                            <MonacoCodeEditor language="markdown" height="120px" value={draft.styleTemplate} onChange={(value) => setDraft((prev) => ({ ...prev, styleTemplate: value }))} />
                        </div>

                        <div className="space-y-1">
                            <Label>Guide questions</Label>
                            <MonacoCodeEditor
                                language="markdown"
                                height="120px"
                                value={(draft.briefGuideQuestions ?? []).join("\n")}
                                onChange={(value) => setDraft((prev) => ({ ...prev, briefGuideQuestions: value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }))}
                            />
                        </div>

                        <div className="space-y-1">
                            <Label>Optimized preprompt module</Label>
                            <MonacoCodeEditor language="markdown" height="240px" value={draft.outputSpec.systemPromptModule} onChange={(value) => setDraft((prev) => ({ ...prev, outputSpec: { ...prev.outputSpec, systemPromptModule: value } }))} />
                        </div>

                        <div className="space-y-1">
                            <Label>CSS constraints</Label>
                            <MonacoCodeEditor language="css" height="180px" value={draft.outputSpec.cssConstraints ?? ""} onChange={(value) => setDraft((prev) => ({ ...prev, outputSpec: { ...prev.outputSpec, cssConstraints: value } }))} />
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save preset"}</Button>
                            <Button type="button" variant="destructive" onClick={handleDelete} disabled={saving || !draft.id}>Delete preset</Button>
                        </div>
                    </CardContent>
                </Card>
                </div>
            </div>
        </div>
    );
}
