"use client";

import { useState } from "react";
import { getToken } from "@/lib/token-store";
import { adminGetProjectSnapshot, type AdminSnapshotSummaryDto } from "@/lib/api/admin";
import { buildPreviewDoc } from "@/lib/preview/buildPreviewDoc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ProjectVersionsPanelProps {
    projectId: string;
    snapshots: AdminSnapshotSummaryDto[];
    loading?: boolean;
}

/**
 * Read-only version history for the admin "Versions" tab. Listing snapshots is not
 * audited (metadata only); opening a version's rendered preview fetches full artifacts
 * via an admin endpoint that writes an AdminAuditLog entry server-side on every call.
 */
export default function ProjectVersionsPanel({ projectId, snapshots, loading = false }: ProjectVersionsPanelProps) {
    const [previewSnapshotId, setPreviewSnapshotId] = useState<string | null>(null);
    const [previewDoc, setPreviewDoc] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    async function openPreview(snapshotId: string) {
        setPreviewSnapshotId(snapshotId);
        setPreviewDoc(null);
        setPreviewError(null);
        const token = getToken();
        if (!token) {
            setPreviewError("Not authenticated.");
            return;
        }
        setPreviewLoading(true);
        try {
            const { snapshot } = await adminGetProjectSnapshot(token, projectId, snapshotId);
            const { doc } = buildPreviewDoc(snapshot.artifacts.html, snapshot.artifacts.css, snapshot.artifacts.js);
            setPreviewDoc(doc);
        } catch (err: unknown) {
            setPreviewError(err instanceof Error ? err.message : "Failed to load snapshot.");
        } finally {
            setPreviewLoading(false);
        }
    }

    function closePreview() {
        setPreviewSnapshotId(null);
        setPreviewDoc(null);
        setPreviewError(null);
    }

    return (
        <>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Version history</CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Read-only. Opening a version&apos;s preview is recorded in the admin audit log.
                    </p>
                </CardHeader>
                <CardContent className="space-y-2">
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : snapshots.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No versions yet.</p>
                    ) : (
                        snapshots.map((s) => (
                            <div
                                key={s.id}
                                className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3 text-sm"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        {s.isActive && (
                                            <Badge variant="success" className="text-[10px] uppercase">Active</Badge>
                                        )}
                                        <span className="font-mono text-xs text-muted-foreground truncate">{s.id}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {new Date(s.createdAt).toLocaleString()}
                                        {s.activatedAt ? ` · activated ${new Date(s.activatedAt).toLocaleString()}` : ""}
                                    </p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => openPreview(s.id)}>
                                    View
                                </Button>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <Dialog open={Boolean(previewSnapshotId)} onOpenChange={(open) => !open && closePreview()}>
                <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Version preview</DialogTitle>
                        <DialogDescription>
                            Read-only render. This view was recorded in the admin audit log.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden bg-white">
                        {previewLoading ? (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
                        ) : previewError ? (
                            <div className="flex h-full items-center justify-center text-sm text-destructive">{previewError}</div>
                        ) : previewDoc ? (
                            <iframe
                                title="Version preview"
                                srcDoc={previewDoc}
                                sandbox="allow-scripts"
                                className="w-full h-full border-0"
                            />
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
