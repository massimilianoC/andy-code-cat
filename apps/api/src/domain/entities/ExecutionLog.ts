/**
 * ExecutionLog — structured event record for a single operation or process step.
 *
 * Stored in the `execution_logs` MongoDB collection (TTL: 90 days).
 * Every record is scoped to a project (tenant isolation).
 * Agents and future admin tools can query by domain/eventType/level to reconstruct
 * error timelines without reading conversation blobs.
 */

/** Top-level category of the operation that produced this log entry. */
export type LogDomain = "llm" | "focus_patch" | "snapshot" | "wysiwyg" | "export" | "system";

/** Severity level — matches conventional log levels. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Terminal outcome of the operation. */
export type LogStatus = "success" | "failure" | "partial";

/**
 * Stable event-type identifiers by domain.
 *
 * llm:
 *   "llm_generation_complete" | "llm_generation_failed" | "llm_generation_interrupted"
 *
 * focus_patch:
 *   "focus_patch_applied"  — all strategies tried, one succeeded
 *   "focus_patch_failed"   — all strategies exhausted, fallback HTML used
 *
 * snapshot:
 *   "snapshot_created"     — new PreviewSnapshot persisted
 *   "snapshot_activated"   — a snapshot set as active (isActive = true)
 *   "snapshot_deleted"     — a snapshot removed
 *
 * wysiwyg:
 *   "wysiwyg_session_started"
 *   "wysiwyg_session_committed"
 *   "wysiwyg_session_autosaved"
 *
 * export:
 *   "export_zip_completed"
 *   "export_capture_completed"
 *
 * system:
 *   "seed_completed" | "health_check" | ...
 */
export type LogEventType = string;

export interface ExecutionLog {
    /** UUID primary key. */
    id: string;

    /** Tenant isolation: every log belongs to exactly one project. */
    projectId: string;

    /** Optional FK — the conversation this operation was part of. */
    conversationId?: string;

    /** Optional FK — the preview snapshot this operation created or referenced. */
    snapshotId?: string;

    /** Optional FK — the conversation message that triggered this operation. */
    messageId?: string;

    /** Top-level process category. */
    domain: LogDomain;

    /**
     * Fine-grained event identifier.
     * Use snake_case, lowercase.  Examples: "llm_generation_complete", "focus_patch_failed".
     * See LogEventType JSDoc for the full catalogue.
     */
    eventType: LogEventType;

    /** Severity. Determines alerting thresholds for future admin tooling. */
    level: LogLevel;

    /** Terminal outcome of the operation. */
    status: LogStatus;

    /**
     * Wall-clock execution time in milliseconds.
     * Present whenever the operation has a measurable duration (LLM call, patch merge, export, …).
     */
    durationMs?: number;

    /**
     * Domain-specific payload.
     * Keep it moderate — enough to reconstruct the error without reading full conversations.
     *
     * Schema conventions per domain (informal — not enforced here, documented in EXECUTION_LOG_SPEC.md):
     *
     *   llm:            { provider, model, promptTokens, completionTokens, costEur, finishReason,
     *                     pipelineRole, structuredParseValid, focusPatchPresent }
     *   focus_patch:    { targetType, strategyUsed, strategiesTried, pfIdFound, anchorTag }
     *   snapshot:       { snapshotId, parentSnapshotId, activatedAt, artifactHtmlBytes }
     *   wysiwyg:        { sessionId, originSnapshotId, changeCount }
     *   export:         { format, sizeBytes }
     *   system:         { message }
     */
    metadata: Record<string, unknown>;

    /** ISO timestamp — also used as the TTL index anchor field. */
    createdAt: Date;
}
