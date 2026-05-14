import { ObjectId, type Collection } from "mongodb";
import { getDb } from "../db/mongo";
import { CryptoService } from "../security/CryptoService";
import { env } from "../../config";
import type { ServiceApiKey } from "../../domain/entities/ServiceApiKey";
import type {
    ServiceApiKeyRepository,
    CreateServiceApiKeyInput,
    UpdateServiceApiKeyInput,
} from "../../domain/repositories/ServiceApiKeyRepository";

const COLLECTION = "service_api_keys";

interface ServiceApiKeyDocument {
    _id: ObjectId;
    service: string;
    label: string;
    category: ServiceApiKey["category"];
    ownerType: ServiceApiKey["ownerType"];
    ownerUserId?: string;
    encryptedKey: string;
    iv: string;
    authTag: string;
    enabled: boolean;
    supportsVideo: boolean;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdByUserId: string;
}

function toEntity(doc: ServiceApiKeyDocument): ServiceApiKey {
    return {
        id: doc._id.toHexString(),
        service: doc.service,
        label: doc.label,
        category: doc.category,
        ownerType: doc.ownerType,
        ownerUserId: doc.ownerUserId,
        encryptedKey: doc.encryptedKey,
        iv: doc.iv,
        authTag: doc.authTag,
        enabled: doc.enabled,
        supportsVideo: doc.supportsVideo,
        isDefault: doc.isDefault,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        createdByUserId: doc.createdByUserId,
    };
}

export class MongoServiceApiKeyRepository implements ServiceApiKeyRepository {
    private readonly crypto: CryptoService;

    constructor() {
        this.crypto = new CryptoService(env.JWT_ACCESS_SECRET, env.MONGODB_DB_NAME);
        void this.ensureIndexes();
    }

    private async col(): Promise<Collection<ServiceApiKeyDocument>> {
        const db = await getDb();
        return db.collection<ServiceApiKeyDocument>(COLLECTION);
    }

    private async ensureIndexes(): Promise<void> {
        try {
            const col = await this.col();
            await col.createIndex({ service: 1, ownerType: 1, enabled: 1 });
            await col.createIndex({ service: 1, ownerType: 1, ownerUserId: 1, enabled: 1 });
        } catch {
            // Indexes are best-effort; do not block startup
        }
    }

    async findAllPlatform(): Promise<ServiceApiKey[]> {
        const col = await this.col();
        const docs = await col.find({ ownerType: "platform" })
            .sort({ service: 1 })
            .toArray();
        return docs.map(toEntity);
    }

    async findByUserId(userId: string): Promise<ServiceApiKey[]> {
        const col = await this.col();
        const docs = await col.find({ ownerType: "user", ownerUserId: userId })
            .sort({ service: 1 })
            .toArray();
        return docs.map(toEntity);
    }

    async findById(id: string): Promise<ServiceApiKey | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: new ObjectId(id) });
        return doc ? toEntity(doc) : null;
    }

    async findActiveByService(service: string, userId?: string): Promise<ServiceApiKey | null> {
        const col = await this.col();
        // User override takes priority over platform default
        if (userId) {
            const userKey = await col.findOne({
                service,
                ownerType: "user",
                ownerUserId: userId,
                enabled: true,
            });
            if (userKey) return toEntity(userKey);
        }

        const platformKey = await col.findOne({
            service,
            ownerType: "platform",
            enabled: true,
        });
        return platformKey ? toEntity(platformKey) : null;
    }

    async create(input: CreateServiceApiKeyInput): Promise<ServiceApiKey> {
        const { encryptedKey, iv, authTag } = this.crypto.encrypt(input.plaintextKey);
        const now = new Date();
        const doc: Omit<ServiceApiKeyDocument, "_id"> = {
            service: input.service.toLowerCase().trim(),
            label: input.label,
            category: input.category,
            ownerType: input.ownerType,
            ownerUserId: input.ownerUserId,
            encryptedKey,
            iv,
            authTag,
            enabled: input.enabled ?? true,
            supportsVideo: input.supportsVideo ?? false,
            isDefault: input.isDefault ?? false,
            createdAt: now,
            updatedAt: now,
            createdByUserId: input.createdByUserId,
        };

        const col = await this.col();
        const result = await col.insertOne(doc as ServiceApiKeyDocument);
        return toEntity({ ...doc, _id: result.insertedId } as ServiceApiKeyDocument);
    }

    async update(id: string, input: UpdateServiceApiKeyInput): Promise<ServiceApiKey> {
        const set: Partial<ServiceApiKeyDocument> = { updatedAt: new Date() };

        if (input.label !== undefined) set.label = input.label;
        if (input.enabled !== undefined) set.enabled = input.enabled;
        if (input.supportsVideo !== undefined) set.supportsVideo = input.supportsVideo;
        if (input.isDefault !== undefined) set.isDefault = input.isDefault;

        if (input.plaintextKey) {
            const { encryptedKey, iv, authTag } = this.crypto.encrypt(input.plaintextKey);
            set.encryptedKey = encryptedKey;
            set.iv = iv;
            set.authTag = authTag;
        }

        const col = await this.col();
        const doc = await col.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: set },
            { returnDocument: "after" },
        );
        if (!doc) throw new Error(`ServiceApiKey ${id} not found`);
        return toEntity(doc);
    }

    async delete(id: string): Promise<void> {
        const col = await this.col();
        await col.deleteOne({ _id: new ObjectId(id) });
    }

    async resolvePlaintext(key: ServiceApiKey): Promise<string> {
        return this.crypto.decrypt(key.encryptedKey, key.iv, key.authTag);
    }
}
