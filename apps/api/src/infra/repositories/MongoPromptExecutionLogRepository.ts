import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { PromptExecutionLog, PromptExecutionUsageSummary, PromptExecutionModelSummary } from "../../domain/entities/PromptExecutionLog";
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

    async summarizeByProject(projectId: string, userId: string): Promise<PromptExecutionUsageSummary> {
        return this.summarize({ projectId, userId });
    }

    async summarizeAll(): Promise<PromptExecutionUsageSummary> {
        return this.summarize({});
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
