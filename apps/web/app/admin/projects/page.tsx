"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    adminListProjects,
    adminDeleteProject,
    adminBlockDeployment,
    type AdminProjectDto,
} from "@/lib/api/admin";
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

type ConfirmAction = "delete-project" | "block-deployment" | "unblock-deployment";

interface ConfirmState {
    action: ConfirmAction;
    projectId: string;
    publishId?: string;
}

export default function AdminProjectsPage() {
    const router = useRouter();
    const [projects, setProjects] = useState<AdminProjectDto[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [draftSearch, setDraftSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectedProject, setSelectedProject] = useState<AdminProjectDto | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
    const [actionInFlight, setActionInFlight] = useState(false);

    const limit = 20;

    const fetchProjects = useCallback(
        async (p: number, s: string) => {
            const token = getToken();
            if (!token) {
                router.replace("/login");
                return;
            }
            setLoading(true);
            try {
                const result = await adminListProjects(token, { page: p, limit, search: s || undefined });
                setProjects(result.projects);
                setTotal(result.total);
            } catch {
                setActionMessage("Failed to load projects.");
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
            // Refresh selected project data from the updated list
            if (confirmState.action !== "delete-project") {
                // find updated project
                setSelectedProject((prev) => {
                    if (!prev) return null;
                    // project list may have been updated; find by id
                    return prev;
                });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Action failed.";
            setActionMessage(msg);
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

    function getConfirmCopy(state: ConfirmState): { title: string; description: string } {
        if (state.action === "delete-project")
            return {
                title: "Delete project?",
                description:
                    "This will block all published deployments for this project and permanently delete the project record. This cannot be undone.",
            };
        if (state.action === "block-deployment")
            return {
                title: "Block deployment?",
                description: "The published site will return HTTP 403 until unblocked.",
            };
        return {
            title: "Unblock deployment?",
            description: "The published site will be accessible again.",
        };
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className={cn("", selectedProject && "xl:pr-[30rem]")}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Projects</h1>
                    <p className="text-sm text-muted-foreground mt-1">{total} total projects</p>
                </div>
            </div>

            {/* Search bar */}
            <div className="flex gap-2 mb-4">
                <Input
                    placeholder="Search by project name…"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applySearch()}
                    className="max-w-sm"
                />
                <Button variant="outline" onClick={applySearch}>
                    Search
                </Button>
                {search && (
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setDraftSearch("");
                            setSearch("");
                            setPage(1);
                        }}
                    >
                        Clear
                    </Button>
                )}
            </div>

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
                                        onClick={() => {
                                            setSelectedProject(p);
                                            setActionMessage(null);
                                        }}
                                        className={cn(
                                            "border-b border-border cursor-pointer hover:bg-muted/30 transition-colors",
                                            selectedProject?.id === p.id && "bg-muted/50",
                                        )}
                                    >
                                        <td className="py-3 px-4 font-medium">{p.name}</td>
                                        <td className="py-3 px-4 text-muted-foreground">
                                            <span className="block">{p.ownerEmail}</span>
                                            {p.ownerIsBlocked && (
                                                <Badge variant="destructive" className="text-xs mt-1">
                                                    Blocked
                                                </Badge>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-muted-foreground">
                                            {p.presetId ? (
                                                <Badge variant="outline" className="text-xs">
                                                    {p.presetId}
                                                </Badge>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4">
                                            {p.activeDeployment ? (
                                                <Badge
                                                    variant={p.activeDeployment.isAdminBlocked ? "destructive" : "success"}
                                                    className="text-xs"
                                                >
                                                    {p.activeDeployment.isAdminBlocked ? "Blocked" : "Live"}
                                                </Badge>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-muted-foreground text-xs">
                                            {new Date(p.createdAt).toLocaleDateString()}
                                        </td>
                                    </tr>
                                ))}
                                {projects.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                                            No projects found.
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
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                    >
                        Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {page} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </Button>
                </div>
            )}

            {/* Right sidebar */}
            {selectedProject && (
                <>
                    {/* Mobile overlay */}
                    <div
                        className="fixed inset-0 bg-black/40 z-30 xl:hidden"
                        onClick={() => setSelectedProject(null)}
                    />
                    <div className="fixed top-0 right-0 h-full w-full max-w-[28rem] bg-background border-l border-border z-40 shadow-xl flex flex-col">
                        {/* Sidebar header */}
                        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                            <h2 className="font-semibold text-base truncate max-w-[20rem]">
                                {selectedProject.name}
                            </h2>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedProject(null)}
                            >
                                ✕
                            </Button>
                        </div>

                        <ScrollArea className="flex-1">
                            <div className="p-4 space-y-4">
                                {actionMessage && (
                                    <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded">
                                        {actionMessage}
                                    </div>
                                )}

                                {/* Owner info */}
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Owner</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-1 text-sm">
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">Email:</span>
                                            <span>{selectedProject.ownerEmail}</span>
                                            {selectedProject.ownerIsBlocked && (
                                                <Badge variant="destructive" className="text-xs">
                                                    Blocked
                                                </Badge>
                                            )}
                                        </div>
                                        {(selectedProject.ownerFirstName || selectedProject.ownerLastName) && (
                                            <div className="flex gap-2">
                                                <span className="text-muted-foreground">Name:</span>
                                                <span>
                                                    {[selectedProject.ownerFirstName, selectedProject.ownerLastName]
                                                        .filter(Boolean)
                                                        .join(" ")}
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex gap-2">
                                            <span className="text-muted-foreground">Owner ID:</span>
                                            <span className="font-mono text-xs text-muted-foreground">
                                                {selectedProject.ownerUserId}
                                            </span>
                                        </div>
                                        <div className="pt-1">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    router.push(
                                                        `/admin/users?highlight=${selectedProject.ownerUserId}`,
                                                    )
                                                }
                                            >
                                                View owner in Users →
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Project metadata */}
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Project details</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-1 text-sm">
                                        <div className="flex gap-2">
                                            <span className="text-muted-foreground">ID:</span>
                                            <span className="font-mono text-xs">
                                                {selectedProject.id}
                                            </span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-muted-foreground">Preset:</span>
                                            <span>
                                                {selectedProject.presetId ?? (
                                                    <span className="text-muted-foreground">none</span>
                                                )}
                                            </span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-muted-foreground">Created:</span>
                                            <span>
                                                {new Date(selectedProject.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Deployment */}
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">Active deployment</CardTitle>
                                    </CardHeader>
                                    <CardContent className="text-sm">
                                        {selectedProject.activeDeployment ? (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Badge
                                                        variant={
                                                            selectedProject.activeDeployment.isAdminBlocked
                                                                ? "destructive"
                                                                : "success"
                                                        }
                                                    >
                                                        {selectedProject.activeDeployment.isAdminBlocked
                                                            ? "Blocked"
                                                            : "Live"}
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
                                                    <span className="text-muted-foreground">URL:</span>
                                                    <a
                                                        href={selectedProject.activeDeployment.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-primary hover:underline text-xs"
                                                    >
                                                        {selectedProject.activeDeployment.url}
                                                    </a>
                                                </div>
                                                <div className="flex gap-2 pt-1">
                                                    {selectedProject.activeDeployment.isAdminBlocked ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() =>
                                                                openConfirm({
                                                                    action: "unblock-deployment",
                                                                    projectId: selectedProject.id,
                                                                    publishId:
                                                                        selectedProject.activeDeployment!.publishId,
                                                                })
                                                            }
                                                        >
                                                            Unblock site
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() =>
                                                                openConfirm({
                                                                    action: "block-deployment",
                                                                    projectId: selectedProject.id,
                                                                    publishId:
                                                                        selectedProject.activeDeployment!.publishId,
                                                                })
                                                            }
                                                        >
                                                            Block site
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-muted-foreground">No active deployment.</p>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Danger zone */}
                                <Card className="border-destructive/40">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm text-destructive">Danger zone</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-xs text-muted-foreground mb-3">
                                            Deletes the project and blocks all its published deployments. This
                                            cannot be undone.
                                        </p>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() =>
                                                openConfirm({
                                                    action: "delete-project",
                                                    projectId: selectedProject.id,
                                                })
                                            }
                                        >
                                            Delete project
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>
                        </ScrollArea>
                    </div>
                </>
            )}

            {/* Confirmation dialog */}
            <Dialog
                open={!!confirmState}
                onOpenChange={(open) => {
                    if (!open) setConfirmState(null);
                }}
            >
                <DialogContent>
                    {confirmState && (
                        <>
                            <DialogHeader>
                                <DialogTitle>{getConfirmCopy(confirmState).title}</DialogTitle>
                                <DialogDescription>
                                    {getConfirmCopy(confirmState).description}
                                </DialogDescription>
                            </DialogHeader>
                            <Separator />
                            <DialogFooter>
                                <Button
                                    variant="outline"
                                    onClick={() => setConfirmState(null)}
                                    disabled={actionInFlight}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant={
                                        confirmState.action === "delete-project" ? "destructive" : "default"
                                    }
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
