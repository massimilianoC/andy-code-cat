import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { UserPreferences, CreateUserPreferencesInput, UpdateUserPreferencesInput } from "../../domain/entities/UserPreferences";
import type { UserPreferencesRepository } from "../../domain/repositories/UserPreferencesRepository";

interface UserPreferencesDocument {
    _id: string;
    userId: string;
    preferredLanguage: string;
    preferredModel?: string;
    preferredProvider?: string;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: UserPreferencesDocument): UserPreferences {
    return {
        id: doc._id,
        userId: doc.userId,
        preferredLanguage: doc.preferredLanguage ?? "en",
        preferredModel: doc.preferredModel,
        preferredProvider: doc.preferredProvider,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export class MongoUserPreferencesRepository implements UserPreferencesRepository {
    private async collection(): Promise<Collection<UserPreferencesDocument>> {
        const db = await getDb();
        const col = db.collection<UserPreferencesDocument>("user_preferences");
        await col.createIndex({ userId: 1 }, { unique: true });
        return col;
    }

    async findByUserId(userId: string): Promise<UserPreferences | null> {
        const col = await this.collection();
        const doc = await col.findOne({ userId });
        return doc ? toEntity(doc) : null;
    }

    async initForUser(input: CreateUserPreferencesInput): Promise<UserPreferences> {
        const col = await this.collection();
        const now = new Date();
        const id = randomUUID();

        try {
            await col.insertOne({
                _id: id,
                userId: input.userId,
                preferredLanguage: input.preferredLanguage ?? "en",
                preferredModel: input.preferredModel,
                preferredProvider: input.preferredProvider,
                createdAt: now,
                updatedAt: now,
            });
        } catch (err: unknown) {
            // duplicate key — preferences already exist, fall through
            const code = (err as { code?: number }).code;
            if (code !== 11000) throw err;
        }

        const doc = await col.findOne({ userId: input.userId });
        if (!doc) throw new Error("Failed to init user preferences");
        return toEntity(doc);
    }

    async upsert(userId: string, input: UpdateUserPreferencesInput): Promise<UserPreferences> {
        const col = await this.collection();
        const now = new Date();

        const setFields: Partial<UserPreferencesDocument> = { updatedAt: now };
        if (input.preferredLanguage !== undefined) setFields.preferredLanguage = input.preferredLanguage;
        if (input.preferredModel !== undefined) setFields.preferredModel = input.preferredModel;
        if (input.preferredProvider !== undefined) setFields.preferredProvider = input.preferredProvider;

        await col.updateOne(
            { userId },
            {
                $set: setFields,
                $setOnInsert: {
                    _id: randomUUID(),
                    userId,
                    preferredLanguage: input.preferredLanguage ?? "en",
                    createdAt: now,
                },
            },
            { upsert: true }
        );

        const doc = await col.findOne({ userId });
        if (!doc) throw new Error("Failed to persist user preferences");
        return toEntity(doc);
    }
}
