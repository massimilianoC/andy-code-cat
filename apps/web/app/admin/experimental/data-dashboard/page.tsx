"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminExperimentalDataDashboardIndexPage() {
    const router = useRouter();
    const [projectId, setProjectId] = useState("");

    return (
        <div className="flex max-w-3xl flex-col gap-6">
            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
                    Experimental Alpha
                </p>
                <h1 className="text-2xl font-semibold text-foreground">Data Dashboard</h1>
                <p className="text-sm text-muted-foreground">
                    This flow is intentionally detached from the native Vibe / Zero Effort UX.
                    Use it only for explicit superadmin testing on a known project.
                </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
                <div className="space-y-4">
                    <div className="space-y-1">
                        <Label>Project ID</Label>
                        <Input
                            value={projectId}
                            onChange={(event) => setProjectId(event.target.value)}
                            placeholder="Paste a project id"
                        />
                    </div>
                    <div className="flex gap-3">
                        <Button
                            type="button"
                            onClick={() => router.push(`/admin/experimental/data-dashboard/${encodeURIComponent(projectId.trim())}`)}
                            disabled={projectId.trim().length < 3}
                        >
                            Open Experimental Console
                        </Button>
                        <Button type="button" variant="outline" onClick={() => router.push("/admin")}>
                            Back To Admin
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
