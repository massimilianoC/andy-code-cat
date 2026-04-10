import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { PublishHistoryEntry, PublishAction } from "../../domain/entities/PublishHistory";
import type { PublishHistoryRepository } from "../../domain/repositories/PublishHistoryRepository";

const COLLECTION = "publish_history";

interface PublishHistoryDocument {
    _id: string;
    projectId: string;
    userId: string;
    publishId: string;
    deploymentId: string;
    snapshotId: string;
    action: PublishAction;
    publishedAt: Date;
}

function toEntity(doc: PublishHistoryDocument): PublishHistoryEntry {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoPublishHistoryRepository implements PublishHistoryRepository {
    private async col(): Promise<Collection<PublishHistoryDocument>> {
        const db = await getDb();
        return db.collection<PublishHistoryDocument>(COLLECTION);
    }

    async record(entry: Omit<PublishHistoryEntry, "id">): Promise<PublishHistoryEntry> {
        const col = await this.col();
        const doc: PublishHistoryDocument = {
            _id: randomUUID(),
            projectId: entry.projectId,
            userId: entry.userId,
            publishId: entry.publishId,
            deploymentId: entry.deploymentId,
            snapshotId: entry.snapshotId,
            action: entry.action,
            publishedAt: entry.publishedAt,
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findByProjectId(projectId: string, limit = 50): Promise<PublishHistoryEntry[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId })
            .sort({ publishedAt: -1 })
            .limit(limit)
            .toArray();
        return docs.map(toEntity);
    }
}
