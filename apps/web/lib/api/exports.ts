import { call, ApiError } from "./call";

export interface ExportRecordDto {
    id: string;
    projectId: string;
    status: "pending" | "processing" | "ready" | "failed" | "expired";
    sourceType: string;
    snapshotId?: string;
    filesIncluded: string[];
    downloadUrl?: string;
    fileSha256?: string;
    errorMessage?: string;
    expiresAt?: string;
    createdAt: string;
    completedAt?: string;
}

export function requestLayer1Export(token: string, projectId: string, snapshotId?: string) {
    return call<ExportRecordDto & { downloadToken?: string; downloadUrl?: string }>(
        "POST",
        `/v1/projects/${projectId}/export/layer1`,
        snapshotId ? { snapshotId } : {},
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

/**
 * Download the export ZIP as a Blob using the Bearer token (no JWT-in-URL).
 * Throws ApiError(401) if the session is expired.
 */
export async function downloadExportBlob(token: string, exportId: string): Promise<Blob> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const res = await fetch(`${baseUrl}/v1/exports/${exportId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        let body: unknown = {};
        try { body = await res.json(); } catch { /* ignore */ }
        throw new ApiError(res.status, body);
    }
    return res.blob();
}

/**
 * Capture a preview snapshot as JPEG or PDF via Puppeteer server-side rendering.
 */
export async function downloadSnapshotCapture(
    token: string,
    projectId: string,
    snapshotId: string,
    format: "jpg" | "pdf"
): Promise<Blob> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const res = await fetch(
        `${baseUrl}/v1/projects/${projectId}/preview-snapshots/${snapshotId}/capture?format=${format}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "x-project-id": projectId,
            },
        }
    );
    if (!res.ok) {
        let body: unknown = {};
        try { body = await res.json(); } catch { /* ignore */ }
        throw new ApiError(res.status, body);
    }
    return res.blob();
}
