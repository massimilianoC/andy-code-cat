import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { NewVibeIntake, VibeIntake } from "../../domain/entities/VibeIntake";
import type { VibeIntakeRecord, VibeIntakeRepository } from "../../domain/repositories/VibeIntakeRepository";

const COLLECTION = "vibe_intakes";

interface VibeIntakeDocument {
    _id: string;
    workSessionId: string;
    userId: string;
    projectId?: string;
    prompt: string;
    attachments: VibeIntake["attachments"];
    requestedProvider?: string;
    requestedModel?: string;
    generationMode?: string;
    options?: Record<string, unknown>;
    promptExecutionLogIds: string[];
    createdAt: Date;
}

function toEntity(doc: VibeIntakeDocument): VibeIntake {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoVibeIntakeRepository implements VibeIntakeRepository {
    private async col(): Promise<Collection<VibeIntakeDocument>> {
        const db = await getDb();
        return db.collection<VibeIntakeDocument>(COLLECTION);
    }

    async record(intake: NewVibeIntake): Promise<VibeIntakeRecord> {
        const col = await this.col();
        const doc: VibeIntakeDocument = {
            _id: randomUUID(),
            ...intake,
            promptExecutionLogIds: [],
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async appendPromptExecutionLogId(id: string, promptExecutionLogId: string): Promise<void> {
        const col = await this.col();
        // $addToSet, not $push: a retried stage must not make the same call appear twice in the
        // history it is supposed to certify.
        await col.updateOne(
            { _id: id } as Filter<VibeIntakeDocument>,
            { $addToSet: { promptExecutionLogIds: promptExecutionLogId } },
        );
    }

    async listByProject(projectId: string, userId: string): Promise<VibeIntakeRecord[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId, userId } as Filter<VibeIntakeDocument>)
            .sort({ $natural: 1 })
            .toArray();
        return docs.map(toEntity);
    }

    async listByWorkSession(workSessionId: string, userId: string): Promise<VibeIntakeRecord[]> {
        const col = await this.col();
        const docs = await col
            .find({ workSessionId, userId } as Filter<VibeIntakeDocument>)
            .sort({ createdAt: 1 })
            .toArray();
        return docs.map(toEntity);
    }

    async deleteByProject(projectId: string, userId: string): Promise<number> {
        const col = await this.col();
        const result = await col.deleteMany({ projectId, userId } as Filter<VibeIntakeDocument>);
        return result.deletedCount;
    }
}
