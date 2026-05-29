import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { SystemNotification } from "../../domain/entities/SystemNotification";
import type {
    CreateSystemNotificationInput,
    SystemNotificationQuery,
    SystemNotificationRepository,
} from "../../domain/repositories/SystemNotificationRepository";

const COLLECTION = "system_notifications";

type SystemNotificationDocument = Omit<SystemNotification, "id"> & { _id: string };

function toEntity(doc: SystemNotificationDocument): SystemNotification {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

function applyQuery(filter: Filter<SystemNotificationDocument>, query: SystemNotificationQuery = {}) {
    if (query.domain) filter.domain = query.domain;
    if (query.severity) filter.severity = query.severity;
    if (query.status) filter.status = query.status;
    if (query.projectId) filter.projectId = query.projectId;
    return filter;
}

export class MongoSystemNotificationRepository implements SystemNotificationRepository {
    private async col(): Promise<Collection<SystemNotificationDocument>> {
        const db = await getDb();
        const col = db.collection<SystemNotificationDocument>(COLLECTION);
        await Promise.all([
            col.createIndex({ userId: 1, status: 1, createdAt: -1 }, { background: true }),
            col.createIndex({ audience: 1, status: 1, createdAt: -1 }, { background: true }),
            col.createIndex({ domain: 1, severity: 1, createdAt: -1 }, { background: true }),
            col.createIndex({ projectId: 1, createdAt: -1 }, { background: true }),
        ]);
        return col;
    }

    async create(input: CreateSystemNotificationInput): Promise<SystemNotification> {
        const col = await this.col();
        const doc: SystemNotificationDocument = {
            _id: randomUUID(),
            ...input,
            status: "unread",
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async listForUser(userId: string, query: SystemNotificationQuery = {}): Promise<SystemNotification[]> {
        const col = await this.col();
        const filter = applyQuery({
            userId,
            audience: { $in: ["user", "both"] },
        } as Filter<SystemNotificationDocument>, query);

        const docs = await col.find(filter).sort({ createdAt: -1 }).limit(Math.min(query.limit ?? 50, 200)).toArray();
        return docs.map(toEntity);
    }

    async listForAdmin(query: SystemNotificationQuery = {}): Promise<SystemNotification[]> {
        const col = await this.col();
        const filter = applyQuery({
            audience: { $in: ["superadmin", "both"] },
        } as Filter<SystemNotificationDocument>, query);

        const docs = await col.find(filter).sort({ createdAt: -1 }).limit(Math.min(query.limit ?? 100, 200)).toArray();
        return docs.map(toEntity);
    }

    async markRead(id: string, userId: string): Promise<SystemNotification | null> {
        const col = await this.col();
        const now = new Date();
        await col.updateOne(
            { _id: id, userId, audience: { $in: ["user", "both"] } } as Filter<SystemNotificationDocument>,
            { $set: { status: "read", readAt: now } },
        );
        const doc = await col.findOne({ _id: id, userId } as Filter<SystemNotificationDocument>);
        return doc ? toEntity(doc) : null;
    }
}
