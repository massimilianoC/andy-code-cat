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
        `/v1/projects/${projectId}/wysiwyg/sessions`,
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
        `/v1/projects/${projectId}/wysiwyg/sessions/${sessionId}/state`,
        input,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function commitWysiwygSession(
    token: string,
    projectId: string,
    sessionId: string,
    input?: {
        description?: string;
        /**
         * Optimistic concurrency precondition — the caller's belief about which snapshot
         * is currently active project-wide. undefined = no precondition, null = "I believe
         * none is active", "<id>" = "I believe this one is active". See
         * docs/specs/PREVIEW_SNAPSHOT_CONCURRENCY_GUARD_PLAN.md.
         */
        expectedActiveSnapshotId?: string | null;
    }
) {
    return call<{ snapshot: PreviewSnapshot; session: WysiwygEditSessionDto }>(
        "POST",
        `/v1/projects/${projectId}/wysiwyg/sessions/${sessionId}/commit`,
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
        `/v1/projects/${projectId}/wysiwyg/sessions/${sessionId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}
