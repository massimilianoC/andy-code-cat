"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    listServiceKeys,
    createServiceKey,
    updateServiceKey,
    deleteServiceKey,
    getServiceKeyEnvStatus,
    seedServiceKeysFromEnv,
    type ServiceApiKeyDto,
    type ServiceCategory,
    type EnvKeyStatusDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const CATEGORY_OPTIONS: { value: ServiceCategory; label: string }[] = [
    { value: "image", label: "Image" },
    { value: "video", label: "Video" },
    { value: "llm", label: "LLM" },
    { value: "other", label: "Other" },
];

const SERVICE_PRESETS = [
    { service: "pexels", label: "Pexels", category: "image" as ServiceCategory, supportsVideo: true },
    { service: "pixabay", label: "Pixabay", category: "image" as ServiceCategory, supportsVideo: true },
    { service: "unsplash", label: "Unsplash", category: "image" as ServiceCategory, supportsVideo: false },
];

const EMPTY_DRAFT = {
    service: "",
    label: "",
    category: "image" as ServiceCategory,
    plaintextKey: "",
    enabled: true,
    supportsVideo: false,
    isDefault: false,
};

export default function AdminIntegrationsPage() {
    const router = useRouter();
    const [keys, setKeys] = useState<ServiceApiKeyDto[]>([]);
    const [envStatus, setEnvStatus] = useState<EnvKeyStatusDto | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const [reKeyId, setReKeyId] = useState<string | null>(null);
    const [newKeyValue, setNewKeyValue] = useState("");
    const [seeding, setSeeding] = useState(false);
    const [seedResult, setSeedResult] = useState<string | null>(null);

    useEffect(() => {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }
        Promise.all([listServiceKeys(token), getServiceKeyEnvStatus(token)])
            .then(([ks, es]) => { setKeys(ks.keys); setEnvStatus(es); })
            .catch((e) => setError(String(e)))
            .finally(() => setLoading(false));
    }, [router]);

    async function handleSeedFromEnv() {
        const token = getToken();
        if (!token) return;
        setSeeding(true); setError(null); setSeedResult(null);
        try {
            const result = await seedServiceKeysFromEnv(token);
            const [ks] = await Promise.all([listServiceKeys(token)]);
            setKeys(ks.keys);
            const msg = result.seeded.length > 0
                ? `Seeded: ${result.seeded.join(", ")}${result.skipped.length > 0 ? ` | Skipped: ${result.skipped.join(", ")}` : ""}`
                : `Nothing to seed. ${result.skipped.join(", ")}`;
            setSeedResult(msg);
            setTimeout(() => setSeedResult(null), 5000);
        } catch (e) {
            setError(String(e));
        } finally {
            setSeeding(false);
        }
    }

    async function handleCreate() {
        const token = getToken();
        if (!token) return;
        setSaving(true); setError(null);
        try {
            const created = await createServiceKey(token, draft);
            setKeys((prev) => [...prev, created]);
            setShowForm(false);
            setDraft(EMPTY_DRAFT);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e) {
            setError(String(e));
        } finally {
            setSaving(false);
        }
    }

    async function handleToggleEnabled(key: ServiceApiKeyDto) {
        const token = getToken();
        if (!token) return;
        try {
            const updated = await updateServiceKey(token, key.id, { enabled: !key.enabled });
            setKeys((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
        } catch (e) {
            setError(String(e));
        }
    }

    async function handleToggleDefault(key: ServiceApiKeyDto) {
        const token = getToken();
        if (!token) return;
        try {
            const updated = await updateServiceKey(token, key.id, { isDefault: !key.isDefault });
            setKeys((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
        } catch (e) {
            setError(String(e));
        }
    }

    async function handleReKey(id: string) {
        const token = getToken();
        if (!token || !newKeyValue.trim()) return;
        setSaving(true); setError(null);
        try {
            const updated = await updateServiceKey(token, id, { plaintextKey: newKeyValue.trim() });
            setKeys((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
            setReKeyId(null);
            setNewKeyValue("");
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e) {
            setError(String(e));
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        const token = getToken();
        if (!token) return;
        if (!confirm("Delete this API key?")) return;
        try {
            await deleteServiceKey(token, id);
            setKeys((prev) => prev.filter((k) => k.id !== id));
        } catch (e) {
            setError(String(e));
        }
    }

    function applyPreset(preset: typeof SERVICE_PRESETS[number]) {
        setDraft((d) => ({
            ...d,
            service: preset.service,
            label: preset.label,
            category: preset.category,
            supportsVideo: preset.supportsVideo,
        }));
    }

    if (loading) {
        return (
            <div className="p-8 text-muted-foreground text-sm">Loading integrations…</div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-xl font-semibold text-foreground">Integration Hub</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Manage encrypted API keys for external image, video, and LLM services.
                    Keys are stored AES-256-GCM encrypted in MongoDB — never plain-text.
                </p>
            </div>

            {/* Env status strip */}
            {envStatus && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Environment keys (read-only, from .env)</CardTitle>
                        <CardDescription className="text-xs">
                            Keys loaded from environment variables. DB keys take priority over these.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-2">
                            {(Object.entries(envStatus) as [string, boolean][]).map(([name, present]) => (
                                <Badge
                                    key={name}
                                    variant={present ? "success" : "outline"}
                                    className="text-xs capitalize"
                                >
                                    {name} {present ? "✓" : "—"}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-2 text-sm text-destructive">
                    {error}
                </div>
            )}

            {saved && (
                <div className="rounded-md bg-primary/10 border border-primary/30 px-4 py-2 text-sm text-foreground">
                    Saved successfully.
                </div>
            )}

            {seedResult && (
                <div className="rounded-md bg-muted border border-border px-4 py-2 text-sm text-foreground">
                    {seedResult}
                </div>
            )}

            {/* Stored keys table */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div>
                        <CardTitle className="text-sm font-medium">Stored keys ({keys.length})</CardTitle>
                        <CardDescription className="text-xs">Encrypted in MongoDB. Masked preview only.</CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={seeding} onClick={handleSeedFromEnv}>
                            {seeding ? "Seeding…" : "Seed from env"}
                        </Button>
                        <Button size="sm" onClick={() => { setShowForm(true); setDraft(EMPTY_DRAFT); }}>
                            + Add key
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {keys.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No stored keys yet. Add one to override env keys.</p>
                    ) : (
                        <div className="space-y-2">
                            {keys.map((key) => (
                                <div
                                    key={key.id}
                                    className="flex flex-wrap items-center gap-3 rounded-md border border-border px-4 py-3 text-sm"
                                >
                                    <div className="flex-1 min-w-[160px]">
                                        <span className="font-medium text-foreground">{key.label}</span>
                                        <span className="ml-2 text-xs text-muted-foreground capitalize">{key.service}</span>
                                    </div>
                                    <Badge variant="secondary" className="text-xs">{key.category}</Badge>
                                    {key.supportsVideo && <Badge variant="outline" className="text-xs">video</Badge>}
                                    <code className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                        {key.maskedKey}
                                    </code>

                                    {/* Re-key inline */}
                                    {reKeyId === key.id ? (
                                        <div className="flex items-center gap-2 w-full mt-1">
                                            <Input
                                                className="h-7 text-xs font-mono flex-1"
                                                placeholder="New API key…"
                                                value={newKeyValue}
                                                onChange={(e) => setNewKeyValue(e.target.value)}
                                            />
                                            <Button size="sm" disabled={saving || !newKeyValue.trim()} onClick={() => handleReKey(key.id)}>
                                                {saving ? "…" : "Save"}
                                            </Button>
                                            <Button size="sm" variant="ghost" onClick={() => { setReKeyId(null); setNewKeyValue(""); }}>
                                                Cancel
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 ml-auto">
                                            <Button
                                                size="sm"
                                                variant={key.isDefault ? "default" : "outline"}
                                                className="text-xs h-7"
                                                onClick={() => handleToggleDefault(key)}
                                            >
                                                {key.isDefault ? "Default" : "Set default"}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant={key.enabled ? "secondary" : "outline"}
                                                className="text-xs h-7"
                                                onClick={() => handleToggleEnabled(key)}
                                            >
                                                {key.enabled ? "Enabled" : "Disabled"}
                                            </Button>
                                            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setReKeyId(key.id); setNewKeyValue(""); }}>
                                                Re-key
                                            </Button>
                                            <Button size="sm" variant="destructive" className="text-xs h-7" onClick={() => handleDelete(key.id)}>
                                                Delete
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Add key form */}
            {showForm && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium">Add new key</CardTitle>
                        <CardDescription className="text-xs">
                            Quick-fill with a preset or enter manually.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Preset chips */}
                        <div className="flex flex-wrap gap-2">
                            {SERVICE_PRESETS.map((p) => (
                                <Button
                                    key={p.service}
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-7 capitalize"
                                    onClick={() => applyPreset(p)}
                                >
                                    {p.label}
                                </Button>
                            ))}
                        </div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label className="text-xs">Service slug</Label>
                                <Input
                                    className="h-8 text-sm"
                                    placeholder="pexels"
                                    value={draft.service}
                                    onChange={(e) => setDraft((d) => ({ ...d, service: e.target.value.toLowerCase() }))}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Label</Label>
                                <Input
                                    className="h-8 text-sm"
                                    placeholder="Pexels (main)"
                                    value={draft.label}
                                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label className="text-xs">Category</Label>
                                <select
                                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                                    value={draft.category}
                                    onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as ServiceCategory }))}
                                >
                                    {CATEGORY_OPTIONS.map((c) => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1 col-span-1">
                                <Label className="text-xs">API key (plain-text — encrypted before storing)</Label>
                                <Input
                                    className="h-8 text-sm font-mono"
                                    type="password"
                                    placeholder="Paste your API key…"
                                    value={draft.plaintextKey}
                                    onChange={(e) => setDraft((d) => ({ ...d, plaintextKey: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={draft.enabled}
                                    onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                                />
                                Enabled
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={draft.supportsVideo}
                                    onChange={(e) => setDraft((d) => ({ ...d, supportsVideo: e.target.checked }))}
                                />
                                Supports video
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={draft.isDefault}
                                    onChange={(e) => setDraft((d) => ({ ...d, isDefault: e.target.checked }))}
                                />
                                Set as default
                            </label>
                        </div>
                        <div className="flex gap-3 pt-1">
                            <Button
                                size="sm"
                                disabled={saving || !draft.service || !draft.label || !draft.plaintextKey}
                                onClick={handleCreate}
                            >
                                {saving ? "Saving…" : "Save key"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                                Cancel
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
