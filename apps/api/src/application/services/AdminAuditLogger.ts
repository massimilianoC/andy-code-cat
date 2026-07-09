/**
 * AdminAuditLogger — fire-and-forget singleton for superadmin accountability logging.
 *
 * Usage (non-blocking):
 *   AdminAuditLogger.instance.emit({ actorUserId, action: "admin_viewed_project_snapshot", ... });
 *
 * The emit() method never throws — errors are swallowed after console.error so callers
 * on the request path are never blocked or failed by a logging side-effect.
 *
 * The singleton is initialised lazily on first access. Route handlers should import and
 * use `AdminAuditLogger.instance` directly.
 */

import type { AdminAuditLog } from "../../domain/entities/AdminAuditLog";
import type { IAdminAuditLogRepository } from "../../domain/repositories/IAdminAuditLogRepository";
import { MongoAdminAuditLogRepository } from "../../infra/repositories/MongoAdminAuditLogRepository";

type EmitInput = Omit<AdminAuditLog, "id" | "createdAt">;

export class AdminAuditLogger {
    private static _instance: AdminAuditLogger | null = null;

    /** Lazily-initialised singleton. */
    static get instance(): AdminAuditLogger {
        if (!AdminAuditLogger._instance) {
            AdminAuditLogger._instance = new AdminAuditLogger(new MongoAdminAuditLogRepository());
        }
        return AdminAuditLogger._instance;
    }

    constructor(private readonly repo: IAdminAuditLogRepository) { }

    /**
     * Fire-and-forget log emission.
     * Returns void so callers cannot accidentally await it and block the request cycle.
     */
    emit(input: EmitInput): void {
        this.repo.emit(input).catch((err: unknown) => {
            console.error("[AdminAuditLogger] Failed to persist log:", err);
        });
    }

    /**
     * Awaitable version — use only where you genuinely need the persisted record (tests).
     */
    async emitAsync(input: EmitInput): Promise<AdminAuditLog> {
        return this.repo.emit(input);
    }
}
