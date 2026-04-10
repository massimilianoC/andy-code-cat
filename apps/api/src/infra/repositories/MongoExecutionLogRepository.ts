import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { ExecutionLog } from "../../domain/entities/ExecutionLog";
import type {
    IExecutionLogRepository,
    ExecutionLogQuery,
} from "../../domain/repositories/IExecutionLogRepository";

const COLLECTION = "execution_logs";
/** TTL in seconds: 90 days */
const TTL_SECONDS = 90 * 24 * 60 * 60;

interface ExecutionLogDocument {
    _id: string;
    projectId: string;
    conversationId?: string;
    snapshotId?: string;
    messageId?: string;
    domain: ExecutionLog["domain"];
    eventType: string;
    level: ExecutionLog["level"];
    status: ExecutionLog["status"];
    durationMs?: number;
    metadata: Record<string, unknown>;
    createdAt: Date;
}

function toEntity(doc: ExecutionLogDocument): ExecutionLog {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoExecutionLogRepository implements IExecutionLogRepository {
    private async col(): Promise<Collection<ExecutionLogDocument>> {
        const db = await getDb();
        const col = db.collection<ExecutionLogDocument>(COLLECTION);

        // Ensure TTL index — createIndex is idempotent if the index already exists.
        await col.createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS, background: true });

        return col;
    }

    async emit(log: Omit<ExecutionLog, "id" | "createdAt">): Promise<ExecutionLog> {
        const col = await this.col();
        const doc: ExecutionLogDocument = {
            _id: randomUUID(),
            ...log,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findByProject(projectId: string, query: ExecutionLogQuery = {}): Promise<ExecutionLog[]> {
        const col = await this.col();

        const filter: Filter<ExecutionLogDocument> = { projectId };
        if (query.domain) filter.domain = query.domain;
        if (query.level) filter.level = query.level;
        if (query.conversationId) filter.conversationId = query.conversationId;
        if (query.snapshotId) filter.snapshotId = query.snapshotId;
        if (query.before) filter.createdAt = { $lt: query.before };

        const limit = Math.min(query.limit ?? 50, 200);

        const docs = await col
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        return docs.map(toEntity);
    }
}
