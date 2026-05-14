import { randomUUID } from "crypto";
import type { Collection, Document } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "../db/mongo";
import type {
    ICostTransactionRepository,
    CostSummary,
    CostTypeBreakdown,
    CostTrendPoint,
    PageOpts,
    PagedResult,
    AdminCostFilter,
} from "../../domain/repositories/ICostTransactionRepository";
import type { CostTransaction, CostSourceRef } from "../../domain/entities/CostTransaction";

const COLLECTION = "cost_transactions";

interface CostTransactionDocument extends Omit<CostTransaction, "id"> {
    _id: string;
}

function toEntity(doc: CostTransactionDocument): CostTransaction {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

function toDoc(tx: Omit<CostTransaction, "id" | "createdAt"> & { createdAt?: Date }): Omit<CostTransactionDocument, "_id"> {
    return {
        txId: tx.txId,
        userId: tx.userId,
        projectId: tx.projectId,
        resourceType: tx.resourceType,
        resourceSubtype: tx.resourceSubtype,
        providerCostUsd: tx.providerCostUsd,
        providerCostEur: tx.providerCostEur,
        infraCostEur: tx.infraCostEur,
        platformMarkupEur: tx.platformMarkupEur,
        totalEur: tx.totalEur,
        ratesSnapshot: tx.ratesSnapshot,
        units: tx.units,
        sourceRef: tx.sourceRef,
        meta: tx.meta,
        status: tx.status,
        voidedByTxId: tx.voidedByTxId,
        createdAt: tx.createdAt ?? new Date(),
    };
}

async function buildSumPipeline(match: Document): Promise<CostSummary> {
    const db = await getDb();
    const col = db.collection<CostTransactionDocument>(COLLECTION);
    const rows = await col.aggregate<{
        totalEur: number;
        providerCostEur: number;
        infraCostEur: number;
        platformMarkupEur: number;
        txCount: number;
    }>([
        { $match: { ...match, status: "settled" } },
        {
            $group: {
                _id: null,
                totalEur: { $sum: "$totalEur" },
                providerCostEur: { $sum: "$providerCostEur" },
                infraCostEur: { $sum: "$infraCostEur" },
                platformMarkupEur: { $sum: "$platformMarkupEur" },
                txCount: { $sum: 1 },
            },
        },
    ]).toArray();

    const row = rows[0];
    return {
        totalEur: row?.totalEur ?? 0,
        providerCostEur: row?.providerCostEur ?? 0,
        infraCostEur: row?.infraCostEur ?? 0,
        platformMarkupEur: row?.platformMarkupEur ?? 0,
        txCount: row?.txCount ?? 0,
    };
}

async function buildBreakdownPipeline(match: Document): Promise<CostTypeBreakdown[]> {
    const db = await getDb();
    const col = db.collection<CostTransactionDocument>(COLLECTION);
    const rows = await col.aggregate<{
        _id: string;
        totalEur: number;
        providerCostEur: number;
        infraCostEur: number;
        platformMarkupEur: number;
        txCount: number;
    }>([
        { $match: { ...match, status: "settled" } },
        {
            $group: {
                _id: "$resourceType",
                totalEur: { $sum: "$totalEur" },
                providerCostEur: { $sum: "$providerCostEur" },
                infraCostEur: { $sum: "$infraCostEur" },
                platformMarkupEur: { $sum: "$platformMarkupEur" },
                txCount: { $sum: 1 },
            },
        },
        { $sort: { totalEur: -1 } },
    ]).toArray();

    return rows.map((r) => ({
        resourceType: r._id,
        totalEur: r.totalEur ?? 0,
        providerCostEur: r.providerCostEur ?? 0,
        infraCostEur: r.infraCostEur ?? 0,
        platformMarkupEur: r.platformMarkupEur ?? 0,
        txCount: r.txCount ?? 0,
    }));
}

async function buildTrendPipeline(match: Document, days: number): Promise<CostTrendPoint[]> {
    const db = await getDb();
    const col = db.collection<CostTransactionDocument>(COLLECTION);
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await col.aggregate<{ _id: string; totalEur: number; txCount: number }>([
        { $match: { ...match, status: "settled", createdAt: { $gte: fromDate } } },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                totalEur: { $sum: "$totalEur" },
                txCount: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 } },
    ]).toArray();

    return rows.map((r) => ({ date: r._id, totalEur: r.totalEur ?? 0, txCount: r.txCount ?? 0 }));
}

export class MongoCostTransactionRepository implements ICostTransactionRepository {
    private async col(): Promise<Collection<CostTransactionDocument>> {
        const db = await getDb();
        const col = db.collection<CostTransactionDocument>(COLLECTION);
        // Indexes are created lazily — idempotent in MongoDB
        await Promise.all([
            col.createIndex({ userId: 1, createdAt: -1 }),
            col.createIndex({ projectId: 1, createdAt: -1 }),
            col.createIndex({ userId: 1, projectId: 1, createdAt: -1 }),
            col.createIndex({ resourceType: 1, createdAt: -1 }),
            col.createIndex({ createdAt: -1 }),
            col.createIndex({ status: 1 }),
            col.createIndex({ txId: 1 }, { unique: true }),
            col.createIndex({ "sourceRef.conversationId": 1 }, { sparse: true }),
            col.createIndex({ "sourceRef.promptExecutionLogId": 1 }, { sparse: true }),
            col.createIndex({ "sourceRef.assetId": 1 }, { sparse: true }),
        ]).catch(() => { /* Index creation failures are non-fatal */ });
        return col;
    }

    async create(tx: Omit<CostTransaction, "id" | "createdAt">): Promise<CostTransaction> {
        const col = await this.col();
        const id = randomUUID();
        const doc: CostTransactionDocument = { _id: id, ...toDoc(tx) };
        await col.insertOne(doc as unknown as Parameters<typeof col.insertOne>[0]);
        return toEntity(doc);
    }

    async findById(id: string): Promise<CostTransaction | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id } as unknown as Parameters<typeof col.findOne>[0]);
        return doc ? toEntity(doc) : null;
    }

    async findBySourceRef(ref: Partial<CostSourceRef>): Promise<CostTransaction[]> {
        const col = await this.col();
        const query: Document = {};
        for (const [k, v] of Object.entries(ref)) {
            if (v !== undefined) query[`sourceRef.${k}`] = v;
        }
        const docs = await col.find(query as unknown as Parameters<typeof col.find>[0]).sort({ createdAt: -1 }).limit(50).toArray();
        return docs.map(toEntity);
    }

    async sumByProject(projectId: string): Promise<CostSummary> {
        return buildSumPipeline({ projectId });
    }

    async sumByUser(userId: string, fromDate?: Date): Promise<CostSummary> {
        const match: Document = { userId };
        if (fromDate) match.createdAt = { $gte: fromDate };
        return buildSumPipeline(match);
    }

    async breakdownByTypeForProject(projectId: string): Promise<CostTypeBreakdown[]> {
        return buildBreakdownPipeline({ projectId });
    }

    async breakdownByTypeForUser(userId: string, fromDate?: Date): Promise<CostTypeBreakdown[]> {
        const match: Document = { userId };
        if (fromDate) match.createdAt = { $gte: fromDate };
        return buildBreakdownPipeline(match);
    }

    async breakdownByTypePlatform(fromDate?: Date, toDate?: Date): Promise<CostTypeBreakdown[]> {
        const match: Document = {};
        if (fromDate || toDate) {
            match.createdAt = {};
            if (fromDate) match.createdAt.$gte = fromDate;
            if (toDate) match.createdAt.$lte = toDate;
        }
        return buildBreakdownPipeline(match);
    }

    async trendByProject(projectId: string, days: number): Promise<CostTrendPoint[]> {
        return buildTrendPipeline({ projectId }, days);
    }

    async trendByUser(userId: string, days: number): Promise<CostTrendPoint[]> {
        return buildTrendPipeline({ userId }, days);
    }

    async trendPlatform(days: number): Promise<CostTrendPoint[]> {
        return buildTrendPipeline({}, days);
    }

    async listByProject(projectId: string, opts: PageOpts): Promise<PagedResult<CostTransaction>> {
        const col = await this.col();
        const skip = (opts.page - 1) * opts.limit;
        const query = { projectId } as unknown as Parameters<typeof col.find>[0];
        const [docs, total] = await Promise.all([
            col.find(query).sort({ createdAt: -1 }).skip(skip).limit(opts.limit).toArray(),
            col.countDocuments(query),
        ]);
        return { items: docs.map(toEntity), total, page: opts.page, limit: opts.limit };
    }

    async listByUser(userId: string, opts: PageOpts): Promise<PagedResult<CostTransaction>> {
        const col = await this.col();
        const skip = (opts.page - 1) * opts.limit;
        const query = { userId } as unknown as Parameters<typeof col.find>[0];
        const [docs, total] = await Promise.all([
            col.find(query).sort({ createdAt: -1 }).skip(skip).limit(opts.limit).toArray(),
            col.countDocuments(query),
        ]);
        return { items: docs.map(toEntity), total, page: opts.page, limit: opts.limit };
    }

    async listAll(filter: AdminCostFilter, opts: PageOpts): Promise<PagedResult<CostTransaction>> {
        const col = await this.col();
        const skip = (opts.page - 1) * opts.limit;
        const query: Document = {};
        if (filter.userId) query.userId = filter.userId;
        if (filter.projectId) query.projectId = filter.projectId;
        if (filter.resourceType) query.resourceType = filter.resourceType;
        if (filter.status) query.status = filter.status;
        if (filter.fromDate || filter.toDate) {
            query.createdAt = {};
            if (filter.fromDate) query.createdAt.$gte = filter.fromDate;
            if (filter.toDate) query.createdAt.$lte = filter.toDate;
        }
        const q = query as unknown as Parameters<typeof col.find>[0];
        const [docs, total] = await Promise.all([
            col.find(q).sort({ createdAt: -1 }).skip(skip).limit(opts.limit).toArray(),
            col.countDocuments(q),
        ]);
        return { items: docs.map(toEntity), total, page: opts.page, limit: opts.limit };
    }

    async topProjectsByUser(userId: string, limit = 10): Promise<Array<{ projectId: string; totalEur: number }>> {
        const db = await getDb();
        const col = db.collection<CostTransactionDocument>(COLLECTION);
        const rows = await col.aggregate<{ _id: string; totalEur: number }>([
            { $match: { userId, status: "settled" } },
            { $group: { _id: "$projectId", totalEur: { $sum: "$totalEur" } } },
            { $sort: { totalEur: -1 } },
            { $limit: limit },
        ]).toArray();
        return rows.map((r) => ({ projectId: r._id, totalEur: r.totalEur ?? 0 }));
    }

    async topProjectsPlatform(fromDate?: Date, toDate?: Date, limit = 20): Promise<Array<{ projectId: string; totalEur: number }>> {
        const db = await getDb();
        const col = db.collection<CostTransactionDocument>(COLLECTION);
        const match: Document = { status: "settled" };
        if (fromDate || toDate) {
            match.createdAt = {};
            if (fromDate) match.createdAt.$gte = fromDate;
            if (toDate) match.createdAt.$lte = toDate;
        }
        const rows = await col.aggregate<{ _id: string; totalEur: number }>([
            { $match: match },
            { $group: { _id: "$projectId", totalEur: { $sum: "$totalEur" } } },
            { $sort: { totalEur: -1 } },
            { $limit: limit },
        ]).toArray();
        return rows.map((r) => ({ projectId: r._id, totalEur: r.totalEur ?? 0 }));
    }

    async voidTransaction(txId: string, voidedByTxId: string): Promise<void> {
        const db = await getDb();
        const col = db.collection<CostTransactionDocument>(COLLECTION);
        await col.updateOne(
            { txId } as unknown as Parameters<typeof col.updateOne>[0],
            { $set: { status: "voided", voidedByTxId } } as Document,
        );
    }
}
