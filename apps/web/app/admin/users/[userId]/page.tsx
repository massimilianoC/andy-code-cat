"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminUser,
    adminBlockUser,
    adminSetUserRoles,
    adminSetUserLimits,
    adminDeleteUser,
    type AdminUserDetailDto,
    type UserLimitsDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const ALL_ROLES = ["user", "admin", "superadmin"];

export default function AdminUserDetailPage() {
    const router = useRouter();
    const params = useParams<{ userId: string }>();
    const userId = params.userId;

    const [user, setUser] = useState<AdminUserDetailDto | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Roles editing
    const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
    const [savingRoles, setSavingRoles] = useState(false);

    // Limits editing
    const [limitsForm, setLimitsForm] = useState<Partial<UserLimitsDto>>({});
    const [savingLimits, setSavingLimits] = useState(false);

    // Delete confirmation
    const [showDelete, setShowDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    function loadUser() {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }
        setLoading(true);
        setError(null);
        getAdminUser(token, userId)
            .then((u) => {
                setUser(u);
                setSelectedRoles(u.roles);
                setLimitsForm(u.limits ?? {});
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load user"))
            .finally(() => setLoading(false));
    }

    useEffect(() => { loadUser(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function toggleBlock() {
        if (!user) return;
        const token = getToken();
        if (!token) return;
        setActionError(null);
        try {
            await adminBlockUser(token, user.id, !user.isBlocked);
            loadUser();
        } catch (e: unknown) {
            setActionError(e instanceof Error ? e.message : "Action failed");
        }
    }

    async function saveRoles() {
        if (!user) return;
        const token = getToken();
        if (!token) return;
        setSavingRoles(true);
        setActionError(null);
        try {
            await adminSetUserRoles(token, user.id, selectedRoles);
            loadUser();
        } catch (e: unknown) {
            setActionError(e instanceof Error ? e.message : "Failed to update roles");
        } finally {
            setSavingRoles(false);
        }
    }

    async function saveLimits() {
        if (!user) return;
        const token = getToken();
        if (!token) return;
        setSavingLimits(true);
        setActionError(null);
        try {
            await adminSetUserLimits(token, user.id, limitsForm);
            loadUser();
        } catch (e: unknown) {
            setActionError(e instanceof Error ? e.message : "Failed to update limits");
        } finally {
            setSavingLimits(false);
        }
    }

    async function handleDelete() {
        if (!user) return;
        const token = getToken();
        if (!token) return;
        setDeleting(true);
        try {
            await adminDeleteUser(token, user.id);
            router.push("/admin/users");
        } catch (e: unknown) {
            setActionError(e instanceof Error ? e.message : "Delete failed");
            setDeleting(false);
            setShowDelete(false);
        }
    }

    function toggleRole(role: string) {
        setSelectedRoles((prev) =>
            prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
        );
    }

    if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;
    if (error) return <p className="text-destructive text-sm">{error}</p>;
    if (!user) return null;

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
                <a href="/admin" className="hover:text-foreground transition-colors">Admin</a>
                <span>/</span>
                <a href="/admin/users" className="hover:text-foreground transition-colors">Users</a>
                <span>/</span>
                <span className="text-foreground truncate">{user.email}</span>
            </div>

            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={() => router.push("/admin/users")}>
                    ← Back
                </Button>
                <h1 className="text-2xl font-bold truncate">{user.email}</h1>
                {user.isBlocked && <Badge variant="destructive">Blocked</Badge>}
                {user.emailVerified && <Badge variant="outline" className="text-green-400 border-green-400">Verified</Badge>}
            </div>

            {actionError && <p className="text-destructive text-sm">{actionError}</p>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* User Info */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">User Info</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">ID</span>
                            <span className="font-mono text-xs">{user.id}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Name</span>
                            <span>{[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Email verified</span>
                            <span>{user.emailVerified ? "Yes" : "No"}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Joined</span>
                            <span>{new Date(user.createdAt).toLocaleDateString()}</span>
                        </div>
                        <Separator className="my-2" />
                        <Button
                            variant={user.isBlocked ? "outline" : "destructive"}
                            size="sm"
                            className="w-full"
                            onClick={toggleBlock}
                        >
                            {user.isBlocked ? "Unblock User" : "Block User"}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-destructive hover:text-destructive"
                            onClick={() => setShowDelete(true)}
                        >
                            Delete User
                        </Button>
                    </CardContent>
                </Card>

                {/* Projects */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Projects ({user.projects.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm max-h-64 overflow-y-auto">
                        {user.projects.length === 0 && (
                            <p className="text-muted-foreground">No projects.</p>
                        )}
                        {user.projects.map((p) => (
                            <div key={p.id} className="flex justify-between items-center py-1">
                                <span className="truncate">{p.name}</span>
                                <Badge variant="secondary" className="text-xs ml-2">{p.presetId ?? "custom"}</Badge>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {/* Roles */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Roles</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                            {ALL_ROLES.map((role) => (
                                <button
                                    key={role}
                                    onClick={() => toggleRole(role)}
                                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                        selectedRoles.includes(role)
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-background text-muted-foreground border-border hover:border-foreground"
                                    }`}
                                >
                                    {role}
                                </button>
                            ))}
                        </div>
                        <Button size="sm" onClick={saveRoles} disabled={savingRoles}>
                            {savingRoles ? "Saving…" : "Save Roles"}
                        </Button>
                    </CardContent>
                </Card>

                {/* Limits */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Limits &amp; Plan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="lim-plan" className="text-xs">Plan</Label>
                                <Input
                                    id="lim-plan"
                                    value={limitsForm.plan ?? ""}
                                    onChange={(e) => setLimitsForm((f) => ({ ...f, plan: e.target.value }))}
                                    placeholder="unlimited"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="lim-projects" className="text-xs">Max projects (-1 = ∞)</Label>
                                <Input
                                    id="lim-projects"
                                    type="number"
                                    value={limitsForm.maxProjects ?? ""}
                                    onChange={(e) => setLimitsForm((f) => ({ ...f, maxProjects: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="lim-tokens" className="text-xs">Max tokens/mo (K)</Label>
                                <Input
                                    id="lim-tokens"
                                    type="number"
                                    value={limitsForm.maxMonthlyTokensK ?? ""}
                                    onChange={(e) => setLimitsForm((f) => ({ ...f, maxMonthlyTokensK: Number(e.target.value) }))}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <Label htmlFor="lim-sites" className="text-xs">Max published sites</Label>
                                <Input
                                    id="lim-sites"
                                    type="number"
                                    value={limitsForm.maxPublishedSites ?? ""}
                                    onChange={(e) => setLimitsForm((f) => ({ ...f, maxPublishedSites: Number(e.target.value) }))}
                                />
                            </div>
                        </div>
                        <Button size="sm" onClick={saveLimits} disabled={savingLimits}>
                            {savingLimits ? "Saving…" : "Save Limits"}
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Delete Confirmation */}
            <Dialog open={showDelete} onOpenChange={setShowDelete}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete User</DialogTitle>
                        <DialogDescription>
                            Permanently delete <strong>{user.email}</strong>? This cannot be undone.
                            The user&apos;s projects and data will remain in the database.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                            {deleting ? "Deleting…" : "Delete"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
