import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { ProjectAsset, AssetSource } from "../../domain/entities/ProjectAsset";
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
    label?: string;
    useInProject?: boolean;
    styleRole?: "inspiration" | "material";
    descriptionText?: string;
    externalUrl?: string;
    createdAt: Date;
}

function toEntity(doc: ProjectAssetDocument): ProjectAsset {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoProjectAssetRepository implements ProjectAssetRepository {
    private async col(): Promise<Collection<ProjectAssetDocument>> {
        const db = await getDb();
        return db.collection<ProjectAssetDocument>(COLLECTION);
    }

    async create(input: {
        projectId: string;
        userId: string;
        originalName: string;
        storedFilename: string;
        mimeType: string;
        fileSize: number;
        source: AssetSource;
        label?: string;
        useInProject?: boolean;
        styleRole?: "inspiration" | "material";
        descriptionText?: string;
        externalUrl?: string;
    }): Promise<ProjectAsset> {
        const col = await this.col();
        const doc: ProjectAssetDocument = {
            _id: randomUUID(),
            ...input,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async listByProject(projectId: string, userId: string, source?: AssetSource): Promise<ProjectAsset[]> {
        const col = await this.col();
        const filter: Record<string, unknown> = { projectId, userId };
        if (source) filter["source"] = source;
        const docs = await col
            .find(filter)
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toEntity);
    }

    async findById(id: string, projectId: string, userId: string): Promise<ProjectAsset | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id, projectId, userId });
        return doc ? toEntity(doc) : null;
    }

    async delete(id: string, projectId: string, userId: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne({ _id: id, projectId, userId });
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

    /** Call once at startup to ensure indexes exist. */
    async ensureIndexes(): Promise<void> {
        const col = await this.col();
        await col.createIndex({ projectId: 1, createdAt: -1 });
        await col.createIndex({ userId: 1 });
    }

    async update(
        id: string,
        projectId: string,
        userId: string,
        data: Partial<{ label: string; useInProject: boolean; styleRole: "inspiration" | "material"; descriptionText: string }>
    ): Promise<ProjectAsset | null> {
        const col = await this.col();
        const setFields: Record<string, unknown> = {};
        if (data.label !== undefined) setFields["label"] = data.label;
        if (data.useInProject !== undefined) setFields["useInProject"] = data.useInProject;
        if (data.styleRole !== undefined) setFields["styleRole"] = data.styleRole;
        if (data.descriptionText !== undefined) setFields["descriptionText"] = data.descriptionText;

        if (Object.keys(setFields).length === 0) {
            return this.findById(id, projectId, userId);
        }

        await col.updateOne({ _id: id, projectId, userId }, { $set: setFields });
        const doc = await col.findOne({ _id: id, projectId, userId });
        return doc ? toEntity(doc) : null;
    }
}
