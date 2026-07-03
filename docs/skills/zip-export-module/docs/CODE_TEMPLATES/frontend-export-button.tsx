/**
 * Portable "one-click ZIP export" button. React, but the state machine and
 * blob-download trick apply identically to any frontend framework.
 *
 * This file is illustrative, not literally importable — replace the
 * `yourApiClient` / `yourNotifications` / `useYourAuthToken` stand-ins with
 * whatever your project already has. Do NOT invent a new notification system
 * or API client layer just for this feature.
 */
import { useState } from "react";

// ---- Stand-ins — replace with your real implementations -------------------

declare function useYourAuthToken(): string | null;
declare function useYourNotifications(): {
    addNotification(opts: { label: string; status: "running"; message: string }): string;
    updateNotification(id: string, opts: { status: "done" | "error"; message: string }): void;
};

interface CreateExportResponse {
    id: string;
    downloadToken?: string;
    downloadUrl?: string;
}

async function yourApiClient_createExport(token: string, projectId: string): Promise<CreateExportResponse> {
    const res = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
    });
    if (!res.ok) throw new Error(`Export creation failed: ${res.status}`);
    return res.json();
}

/**
 * Fetch the ZIP as a Blob using the Bearer token — never navigate the browser
 * directly to a download URL, which would either require the token in the URL
 * (leaks into history/referrer/logs) or silently fail for an authenticated
 * endpoint. See docs/ARCHITECTURE.md § Step 6 for the full rationale.
 */
async function yourApiClient_downloadExportBlob(token: string, exportId: string): Promise<Blob> {
    const res = await fetch(`/api/exports/${exportId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.blob();
}

function isAuthExpiredError(err: unknown): boolean {
    return err instanceof Error && err.message.includes("401");
}

// ---------------------------------------------------------------------------
// The button
// ---------------------------------------------------------------------------

type ExportState = "idle" | "loading" | "error";

export function ExportZipButton({ projectId, hasOutput }: { projectId: string; hasOutput: boolean }) {
    const token = useYourAuthToken();
    const { addNotification, updateNotification } = useYourNotifications();
    const [exportState, setExportState] = useState<ExportState>("idle");
    const [exportError, setExportError] = useState<string | null>(null);

    async function handleExportZip() {
        if (!token) return;
        setExportState("loading");
        setExportError(null);
        const notifId = addNotification({ label: "Export", status: "running", message: "Preparing your export…" });

        try {
            // 1. Create the export record on the server (fast, synchronous for MVP).
            const created = await yourApiClient_createExport(token, projectId);

            // 2. Fetch the ZIP bytes as a Blob using the same auth header — this is
            //    the trick that avoids ever putting a bearer token in a URL.
            updateNotification(notifId, { status: "running" as never, message: "Downloading…" });
            const blob = await yourApiClient_downloadExportBlob(token, created.id);

            // 3. Trigger a browser-native download via a throwaway <a> + objectURL.
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = "export.zip";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl); // free the blob URL — don't leak memory

            setExportState("idle");
            updateNotification(notifId, { status: "done", message: "Export ready — check your downloads." });
        } catch (err) {
            if (isAuthExpiredError(err)) {
                // Surface the app's normal re-auth prompt instead of a generic export error.
                setExportState("idle");
                updateNotification(notifId, { status: "error", message: "Session expired — please sign in again." });
                return;
            }
            const msg = err instanceof Error ? err.message : "Export failed";
            setExportError(msg);
            setExportState("error");
            updateNotification(notifId, { status: "error", message: msg });
        }
    }

    if (!hasOutput) return null;

    return (
        <button
            type="button"
            disabled={exportState === "loading"}
            onClick={handleExportZip}
            title={exportState === "error" ? (exportError ?? "Export failed") : "Download as ZIP"}
        >
            {exportState === "loading" ? "⏳" : "⬇ ZIP"}
        </button>
    );
}
