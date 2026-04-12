/**
 * Super Admin API client.
 * All functions require the caller to hold the "superadmin" role.
 * The bearer token is injected automatically by the `call` helper.
 */
import { call } from "./call";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserLimitsDto {
    maxProjects: number;
    maxMonthlyTokensK: number;
    maxStorageMb: number;
    maxPublishedSites: number;
    plan: string;
    planExpiresAt?: string;
}

export interface AdminUserDto {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: string[];
    limits?: UserLimitsDto;
    createdAt: string;
}

export interface AdminUserDetailDto extends AdminUserDto {
    projects: { id: string; name: string; presetId?: string; createdAt: string }[];
}

export interface PlatformStatsDto {
    totalUsers: number;
    blockedUsers: number;
    totalLiveDeployments: number;
    usersByRole: Record<string, number>;
}

export interface PlatformConfigDto {
    registrationOpen: boolean;
    emailVerificationRequired: boolean;
    defaultUserLimits: UserLimitsDto;
    updatedAt: string;
    updatedByUserId?: string;
}

export interface AdminDeploymentDto {
    id: string;
    publishId: string;
    customSlug?: string;
    projectId: string;
    userId: string;
    status: string;
    url: string;
    isAdminBlocked: boolean;
    adminBlockedAt?: string;
    createdAt: string;
    updatedAt: string;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

export function getAdminStats(token: string): Promise<PlatformStatsDto> {
    return call<PlatformStatsDto>("GET", "/v1/admin/stats", undefined, auth(token));
}

// ── Platform config ───────────────────────────────────────────────────────────

export function getAdminConfig(token: string): Promise<PlatformConfigDto> {
    return call<PlatformConfigDto>("GET", "/v1/admin/config", undefined, auth(token));
}

export function updateAdminConfig(
    token: string,
    body: Partial<{ registrationOpen: boolean; emailVerificationRequired: boolean; defaultUserLimits: Partial<UserLimitsDto> }>
): Promise<PlatformConfigDto> {
    return call<PlatformConfigDto>("PATCH", "/v1/admin/config", body, auth(token));
}

// ── User management ───────────────────────────────────────────────────────────

export interface ListUsersParams {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isBlocked?: boolean;
}

export interface ListUsersResult {
    users: AdminUserDto[];
    total: number;
    page: number;
    limit: number;
}

export function listAdminUsers(token: string, params?: ListUsersParams): Promise<ListUsersResult> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.search) qs.set("search", params.search);
    if (params?.role) qs.set("role", params.role);
    if (params?.isBlocked !== undefined) qs.set("isBlocked", String(params.isBlocked));
    const query = qs.toString();
    return call<ListUsersResult>("GET", `/v1/admin/users${query ? `?${query}` : ""}`, undefined, auth(token));
}

export function getAdminUser(token: string, userId: string): Promise<AdminUserDetailDto> {
    return call<AdminUserDetailDto>("GET", `/v1/admin/users/${userId}`, undefined, auth(token));
}

export interface AdminCreateUserBody {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    roles?: string[];
    emailVerified?: boolean;
}

export function adminCreateUser(token: string, body: AdminCreateUserBody): Promise<AdminUserDto> {
    return call<AdminUserDto>("POST", "/v1/admin/users", body, auth(token));
}

export function adminBlockUser(token: string, userId: string, blocked: boolean): Promise<{ userId: string; isBlocked: boolean }> {
    return call("PATCH", `/v1/admin/users/${userId}/block`, { blocked }, auth(token));
}

export function adminSetUserRoles(token: string, userId: string, roles: string[]): Promise<{ userId: string; roles: string[] }> {
    return call("PATCH", `/v1/admin/users/${userId}/roles`, { roles }, auth(token));
}

export function adminSetUserLimits(token: string, userId: string, limits: Partial<UserLimitsDto>): Promise<{ userId: string; limits: UserLimitsDto }> {
    return call("PATCH", `/v1/admin/users/${userId}/limits`, limits, auth(token));
}

export function adminDeleteUser(token: string, userId: string): Promise<{ deleted: boolean; userId: string }> {
    return call("DELETE", `/v1/admin/users/${userId}`, undefined, auth(token));
}

// ── Deployments ───────────────────────────────────────────────────────────────

export interface ListDeploymentsResult {
    deployments: AdminDeploymentDto[];
    total: number;
    page: number;
    limit: number;
}

export function listAdminDeployments(token: string, params?: { page?: number; limit?: number }): Promise<ListDeploymentsResult> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    return call<ListDeploymentsResult>("GET", `/v1/admin/deployments${qs.toString() ? `?${qs}` : ""}`, undefined, auth(token));
}

export function adminBlockDeployment(token: string, publishId: string, blocked: boolean): Promise<{ publishId: string; isAdminBlocked: boolean }> {
    return call("PATCH", `/v1/admin/deployments/${publishId}/block`, { blocked }, auth(token));
}
