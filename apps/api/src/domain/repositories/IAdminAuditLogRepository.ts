import type { AdminAuditLog } from "../entities/AdminAuditLog";

export interface IAdminAuditLogRepository {
    /**
     * Persist a new admin audit log record.
     * Implementations must be fire-and-forget safe — callers may choose not to await.
     */
    emit(log: Omit<AdminAuditLog, "id" | "createdAt">): Promise<AdminAuditLog>;
}
