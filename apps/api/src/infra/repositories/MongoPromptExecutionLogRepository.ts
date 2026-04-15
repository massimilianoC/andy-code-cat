import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { PromptExecutionLog, PromptExecutionUsageSummary } from "../../domain/entities/PromptExecutionLog";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";

const COLLECTION = "prompt_execution_logs";

interface PromptExecutionLogDocument extends Omit<PromptExecutionLog, "id"> {
    _id: string;
}

function toEntity(doc: PromptExecutionLogDocument): PromptExecutionLog {
    const { _id, ...rest } = doc;
    return {
        id: _id,
        ...rest,
    };
}

export class MongoPromptExecutionLogRepository implements PromptExecutionLogRepository {
    private async col(): Promise<Collection<PromptExecutionLogDocument>> {
        const db = await getDb();
        const col = db.collection<PromptExecutionLogDocument>(COLLECTION);
        await col.createIndex({ projectId: 1, userId: 1, createdAt: -1 });
        await col.createIndex({ taskKey: 1, createdAt: -1 });
        return col;
    }

    async create(input: Omit<PromptExecutionLog, "id" | "createdAt">): Promise<PromptExecutionLog> {
        const col = await this.col();
        const doc: PromptExecutionLogDocument = {
            _id: randomUUID(),
            ...input,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async summarizeByProject(projectId: string, userId: string): Promise<PromptExecutionUsageSummary> {
        const col = await this.col();
        const rows = await col.aggregate<{ totalCost?: number; totalTokens?: number; runs?: number }>([
            {
                $match: {
                    projectId,
                    userId,
                    status: "succeeded",
                },
            },
            {
                $group: {
                    _id: null,
                    totalCost: { $sum: { $ifNull: ["$costEstimate.amount", 0] } },
                    totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
                    runs: { $sum: 1 },
                },
            },
        ]).toArray();

        return {
            totalCost: rows[0]?.totalCost ?? 0,
            totalTokens: rows[0]?.totalTokens ?? 0,
            runs: rows[0]?.runs ?? 0,
        };
    }
}
