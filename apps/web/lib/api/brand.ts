/**
 * Brand Identity API client — platform, user, and project scopes.
 */
import { call, ApiError } from "./call";
import type { BrandAssetDto } from "@andy-code-cat/contracts";
export type { BrandAssetDto };

interface BrandAssetListResponse { assets: BrandAssetDto[]; }
interface BrandAssetResponse { asset: BrandAssetDto; }

export interface CreateBrandTextBody {
    role: string;
    policy: string;
    valueType: "text" | "color_list" | "url";
    textValue: string;
    customRoleLabel?: string;
    description?: string;
    isActive?: boolean;
    priority?: number;
}

export interface UpdateBrandBody {
    role?: string;
    policy?: string;
    textValue?: string;
    description?: string;
    isActive?: boolean;
    priority?: number;
}

function baseUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

async function uploadFile(
    url: string,
    token: string,
    file: File,
    meta: { role: string; policy: string; description?: string },
    extraHeaders?: Record<string, string>,
): Promise<BrandAssetDto> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("role", meta.role);
    formData.append("policy", meta.policy);
    if (meta.description) formData.append("description", meta.description);
    const res = await fetch(`${baseUrl()}${url}`, {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
        body: formData,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json);
    return (json as BrandAssetResponse).asset;
}

// ── Platform (Super Admin) ───────────────────────────────────────────────────

export async function listAdminBrandAssets(token: string): Promise<BrandAssetDto[]> {
    const data = await call<BrandAssetListResponse>("GET", "/v1/admin/brand-assets", undefined, { Authorization: `Bearer ${token}` });
    return data.assets;
}

export async function createAdminBrandAssetText(token: string, body: CreateBrandTextBody): Promise<BrandAssetDto> {
    const data = await call<BrandAssetResponse>("POST", "/v1/admin/brand-assets", body, { Authorization: `Bearer ${token}` });
    return data.asset;
}

export async function uploadAdminBrandAssetFile(
    token: string,
    file: File,
    meta: { role: string; policy: string; description?: string },
): Promise<BrandAssetDto> {
    return uploadFile("/v1/admin/brand-assets/upload", token, file, meta);
}

export async function updateAdminBrandAsset(token: string, id: string, patch: UpdateBrandBody): Promise<BrandAssetDto> {
    const data = await call<BrandAssetResponse>("PATCH", `/v1/admin/brand-assets/${id}`, patch, { Authorization: `Bearer ${token}` });
    return data.asset;
}

export async function deleteAdminBrandAsset(token: string, id: string): Promise<void> {
    await call("DELETE", `/v1/admin/brand-assets/${id}`, undefined, { Authorization: `Bearer ${token}` });
}

// ── User ─────────────────────────────────────────────────────────────────────

export async function listUserBrandAssets(token: string): Promise<BrandAssetDto[]> {
    const data = await call<BrandAssetListResponse>("GET", "/v1/users/me/brand-assets", undefined, { Authorization: `Bearer ${token}` });
    return data.assets;
}

export async function createUserBrandAssetText(token: string, body: CreateBrandTextBody): Promise<BrandAssetDto> {
    const data = await call<BrandAssetResponse>("POST", "/v1/users/me/brand-assets", body, { Authorization: `Bearer ${token}` });
    return data.asset;
}

export async function uploadUserBrandAssetFile(
    token: string,
    file: File,
    meta: { role: string; policy: string; description?: string },
): Promise<BrandAssetDto> {
    return uploadFile("/v1/users/me/brand-assets/upload", token, file, meta);
}

export async function updateUserBrandAsset(token: string, id: string, patch: UpdateBrandBody): Promise<BrandAssetDto> {
    const data = await call<BrandAssetResponse>("PATCH", `/v1/users/me/brand-assets/${id}`, patch, { Authorization: `Bearer ${token}` });
    return data.asset;
}

export async function deleteUserBrandAsset(token: string, id: string): Promise<void> {
    await call("DELETE", `/v1/users/me/brand-assets/${id}`, undefined, { Authorization: `Bearer ${token}` });
}

// ── Project ──────────────────────────────────────────────────────────────────

export async function listProjectBrandAssets(token: string, projectId: string): Promise<BrandAssetDto[]> {
    const data = await call<BrandAssetListResponse>(
        "GET", `/v1/projects/${projectId}/brand-assets`, undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
    return data.assets;
}

export async function createProjectBrandAssetText(token: string, projectId: string, body: CreateBrandTextBody): Promise<BrandAssetDto> {
    const data = await call<BrandAssetResponse>(
        "POST", `/v1/projects/${projectId}/brand-assets`, body,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
    return data.asset;
}

export async function updateProjectBrandAsset(token: string, projectId: string, id: string, patch: UpdateBrandBody): Promise<BrandAssetDto> {
    const data = await call<BrandAssetResponse>(
        "PATCH", `/v1/projects/${projectId}/brand-assets/${id}`, patch,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
    return data.asset;
}

export async function deleteProjectBrandAsset(token: string, projectId: string, id: string): Promise<void> {
    await call(
        "DELETE", `/v1/projects/${projectId}/brand-assets/${id}`, undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}
