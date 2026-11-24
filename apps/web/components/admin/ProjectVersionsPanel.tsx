"use client";

import { useState } from "react";
import { Eye, ShieldCheck } from "lucide-react";
import { getToken } from "@/lib/token-store";
import { adminGetProjectSnapshot, type AdminSnapshotSummaryDto } from "@/lib/api/admin";
import { buildPreviewDoc } from "@/lib/preview/buildPreviewDoc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ProjectVersionsPanelProps {
    projectId: string;
    snapshots: AdminSnapshotSummaryDto[];
    loading?: boolean;
}

type InspectStep = { snapshotId: string; stage: "reason" } | { snapshotId: string; stage: "preview" };

/**
 * A project's content as its owner sees it, for the superadmin — published or not.
 *
 * Listing versions shows dates only. Opening one shows another user's content, so it is a
 * deliberate step: the superadmin may say why (optional), and the server records who looked, at
 * what, and that reason in the admin audit log before the content is returned. The render runs in
 * a sandboxed frame without the app's origin, so the project's code cannot reach the session.
 */
export default function ProjectVersionsPanel({ projectId, snapshots, loading = false }: ProjectVersionsPanelProps) {
    const [step, setStep] = useState<InspectStep | null>(null);
    const [reason, setReason] = useState("");
    const [previewDoc, setPreviewDoc] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const active = snapshots.find((snapshot) => snapshot.isActive);

    function askReason(snapshotId: string) {
        setReason("");
        setPreviewDoc(null);
        setPreviewError(null);
        setStep({ snapshotId, stage: "reason" });
    }

    async function inspect(snapshotId: string) {
        setStep({ snapshotId, stage: "preview" });
        const token = getToken();
        if (!token) {
            setPreviewError("Not authenticated.");
            return;
        }
        setPreviewLoading(true);
        try {
            const { snapshot } = await adminGetProjectSnapshot(token, projectId, snapshotId, reason);
            setPreviewDoc(buildPreviewDoc(snapshot.artifacts.html, snapshot.artifacts.css, snapshot.artifacts.js).doc);
        } catch (err: unknown) {
            setPreviewError(err instanceof Error ? err.message : "Failed to load this version.");
        } finally {
            setPreviewLoading(false);
        }
    }

    function close() {
        setStep(null);
        setPreviewDoc(null);
        setPreviewError(null);
    }

    return (
        <>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Content</CardTitle>
                    <p className="mb-0 text-xs text-muted-foreground">
                        Every version of the site, published or not. Opening one is recorded in the audit log.
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : snapshots.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No versions yet: nothing has been generated in this project.</p>
                    ) : (
                        <>
                            {active && (
                                <Button className="w-full gap-2" onClick={() => askReason(active.id)}>
                                    <Eye className="size-4" />
                                    Inspect the active version
                                </Button>
                            )}
                            <ol className="m-0 list-none space-y-2 p-0">
                                {snapshots.map((s) => (
                                    <li
                                        key={s.id}
                                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm"
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                {s.isActive && <Badge variant="success" className="text-[10px] uppercase">Active</Badge>}
                                                <span className="truncate font-mono text-xs text-muted-foreground">{s.id}</span>
                                            </div>
                                            <p className="mb-0 mt-1 text-xs text-muted-foreground">
                                                {new Date(s.createdAt).toLocaleString()}
                                                {s.activatedAt ? ` · activated ${new Date(s.activatedAt).toLocaleString()}` : ""}
                                            </p>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => askReason(s.id)}>
                                            Inspect
                                        </Button>
                                    </li>
                                ))}
                            </ol>
                        </>
                    )}
                </CardContent>
            </Card>

            <Dialog open={step?.stage === "reason"} onOpenChange={(open) => !open && close()}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ShieldCheck className="size-4 text-primary" />
                            Inspect a user&apos;s content
                        </DialogTitle>
                        <DialogDescription>
                            You are about to view content that belongs to another user and may not be published.
                            Your account, the version and the time are recorded in the audit log.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="inspect-reason">Reason (optional)</Label>
                        <Input
                            id="inspect-reason"
                            value={reason}
                            maxLength={500}
                            placeholder="e.g. support request, content report, quality check"
                            onChange={(event) => setReason(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && step) void inspect(step.snapshotId);
                            }}
                            autoFocus
                        />
                        <p className="mb-0 text-xs text-muted-foreground">Recorded with the audit entry.</p>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={close}>Cancel</Button>
                        <Button onClick={() => step && void inspect(step.snapshotId)}>Open content</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={step?.stage === "preview"} onOpenChange={(open) => !open && close()}>
                <DialogContent className="flex h-[85vh] max-w-5xl flex-col">
                    <DialogHeader>
                        <DialogTitle>Version preview</DialogTitle>
                        <DialogDescription>
                            Read-only render, isolated from the app. This view was recorded in the audit log
                            {reason.trim() ? ` — reason: “${reason.trim()}”` : ""}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-white">
                        {previewLoading ? (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
                        ) : previewError ? (
                            <div className="flex h-full items-center justify-center text-sm text-destructive">{previewError}</div>
                        ) : previewDoc ? (
                            <iframe
                                title="Version preview"
                                srcDoc={previewDoc}
                                sandbox="allow-scripts"
                                className="h-full w-full border-0"
                            />
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
