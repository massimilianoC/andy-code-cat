import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type {
    NewPendingPromptExecution,
    PromptExecutionCompletion,
    PromptExecutionLog,
    PromptExecutionUsageSummary,
    PromptExecutionModelSummary,
} from "../../domain/entities/PromptExecutionLog";
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
        // Sparse: most records have no idempotencyKey (existing create() callers don't set one).
        await col.createIndex({ projectId: 1, userId: 1, idempotencyKey: 1 }, { sparse: true });
        return col;
    }

    private async summarize(match: Record<string, unknown>): Promise<PromptExecutionUsageSummary> {
        const col = await this.col();
        const rows = await col.aggregate<{
            totals?: Array<{ totalCost?: number; totalTokens?: number; runs?: number }>;
            topModels?: Array<{
                _id: { provider?: string; model?: string };
                runs?: number;
                totalCost?: number;
                totalTokens?: number;
            }>;
        }>([
            {
                $match: {
                    ...match,
                    status: "succeeded",
                },
            },
            {
                $facet: {
                    totals: [
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: { $ifNull: ["$costEstimate.amount", 0] } },
                                totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
                                runs: { $sum: 1 },
                            },
                        },
                    ],
                    topModels: [
                        {
                            $group: {
                                _id: { provider: "$provider", model: "$model" },
                                runs: { $sum: 1 },
                                totalCost: { $sum: { $ifNull: ["$costEstimate.amount", 0] } },
                                totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
                            },
                        },
                        { $sort: { totalCost: -1, runs: -1 } },
                        { $limit: 6 },
                    ],
                },
            },
        ]).toArray();

        const totals = rows[0]?.totals?.[0];
        const topModels: PromptExecutionModelSummary[] = (rows[0]?.topModels ?? []).map((entry) => ({
            provider: entry._id.provider ?? "unknown",
            model: entry._id.model ?? "unknown",
            runs: entry.runs ?? 0,
            totalCost: entry.totalCost ?? 0,
            totalTokens: entry.totalTokens ?? 0,
        }));

        return {
            totalCost: totals?.totalCost ?? 0,
            totalTokens: totals?.totalTokens ?? 0,
            runs: totals?.runs ?? 0,
            topModels,
        };
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

    async createPending(input: NewPendingPromptExecution): Promise<PromptExecutionLog> {
        const col = await this.col();
        const doc: PromptExecutionLogDocument = {
            _id: randomUUID(),
            ...input,
            status: "pending",
            durationMs: 0,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async complete(id: string, completion: PromptExecutionCompletion): Promise<PromptExecutionLog> {
        const col = await this.col();
        const updated = await col.findOneAndUpdate(
            { _id: id },
            { $set: completion },
            { returnDocument: "after" },
        );
        if (!updated) {
            throw new Error(`PromptExecutionLog not found: ${id}`);
        }
        return toEntity(updated);
    }

    async findActiveByIdempotencyKey(
        projectId: string,
        userId: string,
        idempotencyKey: string,
        staleAfterMs: number,
    ): Promise<PromptExecutionLog | null> {
        const col = await this.col();
        const staleThreshold = new Date(Date.now() - staleAfterMs);
        const doc = await col.findOne(
            {
                projectId,
                userId,
                idempotencyKey,
                $or: [
                    { status: "succeeded" },
                    { status: "pending", createdAt: { $gte: staleThreshold } },
                ],
            },
            { sort: { createdAt: -1 } },
        );
        return doc ? toEntity(doc) : null;
    }

    async summarizeByProject(projectId: string, userId: string): Promise<PromptExecutionUsageSummary> {
        return this.summarize({ projectId, userId });
    }

    async summarizeAll(): Promise<PromptExecutionUsageSummary> {
        return this.summarize({});
    }

    async summarizeCostsByUser(userId: string): Promise<Record<string, number>> {
        const col = await this.col();
        const rows = await col.aggregate<{ _id: string; totalCost: number }>([
            { $match: { userId, status: "succeeded" } },
            { $group: { _id: "$projectId", totalCost: { $sum: { $ifNull: ["$costEstimate.amount", 0] } } } },
        ]).toArray();
        const result: Record<string, number> = {};
        for (const row of rows) {
            result[row._id] = row.totalCost;
        }
        return result;
    }

    async listRecentByProject(projectId: string, userId: string, limit = 8): Promise<PromptExecutionLog[]> {
        const col = await this.col();
        const docs = await col.find({ projectId, userId }).sort({ createdAt: -1 }).limit(limit).toArray();
        return docs.map(toEntity);
    }

    async listRecentAll(limit = 10): Promise<PromptExecutionLog[]> {
        const col = await this.col();
        const docs = await col.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
        return docs.map(toEntity);
    }
}
