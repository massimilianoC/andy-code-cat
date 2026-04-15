"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sparkles, LayoutTemplate, Files, FileImage, Presentation, FormInput, GalleryVertical, RectangleEllipsis, Plus, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
    listProjects,
    createProject,
    deleteProject,
    duplicateProject,
    getLlmPromptConfig,
    getPresets,
    ApiError,
    type Project,
    type ProjectPreset,
} from "../../lib/api";
import { getToken, clearSession, isPasswordChangeRequired, getRoles } from "../../lib/token-store";
import { PasswordChangeDialog } from "../../components/PasswordChangeDialog";
import ProjectCard from "../../components/ProjectCard";
import { TipsChip } from "../../components/TipsPanel";
import GuideBanner from "../../components/GuideBanner";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const RECENT_KEY = "pf_recent_projects";
const MAX_RECENTS = 3;

const PRESET_ICON_MAP = {
    Sparkles,
    LayoutTemplate,
    Files,
    FileImage,
    Presentation,
    FormInput,
    GalleryVertical,
    RectangleEllipsis,
    BarChart3,
} as const;

function getRecentIds(): string[] {
    try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    } catch {
        return [];
    }
}

function pushRecentId(id: string) {
    const ids = getRecentIds().filter((x) => x !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...ids].slice(0, MAX_RECENTS)));
}

export default function DashboardPage() {
    const router = useRouter();
    const { t } = useTranslation();
    const [token, setToken] = useState<string | null>(null);
    const [checkingAuth, setCheckingAuth] = useState(true);
    const [projects, setProjects] = useState<Project[]>([]);
    const [recentIds, setRecentIds] = useState<string[]>([]);
    const [newProjectName, setNewProjectName] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);
    const [presetCatalog, setPresetCatalog] = useState<ProjectPreset[]>([]);
    const [presetCategoryFilter, setPresetCategoryFilter] = useState<string>("all");
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const [passwordChangeRequired, setPasswordChangeRequiredState] = useState(false);
    const [canAccessSuperadmin, setCanAccessSuperadmin] = useState(false);
    const createInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const tok = getToken();
        if (!tok) {
            router.replace("/login");
            setCheckingAuth(false);
            return;
        }
        setToken(tok);
        setRecentIds(getRecentIds());
        const roles = getRoles();
        setCanAccessSuperadmin(roles.includes("admin") || roles.includes("superadmin"));
        setPasswordChangeRequiredState(isPasswordChangeRequired());
        setCheckingAuth(false);
        void load(tok);
        void getPresets().then((res) => setPresetCatalog(res.presets ?? [])).catch(() => undefined);
    }, [router]);

    useEffect(() => {
        if (createOpen) {
            setTimeout(() => createInputRef.current?.focus(), 50);
        }
    }, [createOpen]);

    async function load(tok: string) {
        try {
            const res = await listProjects(tok);
            setProjects(res.projects);
        } catch {
            showToast(t("dashboard.toast.loadError"), false);
        }
    }

    function showToast(msg: string, ok: boolean) {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3500);
    }

    async function handleCreateProject(e: React.FormEvent) {
        e.preventDefault();
        if (!token || !newProjectName.trim()) return;
        setCreating(true);
        try {
            const res = await createProject(token, newProjectName.trim(), selectedPresetId);
            setNewProjectName("");
            setSelectedPresetId(undefined);
            setCreateOpen(false);
            pushRecentId(res.project.id);
            setRecentIds(getRecentIds());
            router.push(`/workspace/${res.project.id}`);
        } catch {
            showToast(t("dashboard.toast.loadError"), false);
        } finally {
            setCreating(false);
        }
    }

    function handleCreateFromPreset(presetId: string, presetLabel: string) {
        setSelectedPresetId(presetId === "neutral" ? undefined : presetId);
        setNewProjectName(presetLabel);
        setCreateOpen(true);
    }

    function handleOpenProject(project: Project) {
        pushRecentId(project.id);
        setRecentIds(getRecentIds());
        router.push(`/workspace/${project.id}`);
    }

    async function handleDuplicate(project: Project) {
        if (!token) return;
        try {
            const res = await duplicateProject(token, project.id);
            showToast(t("dashboard.toast.created", { name: res.project.name }), true);
            await load(token);
        } catch {
            showToast(t("dashboard.toast.duplicateError"), false);
        }
    }

    async function handleDelete(project: Project) {
        if (!token) return;
        if (!window.confirm(t("dashboard.confirm.delete", { name: project.name }))) return;
        try {
            await deleteProject(token, project.id);
            showToast(t("dashboard.toast.deleted", { name: project.name }), true);
            await load(token);
        } catch {
            showToast(t("dashboard.toast.deleteError"), false);
        }
    }

    async function handleCopyPrompt(project: Project) {
        if (!token) return;
        try {
            const res = await getLlmPromptConfig(token, project.id);
            const text = res.config?.prePromptTemplate ?? "";
            await navigator.clipboard.writeText(text);
            showToast(t("dashboard.toast.promptCopied"), true);
        } catch {
            showToast(t("dashboard.toast.noPrompt"), false);
        }
    }

    function handleLogout() {
        clearSession();
        router.replace("/login");
    }

    if (checkingAuth) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    if (!token) return null;

    const sortedProjects = [...projects].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const selectedPresetLabel = presetCatalog.find((preset) => preset.id === selectedPresetId)?.labelIt;
    const blankPreset = presetCatalog.find((preset) => preset.id === "neutral");
    const activePresets = presetCatalog
        .filter((preset) => preset.id !== "neutral" && preset.isActive !== false)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

    const seenCategories = new Map<string, { key: string; label: string; hint: string }>();
    for (const preset of activePresets) {
        const key = preset.category ?? "custom";
        if (!seenCategories.has(key)) {
            seenCategories.set(key, {
                key,
                label: preset.categoryLabel ?? "Custom",
                hint: preset.categoryHint ?? "",
            });
        }
    }
    const presetCategories = [...seenCategories.values()];

    const filteredPresets = presetCategoryFilter === "all"
        ? activePresets
        : activePresets.filter((preset) => (preset.category ?? "custom") === presetCategoryFilter);

    const groupedPresets = presetCategories
        .map((category) => ({
            ...category,
            presets: filteredPresets.filter((preset) => (preset.category ?? "custom") === category.key),
        }))
        .filter((group) => group.presets.length > 0);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {token ? (
                <PasswordChangeDialog
                    open={passwordChangeRequired}
                    token={token}
                    onCompleted={() => setPasswordChangeRequiredState(false)}
                />
            ) : null}

            {/* Navbar */}
            <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between sticky top-0 z-20">
                <div className="flex items-center gap-2">
                    <span className="text-xl leading-none">🐱</span>
                    <span className="font-bold text-foreground text-sm tracking-tight">{t("brand.name")}</span>
                </div>
                <div className="flex items-center gap-2">
                    <LanguageSwitcher className="mr-1" />
                    {canAccessSuperadmin ? (
                        <Button variant="outline" size="sm" onClick={() => router.push("/admin")}>Superadmin</Button>
                    ) : null}
                    <Button size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        {t("dashboard.newProject")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleLogout}>
                        {t("dashboard.logout")}
                    </Button>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-1 px-10 py-12 pb-24 w-full max-w-screen-2xl mx-auto">
                {/* Hero */}
                <section className="mb-12">
                    <h1 className="text-3xl font-bold text-foreground mb-2">{t("dashboard.hero.title")}</h1>
                    <p className="text-muted-foreground">
                        {projects.length === 0
                            ? t("dashboard.hero.empty")
                            : t("dashboard.hero.count_other", { count: projects.length })}
                    </p>
                </section>

                {/* Guide banner */}
                <section className="mb-12">
                    <GuideBanner
                        videoUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                        title={t("guide.title")}
                        subtitle={t("guide.subtitle")}
                        ctaLabel={t("guide.cta")}
                    />
                </section>

                {/* Preset section */}
                <section className="mb-16 space-y-5">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                {t("dashboard.presets.title")}
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Libreria ordinata per categoria, con preset vuoto e modello consigliato quando disponibile.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={presetCategoryFilter === "all" ? "default" : "outline"}
                                onClick={() => setPresetCategoryFilter("all")}
                            >
                                Tutti
                            </Button>
                            {presetCategories.map((category) => (
                                <Button
                                    key={category.key}
                                    type="button"
                                    size="sm"
                                    variant={presetCategoryFilter === category.key ? "default" : "outline"}
                                    onClick={() => setPresetCategoryFilter(category.key)}
                                >
                                    {category.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {blankPreset ? (
                        <Button
                            variant="outline"
                            className="w-full h-auto min-h-24 p-5 flex flex-col items-start justify-start gap-2 text-left border-dashed"
                            onClick={() => handleCreateFromPreset(blankPreset.id, blankPreset.labelIt || blankPreset.label)}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <Sparkles className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                    <div className="text-sm font-semibold text-foreground leading-tight">{blankPreset.labelIt || blankPreset.label}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{blankPreset.hint}</div>
                                </div>
                            </div>
                        </Button>
                    ) : null}

                    <div className="space-y-6">
                        {groupedPresets.map((group) => (
                            <div key={group.key} className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                                    {group.hint ? <span className="text-xs text-muted-foreground">{group.hint}</span> : null}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {group.presets.map((preset) => {
                                        const Icon = PRESET_ICON_MAP[preset.icon as keyof typeof PRESET_ICON_MAP] ?? Sparkles;
                                        return (
                                            <Button
                                                key={preset.id}
                                                variant="outline"
                                                className="h-auto min-h-32 p-5 flex flex-col items-start justify-start gap-3 text-left"
                                                onClick={() => handleCreateFromPreset(preset.id, preset.labelIt || preset.label)}
                                            >
                                                <div className="flex items-start justify-between w-full gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                                        <Icon className="h-4 w-4 text-primary" />
                                                    </div>
                                                    {preset.recommendedModel?.label ? (
                                                        <Badge variant="secondary" className="text-[10px]">
                                                            {preset.recommendedModel.label}
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-semibold text-foreground leading-tight">{preset.labelIt || preset.label}</div>
                                                    <div className="text-xs text-muted-foreground mt-1 leading-snug">{preset.hint}</div>
                                                </div>
                                                {preset.tags?.length ? (
                                                    <div className="flex flex-wrap gap-1">
                                                        {preset.tags.slice(0, 3).map((tag) => (
                                                            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Projects grid */}
                <section>
                    <h2 className="text-lg font-semibold text-foreground mb-8 flex items-center gap-3">
                        {t("dashboard.projects.title")}
                        {projects.length > 0 && (
                            <span className="text-sm font-normal text-muted-foreground">({projects.length})</span>
                        )}
                    </h2>
                    {sortedProjects.length === 0 ? (
                        <div className="text-center py-28 border border-dashed border-border rounded-2xl">
                            <p className="text-muted-foreground mb-4">{t("dashboard.projects.empty")}</p>
                            <Button onClick={() => setCreateOpen(true)}>{t("dashboard.projects.createFirst")}</Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                            {sortedProjects.map((p) => (
                                <ProjectCard
                                    key={p.id}
                                    project={p}
                                    onOpen={handleOpenProject}
                                    onDuplicate={handleDuplicate}
                                    onDelete={handleDelete}
                                    onCopyPrompt={handleCopyPrompt}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </main>

            {/* Footer bar */}
            <footer className="fixed bottom-0 left-0 right-0 z-30 bg-card/90 backdrop-blur-sm border-t border-border h-12 flex items-center px-8 gap-4">
                <TipsChip />
                {projects.length > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                        {t("dashboard.footer.count_other", { count: projects.length })}
                    </span>
                )}
            </footer>

            {/* Create project modal */}
            <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setSelectedPresetId(undefined); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t("dashboard.modal.title")}</DialogTitle>
                        <DialogDescription>
                            {selectedPresetId
                                ? t("dashboard.modal.descPreset", { preset: selectedPresetLabel ?? selectedPresetId })
                                : t("dashboard.modal.descBlank")}
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateProject} className="space-y-4">
                        <Input
                            ref={createInputRef}
                            type="text"
                            placeholder={t("dashboard.modal.placeholder")}
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            minLength={3}
                            required
                        />
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                                {t("dashboard.modal.cancel")}
                            </Button>
                            <Button type="submit" disabled={creating}>
                                {creating ? t("dashboard.modal.creating") : t("dashboard.modal.create")}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Toast notifications */}
            {toast && (
                <div
                    className={`fixed bottom-16 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
                        toast.ok
                            ? "bg-success text-white"
                            : "bg-destructive text-destructive-foreground"
                    }`}
                >
                    <span>{toast.ok ? "✓" : "✗"}</span>
                    <span>{toast.msg}</span>
                </div>
            )}
        </div>
    );
}
