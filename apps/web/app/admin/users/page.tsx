"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    listAdminUsers,
    getAdminUser,
    adminBlockUser,
    adminCreateUser,
    adminDeleteUser,
    adminResetUserPassword,
    adminSetUserLimits,
    adminSetUserPasswordResetRequired,
    adminSetUserRoles,
    adminUpdateUserProfile,
    type AdminUserDto,
    type AdminUserDetailDto,
    type ListUsersResult,
    type UserLimitsDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

const PAGE_SIZE = 20;

type ConfirmAction =
    | "block-toggle"
    | "save-profile"
    | "save-roles"
    | "save-limits"
    | "reset-password"
    | "toggle-password-reset"
    | "delete-user";

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
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [selectedUser, setSelectedUser] = useState<AdminUserDetailDto | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [profileForm, setProfileForm] = useState({ email: "", firstName: "", lastName: "", emailVerified: false });
    const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
    const [limitsForm, setLimitsForm] = useState<Partial<UserLimitsDto>>({});
    const [passwordResetForm, setPasswordResetForm] = useState({ newPassword: "", requireChangeOnNextLogin: true });
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

    async function fetchUsers() {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }
        setLoading(true);
        setError(null);
        try {
            const next = await listAdminUsers(token, {
                page,
                limit: PAGE_SIZE,
                search: search || undefined,
                role: roleFilter || undefined,
                isBlocked: blockedFilter === "" ? undefined : blockedFilter === "true",
            });
            setResult(next);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void fetchUsers();
    }, [page, search, roleFilter, blockedFilter, router]);

    async function loadUserDetail(userId: string) {
        const token = getToken();
        if (!token) {
            router.replace("/login");
            return;
        }

        setSelectedUserId(userId);
        setDetailLoading(true);
        setDetailError(null);
        setActionMessage(null);

        try {
            const detail = await getAdminUser(token, userId);
            setSelectedUser(detail);
            setProfileForm({
                email: detail.email,
                firstName: detail.firstName ?? "",
                lastName: detail.lastName ?? "",
                emailVerified: detail.emailVerified,
            });
            setSelectedRoles(detail.roles);
            setLimitsForm(detail.limits ?? {});
            setPasswordResetForm({ newPassword: "", requireChangeOnNextLogin: true });
        } catch (e: unknown) {
            setDetailError(e instanceof Error ? e.message : "Failed to load user detail");
        } finally {
            setDetailLoading(false);
        }
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

    function closeSidebar() {
        setSelectedUserId(null);
        setSelectedUser(null);
        setDetailError(null);
        setActionMessage(null);
        setConfirmAction(null);
    }

    function toggleRole(role: string) {
        setSelectedRoles((prev) =>
            prev.includes(role) ? prev.filter((item) => item !== role) : [...prev, role]
        );
    }

    function getConfirmCopy(action: ConfirmAction): { title: string; description: string } {
        if (!selectedUser) {
            return { title: "Confirm action", description: "Proceed with this operation?" };
        }

        switch (action) {
            case "block-toggle":
                return {
                    title: selectedUser.isBlocked ? "Unblock user" : "Block user",
                    description: selectedUser.isBlocked
                        ? `Restore access for ${selectedUser.email} and published sites owned by this user.`
                        : `Suspend ${selectedUser.email}, invalidate sessions, and block access to published sites owned by this user.`,
                };
            case "save-profile":
                return {
                    title: "Save profile changes",
                    description: `Apply email/name changes for ${selectedUser.email}. If the email changes, verification is reset unless you keep it explicitly enabled.`,
                };
            case "save-roles":
                return {
                    title: "Save roles",
                    description: `Update platform roles for ${selectedUser.email}.`,
                };
            case "save-limits":
                return {
                    title: "Save limits",
                    description: `Apply plan and quota overrides for ${selectedUser.email}. Use -1 for unlimited values.`,
                };
            case "reset-password":
                return {
                    title: "Reset password",
                    description: `Set a new password for ${selectedUser.email}. Existing sessions will be invalidated immediately.`,
                };
            case "toggle-password-reset":
                return {
                    title: selectedUser.requiresPasswordChange ? "Clear password reset requirement" : "Force password reset",
                    description: selectedUser.requiresPasswordChange
                        ? `Remove the forced password change requirement for ${selectedUser.email}.`
                        : `Require ${selectedUser.email} to change password at the next login.`,
                };
            case "delete-user":
                return {
                    title: "Delete user",
                    description: `Permanently delete ${selectedUser.email}. Projects and related data remain in the database as orphaned records.`,
                };
        }
    }

    async function executeConfirmedAction() {
        if (!confirmAction || !selectedUser) {
            return;
        }

        const token = getToken();
        if (!token) {
            router.replace("/login");
            return;
        }

        setActionLoading(true);
        setDetailError(null);
        setActionMessage(null);

        try {
            switch (confirmAction) {
                case "block-toggle":
                    await adminBlockUser(token, selectedUser.id, !selectedUser.isBlocked);
                    setActionMessage(selectedUser.isBlocked ? "User restored." : "User blocked and sessions invalidated.");
                    break;
                case "save-profile":
                    await adminUpdateUserProfile(token, selectedUser.id, {
                        email: profileForm.email.trim(),
                        firstName: profileForm.firstName.trim() || null,
                        lastName: profileForm.lastName.trim() || null,
                        emailVerified: profileForm.emailVerified,
                    });
                    setActionMessage("Profile updated.");
                    break;
                case "save-roles":
                    await adminSetUserRoles(token, selectedUser.id, selectedRoles);
                    setActionMessage("Roles updated.");
                    break;
                case "save-limits":
                    await adminSetUserLimits(token, selectedUser.id, limitsForm);
                    setActionMessage("Limits updated.");
                    break;
                case "reset-password":
                    await adminResetUserPassword(token, selectedUser.id, {
                        newPassword: passwordResetForm.newPassword,
                        requireChangeOnNextLogin: passwordResetForm.requireChangeOnNextLogin,
                    });
                    setPasswordResetForm({ newPassword: "", requireChangeOnNextLogin: true });
                    setActionMessage("Password reset completed. Existing sessions were invalidated.");
                    break;
                case "toggle-password-reset":
                    await adminSetUserPasswordResetRequired(token, selectedUser.id, !selectedUser.requiresPasswordChange);
                    setActionMessage(selectedUser.requiresPasswordChange ? "Forced reset removed." : "Password reset enforced for next login.");
                    break;
                case "delete-user":
                    await adminDeleteUser(token, selectedUser.id);
                    closeSidebar();
                    await fetchUsers();
                    return;
            }

            await fetchUsers();
            await loadUserDetail(selectedUser.id);
        } catch (e: unknown) {
            setDetailError(e instanceof Error ? e.message : "Action failed");
        } finally {
            setConfirmAction(null);
            setActionLoading(false);
        }
    }

    const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 1;
    const confirmCopy = confirmAction ? getConfirmCopy(confirmAction) : null;

    return (
        <div className={cn("relative space-y-6", selectedUserId && "xl:pr-[30rem]")}>
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
                                    <tr
                                        key={u.id}
                                        className={`border-t border-border transition-colors cursor-pointer ${selectedUserId === u.id ? "bg-card" : "hover:bg-card/50"}`}
                                        onClick={() => loadUserDetail(u.id)}
                                    >
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
                                                    onClick={async (event) => {
                                                        event.stopPropagation();
                                                        await loadUserDetail(u.id);
                                                        setConfirmAction("block-toggle");
                                                    }}
                                                >
                                                    {u.isBlocked ? "Unblock" : "Block"}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        loadUserDetail(u.id);
                                                    }}
                                                >
                                                    Open
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

            {selectedUserId && (
                <>
                    <div className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm xl:hidden" onClick={closeSidebar} />
                    <aside className="fixed right-0 top-0 z-40 h-full w-full max-w-2xl border-l border-border bg-background shadow-2xl xl:w-[28rem]">
                        <div className="flex h-full flex-col">
                            <div className="flex items-center justify-between border-b border-border px-5 py-4">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">User configuration</p>
                                    <h2 className="text-lg font-semibold">{selectedUser?.email ?? "Loading…"}</h2>
                                </div>
                                <Button variant="ghost" size="sm" onClick={closeSidebar}>Close</Button>
                            </div>

                            <ScrollArea className="flex-1">
                                <div className="space-y-4 p-5">
                                    {detailLoading && <p className="text-sm text-muted-foreground">Loading user detail…</p>}
                                    {detailError && <p className="text-sm text-destructive">{detailError}</p>}
                                    {actionMessage && <p className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">{actionMessage}</p>}

                                    {selectedUser && !detailLoading && (
                                        <>
                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base">Status</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-3 text-sm">
                                                    <div className="flex flex-wrap gap-2">
                                                        <Badge variant={selectedUser.isBlocked ? "destructive" : "outline"}>
                                                            {selectedUser.isBlocked ? "Blocked" : "Active"}
                                                        </Badge>
                                                        <Badge variant={selectedUser.emailVerified ? "outline" : "secondary"}>
                                                            {selectedUser.emailVerified ? "Verified" : "Unverified"}
                                                        </Badge>
                                                        <Badge variant={selectedUser.requiresPasswordChange ? "accent" : "secondary"}>
                                                            {selectedUser.requiresPasswordChange ? "Password reset required" : "Password policy aligned"}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">Created {new Date(selectedUser.createdAt).toLocaleString()}</p>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <Button
                                                            variant={selectedUser.isBlocked ? "outline" : "destructive"}
                                                            size="sm"
                                                            onClick={() => setConfirmAction("block-toggle")}
                                                            disabled={actionLoading}
                                                        >
                                                            {selectedUser.isBlocked ? "Unblock user" : "Block user"}
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => setConfirmAction("toggle-password-reset")}
                                                            disabled={actionLoading}
                                                        >
                                                            {selectedUser.requiresPasswordChange ? "Clear reset flag" : "Force reset next login"}
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>

                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base">Usage</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-1 text-sm">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-muted-foreground">Lifetime tokens consumed</span>
                                                        <span className="font-mono font-medium">{(selectedUser.tokensConsumedLifetime ?? 0).toLocaleString()}</span>
                                                    </div>
                                                </CardContent>
                                            </Card>

                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base">Profile</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-3">
                                                    <div className="space-y-1">
                                                        <Label htmlFor="au-email">Email</Label>
                                                        <Input id="au-email" type="email" value={profileForm.email} onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))} />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="space-y-1">
                                                            <Label htmlFor="au-first">First name</Label>
                                                            <Input id="au-first" value={profileForm.firstName} onChange={(e) => setProfileForm((f) => ({ ...f, firstName: e.target.value }))} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label htmlFor="au-last">Last name</Label>
                                                            <Input id="au-last" value={profileForm.lastName} onChange={(e) => setProfileForm((f) => ({ ...f, lastName: e.target.value }))} />
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                                                        <div>
                                                            <p className="font-medium">Email verified</p>
                                                            <p className="text-xs text-muted-foreground">If the email changes, leaving this on keeps the account verified.</p>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant={profileForm.emailVerified ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => setProfileForm((f) => ({ ...f, emailVerified: !f.emailVerified }))}
                                                        >
                                                            {profileForm.emailVerified ? "Verified" : "Not verified"}
                                                        </Button>
                                                    </div>
                                                    <Button size="sm" onClick={() => setConfirmAction("save-profile")} disabled={actionLoading || !profileForm.email.trim()}>
                                                        Save profile
                                                    </Button>
                                                </CardContent>
                                            </Card>

                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base">Roles</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-3">
                                                    <div className="flex flex-wrap gap-2">
                                                        {["user", "admin", "superadmin"].map((role) => (
                                                            <Button
                                                                key={role}
                                                                type="button"
                                                                variant={selectedRoles.includes(role) ? "default" : "outline"}
                                                                size="sm"
                                                                onClick={() => toggleRole(role)}
                                                            >
                                                                {role}
                                                            </Button>
                                                        ))}
                                                    </div>
                                                    <Button size="sm" onClick={() => setConfirmAction("save-roles")} disabled={actionLoading || selectedRoles.length === 0}>
                                                        Save roles
                                                    </Button>
                                                </CardContent>
                                            </Card>

                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base">Limits</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-3">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="space-y-1">
                                                            <Label htmlFor="lu-plan">Plan</Label>
                                                            <Input id="lu-plan" value={limitsForm.plan ?? ""} onChange={(e) => setLimitsForm((f) => ({ ...f, plan: e.target.value }))} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label htmlFor="lu-projects">Max projects</Label>
                                                            <Input id="lu-projects" type="number" value={limitsForm.maxProjects ?? ""} onChange={(e) => setLimitsForm((f) => ({ ...f, maxProjects: Number(e.target.value) }))} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label htmlFor="lu-tokens">Max tokens/month (K)</Label>
                                                            <Input id="lu-tokens" type="number" value={limitsForm.maxMonthlyTokensK ?? ""} onChange={(e) => setLimitsForm((f) => ({ ...f, maxMonthlyTokensK: Number(e.target.value) }))} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label htmlFor="lu-storage">Max storage (MB)</Label>
                                                            <Input id="lu-storage" type="number" value={limitsForm.maxStorageMb ?? ""} onChange={(e) => setLimitsForm((f) => ({ ...f, maxStorageMb: Number(e.target.value) }))} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label htmlFor="lu-sites">Max published sites</Label>
                                                            <Input id="lu-sites" type="number" value={limitsForm.maxPublishedSites ?? ""} onChange={(e) => setLimitsForm((f) => ({ ...f, maxPublishedSites: Number(e.target.value) }))} />
                                                        </div>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">Use -1 for unlimited values.</p>
                                                    <Button size="sm" onClick={() => setConfirmAction("save-limits")} disabled={actionLoading}>
                                                        Save limits
                                                    </Button>
                                                </CardContent>
                                            </Card>

                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base">Password controls</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-3">
                                                    <div className="space-y-1">
                                                        <Label htmlFor="pw-reset">Temporary password</Label>
                                                        <Input id="pw-reset" type="password" value={passwordResetForm.newPassword} onChange={(e) => setPasswordResetForm((f) => ({ ...f, newPassword: e.target.value }))} />
                                                    </div>
                                                    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                                                        <div>
                                                            <p className="font-medium">Force change on next login</p>
                                                            <p className="text-xs text-muted-foreground">The user will log in with the temporary password and be required to replace it.</p>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant={passwordResetForm.requireChangeOnNextLogin ? "default" : "outline"}
                                                            size="sm"
                                                            onClick={() => setPasswordResetForm((f) => ({ ...f, requireChangeOnNextLogin: !f.requireChangeOnNextLogin }))}
                                                        >
                                                            {passwordResetForm.requireChangeOnNextLogin ? "Required" : "Optional"}
                                                        </Button>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        onClick={() => setConfirmAction("reset-password")}
                                                        disabled={actionLoading || passwordResetForm.newPassword.length < 8}
                                                    >
                                                        Reset password
                                                    </Button>
                                                </CardContent>
                                            </Card>

                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base">Projects</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-2 text-sm">
                                                    {selectedUser.projects.length === 0 && <p className="text-muted-foreground">No projects.</p>}
                                                    {selectedUser.projects.map((project) => (
                                                        <div key={project.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                                                            <div>
                                                                <p className="font-medium">{project.name}</p>
                                                                <p className="text-xs text-muted-foreground">Created {new Date(project.createdAt).toLocaleDateString()}</p>
                                                            </div>
                                                            <Badge variant="secondary">{project.presetId ?? "custom"}</Badge>
                                                        </div>
                                                    ))}
                                                    <p className="text-xs text-muted-foreground">Admin project CRUD and per-project suspension are not wired yet in the backend.</p>
                                                </CardContent>
                                            </Card>

                                            <Card className="border-destructive/40">
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
                                                </CardHeader>
                                                <CardContent>
                                                    <Button variant="destructive" size="sm" onClick={() => setConfirmAction("delete-user")} disabled={actionLoading}>
                                                        Delete user
                                                    </Button>
                                                </CardContent>
                                            </Card>
                                        </>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    </aside>
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

            <Dialog open={confirmAction !== null} onOpenChange={(open) => { if (!open && !actionLoading) setConfirmAction(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{confirmCopy?.title ?? "Confirm action"}</DialogTitle>
                        <DialogDescription>{confirmCopy?.description ?? "Proceed with this operation?"}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={actionLoading}>Cancel</Button>
                        <Button onClick={executeConfirmedAction} disabled={actionLoading} variant={confirmAction === "delete-user" || confirmAction === "block-toggle" ? "destructive" : "default"}>
                            {actionLoading ? "Applying…" : "Confirm"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
