"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Upload, Link2, Trash2, FileText, Globe, Bookmark } from "lucide-react";
import {
    getProjectMoodboard,
    updateProjectMoodboard,
    getStyleTags,
    renameProject,
    listProjectAssets,
    uploadProjectAsset,
    addUrlReference,
    updateProjectAsset,
    deleteProjectAsset,
    type ProjectMoodboardDto,
    type ProjectAssetDto,
    type StyleTagCatalog,
} from "@/lib/api";
import { getToken } from "@/lib/token-store";
import { cn } from "@/lib/utils";

// ── Tag category → moodboard field mapping ────────────────────────────────────

type MoodboardTagField =
    | "eraTags"
    | "visualTags"
    | "paletteTags"
    | "typographyTags"
    | "layoutTags"
    | "toneTags"
    | "referenceTags"
    | "audienceTags"
    | "featureTags"
    | "sectorTags";

const TAG_CATEGORIES: { key: string; field: MoodboardTagField; label: string }[] = [
    { key: "era",        field: "eraTags",        label: "Era / Movimento" },
    { key: "visual",     field: "visualTags",     label: "Stile visivo" },
    { key: "palette",    field: "paletteTags",     label: "Palette" },
    { key: "typography", field: "typographyTags",  label: "Tipografia" },
    { key: "layout",     field: "layoutTags",      label: "Layout" },
    { key: "tone",       field: "toneTags",        label: "Tono" },
    { key: "audience",   field: "audienceTags",    label: "Audience / Target" },
    { key: "feature",    field: "featureTags",     label: "Funzionalità richieste" },
    { key: "sector",     field: "sectorTags",      label: "Settore / Ambito" },
    { key: "reference",  field: "referenceTags",   label: "Riferimenti" },
];

// ── Asset thumb ───────────────────────────────────────────────────────────────

function AssetThumb({
    asset,
    token,
    projectId,
    onUpdate,
    onDelete,
}: {
    asset: ProjectAssetDto;
    token: string;
    projectId: string;
    onUpdate: (id: string, data: Partial<ProjectAssetDto>) => void;
    onDelete: (id: string) => void;
}) {
    const [showMeta, setShowMeta] = useState(false);
    const [descText, setDescText] = useState(asset.descriptionText ?? "");

    const isImage = asset.mimeType.startsWith("image/");
    const isPdf = asset.mimeType === "application/pdf";
    const isUrl = asset.source === "url_reference";

    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const downloadUrl = `${baseUrl}/v1/projects/${projectId}/assets/${asset.id}/download`;

    async function handleUseChange(checked: boolean) {
        await updateProjectAsset(token, projectId, asset.id, { useInProject: checked }).catch(() => {});
        onUpdate(asset.id, { useInProject: checked });
    }

    async function handleRoleChange(role: string) {
        await updateProjectAsset(token, projectId, asset.id, { styleRole: role }).catch(() => {});
        onUpdate(asset.id, { styleRole: role as ProjectAssetDto["styleRole"] });
    }

    async function handleDescBlur() {
        await updateProjectAsset(token, projectId, asset.id, { descriptionText: descText }).catch(() => {});
        onUpdate(asset.id, { descriptionText: descText });
    }

    async function handleDelete() {
        if (!confirm(`Eliminare "${asset.label ?? asset.originalName}"?`)) return;
        await deleteProjectAsset(token, projectId, asset.id).catch(() => {});
        onDelete(asset.id);
    }

    return (
        <div className="relative group border border-border rounded-md p-1.5 bg-card/50 hover:bg-card transition-colors">
            {/* Thumbnail */}
            <div className="w-full aspect-square flex items-center justify-center overflow-hidden rounded mb-1 bg-muted/30">
                {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={downloadUrl}
                        alt={asset.label ?? asset.originalName}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                    />
                ) : isPdf ? (
                    <FileText className="w-8 h-8 text-muted-foreground" />
                ) : isUrl ? (
                    <Globe className="w-8 h-8 text-muted-foreground" />
                ) : (
                    <FileText className="w-8 h-8 text-muted-foreground" />
                )}
            </div>

            {/* Label */}
            <p
                className="text-[0.65rem] text-muted-foreground truncate w-full text-center"
                title={asset.originalName}
            >
                {asset.label ?? asset.originalName}
            </p>

            {/* Always-visible bottom bar: useInProject toggle + delete */}
            <div className="flex items-center justify-between mt-1 px-0.5">
                <button
                    type="button"
                    title={asset.useInProject ? "Escludi dal progetto" : "Usa nel progetto"}
                    onClick={() => handleUseChange(!asset.useInProject)}
                    className={cn(
                        "flex items-center gap-0.5 text-[0.6rem] rounded px-1 py-0.5 transition-colors",
                        asset.useInProject
                            ? "bg-primary/20 text-primary"
                            : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Bookmark className="w-2.5 h-2.5" />
                    <span>{asset.useInProject ? "in uso" : "usa"}</span>
                </button>
                <button
                    type="button"
                    title="Elimina asset"
                    onClick={handleDelete}
                    className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded"
                >
                    <Trash2 className="w-3 h-3" />
                </button>
            </div>

            {/* Settings button — role & description (still gear-hover) */}
            <Button
                variant="ghost"
                size="icon"
                className="absolute top-0.5 right-0.5 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-[0.6rem]"
                onClick={() => setShowMeta(!showMeta)}
                title="Opzioni avanzate"
            >
                ⚙
            </Button>

            {/* Meta dropdown — role + description only */}
            {showMeta && (
                <div className="absolute z-20 top-full left-0 w-52 bg-card border border-border rounded-md shadow-xl p-2.5 space-y-2 mt-1">
                    <select
                        className="w-full text-xs bg-muted border border-border rounded px-1.5 py-1 text-foreground"
                        value={asset.styleRole ?? ""}
                        onChange={(e) => handleRoleChange(e.target.value)}
                    >
                        <option value="">Ruolo stile…</option>
                        <option value="mood">Mood</option>
                        <option value="reference">Riferimento</option>
                        <option value="palette">Palette</option>
                        <option value="typography">Tipografia</option>
                    </select>
                    <Input
                        placeholder="Descrizione…"
                        value={descText}
                        onChange={(e) => setDescText(e.target.value)}
                        onBlur={handleDescBlur}
                        className="text-xs h-7"
                    />
                </div>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProjectConfigPopupProps {
    projectId: string;
    open: boolean;
    onClose: () => void;
    initialProjectName?: string;
    onRename?: (name: string) => void;
    /** Optional preset label to show as active-preset badge in the config panel. */
    presetLabel?: string;
    /** Optional guide questions from the active preset (shown when brief is empty). */
    briefGuideQuestions?: string[];
}

export default function ProjectConfigPopup({
    projectId,
    open,
    onClose,
    initialProjectName,
    onRename,
    presetLabel,
    briefGuideQuestions,
}: ProjectConfigPopupProps) {
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [projectName, setProjectName] = useState(initialProjectName ?? "");
    const [moodboard, setMoodboard] = useState<Partial<ProjectMoodboardDto>>({});
    const [catalog, setCatalog] = useState<StyleTagCatalog>({});
    const [assets, setAssets] = useState<ProjectAssetDto[]>([]);

    const [urlPanelOpen, setUrlPanelOpen] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    const [urlLabel, setUrlLabel] = useState("");

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setToken(getToken());
    }, []);

    // Sync name when prop changes (e.g. parent loads it later)
    useEffect(() => {
        if (initialProjectName) setProjectName(initialProjectName);
    }, [initialProjectName]);

    useEffect(() => {
        if (!open || !token) return;
        setLoading(true);
        Promise.all([
            getProjectMoodboard(token, projectId),
            getStyleTags(),
            listProjectAssets(token, projectId),
        ])
            .then(([moodRes, tagsRes, assetsRes]) => {
                setMoodboard(moodRes.moodboard);
                setCatalog(tagsRes.catalog);
                setAssets(assetsRes.assets);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [open, token, projectId]);

    const toggleTag = useCallback(
        (field: MoodboardTagField, tagId: string) => {
            setMoodboard((m) => {
                const current = (m[field] ?? []) as string[];
                const next = current.includes(tagId)
                    ? current.filter((id) => id !== tagId)
                    : [...current, tagId];
                return { ...m, [field]: next };
            });
        },
        []
    );

    const handleSave = async () => {
        if (!token) return;
        setSaving(true);
        try {
            const saveOps: Promise<unknown>[] = [
                updateProjectMoodboard(token, projectId, moodboard),
            ];
            if (projectName.trim().length >= 3) {
                saveOps.push(renameProject(token, projectId, projectName.trim()));
            }
            await Promise.all(saveOps);
            if (projectName.trim().length >= 3) onRename?.(projectName.trim());
            onClose();
        } catch (err) {
            console.error("[ProjectConfigPopup] save error", err);
        } finally {
            setSaving(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!token || !e.target.files?.[0]) return;
        const file = e.target.files[0];
        try {
            const res = await uploadProjectAsset(token, projectId, file);
            setAssets((a) => [res.asset, ...a]);
        } catch (err) {
            console.error("[ProjectConfigPopup] upload error", err);
        }
        e.target.value = "";
    };

    const handleAddUrl = async () => {
        if (!token || !urlInput.trim()) return;
        try {
            const res = await addUrlReference(token, projectId, {
                url: urlInput.trim(),
                label: urlLabel.trim() || undefined,
            });
            setAssets((a) => [res.asset, ...a]);
            setUrlInput("");
            setUrlLabel("");
            setUrlPanelOpen(false);
        } catch (err) {
            console.error("[ProjectConfigPopup] add URL error", err);
        }
    };

    const handleAssetUpdate = useCallback((id: string, data: Partial<ProjectAssetDto>) => {
        setAssets((a) => a.map((asset) => (asset.id === id ? { ...asset, ...data } : asset)));
    }, []);

    const handleAssetDelete = useCallback((id: string) => {
        setAssets((a) => a.filter((asset) => asset.id !== id));
    }, []);

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
                <div className="flex flex-col h-[82vh]">
                    <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
                        <DialogTitle className="text-foreground">Configurazione Progetto</DialogTitle>
                    </DialogHeader>

                    {loading ? (
                        <div className="flex-1 flex items-center justify-center">
                            <p className="text-muted-foreground text-sm">Caricamento…</p>
                        </div>
                    ) : (
                        <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 min-h-0">
                            {/* ── LEFT COLUMN: Moodboard ─────────────────── */}
                            <ScrollArea className="h-full border-r border-border">
                                <div className="p-5 space-y-5">
                                    {/* Preset badge */}
                                    {presetLabel && (
                                        <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-md border border-primary/20">
                                            <Badge variant="outline" className="text-xs border-primary/40 text-primary">{presetLabel}</Badge>
                                            <span className="text-xs text-muted-foreground">Preset attivo — brief e tag pre-compilati.</span>
                                        </div>
                                    )}

                                    {/* Project name */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="cfg-project-name" className="text-foreground">
                                            Nome progetto
                                        </Label>
                                        <Input
                                            id="cfg-project-name"
                                            value={projectName}
                                            onChange={(e) => setProjectName(e.target.value)}
                                            placeholder="Nome progetto…"
                                            className="bg-muted/30"
                                        />
                                    </div>

                                    {/* Brief */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="cfg-brief" className="text-foreground">
                                            Brief di progetto
                                        </Label>
                                        <textarea
                                            id="cfg-brief"
                                            className="w-full h-20 bg-muted/30 border border-border rounded-md px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                                            placeholder="Descrivi il progetto e le sue caratteristiche principali…"
                                            value={moodboard.projectBrief ?? ""}
                                            onChange={(e) =>
                                                setMoodboard((m) => ({ ...m, projectBrief: e.target.value }))
                                            }
                                        />
                                        {/* Brief guide questions — shown when brief is empty and preset provides hints */}
                                        {!moodboard.projectBrief && briefGuideQuestions && briefGuideQuestions.length > 0 && (
                                            <div className="rounded-md border border-border bg-muted/20 p-2.5 space-y-1">
                                                <p className="text-[0.65rem] uppercase font-semibold text-muted-foreground tracking-wide">
                                                    Guida al brief
                                                </p>
                                                <ul className="space-y-0.5">
                                                    {briefGuideQuestions.map((q, i) => (
                                                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                                                            <span className="text-primary/60 shrink-0">{i + 1}.</span>
                                                            <span>{q}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>

                                    {/* Style notes */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="cfg-style-notes" className="text-foreground">
                                            Note di stile
                                        </Label>
                                        <textarea
                                            id="cfg-style-notes"
                                            className="w-full h-16 bg-muted/30 border border-border rounded-md px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                                            placeholder="Vincoli o preferenze di stile specifiche…"
                                            value={moodboard.styleNotes ?? ""}
                                            onChange={(e) =>
                                                setMoodboard((m) => ({ ...m, styleNotes: e.target.value }))
                                            }
                                        />
                                    </div>

                                    {/* Inherit from user */}
                                    <div className="flex items-center gap-3 py-1">
                                        <input
                                            type="checkbox"
                                            id="cfg-inherit"
                                            checked={moodboard.inheritFromUser ?? true}
                                            onChange={(e) =>
                                                setMoodboard((m) => ({
                                                    ...m,
                                                    inheritFromUser: e.target.checked,
                                                }))
                                            }
                                            className="w-4 h-4 accent-primary cursor-pointer"
                                        />
                                        <Label htmlFor="cfg-inherit" className="cursor-pointer">
                                            Eredita preferenze utente (fallback)
                                        </Label>
                                    </div>

                                    <Separator />

                                    {/* Tag categories */}
                                    {TAG_CATEGORIES.map(({ key, field, label }) => {
                                        const catTags = catalog[key] ?? [];
                                        if (catTags.length === 0) return null;
                                        const selected = (moodboard[field] ?? []) as string[];
                                        return (
                                            <div key={key} className="space-y-2">
                                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                                    {label}
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {catTags.map((tag) => (
                                                        <Badge
                                                            key={tag.id}
                                                            variant={
                                                                selected.includes(tag.id) ? "default" : "outline"
                                                            }
                                                            className={cn(
                                                                "cursor-pointer select-none transition-colors text-xs",
                                                                selected.includes(tag.id)
                                                                    ? "bg-primary text-primary-foreground hover:bg-primary/80"
                                                                    : "text-muted-foreground hover:text-foreground"
                                                            )}
                                                            onClick={() => toggleTag(field, tag.id)}
                                                        >
                                                            {tag.emoji && (
                                                                <span className="mr-1">{tag.emoji}</span>
                                                            )}
                                                            {tag.label}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>

                            {/* ── RIGHT COLUMN: Asset gallery ───────────── */}
                            <ScrollArea className="h-full">
                                <div className="p-5 space-y-4">
                                    {/* Upload controls */}
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1 text-xs"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                                            Carica file
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1 text-xs"
                                            onClick={() => setUrlPanelOpen(!urlPanelOpen)}
                                        >
                                            <Link2 className="w-3.5 h-3.5 mr-1.5" />
                                            Aggiungi URL
                                        </Button>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            className="hidden"
                                            accept="image/*,application/pdf,text/*,application/json"
                                            onChange={handleFileUpload}
                                        />
                                    </div>

                                    {/* URL panel */}
                                    {urlPanelOpen && (
                                        <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
                                            <Input
                                                placeholder="https://…"
                                                value={urlInput}
                                                onChange={(e) => setUrlInput(e.target.value)}
                                                className="text-sm"
                                            />
                                            <Input
                                                placeholder="Etichetta (opzionale)"
                                                value={urlLabel}
                                                onChange={(e) => setUrlLabel(e.target.value)}
                                                className="text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    className="flex-1 text-xs"
                                                    onClick={handleAddUrl}
                                                    disabled={!urlInput.trim()}
                                                >
                                                    Aggiungi
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="flex-1 text-xs"
                                                    onClick={() => {
                                                        setUrlPanelOpen(false);
                                                        setUrlInput("");
                                                        setUrlLabel("");
                                                    }}
                                                >
                                                    Annulla
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Asset grid */}
                                    {assets.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-center">
                                            <Upload className="w-10 h-10 text-muted-foreground/40 mb-3" />
                                            <p className="text-sm text-muted-foreground">
                                                Nessun asset.
                                            </p>
                                            <p className="text-xs text-muted-foreground/70 mt-1">
                                                Carica immagini, PDF o aggiungi link di riferimento.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-2">
                                            {token &&
                                                assets.map((asset) => (
                                                    <AssetThumb
                                                        key={asset.id}
                                                        asset={asset}
                                                        token={token}
                                                        projectId={projectId}
                                                        onUpdate={handleAssetUpdate}
                                                        onDelete={handleAssetDelete}
                                                    />
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    )}

                    <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
                        <Button variant="ghost" onClick={onClose} disabled={saving}>
                            Annulla
                        </Button>
                        <Button onClick={handleSave} disabled={saving || loading}>
                            {saving ? "Salvataggio…" : "Salva"}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
