import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { DidacticQnaEntry } from "../../domain/entities/DidacticQnaEntry";
import type { DidacticQnaRepository } from "../../domain/repositories/DidacticQnaRepository";

interface DidacticQnaDocument {
    _id: string;
    projectId: string;
    userId: string;
    snapshotId: string;
    focus?: unknown;
    question: string;
    answer: string;
    model?: string;
    provider?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    createdAt: Date;
}

function toEntity(doc: DidacticQnaDocument): DidacticQnaEntry {
    return {
        id: doc._id,
        projectId: doc.projectId,
        userId: doc.userId,
        snapshotId: doc.snapshotId,
        focus: doc.focus as DidacticQnaEntry["focus"] | undefined,
        question: doc.question,
        answer: doc.answer,
        model: doc.model,
        provider: doc.provider,
        usage: doc.usage,
        createdAt: doc.createdAt,
    };
}

export class MongoDidacticQnaRepository implements DidacticQnaRepository {
    private async collection(): Promise<Collection<DidacticQnaDocument>> {
        const db = await getDb();
        const col = db.collection<DidacticQnaDocument>("didactic_qna");
        await col.createIndex({ projectId: 1, createdAt: -1 });
        return col;
    }

    async listByProject(projectId: string, limit = 100): Promise<DidacticQnaEntry[]> {
        const col = await this.collection();
        const docs = await col
            .find({ projectId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return docs.map(toEntity);
    }

    async insert(entry: DidacticQnaEntry): Promise<DidacticQnaEntry> {
        const col = await this.collection();
        const doc: DidacticQnaDocument = {
            _id: entry.id || randomUUID(),
            projectId: entry.projectId,
            userId: entry.userId,
            snapshotId: entry.snapshotId,
            focus: entry.focus as unknown,
            question: entry.question,
            answer: entry.answer,
            model: entry.model,
            provider: entry.provider,
            usage: entry.usage,
            createdAt: entry.createdAt ?? new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }
}
