import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { AssetGenerationMetadata, AssetGenerationStatus, AssetScope, AssetSemanticMetadata, AssetSource, AssetStyleRole, ProjectAsset, AssetGenerationUsageSummary, AssetGenerationModelSummary } from "../../domain/entities/ProjectAsset";
import type { AssetEnrichmentTrace } from "../../domain/entities/AssetEnrichmentTrace";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";

const COLLECTION = "project_assets";

interface ProjectAssetDocument {
    _id: string;
    projectId: string;
    userId: string;
    originalName: string;
    storedFilename: string;
    mimeType: string;
    fileSize: number;
    source: AssetSource;
    scope: AssetScope;
    label?: string;
    useInProject?: boolean;
    styleRole?: AssetStyleRole;
    descriptionText?: string;
    externalUrl?: string;
    generationStatus?: AssetGenerationStatus;
    generationPrompt?: string;
    generationMetadata?: AssetGenerationMetadata;
    semanticMetadata?: AssetSemanticMetadata;
    enrichmentTrace?: AssetEnrichmentTrace | null;
    createdAt: Date;
}

function toEntity(doc: ProjectAssetDocument): ProjectAsset {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

function buildAccessibleAssetFilter(
    projectId: string,
    userId: string,
    id?: string,
): Filter<ProjectAssetDocument> {
    return {
        ...(id ? { _id: id } : {}),
        userId,
        $or: [
            { projectId },
            { scope: "user" },
        ],
    };
}

export class MongoProjectAssetRepository implements ProjectAssetRepository {
    private async col(): Promise<Collection<ProjectAssetDocument>> {
        const db = await getDb();
        return db.collection<ProjectAssetDocument>(COLLECTION);
    }

    private async summarizeGeneration(match: Filter<ProjectAssetDocument>): Promise<AssetGenerationUsageSummary> {
        const col = await this.col();
        const rows = await col.aggregate<{
            totals?: Array<{ totalCost?: number; totalImages?: number; ready?: number; queued?: number; failed?: number }>;
            topModels?: Array<{
                _id: { provider?: string; model?: string };
                runs?: number;
                totalCost?: number;
            }>;
        }>([
            {
                $match: {
                    ...match,
                    generationMetadata: { $exists: true },
                },
            },
            {
                $facet: {
                    totals: [
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: { $ifNull: ["$generationMetadata.cost.amount", 0] } },
                                totalImages: { $sum: 1 },
                                ready: { $sum: { $cond: [{ $eq: ["$generationStatus", "ready"] }, 1, 0] } },
                                queued: { $sum: { $cond: [{ $eq: ["$generationStatus", "queued"] }, 1, 0] } },
                                failed: { $sum: { $cond: [{ $eq: ["$generationStatus", "failed"] }, 1, 0] } },
                            },
                        },
                    ],
                    topModels: [
                        {
                            $group: {
                                _id: {
                                    provider: { $ifNull: ["$generationMetadata.provider", "system"] },
                                    model: { $ifNull: ["$generationMetadata.model", "unknown"] },
                                },
                                runs: { $sum: 1 },
                                totalCost: { $sum: { $ifNull: ["$generationMetadata.cost.amount", 0] } },
                            },
                        },
                        { $sort: { totalCost: -1, runs: -1 } },
                        { $limit: 6 },
                    ],
                },
            },
        ]).toArray();

        const totals = rows[0]?.totals?.[0];
        const topModels: AssetGenerationModelSummary[] = (rows[0]?.topModels ?? []).map((entry) => ({
            provider: entry._id.provider ?? "system",
            model: entry._id.model ?? "unknown",
            runs: entry.runs ?? 0,
            totalCost: entry.totalCost ?? 0,
        }));

        return {
            totalCost: totals?.totalCost ?? 0,
            totalImages: totals?.totalImages ?? 0,
            ready: totals?.ready ?? 0,
            queued: totals?.queued ?? 0,
            failed: totals?.failed ?? 0,
            topModels,
        };
    }

    async create(input: {
        projectId: string;
        userId: string;
        originalName: string;
        storedFilename: string;
        mimeType: string;
        fileSize: number;
        source: AssetSource;
        scope?: AssetScope;
        label?: string;
        useInProject?: boolean;
        styleRole?: AssetStyleRole;
        descriptionText?: string;
        externalUrl?: string;
        generationStatus?: AssetGenerationStatus;
        generationPrompt?: string;
        generationMetadata?: AssetGenerationMetadata;
        semanticMetadata?: AssetSemanticMetadata;
    }): Promise<ProjectAsset> {
        const col = await this.col();
        const doc: ProjectAssetDocument = {
            _id: randomUUID(),
            ...input,
            scope: input.scope ?? "project",
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async listByProject(projectId: string, userId: string, source?: AssetSource): Promise<ProjectAsset[]> {
        const col = await this.col();
        const filter: Filter<ProjectAssetDocument> = buildAccessibleAssetFilter(projectId, userId);
        if (source) filter.source = source;
        const docs = await col
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toEntity);
    }

    async listByUser(userId: string): Promise<ProjectAsset[]> {
        const col = await this.col();
        const docs = await col
            .find({ userId })
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toEntity);
    }

    async findById(id: string, projectId: string, userId: string): Promise<ProjectAsset | null> {
        const col = await this.col();
        const doc = await col.findOne(buildAccessibleAssetFilter(projectId, userId, id));
        return doc ? toEntity(doc) : null;
    }

    async findByIdPublic(id: string): Promise<ProjectAsset | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id });
        return doc ? toEntity(doc) : null;
    }

    async delete(id: string, projectId: string, userId: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne(buildAccessibleAssetFilter(projectId, userId, id));
        return result.deletedCount === 1;
    }

    /** Total bytes for user_upload assets only (for quota enforcement). */
    async totalProjectSize(projectId: string, userId: string): Promise<number> {
        const col = await this.col();
        const result = await col
            .aggregate<{ total: number }>([
                { $match: { projectId, userId, source: "user_upload" } },
                { $group: { _id: null, total: { $sum: "$fileSize" } } },
            ])
            .toArray();
        return result[0]?.total ?? 0;
    }

    /** Count user_upload assets only (for quota enforcement). */
    async countByProject(projectId: string, userId: string): Promise<number> {
        const col = await this.col();
        return col.countDocuments({ projectId, userId, source: "user_upload" });
    }

    async summarizeGenerationByProject(projectId: string, userId: string): Promise<AssetGenerationUsageSummary> {
        return this.summarizeGeneration({ projectId, userId });
    }

    async summarizeGenerationCostsByUser(userId: string): Promise<Record<string, number>> {
        const col = await this.col();
        const rows = await col.aggregate<{ _id: string; totalCost: number }>([
            { $match: { userId, generationMetadata: { $exists: true } } },
            { $group: { _id: "$projectId", totalCost: { $sum: { $ifNull: ["$generationMetadata.cost.amount", 0] } } } },
        ]).toArray();
        const result: Record<string, number> = {};
        for (const row of rows) {
            result[row._id] = row.totalCost;
        }
        return result;
    }

    async listRecentGeneratedByProject(projectId: string, userId: string, limit = 8): Promise<ProjectAsset[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId, userId, generationMetadata: { $exists: true } })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return docs.map(toEntity);
    }

    async summarizeGenerationAll(): Promise<AssetGenerationUsageSummary> {
        return this.summarizeGeneration({});
    }

    async listRecentGeneratedAll(limit = 10): Promise<ProjectAsset[]> {
        const col = await this.col();
        const docs = await col
            .find({ generationMetadata: { $exists: true } })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return docs.map(toEntity);
    }

    async saveEnrichmentTrace(
        id: string,
        projectId: string,
        trace: AssetEnrichmentTrace,
    ): Promise<ProjectAsset | null> {
        const col = await this.col();
        await col.updateOne(
            { _id: id, projectId },
            { $set: { enrichmentTrace: trace } },
        );
        const doc = await col.findOne({ _id: id, projectId });
        return doc ? toEntity(doc) : null;
    }

    /** Call once at startup to ensure indexes exist. */
    async ensureIndexes(): Promise<void> {
        const col = await this.col();
        await col.createIndex({ projectId: 1, createdAt: -1 });
        await col.createIndex({ userId: 1, scope: 1, createdAt: -1 });
    }

    async update(
        id: string,
        projectId: string,
        userId: string,
        data: Partial<{
            originalName: string;
            storedFilename: string;
            label: string;
            useInProject: boolean;
            styleRole: AssetStyleRole;
            descriptionText: string;
            mimeType: string;
            fileSize: number;
            generationStatus: AssetGenerationStatus;
            generationPrompt: string;
            generationMetadata: AssetGenerationMetadata;
            semanticMetadata: AssetSemanticMetadata;
        }>
    ): Promise<ProjectAsset | null> {
        const col = await this.col();
        const setFields: Record<string, unknown> = {};
        if (data.originalName !== undefined) setFields["originalName"] = data.originalName.slice(0, 255);
        if (data.storedFilename !== undefined) setFields["storedFilename"] = data.storedFilename;
        if (data.label !== undefined) setFields["label"] = data.label;
        if (data.useInProject !== undefined) setFields["useInProject"] = data.useInProject;
        if (data.styleRole !== undefined) setFields["styleRole"] = data.styleRole;
        if (data.descriptionText !== undefined) setFields["descriptionText"] = data.descriptionText;
        if (data.mimeType !== undefined) setFields["mimeType"] = data.mimeType;
        if (data.fileSize !== undefined) setFields["fileSize"] = data.fileSize;
        if (data.generationStatus !== undefined) setFields["generationStatus"] = data.generationStatus;
        if (data.generationPrompt !== undefined) setFields["generationPrompt"] = data.generationPrompt;
        if (data.generationMetadata !== undefined) setFields["generationMetadata"] = data.generationMetadata;
        if (data.semanticMetadata !== undefined) setFields["semanticMetadata"] = data.semanticMetadata;

        if (Object.keys(setFields).length === 0) {
            return this.findById(id, projectId, userId);
        }

        const accessFilter = buildAccessibleAssetFilter(projectId, userId, id);

        await col.updateOne(accessFilter, { $set: setFields });
        const doc = await col.findOne(accessFilter);
        return doc ? toEntity(doc) : null;
    }
}
