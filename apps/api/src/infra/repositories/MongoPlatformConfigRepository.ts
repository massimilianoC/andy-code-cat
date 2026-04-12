import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { PlatformConfig } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository, UpdatePlatformConfigInput } from "../../domain/repositories/PlatformConfigRepository";
import { DEFAULT_USER_LIMITS } from "../../domain/entities/User";

const COLLECTION = "platform_config";
const SINGLETON_ID = "global";

interface PlatformConfigDocument {
    _id: string;
    registrationOpen: boolean;
    emailVerificationRequired: boolean;
    defaultUserLimits: PlatformConfig["defaultUserLimits"];
    updatedAt: Date;
    updatedByUserId?: string;
}

function toEntity(doc: PlatformConfigDocument): PlatformConfig {
    return {
        id: doc._id,
        registrationOpen: doc.registrationOpen,
        emailVerificationRequired: doc.emailVerificationRequired,
        defaultUserLimits: doc.defaultUserLimits,
        updatedAt: doc.updatedAt,
        updatedByUserId: doc.updatedByUserId,
    };
}

/** Safe defaults applied when the config document does not yet exist in DB. */
const CONFIG_DEFAULTS: Omit<PlatformConfigDocument, "_id" | "updatedAt"> = {
    registrationOpen: true,
    emailVerificationRequired: false,
    defaultUserLimits: { ...DEFAULT_USER_LIMITS },
};

export class MongoPlatformConfigRepository implements PlatformConfigRepository {
    private async col(): Promise<Collection<PlatformConfigDocument>> {
        const db = await getDb();
        return db.collection<PlatformConfigDocument>(COLLECTION);
    }

    async get(): Promise<PlatformConfig | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: SINGLETON_ID });
        return doc ? toEntity(doc) : null;
    }

    async upsert(input: UpdatePlatformConfigInput): Promise<PlatformConfig> {
        const col = await this.col();
        const now = new Date();

        // Merge defaultUserLimits partially if provided
        const existingDoc = await col.findOne({ _id: SINGLETON_ID });
        const baseLimits = existingDoc?.defaultUserLimits ?? { ...DEFAULT_USER_LIMITS };
        const mergedLimits = input.defaultUserLimits
            ? { ...baseLimits, ...input.defaultUserLimits }
            : baseLimits;

        const setFields: Partial<PlatformConfigDocument> = {
            updatedAt: now,
            defaultUserLimits: mergedLimits,
        };
        if (input.registrationOpen !== undefined) {
            setFields.registrationOpen = input.registrationOpen;
        }
        if (input.emailVerificationRequired !== undefined) {
            setFields.emailVerificationRequired = input.emailVerificationRequired;
        }
        if (input.updatedByUserId !== undefined) {
            setFields.updatedByUserId = input.updatedByUserId;
        }

        await col.updateOne(
            { _id: SINGLETON_ID },
            {
                $set: setFields,
                $setOnInsert: {
                    _id: SINGLETON_ID,
                    registrationOpen: CONFIG_DEFAULTS.registrationOpen,
                    emailVerificationRequired: CONFIG_DEFAULTS.emailVerificationRequired,
                },
            },
            { upsert: true }
        );

        const updated = await col.findOne({ _id: SINGLETON_ID });
        if (!updated) {
            throw new Error("Failed to load platform config after upsert");
        }
        return toEntity(updated);
    }
}
