import { ObjectId, type Collection } from "mongodb";
import type { Session } from "../../domain/entities/Session";
import type { CreateSessionInput, SessionRepository, UpdateSessionRefreshInput } from "../../domain/repositories/SessionRepository";
import { getDb } from "../db/mongo";

interface SessionDocument {
    _id: ObjectId;
    userId: ObjectId;
    projectId: ObjectId;
    tokenId?: string;
    refreshTokenHash: string;
    createdAt: Date;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
}

function mapDocument(doc: SessionDocument): Session {
    return {
        id: doc._id.toHexString(),
        userId: doc.userId.toHexString(),
        projectId: doc.projectId.toHexString(),
        tokenId: doc.tokenId,
        refreshTokenHash: doc.refreshTokenHash,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        ip: doc.ip,
        userAgent: doc.userAgent
    };
}

export class MongoSessionRepository implements SessionRepository {
    private async collection(): Promise<Collection<SessionDocument>> {
        const db = await getDb();
        return db.collection<SessionDocument>("sessions");
    }

    async create(input: CreateSessionInput): Promise<Session> {
        const collection = await this.collection();
        const now = new Date();

        const result = await collection.insertOne({
            _id: new ObjectId(),
            userId: new ObjectId(input.userId),
            projectId: new ObjectId(input.projectId),
            tokenId: input.tokenId,
            refreshTokenHash: input.refreshTokenHash,
            createdAt: now,
            expiresAt: input.expiresAt,
            ip: input.ip,
            userAgent: input.userAgent
        });

        const created = await collection.findOne({ _id: result.insertedId });
        if (!created) {
            throw new Error("Cannot load created session");
        }

        return mapDocument(created);
    }

    async findActiveByTokenId(tokenId: string): Promise<Session | null> {
        const collection = await this.collection();
        const now = new Date();

        const doc = await collection.findOne({
            tokenId,
            expiresAt: { $gt: now }
        });

        return doc ? mapDocument(doc) : null;
    }

    async findActiveByUserId(userId: string): Promise<Session | null> {
        const collection = await this.collection();
        const now = new Date();

        const doc = await collection.findOne({
            userId: new ObjectId(userId),
            expiresAt: { $gt: now }
        }, {
            sort: { createdAt: -1 }
        });

        return doc ? mapDocument(doc) : null;
    }

    async updateRefreshToken(sessionId: string, input: UpdateSessionRefreshInput): Promise<Session | null> {
        const collection = await this.collection();
        const _id = new ObjectId(sessionId);

        await collection.updateOne(
            { _id },
            {
                $set: {
                    tokenId: input.tokenId,
                    refreshTokenHash: input.refreshTokenHash,
                    expiresAt: input.expiresAt,
                    ip: input.ip,
                    userAgent: input.userAgent,
                }
            }
        );

        const updated = await collection.findOne({ _id });
        return updated ? mapDocument(updated) : null;
    }

    async deleteAllByUserId(userId: string): Promise<number> {
        const collection = await this.collection();
        const result = await collection.deleteMany({ userId: new ObjectId(userId) });
        return result.deletedCount;
    }
}
