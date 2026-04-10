import type { ExecutionLog, LogDomain, LogLevel } from "../entities/ExecutionLog";

export interface ExecutionLogQuery {
    /** Filter to a specific process category. */
    domain?: LogDomain;
    /** Filter to a specific severity level. */
    level?: LogLevel;
    /** Return only logs for this conversation. */
    conversationId?: string;
    /** Return only logs for this snapshot. */
    snapshotId?: string;
    /** Cursor-based pagination: return logs created strictly before this date. */
    before?: Date;
    /** Maximum number of records to return (default: 50, max: 200). */
    limit?: number;
}

export interface IExecutionLogRepository {
    /**
     * Persist a new execution log record.
     * Implementations must be fire-and-forget safe — callers may choose not to await.
     */
    emit(log: Omit<ExecutionLog, "id" | "createdAt">): Promise<ExecutionLog>;

    /**
     * Query execution logs for a project with optional filters.
     * Results are sorted by createdAt descending (newest first).
     */
    findByProject(projectId: string, query?: ExecutionLogQuery): Promise<ExecutionLog[]>;
}
