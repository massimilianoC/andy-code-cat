import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

const COLLECTION = "preview_snapshots";

interface PreviewSnapshotDocument {
    _id: string;
    projectId: string;
    conversationId: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    isActive: boolean;
    artifacts: PreviewSnapshot["artifacts"];
    focusContext?: PreviewSnapshot["focusContext"];
    metadata?: PreviewSnapshot["metadata"];
    createdAt: Date;
    activatedAt?: Date;
}

function toEntity(doc: PreviewSnapshotDocument): PreviewSnapshot {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoPreviewSnapshotRepository implements PreviewSnapshotRepository {
    private async col(): Promise<Collection<PreviewSnapshotDocument>> {
        const db = await getDb();
        return db.collection<PreviewSnapshotDocument>(COLLECTION);
    }

    async create(input: {
        projectId: string;
        conversationId: string;
        sourceMessageId?: string;
        parentSnapshotId?: string;
        artifacts: PreviewSnapshot["artifacts"];
        focusContext?: PreviewSnapshot["focusContext"];
        metadata?: PreviewSnapshot["metadata"];
        activate: boolean;
    }): Promise<PreviewSnapshot> {
        const col = await this.col();

        if (input.activate) {
            await col.updateMany(
                { projectId: input.projectId } as Filter<PreviewSnapshotDocument>,
                { $set: { isActive: false } }
            );
        }

        const now = new Date();
        const doc: PreviewSnapshotDocument = {
            _id: randomUUID(),
            projectId: input.projectId,
            conversationId: input.conversationId,
            sourceMessageId: input.sourceMessageId,
            parentSnapshotId: input.parentSnapshotId,
            isActive: input.activate,
            artifacts: input.artifacts,
            focusContext: input.focusContext,
            metadata: input.metadata,
            createdAt: now,
            activatedAt: input.activate ? now : undefined,
        };

        await col.insertOne(doc);
        return toEntity(doc);
    }

    async listByConversation(projectId: string, conversationId: string): Promise<PreviewSnapshot[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId, conversationId } as Filter<PreviewSnapshotDocument>)
            .sort({ createdAt: -1 })
            .toArray();

        return docs.map(toEntity);
    }

    async listByProject(projectId: string): Promise<PreviewSnapshot[]> {
        const col = await this.col();
        const docs = await col
            .find({ projectId } as Filter<PreviewSnapshotDocument>)
            .sort({ createdAt: -1 })
            .toArray();
        return docs.map(toEntity);
    }

    async findById(projectId: string, snapshotId: string): Promise<PreviewSnapshot | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: snapshotId, projectId } as Filter<PreviewSnapshotDocument>);
        return doc ? toEntity(doc) : null;
    }

    async getActive(projectId: string, conversationId: string): Promise<PreviewSnapshot | null> {
        const col = await this.col();
        const doc = await col.findOne({ projectId, conversationId, isActive: true } as Filter<PreviewSnapshotDocument>);
        return doc ? toEntity(doc) : null;
    }

    async getActiveForProject(projectId: string): Promise<PreviewSnapshot | null> {
        const col = await this.col();
        const doc = await col.findOne({ projectId, isActive: true } as Filter<PreviewSnapshotDocument>);
        return doc ? toEntity(doc) : null;
    }

    async activate(projectId: string, conversationId: string, snapshotId: string): Promise<PreviewSnapshot | null> {
        const col = await this.col();

        const target = await col.findOne({ _id: snapshotId, projectId, conversationId } as Filter<PreviewSnapshotDocument>);
        if (!target) return null;

        await col.updateMany(
            { projectId } as Filter<PreviewSnapshotDocument>,
            { $set: { isActive: false } }
        );

        const now = new Date();
        await col.updateOne(
            { _id: snapshotId, projectId, conversationId } as Filter<PreviewSnapshotDocument>,
            { $set: { isActive: true, activatedAt: now } }
        );

        const updated = await col.findOne({ _id: snapshotId, projectId, conversationId } as Filter<PreviewSnapshotDocument>);
        return updated ? toEntity(updated) : null;
    }

    async activateForProject(projectId: string, snapshotId: string): Promise<PreviewSnapshot | null> {
        const col = await this.col();

        const target = await col.findOne({ _id: snapshotId, projectId } as Filter<PreviewSnapshotDocument>);
        if (!target) return null;

        await col.updateMany(
            { projectId } as Filter<PreviewSnapshotDocument>,
            { $set: { isActive: false } }
        );

        const now = new Date();
        await col.updateOne(
            { _id: snapshotId, projectId } as Filter<PreviewSnapshotDocument>,
            { $set: { isActive: true, activatedAt: now } }
        );

        const updated = await col.findOne({ _id: snapshotId, projectId } as Filter<PreviewSnapshotDocument>);
        return updated ? toEntity(updated) : null;
    }

    async deleteById(projectId: string, snapshotId: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne({ _id: snapshotId, projectId } as Filter<PreviewSnapshotDocument>);
        return result.deletedCount === 1;
    }
}
