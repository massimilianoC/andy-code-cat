import type {
    CreatePreviewSnapshotRequest,
    PreviewSnapshotDto,
} from "@andy-code-cat/contracts";
import { call } from "./call";

// The shape of an artifact version lives in packages/contracts/src/preview.ts and nowhere
// else. This module used to restate it twice — once for the response, once for the request
// body — and both copies had drifted from the schema the server actually validates against
// (promptingTrace.promptConfigId was declared and sent here but silently stripped on write).
// Import the contract; do not re-describe it.

export type PreviewSnapshot = PreviewSnapshotDto;

export type CreatePreviewSnapshotBody = CreatePreviewSnapshotRequest;

export function listPreviewSnapshots(token: string, projectId: string, conversationId?: string) {
    const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
    return call<{ snapshots: PreviewSnapshot[]; activeSnapshotId?: string }>(
        "GET",
        `/v1/projects/${projectId}/preview-snapshots${qs}`,
        undefined,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        }
    );
}

export function createPreviewSnapshot(
    token: string,
    projectId: string,
    input: CreatePreviewSnapshotBody
) {
    // AL-045 — `created` is false when the write was byte-identical to its base: the server
    // returns the base rather than adding a duplicate version, so the caller must be able to
    // tell "here is the version you made" from "here is the version you are already on".
    return call<{ snapshot: PreviewSnapshot; created: boolean }>(
        "POST",
        `/v1/projects/${projectId}/preview-snapshots`,
        input,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        }
    );
}

export function activatePreviewSnapshot(
    token: string,
    projectId: string,
    snapshotId: string,
    conversationId?: string
) {
    return call<{ snapshot: PreviewSnapshot }>(
        "POST",
        `/v1/projects/${projectId}/preview-snapshots/${snapshotId}/activate`,
        conversationId ? { conversationId } : {},
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        }
    );
}

export function deletePreviewSnapshot(
    token: string,
    projectId: string,
    snapshotId: string
) {
    return call<void>(
        "DELETE",
        `/v1/projects/${projectId}/preview-snapshots/${snapshotId}`,
        undefined,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        }
    );
}
