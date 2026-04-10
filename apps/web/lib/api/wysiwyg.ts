import { call } from "./call";
import type { PreviewSnapshot } from "./snapshots";

export interface WysiwygEditSessionDto {
    id: string;
    projectId: string;
    userId: string;
    conversationId: string;
    originSnapshotId: string;
    currentHtml: string;
    currentCss: string;
    currentJs: string;
    committedSnapshotId?: string;
    operationCount: number;
    status: "active" | "committed";
    createdAt: string;
    updatedAt: string;
}

export function createWysiwygEditSession(
    token: string,
    projectId: string,
    input: {
        conversationId: string;
        originSnapshotId: string;
        currentHtml: string;
        currentCss: string;
        currentJs: string;
    }
) {
    return call<{ session: WysiwygEditSessionDto; resumed: boolean }>(
        "POST",
        `/projects/${projectId}/wysiwyg/sessions`,
        input,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function saveWysiwygEditState(
    token: string,
    projectId: string,
    sessionId: string,
    input: { html: string; css: string; js: string }
) {
    return call<{ session: WysiwygEditSessionDto }>(
        "PATCH",
        `/projects/${projectId}/wysiwyg/sessions/${sessionId}/state`,
        input,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function commitWysiwygSession(
    token: string,
    projectId: string,
    sessionId: string,
    input?: { description?: string }
) {
    return call<{ snapshot: PreviewSnapshot; session: WysiwygEditSessionDto }>(
        "POST",
        `/projects/${projectId}/wysiwyg/sessions/${sessionId}/commit`,
        input ?? {},
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function getWysiwygEditSession(
    token: string,
    projectId: string,
    sessionId: string
) {
    return call<{ session: WysiwygEditSessionDto }>(
        "GET",
        `/projects/${projectId}/wysiwyg/sessions/${sessionId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}
