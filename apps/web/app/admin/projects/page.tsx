"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    adminListProjects,
    adminDeleteProject,
    adminBlockDeployment,
    getAdminProjectAiAnalytics,
    type AdminProjectDto,
} from "@/lib/api/admin";
import type { AiUsageAnalyticsDto } from "@/lib/api/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import AiUsageSummaryPanel from "@/components/AiUsageSummaryPanel";

type ConfirmAction = "delete-project" | "block-deployment" | "unblock-deployment";

interface ConfirmState {
    action: ConfirmAction;
    projectId: string;
    publishId?: string;
}

type SidebarTab = "overview" | "ai" | "deployment" | "danger";

function getPublicDeploymentUrl(deployment: AdminProjectDto["activeDeployment"]): string | null {
    if (!deployment) return null;
    return deployment.subdomainUrl ?? deployment.url;
}

function getPublicDeploymentLabel(deployment: AdminProjectDto["activeDeployment"]): string {
    return deployment?.customSlug && deployment.subdomainUrl ? "Slug URL" : "Live URL";
}

/** Segment-control tab bar for the project sidebar. */
function SidebarTabs({ active, onChange }: { active: SidebarTab; onChange: (t: SidebarTab) => void }) {
    const tabs: { id: SidebarTab; label: string; danger?: boolean }[] = [
        { id: "overview", label: "Overview" },
        { id: "ai", label: "AI Usage" },
        { id: "deployment", label: "Deployment" },
        { id: "danger", label: "Danger", danger: true },
    ];
    return (
        <div
            className="admin-seg-list shrink-0 mx-4 mt-3"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
        >
            {tabs.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange(t.id)}
                    className="admin-seg-tab"
                    data-active={active === t.id ? "true" : undefined}
                    data-danger={t.danger ? "true" : undefined}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

export default function AdminProjectsPage() {
    const router = useRouter();
    const [projects, setProjects] = useState<AdminProjectDto[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [draftSearch, setDraftSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedProject, setSelectedProject] = useState<AdminProjectDto | null>(null);
    const [sidebarTab, setSidebarTab] = useState<SidebarTab>("overview");
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [projectAiAnalytics, setProjectAiAnalytics] = useState<AiUsageAnalyticsDto | null>(null);
    const [loadingProjectAiAnalytics, setLoadingProjectAiAnalytics] = useState(false);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
    const [actionInFlight, setActionInFlight] = useState(false);

    const limit = 20;

    const fetchProjects = useCallback(
        async (p: number, s: string) => {
            const token = getToken();
            if (!token) { router.replace("/login"); return; }
            setLoading(true);
            setFetchError(null);
            try {
                const result = await adminListProjects(token, { page: p, limit, search: s || undefined });
                setProjects(result.projects);
                setTotal(result.total);
            } catch (err: unknown) {
                setFetchError(err instanceof Error ? err.message : "Failed to load projects.");
            } finally {
                setLoading(false);
            }
        },
        [router],
    );

    useEffect(() => {
        fetchProjects(page, search);
    }, [page, search, fetchProjects]);

    function applySearch() {
        setPage(1);
        setSearch(draftSearch);
    }

    function openConfirm(state: ConfirmState) {
        setConfirmState(state);
        setActionMessage(null);
    }

    function selectProject(p: AdminProjectDto) {
        setSelectedProject(p);
        setActionMessage(null);
        setSidebarTab("overview");
    }

    async function executeConfirmedAction() {
        if (!confirmState) return;
        const token = getToken();
        if (!token) return;
        setActionInFlight(true);
        try {
            if (confirmState.action === "delete-project") {
                await adminDeleteProject(token, confirmState.projectId);
                setActionMessage("Project deleted.");
                setSelectedProject(null);
            } else if (confirmState.action === "block-deployment" && confirmState.publishId) {
                await adminBlockDeployment(token, confirmState.publishId, true);
                setActionMessage("Deployment blocked.");
            } else if (confirmState.action === "unblock-deployment" && confirmState.publishId) {
                await adminBlockDeployment(token, confirmState.publishId, false);
                setActionMessage("Deployment unblocked.");
            }
            await fetchProjects(page, search);
        } catch (err: unknown) {
            setActionMessage(err instanceof Error ? err.message : "Action failed.");
        } finally {
            setActionInFlight(false);
            setConfirmState(null);
        }
    }

    // Sync selectedProject after list refresh
    useEffect(() => {
        if (!selectedProject) return;
        const updated = projects.find((p) => p.id === selectedProject.id);
        if (updated) setSelectedProject(updated);
    }, [projects, selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const token = getToken();
        if (!token || !selectedProject) {
            setProjectAiAnalytics(null);
            return;
        }
        setLoadingProjectAiAnalytics(true);
        getAdminProjectAiAnalytics(token, selectedProject.id)
            .then((result) => setProjectAiAnalytics(result))
            .catch(() => setProjectAiAnalytics(null))
            .finally(() => setLoadingProjectAiAnalytics(false));
    }, [selectedProject?.id]);

    function getConfirmCopy(state: ConfirmState): { title: string; description: string } {
        if (state.action === "delete-project")
            return {
                title: "Delete project?",
                description: "This will block all published deployments for this project and permanently delete the project record. This cannot be undone.",
            };
        if (state.action === "block-deployment")
            return { title: "Block deployment?", description: "The published site will return HTTP 403 until unblocked." };
        return { title: "Unblock deployment?", description: "The published site will be accessible again." };
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className={cn("", selectedProject && "xl:pr-[42rem]")}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Projects</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {loading ? "Loading…" : `${total} total project${total !== 1 ? "s" : ""} across all users`}
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchProjects(page, search)}>
                    Refresh
                </Button>
            </div>

            {/* Search */}
            <div className="flex gap-2 mb-4">
                <Input
                    placeholder="Search by project name…"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applySearch()}
                    className="max-w-sm"
                />
                <Button variant="outline" onClick={applySearch}>Search</Button>
                {search && (
                    <Button variant="ghost" onClick={() => { setDraftSearch(""); setSearch(""); setPage(1); }}>
                        Clear
                    </Button>
                )}
            </div>

            {/* Error state */}
            {fetchError && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {fetchError}
                </div>
            )}

            {/* Project table */}
            {loading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : (
                <Card>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                    <th className="py-3 px-4 text-left font-medium">Project</th>
                                    <th className="py-3 px-4 text-left font-medium">Owner</th>
                                    <th className="py-3 px-4 text-left font-medium">Preset</th>
                                    <th className="py-3 px-4 text-left font-medium">Deployment</th>
                                    <th className="py-3 px-4 text-left font-medium">Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {projects.map((p) => (
                                    <tr
                                        key={p.id}
                                        onClick={() => selectProject(p)}
                                        className={cn(
                                            "border-b border-border cursor-pointer hover:bg-muted/30 transition-colors",
                                            selectedProject?.id === p.id && "bg-muted/50",
                                        )}
                                    >
                                        <td className="py-3 px-4 font-medium">{p.name}</td>
                                        <td className="py-3 px-4 text-muted-foreground">
                                            <span className="block font-mono text-xs">{p.ownerEmail}</span>
                                            {p.ownerIsBlocked && (
                                                <Badge variant="destructive" className="text-xs mt-1">Blocked</Badge>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-muted-foreground">
                                            {p.presetId
                                                ? <Badge variant="outline" className="text-xs">{p.presetId}</Badge>
                                                : <span className="text-xs text-muted-foreground">—</span>
                                            }
                                        </td>
                                        <td className="py-3 px-4">
                                            {p.activeDeployment ? (
                                                <div className="space-y-1">
                                                    <Badge variant={p.activeDeployment.isAdminBlocked ? "destructive" : "success"} className="text-xs">
                                                        {p.activeDeployment.isAdminBlocked ? "Blocked" : "Live"}
                                                    </Badge>
                                                    {getPublicDeploymentUrl(p.activeDeployment) ? (
                                                        <a
                                                            href={getPublicDeploymentUrl(p.activeDeployment)!}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="block text-xs text-primary hover:underline break-all"
                                                        >
                                                            {getPublicDeploymentUrl(p.activeDeployment)}
                                                        </a>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-muted-foreground text-xs">
                                            {new Date(p.createdAt).toLocaleDateString()}
                                        </td>
                                    </tr>
                                ))}
                                {projects.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan={5} className="py-10 text-center text-muted-foreground">
                                            {search
                                                ? "No projects match your search."
                                                : "No projects found in the database. Projects appear here once users start creating them."}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center gap-2 mt-4 justify-end">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                    <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
            )}

            {/* ── Wide project sidebar ─────────────────────────────────────────── */}
            {selectedProject && (
                <>
                    <div className="fixed inset-0 bg-black/40 z-30 xl:hidden" onClick={() => setSelectedProject(null)} />
                    <aside className="fixed top-0 right-0 h-full w-full max-w-xl bg-background border-l border-border z-40 shadow-xl xl:w-[40rem] flex flex-col">

                        {/* Sidebar header */}
                        <div className="shrink-0 px-5 py-4 border-b border-border">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Project</p>
                                    <h2 className="font-semibold text-base truncate">{selectedProject.name}</h2>
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {selectedProject.presetId && (
                                            <Badge variant="outline" className="text-xs">{selectedProject.presetId}</Badge>
                                        )}
                                        {selectedProject.activeDeployment && (
                                            <Badge
                                                variant={selectedProject.activeDeployment.isAdminBlocked ? "destructive" : "success"}
                                                className="text-xs"
                                            >
                                                {selectedProject.activeDeployment.isAdminBlocked ? "Deployment blocked" : "Live"}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedProject(null)} className="shrink-0">Close</Button>
                            </div>
                        </div>

                        {/* Tab bar */}
                        <SidebarTabs active={sidebarTab} onChange={setSidebarTab} />

                        <ScrollArea className="flex-1">
                            <div className="p-5 space-y-4">
                                {actionMessage && (
                                    <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded">
                                        {actionMessage}
                                    </div>
                                )}

                                {/* ── Tab: Overview ── */}
                                {sidebarTab === "overview" && (
                                    <div className="space-y-4">
                                        {/* Owner */}
                                        <Card>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm">Owner</CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-2 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-muted-foreground">Email:</span>
                                                    <span className="font-mono text-xs">{selectedProject.ownerEmail}</span>
                                                    {selectedProject.ownerIsBlocked && (
                                                        <Badge variant="destructive" className="text-xs">Blocked</Badge>
                                                    )}
                                                </div>
                                                {(selectedProject.ownerFirstName || selectedProject.ownerLastName) && (
                                                    <div className="flex gap-2">
                                                        <span className="text-muted-foreground">Name:</span>
                                                        <span>{[selectedProject.ownerFirstName, selectedProject.ownerLastName].filter(Boolean).join(" ")}</span>
                                                    </div>
                                                )}
                                                <div className="flex gap-2">
                                                    <span className="text-muted-foreground">User ID:</span>
                                                    <span className="font-mono text-xs text-muted-foreground">{selectedProject.ownerUserId}</span>
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => router.push(`/admin/users?highlight=${selectedProject.ownerUserId}`)}
                                                >
                                                    View owner in Users →
                                                </Button>
                                            </CardContent>
                                        </Card>

                                        {/* Project metadata */}
                                        <Card>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm">Project metadata</CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-2 text-sm">
                                                <div className="grid grid-cols-[6rem_1fr] gap-y-1.5">
                                                    <span className="text-muted-foreground">Project ID</span>
                                                    <span className="font-mono text-xs break-all">{selectedProject.id}</span>
                                                    <span className="text-muted-foreground">Preset</span>
                                                    <span>{selectedProject.presetId ?? <span className="text-muted-foreground">none</span>}</span>
                                                    <span className="text-muted-foreground">Created</span>
                                                    <span>{new Date(selectedProject.createdAt).toLocaleString()}</span>
                                                    {selectedProject.activeDeployment && (
                                                        <>
                                                            <span className="text-muted-foreground">{getPublicDeploymentLabel(selectedProject.activeDeployment)}</span>
                                                            <a
                                                                href={getPublicDeploymentUrl(selectedProject.activeDeployment)!}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-primary hover:underline text-xs break-all"
                                                            >
                                                                {getPublicDeploymentUrl(selectedProject.activeDeployment)}
                                                            </a>
                                                        </>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </div>
                                )}

                                {sidebarTab === "ai" && (
                                    <AiUsageSummaryPanel
                                        title="Project AI analytics"
                                        subtitle="Incremental LLM and image-generation cost for this project."
                                        analytics={projectAiAnalytics}
                                        loading={loadingProjectAiAnalytics}
                                    />
                                )}

                                {/* ── Tab: Deployment ── */}
                                {sidebarTab === "deployment" && (
                                    <div className="space-y-4">
                                        {selectedProject.activeDeployment ? (
                                            <Card>
                                                <CardHeader className="pb-2">
                                                    <CardTitle className="text-sm">Active deployment</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-3 text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant={selectedProject.activeDeployment.isAdminBlocked ? "destructive" : "success"}>
                                                            {selectedProject.activeDeployment.isAdminBlocked ? "Blocked" : "Live"}
                                                        </Badge>
                                                        <span className="font-mono text-xs text-muted-foreground">
                                                            {selectedProject.activeDeployment.publishId}
                                                        </span>
                                                    </div>
                                                    {selectedProject.activeDeployment.customSlug && (
                                                        <div className="flex gap-2">
                                                            <span className="text-muted-foreground">Slug:</span>
                                                            <span>{selectedProject.activeDeployment.customSlug}</span>
                                                        </div>
                                                    )}
                                                    <div className="flex gap-2">
                                                        <span className="text-muted-foreground">{getPublicDeploymentLabel(selectedProject.activeDeployment)}:</span>
                                                        <a
                                                            href={getPublicDeploymentUrl(selectedProject.activeDeployment)!}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-primary hover:underline text-xs break-all"
                                                        >
                                                            {getPublicDeploymentUrl(selectedProject.activeDeployment)}
                                                        </a>
                                                    </div>
                                                    <div className="pt-1">
                                                        {selectedProject.activeDeployment.isAdminBlocked ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => openConfirm({
                                                                    action: "unblock-deployment",
                                                                    projectId: selectedProject.id,
                                                                    publishId: selectedProject.activeDeployment!.publishId,
                                                                })}
                                                            >
                                                                Unblock site
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => openConfirm({
                                                                    action: "block-deployment",
                                                                    projectId: selectedProject.id,
                                                                    publishId: selectedProject.activeDeployment!.publishId,
                                                                })}
                                                            >
                                                                Block site
                                                            </Button>
                                                        )}
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ) : (
                                            <div className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
                                                No active deployment for this project.
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ── Tab: Danger ── */}
                                {sidebarTab === "danger" && (
                                    <Card className="border-destructive/40">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm text-destructive">Danger zone</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-xs text-muted-foreground mb-4">
                                                Deletes the project and blocks all its published deployments. This action is permanent and cannot be undone.
                                            </p>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={() => openConfirm({ action: "delete-project", projectId: selectedProject.id })}
                                            >
                                                Delete project
                                            </Button>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </ScrollArea>
                    </aside>
                </>
            )}

            {/* Confirmation dialog */}
            <Dialog open={!!confirmState} onOpenChange={(open) => { if (!open) setConfirmState(null); }}>
                <DialogContent>
                    {confirmState && (
                        <>
                            <DialogHeader>
                                <DialogTitle>{getConfirmCopy(confirmState).title}</DialogTitle>
                                <DialogDescription>{getConfirmCopy(confirmState).description}</DialogDescription>
                            </DialogHeader>
                            <Separator />
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setConfirmState(null)} disabled={actionInFlight}>Cancel</Button>
                                <Button
                                    variant={confirmState.action === "delete-project" ? "destructive" : "default"}
                                    onClick={executeConfirmedAction}
                                    disabled={actionInFlight}
                                >
                                    {actionInFlight ? "Working…" : "Confirm"}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
