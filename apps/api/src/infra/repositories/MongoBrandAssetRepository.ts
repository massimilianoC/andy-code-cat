import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { BrandAsset, BrandAssetScope, CreateBrandAssetInput, UpdateBrandAssetInput } from "../../domain/entities/BrandAsset";
import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";

interface BrandAssetDocument {
    _id: string;
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: string;
    customRoleLabel?: string;
    policy: string;
    valueType: string;
    storedFilename?: string;
    originalName?: string;
    mimeType?: string;
    fileSize?: number;
    promotedFromAssetId?: string;
    textValue?: string;
    description?: string;
    isActive: boolean;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: BrandAssetDocument): BrandAsset {
    return {
        id: doc._id,
        scope: doc.scope,
        ownerUserId: doc.ownerUserId,
        projectId: doc.projectId,
        role: doc.role as BrandAsset["role"],
        customRoleLabel: doc.customRoleLabel,
        policy: doc.policy as BrandAsset["policy"],
        valueType: doc.valueType as BrandAsset["valueType"],
        storedFilename: doc.storedFilename,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        promotedFromAssetId: doc.promotedFromAssetId,
        textValue: doc.textValue,
        description: doc.description,
        isActive: doc.isActive,
        priority: doc.priority,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export class MongoBrandAssetRepository implements BrandAssetRepository {
    private async collection(): Promise<Collection<BrandAssetDocument>> {
        const db = await getDb();
        const col = db.collection<BrandAssetDocument>("brand_assets");
        await col.createIndex({ scope: 1, ownerUserId: 1 });
        await col.createIndex({ scope: 1, projectId: 1, ownerUserId: 1 });
        await col.createIndex({ scope: 1, isActive: 1 });
        return col;
    }

    async findById(id: string): Promise<BrandAsset | null> {
        const col = await this.collection();
        const doc = await col.findOne({ _id: id });
        return doc ? toEntity(doc) : null;
    }

    async listPlatform(): Promise<BrandAsset[]> {
        const col = await this.collection();
        const docs = await col.find({ scope: "platform" }).sort({ priority: 1, createdAt: 1 }).toArray();
        return docs.map(toEntity);
    }

    async listByUser(userId: string): Promise<BrandAsset[]> {
        const col = await this.collection();
        const docs = await col.find({ scope: "user", ownerUserId: userId }).sort({ priority: 1, createdAt: 1 }).toArray();
        return docs.map(toEntity);
    }

    async listByProject(projectId: string, userId: string): Promise<BrandAsset[]> {
        const col = await this.collection();
        const docs = await col.find({ scope: "project", projectId, ownerUserId: userId }).sort({ priority: 1, createdAt: 1 }).toArray();
        return docs.map(toEntity);
    }

    async resolveForContext({ userId, projectId }: { userId?: string; projectId?: string }): Promise<BrandAsset[]> {
        const col = await this.collection();
        const conditions: Filter<BrandAssetDocument>[] = [
            { scope: "platform", isActive: true },
        ];
        if (userId) conditions.push({ scope: "user", ownerUserId: userId, isActive: true });
        if (projectId && userId) conditions.push({ scope: "project", projectId, ownerUserId: userId, isActive: true });
        const docs = await col.find({ $or: conditions }).sort({ scope: 1, priority: 1, createdAt: 1 }).toArray();
        return docs.map(toEntity);
    }

    async create(input: CreateBrandAssetInput): Promise<BrandAsset> {
        const col = await this.collection();
        const now = new Date();
        const doc: BrandAssetDocument = {
            _id: randomUUID(),
            ...input,
            createdAt: now,
            updatedAt: now,
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async update(id: string, patch: UpdateBrandAssetInput): Promise<BrandAsset> {
        const col = await this.collection();
        const result = await col.findOneAndUpdate(
            { _id: id },
            { $set: { ...patch, updatedAt: new Date() } },
            { returnDocument: "after" },
        );
        if (!result) throw new Error(`BrandAsset ${id} not found`);
        return toEntity(result);
    }

    async delete(id: string): Promise<boolean> {
        const col = await this.collection();
        const result = await col.deleteOne({ _id: id });
        return result.deletedCount > 0;
    }
}
