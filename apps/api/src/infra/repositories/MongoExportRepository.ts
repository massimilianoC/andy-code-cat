import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { ExportRecord, ExportSourceType, AssetPlaceholder } from "../../domain/entities/ExportRecord";
import type { ExportRepository } from "../../domain/repositories/ExportRepository";

const COLLECTION = "export_records";

interface ExportRecordDocument {
    _id: string;
    projectId: string;
    userId: string;
    sourceType: ExportSourceType;
    snapshotId?: string;
    status: "pending" | "ready" | "failed";
    fileSize?: number;
    fileSha256?: string;
    filesIncluded: string[];
    assetPlaceholders: AssetPlaceholder[];
    downloadCount: number;
    expiresAt: Date;
    errorMessage?: string;
    createdAt: Date;
    readyAt?: Date;
}

function toEntity(doc: ExportRecordDocument): ExportRecord {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoExportRepository implements ExportRepository {
    private async col(): Promise<Collection<ExportRecordDocument>> {
        const db = await getDb();
        return db.collection<ExportRecordDocument>(COLLECTION);
    }

    async create(input: {
        projectId: string;
        userId: string;
        sourceType: ExportSourceType;
        snapshotId?: string;
        filesIncluded: string[];
        assetPlaceholders: AssetPlaceholder[];
        expiresAt: Date;
    }): Promise<ExportRecord> {
        const col = await this.col();
        const doc: ExportRecordDocument = {
            _id: randomUUID(),
            ...input,
            status: "pending",
            downloadCount: 0,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findById(id: string): Promise<ExportRecord | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id });
        return doc ? toEntity(doc) : null;
    }

    async updateReady(id: string, data: { fileSize: number; fileSha256: string }): Promise<ExportRecord | null> {
        const col = await this.col();
        const result = await col.findOneAndUpdate(
            { _id: id },
            { $set: { status: "ready", fileSize: data.fileSize, fileSha256: data.fileSha256, readyAt: new Date() } },
            { returnDocument: "after" }
        );
        return result ? toEntity(result) : null;
    }

    async updateFailed(id: string, errorMessage: string): Promise<ExportRecord | null> {
        const col = await this.col();
        const result = await col.findOneAndUpdate(
            { _id: id },
            { $set: { status: "failed", errorMessage } },
            { returnDocument: "after" }
        );
        return result ? toEntity(result) : null;
    }

    async incrementDownloadCount(id: string): Promise<void> {
        const col = await this.col();
        await col.updateOne({ _id: id }, { $inc: { downloadCount: 1 } });
    }

    /** Call once at startup to ensure indexes exist. */
    async ensureIndexes(): Promise<void> {
        const col = await this.col();
        await col.createIndex({ projectId: 1, createdAt: -1 });
        await col.createIndex({ userId: 1 });
        // TTL index: MongoDB will delete documents after expiresAt
        await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    }
}
