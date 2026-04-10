import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { WysiwygEditSession } from "../../domain/entities/WysiwygEditSession";
import type { WysiwygEditSessionRepository } from "../../domain/repositories/WysiwygEditSessionRepository";

const COLLECTION = "wysiwyg_edit_sessions";

interface WysiwygEditSessionDocument {
    _id: string;
    projectId: string;
    userId: string;
    conversationId: string;
    originSnapshotId: string;
    currentHtml: string;
    currentCss: string;
    currentJs: string;
    committedSnapshotId?: string;
    operationCount: number;
    status: "active" | "committed";
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: WysiwygEditSessionDocument): WysiwygEditSession {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoWysiwygEditSessionRepository implements WysiwygEditSessionRepository {
    private async col(): Promise<Collection<WysiwygEditSessionDocument>> {
        const db = await getDb();
        const col = db.collection<WysiwygEditSessionDocument>(COLLECTION);
        // Ensure index for efficient active-session lookup (idempotent)
        await col.createIndex(
            { projectId: 1, conversationId: 1, originSnapshotId: 1, status: 1 },
            { background: true }
        );
        return col;
    }

    async create(input: {
        projectId: string;
        userId: string;
        conversationId: string;
        originSnapshotId: string;
        currentHtml: string;
        currentCss: string;
        currentJs: string;
    }): Promise<WysiwygEditSession> {
        const col = await this.col();
        const now = new Date();
        const doc: WysiwygEditSessionDocument = {
            _id: randomUUID(),
            projectId: input.projectId,
            userId: input.userId,
            conversationId: input.conversationId,
            originSnapshotId: input.originSnapshotId,
            currentHtml: input.currentHtml,
            currentCss: input.currentCss,
            currentJs: input.currentJs,
            operationCount: 0,
            status: "active",
            createdAt: now,
            updatedAt: now,
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findActive(
        projectId: string,
        conversationId: string,
        originSnapshotId: string
    ): Promise<WysiwygEditSession | null> {
        const col = await this.col();
        const doc = await col.findOne({
            projectId,
            conversationId,
            originSnapshotId,
            status: "active",
        } as Filter<WysiwygEditSessionDocument>);
        return doc ? toEntity(doc) : null;
    }

    async findById(sessionId: string, projectId: string): Promise<WysiwygEditSession | null> {
        const col = await this.col();
        const doc = await col.findOne({
            _id: sessionId,
            projectId,
        } as Filter<WysiwygEditSessionDocument>);
        return doc ? toEntity(doc) : null;
    }

    async saveState(
        sessionId: string,
        projectId: string,
        html: string,
        css: string,
        js: string
    ): Promise<WysiwygEditSession | null> {
        const col = await this.col();
        const result = await col.findOneAndUpdate(
            { _id: sessionId, projectId, status: "active" } as Filter<WysiwygEditSessionDocument>,
            {
                $set: {
                    currentHtml: html,
                    currentCss: css,
                    currentJs: js,
                    updatedAt: new Date(),
                },
                $inc: { operationCount: 1 },
            },
            { returnDocument: "after" }
        );
        return result ? toEntity(result) : null;
    }

    async commit(
        sessionId: string,
        projectId: string,
        committedSnapshotId: string
    ): Promise<WysiwygEditSession | null> {
        const col = await this.col();
        const result = await col.findOneAndUpdate(
            { _id: sessionId, projectId } as Filter<WysiwygEditSessionDocument>,
            {
                $set: {
                    status: "committed",
                    committedSnapshotId,
                    updatedAt: new Date(),
                },
            },
            { returnDocument: "after" }
        );
        return result ? toEntity(result) : null;
    }
}
