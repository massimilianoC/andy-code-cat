import type {
    NewPendingPromptExecution,
    PromptExecutionCompletion,
    PromptExecutionLog,
    PromptExecutionUsageSummary,
} from "../entities/PromptExecutionLog";

export interface PromptExecutionLogRepository {
    create(input: Omit<PromptExecutionLog, "id" | "createdAt">): Promise<PromptExecutionLog>;
    /**
     * I11 — writes a "pending" record before the provider call is dispatched. Callers MUST
     * `await` this (never fire-and-forget) so the durable record exists before any provider
     * call begins.
     */
    createPending(input: NewPendingPromptExecution): Promise<PromptExecutionLog>;
    /** I11 — transitions a pending record to its terminal status once the provider call resolves. */
    complete(id: string, completion: PromptExecutionCompletion): Promise<PromptExecutionLog>;
    /**
     * I11 — looks up the most recent record for (projectId, userId, idempotencyKey) that is
     * either "succeeded" or a still-fresh "pending" (younger than `staleAfterMs`; an older
     * pending record is treated as abandoned — e.g. the process crashed mid-call — and does NOT
     * block a retry). The journal does not store the full reply/artifacts, only cost/usage
     * metadata, so callers use this to REJECT a duplicate in-flight/completed request (409) —
     * not to replay a cached response. Returns null when no such record exists.
     */
    findActiveByIdempotencyKey(projectId: string, userId: string, idempotencyKey: string, staleAfterMs: number): Promise<PromptExecutionLog | null>;
    summarizeByProject(projectId: string, userId: string): Promise<PromptExecutionUsageSummary>;
    summarizeAll(): Promise<PromptExecutionUsageSummary>;
    /** Returns a map of projectId -> total cost (EUR) for all succeeded runs for a user. */
    summarizeCostsByUser(userId: string): Promise<Record<string, number>>;
    listRecentByProject(projectId: string, userId: string, limit?: number): Promise<PromptExecutionLog[]>;
    listRecentAll(limit?: number): Promise<PromptExecutionLog[]>;
    /**
     * Every journal row for one WorkSession, oldest first — ownership-scoped like every other
     * finder here (the `userId` filter is applied in the query, not as an application-layer
     * afterthought). Added for the Session Inspector (docs/specs/SESSION_INSPECTOR_SPEC.md): the
     * detail endpoint needs every call a session made, in the order it made them, and nothing
     * upstream could answer that by workSessionId alone.
     */
    listByWorkSession(workSessionId: string, userId: string): Promise<PromptExecutionLog[]>;
    /**
     * Discard (INTERRUPTED_RUN_RECOVERY.md §3bis) — deletes every journal row for a project the
     * owner is discarding. Returns the number of rows removed, so the caller can state what it
     * actually deleted rather than a vague "done". Ownership-scoped like every other write here.
     */
    deleteByProject(projectId: string, userId: string): Promise<number>;
}
