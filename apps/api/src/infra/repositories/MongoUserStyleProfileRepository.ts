import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { UserStyleProfile, CreateUserStyleProfileInput, UpdateUserStyleProfileInput } from "../../domain/entities/UserStyleProfile";
import type { UserStyleProfileRepository } from "../../domain/repositories/UserStyleProfileRepository";

interface UserStyleProfileDocument {
    _id: string;
    userId: string;
    onboardingCompleted: boolean;
    onboardingStep: number;
    identityTags: string[];
    sectorTags: string[];
    audienceTags: string[];
    visualTags: string[];
    paletteTags: string[];
    typographyTags: string[];
    layoutTags: string[];
    toneTags: string[];
    referenceTags: string[];
    featureTags: string[];
    brandBio?: string;
    preferredColorText?: string;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: UserStyleProfileDocument): UserStyleProfile {
    return {
        id: doc._id,
        userId: doc.userId,
        onboardingCompleted: doc.onboardingCompleted,
        onboardingStep: doc.onboardingStep,
        identityTags: doc.identityTags ?? [],
        sectorTags: doc.sectorTags ?? [],
        audienceTags: doc.audienceTags ?? [],
        visualTags: doc.visualTags ?? [],
        paletteTags: doc.paletteTags ?? [],
        typographyTags: doc.typographyTags ?? [],
        layoutTags: doc.layoutTags ?? [],
        toneTags: doc.toneTags ?? [],
        referenceTags: doc.referenceTags ?? [],
        featureTags: doc.featureTags ?? [],
        brandBio: doc.brandBio,
        preferredColorText: doc.preferredColorText,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export class MongoUserStyleProfileRepository implements UserStyleProfileRepository {
    private async collection(): Promise<Collection<UserStyleProfileDocument>> {
        const db = await getDb();
        const col = db.collection<UserStyleProfileDocument>("user_style_profiles");
        await col.createIndex({ userId: 1 }, { unique: true });
        return col;
    }

    async findByUserId(userId: string): Promise<UserStyleProfile | null> {
        const col = await this.collection();
        const doc = await col.findOne({ userId });
        return doc ? toEntity(doc) : null;
    }

    async initForUser(input: CreateUserStyleProfileInput): Promise<UserStyleProfile> {
        const col = await this.collection();
        const now = new Date();
        const id = randomUUID();

        // insertOne with duplicate-key handling — if already exists, just return existing
        try {
            await col.insertOne({
                _id: id,
                userId: input.userId,
                onboardingCompleted: false,
                onboardingStep: 0,
                identityTags: [],
                sectorTags: [],
                audienceTags: [],
                visualTags: [],
                paletteTags: [],
                typographyTags: [],
                layoutTags: [],
                toneTags: [],
                referenceTags: [],
                featureTags: [],
                createdAt: now,
                updatedAt: now,
            });
        } catch (err: unknown) {
            // duplicate key — profile already exists, fall through
            const code = (err as { code?: number }).code;
            if (code !== 11000) throw err;
        }

        const doc = await col.findOne({ userId: input.userId });
        if (!doc) throw new Error("Failed to init user style profile");
        return toEntity(doc);
    }

    async upsert(userId: string, input: UpdateUserStyleProfileInput): Promise<UserStyleProfile> {
        const col = await this.collection();
        const now = new Date();

        const setFields: Partial<UserStyleProfileDocument> = { updatedAt: now };
        if (input.onboardingCompleted !== undefined) setFields.onboardingCompleted = input.onboardingCompleted;
        if (input.onboardingStep !== undefined) setFields.onboardingStep = input.onboardingStep;
        if (input.identityTags !== undefined) setFields.identityTags = input.identityTags;
        if (input.sectorTags !== undefined) setFields.sectorTags = input.sectorTags;
        if (input.audienceTags !== undefined) setFields.audienceTags = input.audienceTags;
        if (input.visualTags !== undefined) setFields.visualTags = input.visualTags;
        if (input.paletteTags !== undefined) setFields.paletteTags = input.paletteTags;
        if (input.typographyTags !== undefined) setFields.typographyTags = input.typographyTags;
        if (input.layoutTags !== undefined) setFields.layoutTags = input.layoutTags;
        if (input.toneTags !== undefined) setFields.toneTags = input.toneTags;
        if (input.referenceTags !== undefined) setFields.referenceTags = input.referenceTags;
        if (input.featureTags !== undefined) setFields.featureTags = input.featureTags;
        if (input.brandBio !== undefined) setFields.brandBio = input.brandBio;
        if (input.preferredColorText !== undefined) setFields.preferredColorText = input.preferredColorText;

        // $setOnInsert must NOT overlap with $set paths (MongoDB conflict error).
        // Only include default values for fields that are NOT already being set.
        const setOnInsert: Record<string, unknown> = {
            _id: randomUUID(),
            userId,
            createdAt: now,
        };
        if (!('onboardingCompleted' in setFields)) setOnInsert.onboardingCompleted = false;
        if (!('onboardingStep' in setFields)) setOnInsert.onboardingStep = 0;
        if (!('identityTags' in setFields)) setOnInsert.identityTags = [];
        if (!('sectorTags' in setFields)) setOnInsert.sectorTags = [];
        if (!('audienceTags' in setFields)) setOnInsert.audienceTags = [];
        if (!('visualTags' in setFields)) setOnInsert.visualTags = [];
        if (!('paletteTags' in setFields)) setOnInsert.paletteTags = [];
        if (!('typographyTags' in setFields)) setOnInsert.typographyTags = [];
        if (!('layoutTags' in setFields)) setOnInsert.layoutTags = [];
        if (!('toneTags' in setFields)) setOnInsert.toneTags = [];
        if (!('referenceTags' in setFields)) setOnInsert.referenceTags = [];
        if (!('featureTags' in setFields)) setOnInsert.featureTags = [];

        await col.updateOne(
            { userId },
            { $set: setFields, $setOnInsert: setOnInsert },
            { upsert: true }
        );

        const doc = await col.findOne({ userId });
        if (!doc) throw new Error("Failed to persist user style profile");
        return toEntity(doc);
    }
}
