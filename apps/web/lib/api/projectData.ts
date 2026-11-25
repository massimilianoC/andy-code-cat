/**
 * Owner's project data panel (docs/specs/PROJECT_DATA_PANEL.md): every record a platform
 * capability stored for a project. Every call carries x-project-id; the API also requires the
 * path to name the same project.
 */
import type { ProjectDataRecordPageDto, ProjectDataSummaryDto } from "@andy-code-cat/contracts";
import { ApiError, call, getValidAccessToken, refreshAccessToken } from "./call";

export type ProjectDataExportFormat = "json" | "csv";

const headers = (token: string, projectId: string) => ({ Authorization: `Bearer ${token}`, "x-project-id": projectId });
const basePath = (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}/data`;
const capabilityPath = (projectId: string, capabilityId: string) => `${basePath(projectId)}/${encodeURIComponent(capabilityId)}`;

function queryString(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
}

export function getProjectDataSummary(token: string, projectId: string) {
    return call<ProjectDataSummaryDto>("GET", basePath(projectId), undefined, headers(token, projectId));
}

export function listProjectDataRecords(
    token: string,
    projectId: string,
    capabilityId: string,
    query: { groupId?: string; page?: number; limit?: number; search?: string } = {},
) {
    return call<ProjectDataRecordPageDto>(
        "GET",
        `${capabilityPath(projectId, capabilityId)}/records${queryString(query)}`,
        undefined,
        headers(token, projectId),
    );
}

export function deleteProjectDataRecord(token: string, projectId: string, capabilityId: string, recordId: string) {
    return call<void>(
        "DELETE",
        `${capabilityPath(projectId, capabilityId)}/records/${encodeURIComponent(recordId)}`,
        undefined,
        headers(token, projectId),
    );
}

/** `confirm` must be the capability id, typed by the owner. */
export function clearProjectData(token: string, projectId: string, capabilityId: string, input: { groupId?: string; confirm: string }) {
    return call<{ removed: number }>(
        "POST",
        `${capabilityPath(projectId, capabilityId)}/clear`,
        input.groupId ? { groupId: input.groupId, confirm: input.confirm } : { confirm: input.confirm },
        headers(token, projectId),
    );
}

function getApiBaseUrl(): string {
    return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

function fallbackFilename(capabilityId: string, groupId: string | undefined, format: ProjectDataExportFormat): string {
    const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, "_");
    const day = new Date().toISOString().slice(0, 10);
    return ["project-data", safe(capabilityId), ...(groupId ? [safe(groupId)] : []), day].join("-") + `.${format}`;
}

function filenameFrom(disposition: string | null): string | null {
    const match = disposition?.match(/filename="([A-Za-z0-9._-]+)"/);
    return match ? match[1] : null;
}

/**
 * Downloads an export through an authenticated fetch (a plain link cannot carry the bearer token)
 * and hands the browser a Blob to save.
 */
export async function downloadProjectDataExport(
    projectId: string,
    capabilityId: string,
    options: { format: ProjectDataExportFormat; groupId?: string },
): Promise<void> {
    const url = `${getApiBaseUrl()}${capabilityPath(projectId, capabilityId)}/export${queryString({ format: options.format, groupId: options.groupId })}`;
    const fetchExport = (accessToken: string) => fetch(url, { headers: headers(accessToken, projectId), cache: "no-store" });

    let res = await fetchExport(await getValidAccessToken());
    if (res.status === 401) {
        res = await fetchExport(await refreshAccessToken());
    }
    if (!res.ok) {
        throw new ApiError(res.status, await res.text().catch(() => ""));
    }

    const blob = await res.blob();
    const filename = filenameFrom(res.headers.get("content-disposition")) ?? fallbackFilename(capabilityId, options.groupId, options.format);
    const objectUrl = URL.createObjectURL(blob);
    try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        // Give the browser a moment to start the download before the URL is released.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    }
}
