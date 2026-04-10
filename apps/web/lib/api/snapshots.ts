import { call } from "./call";
import type { LlmFocusContext } from "./llm";

export interface PreviewSnapshot {
    id: string;
    projectId: string;
    conversationId: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    isActive: boolean;
    artifacts: {
        html: string;
        css: string;
        js: string;
    };
    focusContext?: LlmFocusContext;
    metadata?: {
        model?: string;
        provider?: string;
        durationMs?: number;
        finishReason?: string;
        structuredParseValid?: boolean;
        rawResponse?: string;
        tokenUsage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
        promptingTrace?: {
            originalUserMessage: string;
            /** MongoDB _id of the llm_prompt_configs document used to build the pipeline wrapper */
            promptConfigId?: string;
            prePromptTemplate?: string;
            effectiveSystemPrompt?: string;
        };
    };
    createdAt: string;
    activatedAt?: string;
}

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
    input: {
        conversationId: string;
        sourceMessageId?: string;
        parentSnapshotId?: string;
        artifacts: { html: string; css: string; js: string };
        rawLlmResponse?: string;
        focusContext?: LlmFocusContext;
        metadata?: {
            model?: string;
            provider?: string;
            durationMs?: number;
            finishReason?: string;
            structuredParseValid?: boolean;
            rawResponse?: string;
            tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
            promptingTrace?: {
                originalUserMessage: string;
                /** MongoDB _id of the llm_prompt_configs document used to build the pipeline wrapper */
                promptConfigId?: string;
                prePromptTemplate?: string;
                effectiveSystemPrompt?: string;
            };
        };
        activate?: boolean;
    }
) {
    return call<{ snapshot: PreviewSnapshot }>(
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
