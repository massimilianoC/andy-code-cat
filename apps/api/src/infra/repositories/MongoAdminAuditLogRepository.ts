import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { AdminAuditLog } from "../../domain/entities/AdminAuditLog";
import type { IAdminAuditLogRepository } from "../../domain/repositories/IAdminAuditLogRepository";

const COLLECTION = "admin_audit_logs";

interface AdminAuditLogDocument {
    _id: string;
    actorUserId: string;
    actorEmail?: string;
    action: AdminAuditLog["action"];
    targetProjectId?: string;
    targetUserId?: string;
    targetSnapshotId?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
}

function toEntity(doc: AdminAuditLogDocument): AdminAuditLog {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoAdminAuditLogRepository implements IAdminAuditLogRepository {
    private async col(): Promise<Collection<AdminAuditLogDocument>> {
        const db = await getDb();
        const col = db.collection<AdminAuditLogDocument>(COLLECTION);

        // Accountability trail — no TTL (unlike execution_logs). Indexes are created lazily;
        // createIndex is idempotent, failures are non-fatal.
        await Promise.all([
            col.createIndex({ actorUserId: 1, createdAt: -1 }),
            col.createIndex({ targetProjectId: 1, createdAt: -1 }),
            col.createIndex({ createdAt: -1 }),
        ]).catch(() => { /* index creation failures are non-fatal */ });

        return col;
    }

    async emit(log: Omit<AdminAuditLog, "id" | "createdAt">): Promise<AdminAuditLog> {
        const col = await this.col();
        const doc: AdminAuditLogDocument = {
            _id: randomUUID(),
            ...log,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }
}
