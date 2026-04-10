import { call, ApiError } from "./call";

export interface ProjectAssetDto {
    id: string;
    projectId: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    source: "user_upload" | "url_reference" | "platform_generated";
    label?: string;
    useInProject?: boolean;
    styleRole?: "mood" | "reference" | "palette" | "typography";
    descriptionText?: string;
    externalUrl?: string;
    createdAt: string;
}

export function listProjectAssets(token: string, projectId: string) {
    return call<{ assets: ProjectAssetDto[] }>(
        "GET",
        `/v1/projects/${projectId}/assets`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export async function uploadProjectAsset(
    token: string,
    projectId: string,
    file: File,
    meta?: { label?: string; useInProject?: boolean; styleRole?: string; descriptionText?: string }
): Promise<{ asset: ProjectAssetDto }> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const formData = new FormData();
    formData.append("file", file);
    if (meta?.label) formData.append("label", meta.label);
    if (meta?.useInProject !== undefined) formData.append("useInProject", String(meta.useInProject));
    if (meta?.styleRole) formData.append("styleRole", meta.styleRole);
    if (meta?.descriptionText) formData.append("descriptionText", meta.descriptionText);

    const res = await fetch(`${baseUrl}/v1/projects/${projectId}/assets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-project-id": projectId },
        body: formData,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json);
    return json as { asset: ProjectAssetDto };
}

export function addUrlReference(
    token: string,
    projectId: string,
    data: { url: string; label?: string; useInProject?: boolean; styleRole?: string; descriptionText?: string }
) {
    return call<{ asset: ProjectAssetDto }>(
        "POST",
        `/v1/projects/${projectId}/assets/url`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function updateProjectAsset(
    token: string,
    projectId: string,
    assetId: string,
    data: { label?: string; useInProject?: boolean; styleRole?: string; descriptionText?: string }
) {
    return call<{ asset: ProjectAssetDto }>(
        "PATCH",
        `/v1/projects/${projectId}/assets/${assetId}`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function deleteProjectAsset(token: string, projectId: string, assetId: string) {
    return call<void>(
        "DELETE",
        `/v1/projects/${projectId}/assets/${assetId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

/** Returns the download URL for an asset (use with fetch + Authorization header). */
export function getAssetDownloadUrl(projectId: string, assetId: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    return `${baseUrl}/v1/projects/${projectId}/assets/${assetId}/download`;
}
