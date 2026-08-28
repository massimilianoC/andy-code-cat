import type { WysiwygEditSessionDto } from "@andy-code-cat/contracts";
import { call } from "./call";
import type { PreviewSnapshot } from "./snapshots";

// The session shape is declared once, in packages/contracts/src/wysiwyg.ts.
export type { WysiwygEditSessionDto };

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
    input?: { description?: string; baseContentHash?: string }
) {
    return call<{ snapshot: PreviewSnapshot; session: WysiwygEditSessionDto; created: boolean }>(
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
