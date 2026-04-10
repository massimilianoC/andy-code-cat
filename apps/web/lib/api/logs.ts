import { call } from "./call";

export type LogDomain = "llm" | "focus_patch" | "snapshot" | "wysiwyg" | "export" | "system";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogStatus = "success" | "failure" | "partial";

export interface ExecutionLogDto {
    id: string;
    projectId: string;
    conversationId?: string;
    snapshotId?: string;
    messageId?: string;
    domain: LogDomain;
    eventType: string;
    level: LogLevel;
    status: LogStatus;
    durationMs?: number;
    metadata: Record<string, unknown>;
    createdAt: string;
}

export interface ExecutionLogListQuery {
    domain?: LogDomain;
    level?: LogLevel;
    conversationId?: string;
    snapshotId?: string;
    before?: string;
    limit?: number;
}

export function listExecutionLogs(
    token: string,
    projectId: string,
    query?: ExecutionLogListQuery
) {
    const params = new URLSearchParams();
    if (query?.domain) params.set("domain", query.domain);
    if (query?.level) params.set("level", query.level);
    if (query?.conversationId) params.set("conversationId", query.conversationId);
    if (query?.snapshotId) params.set("snapshotId", query.snapshotId);
    if (query?.before) params.set("before", query.before);
    if (query?.limit !== undefined) params.set("limit", String(query.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return call<{ logs: ExecutionLogDto[] }>(
        "GET",
        `/v1/projects/${projectId}/execution-logs${qs}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}
