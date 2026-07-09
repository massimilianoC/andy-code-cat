/**
 * AdminAuditLog — accountability record for superadmin actions that view or affect
 * another user's data across tenant boundaries.
 *
 * Stored in the `admin_audit_logs` MongoDB collection. Unlike `execution_logs`, there is
 * no TTL — this is an accountability trail, not operational telemetry, and is meant to
 * persist indefinitely.
 */

/** Stable action identifiers. Extend as more admin actions gain audit coverage. */
export type AdminAuditAction = "admin_viewed_project_snapshot";

export interface AdminAuditLog {
    /** UUID primary key. */
    id: string;

    /** The superadmin who performed the action. */
    actorUserId: string;

    /** Denormalized for readability when inspecting the collection directly. */
    actorEmail?: string;

    /** What was done. */
    action: AdminAuditAction;

    /** Optional FKs — whichever apply to the action. */
    targetProjectId?: string;
    targetUserId?: string;
    targetSnapshotId?: string;

    /** Action-specific payload — keep it small, enough to reconstruct context. */
    metadata: Record<string, unknown>;

    /** ISO timestamp. */
    createdAt: Date;
}
