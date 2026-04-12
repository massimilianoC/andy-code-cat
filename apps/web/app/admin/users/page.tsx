"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    listAdminUsers,
    adminBlockUser,
    adminCreateUser,
    type AdminUserDto,
    type ListUsersResult,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const PAGE_SIZE = 20;

export default function AdminUsersPage() {
    const router = useRouter();
    const [result, setResult] = useState<ListUsersResult | null>(null);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState("");
    const [blockedFilter, setBlockedFilter] = useState<"" | "true" | "false">("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Create user dialog
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ email: "", password: "", firstName: "", lastName: "" });
    const [createError, setCreateError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    const fetchUsers = useCallback(() => {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }
        setLoading(true);
        setError(null);
        listAdminUsers(token, {
            page,
            limit: PAGE_SIZE,
            search: search || undefined,
            role: roleFilter || undefined,
            isBlocked: blockedFilter === "" ? undefined : blockedFilter === "true",
        })
            .then(setResult)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
            .finally(() => setLoading(false));
    }, [page, search, roleFilter, blockedFilter, router]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    async function toggleBlock(user: AdminUserDto) {
        const token = getToken();
        if (!token) return;
        await adminBlockUser(token, user.id, !user.isBlocked).catch(() => null);
        fetchUsers();
    }

    async function handleCreate() {
        const token = getToken();
        if (!token) return;
        setCreateError(null);
        setCreating(true);
        try {
            await adminCreateUser(token, createForm);
            setShowCreate(false);
            setCreateForm({ email: "", password: "", firstName: "", lastName: "" });
            fetchUsers();
        } catch (e: unknown) {
            setCreateError(e instanceof Error ? e.message : "Create failed");
        } finally {
            setCreating(false);
        }
    }

    const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 1;

    return (
        <div className="space-y-6 max-w-5xl">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Users</h1>
                <Button onClick={() => setShowCreate(true)}>Create User</Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                    <Label className="text-xs">Search</Label>
                    <Input
                        placeholder="Email or name…"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        className="w-52"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-xs">Role</Label>
                    <select
                        value={roleFilter}
                        onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    >
                        <option value="">All roles</option>
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                        <option value="superadmin">superadmin</option>
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label className="text-xs">Status</Label>
                    <select
                        value={blockedFilter}
                        onChange={(e) => { setBlockedFilter(e.target.value as "" | "true" | "false"); setPage(1); }}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    >
                        <option value="">All</option>
                        <option value="false">Active</option>
                        <option value="true">Blocked</option>
                    </select>
                </div>
            </div>

            {/* Table */}
            {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
            {error && <p className="text-destructive text-sm">{error}</p>}
            {!loading && result && (
                <>
                    <div className="rounded-md border border-border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-card text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2 text-left font-medium">Email</th>
                                    <th className="px-4 py-2 text-left font-medium">Name</th>
                                    <th className="px-4 py-2 text-left font-medium">Roles</th>
                                    <th className="px-4 py-2 text-left font-medium">Status</th>
                                    <th className="px-4 py-2 text-left font-medium">Verified</th>
                                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.users.map((u) => (
                                    <tr key={u.id} className="border-t border-border hover:bg-card/50 transition-colors">
                                        <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                                        <td className="px-4 py-2 text-muted-foreground">
                                            {[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex gap-1 flex-wrap">
                                                {u.roles.map((r) => (
                                                    <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            {u.isBlocked
                                                ? <Badge variant="destructive" className="text-xs">Blocked</Badge>
                                                : <Badge variant="outline" className="text-xs text-green-400 border-green-400">Active</Badge>
                                            }
                                        </td>
                                        <td className="px-4 py-2 text-muted-foreground text-xs">
                                            {u.emailVerified ? "✓" : "✗"}
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            <div className="flex gap-2 justify-end">
                                                <Button
                                                    variant={u.isBlocked ? "outline" : "destructive"}
                                                    size="sm"
                                                    onClick={() => toggleBlock(u)}
                                                >
                                                    {u.isBlocked ? "Unblock" : "Block"}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => router.push(`/admin/users/${u.id}`)}
                                                >
                                                    Detail
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {result.users.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                                            No users found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center gap-3 text-sm">
                            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
                                Previous
                            </Button>
                            <span className="text-muted-foreground">Page {page} / {totalPages}</span>
                            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                                Next
                            </Button>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">{result.total} total users</p>
                </>
            )}

            {/* Create User Dialog */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create User</DialogTitle>
                        <DialogDescription>
                            Creates an account bypassing the registration gate. The user will be able to log in immediately.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="cu-email">Email *</Label>
                            <Input
                                id="cu-email"
                                type="email"
                                value={createForm.email}
                                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="cu-password">Password *</Label>
                            <Input
                                id="cu-password"
                                type="password"
                                value={createForm.password}
                                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                            />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex flex-col gap-1 flex-1">
                                <Label htmlFor="cu-first">First name</Label>
                                <Input
                                    id="cu-first"
                                    value={createForm.firstName}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))}
                                />
                            </div>
                            <div className="flex flex-col gap-1 flex-1">
                                <Label htmlFor="cu-last">Last name</Label>
                                <Input
                                    id="cu-last"
                                    value={createForm.lastName}
                                    onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))}
                                />
                            </div>
                        </div>
                        {createError && <p className="text-destructive text-sm">{createError}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={creating || !createForm.email || !createForm.password}>
                            {creating ? "Creating…" : "Create"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
