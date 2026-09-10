import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { NewWorkSession, WorkSession, WorkSessionStatus } from "../../domain/entities/WorkSession";
import { assertWorkSessionTransition } from "../../domain/entities/WorkSession";
import type { WorkSessionRecord, WorkSessionRepository } from "../../domain/repositories/WorkSessionRepository";

const COLLECTION = "work_sessions";

interface WorkSessionDocument {
    _id: string;
    userId: string;
    organizationId?: string;
    projectId?: string;
    entryMode: WorkSession["entryMode"];
    config: WorkSession["config"];
    status: WorkSessionStatus;
    failureReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: WorkSessionDocument): WorkSession {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoWorkSessionRepository implements WorkSessionRepository {
    private async col(): Promise<Collection<WorkSessionDocument>> {
        const db = await getDb();
        return db.collection<WorkSessionDocument>(COLLECTION);
    }

    async open(session: NewWorkSession): Promise<WorkSessionRecord> {
        const col = await this.col();
        const now = new Date();
        const doc: WorkSessionDocument = {
            _id: randomUUID(),
            ...session,
            status: "open",
            createdAt: now,
            updatedAt: now,
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findByIdForUser(id: string, userId: string): Promise<WorkSessionRecord | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id, userId } as Filter<WorkSessionDocument>);
        return doc ? toEntity(doc) : null;
    }

    async listByProject(projectId: string, userId: string, limit = 50): Promise<WorkSessionRecord[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId, userId } as Filter<WorkSessionDocument>)
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return docs.map(toEntity);
    }

    async listByUser(userId: string, limit = 50): Promise<WorkSessionRecord[]> {
        const col = await this.col();
        const docs = await col
            .find({ userId } as Filter<WorkSessionDocument>)
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return docs.map(toEntity);
    }

    async findOpenByProject(projectId: string, userId: string): Promise<WorkSessionRecord | null> {
        const col = await this.col();
        const doc = await col.findOne(
            { projectId, userId, status: "open" } as Filter<WorkSessionDocument>,
            { sort: { $natural: -1 } },
        );
        return doc ? toEntity(doc) : null;
    }

    async attachProject(id: string, projectId: string): Promise<WorkSessionRecord> {
        const col = await this.col();
        const updated = await col.findOneAndUpdate(
            { _id: id } as Filter<WorkSessionDocument>,
            { $set: { projectId, updatedAt: new Date() } },
            { returnDocument: "after" },
        );
        if (!updated) throw new Error(`WorkSession not found: ${id}`);
        return toEntity(updated);
    }

    async setStatus(id: string, status: WorkSessionStatus, failureReason?: string): Promise<WorkSessionRecord> {
        const col = await this.col();
        const current = await col.findOne({ _id: id } as Filter<WorkSessionDocument>);
        if (!current) throw new Error(`WorkSession not found: ${id}`);

        assertWorkSessionTransition(current.status, status);

        const updated = await col.findOneAndUpdate(
            { _id: id } as Filter<WorkSessionDocument>,
            {
                $set: {
                    status,
                    updatedAt: new Date(),
                    ...(failureReason ? { failureReason } : {}),
                },
            },
            { returnDocument: "after" },
        );
        if (!updated) throw new Error(`WorkSession not found: ${id}`);
        return toEntity(updated);
    }

    async deleteByProject(projectId: string, userId: string): Promise<number> {
        const col = await this.col();
        const result = await col.deleteMany({ projectId, userId } as Filter<WorkSessionDocument>);
        return result.deletedCount ?? 0;
    }
}
