import { z } from "zod";

// ── Shared enums ─────────────────────────────────────────────────────────────

export const logDomainSchema = z.enum(["llm", "focus_patch", "snapshot", "wysiwyg", "export", "system"]);
export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export const logStatusSchema = z.enum(["success", "failure", "partial"]);

export type LogDomain = z.infer<typeof logDomainSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;
export type LogStatus = z.infer<typeof logStatusSchema>;

// ── Query schema (for GET /projects/:projectId/execution-logs) ───────────────

export const executionLogQuerySchema = z.object({
    domain: logDomainSchema.optional(),
    level: logLevelSchema.optional(),
    conversationId: z.string().uuid().optional(),
    snapshotId: z.string().uuid().optional(),
    before: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type ExecutionLogQuery = z.infer<typeof executionLogQuerySchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

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

export interface ExecutionLogListResult {
    logs: ExecutionLogDto[];
}
