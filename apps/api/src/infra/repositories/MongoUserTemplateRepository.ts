import { randomUUID } from "crypto";
import type { Collection, WithId } from "mongodb";
import { getDb } from "../db/mongo";
import type {
    UserTemplate,
    UserTemplateStatus,
    CreateUserTemplateInput,
} from "../../domain/entities/UserTemplate";
import type { UserTemplateRepository } from "../../domain/repositories/UserTemplateRepository";
import type { FormatHint } from "@andy-code-cat/contracts";

interface UserTemplateDocument {
    _id: string;
    ownerId: string;
    tenantId: string;
    name: string;
    description: string;
    formatHint: FormatHint | null;
    sectorKeywords: string[];
    prepromptBlock: string;
    sourceJobId: string | null;
    isSystem: boolean;
    status: UserTemplateStatus;
    usageCount: number;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: WithId<UserTemplateDocument>): UserTemplate {
    return {
        id: doc._id,
        ownerId: doc.ownerId,
        tenantId: doc.tenantId,
        name: doc.name,
        description: doc.description ?? "",
        formatHint: doc.formatHint ?? null,
        sectorKeywords: doc.sectorKeywords ?? [],
        prepromptBlock: doc.prepromptBlock,
        sourceJobId: doc.sourceJobId ?? null,
        isSystem: doc.isSystem ?? false,
        status: doc.status,
        usageCount: doc.usageCount ?? 0,
        lastUsedAt: doc.lastUsedAt ?? null,
        expiresAt: doc.expiresAt ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export class MongoUserTemplateRepository implements UserTemplateRepository {
    private async collection(): Promise<Collection<UserTemplateDocument>> {
        const db = await getDb();
        const col = db.collection<UserTemplateDocument>("user_templates");
        // Compound index for owner catalog queries
        await col.createIndex({ ownerId: 1, status: 1 });
        // System template catalog queries
        await col.createIndex({ tenantId: 1, isSystem: 1, status: 1 });
        // TTL index — MongoDB purges documents when expiresAt is in the past
        await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
        return col;
    }

    async findByOwner(ownerId: string, status?: UserTemplateStatus): Promise<UserTemplate[]> {
        const col = await this.collection();
        const filter: Record<string, unknown> = { ownerId };
        if (status) filter.status = status;
        const docs = await col.find(filter).sort({ createdAt: -1 }).toArray();
        return docs.map(toEntity);
    }

    async findSystemTemplates(tenantId: string): Promise<UserTemplate[]> {
        const col = await this.collection();
        const docs = await col
            .find({ tenantId, isSystem: true, status: "active" })
            .sort({ usageCount: -1 })
            .toArray();
        return docs.map(toEntity);
    }

    async findById(id: string): Promise<UserTemplate | null> {
        const col = await this.collection();
        const doc = await col.findOne({ _id: id });
        return doc ? toEntity(doc) : null;
    }

    async create(data: CreateUserTemplateInput): Promise<UserTemplate> {
        const col = await this.collection();
        const now = new Date();
        const doc: UserTemplateDocument = {
            _id: randomUUID(),
            ownerId: data.ownerId,
            tenantId: data.tenantId,
            name: data.name,
            description: data.description,
            formatHint: data.formatHint,
            sectorKeywords: data.sectorKeywords,
            prepromptBlock: data.prepromptBlock,
            sourceJobId: data.sourceJobId,
            isSystem: false,
            status: data.status,
            usageCount: 0,
            lastUsedAt: null,
            expiresAt: data.expiresAt,
            createdAt: now,
            updatedAt: now,
        };
        await col.insertOne(doc);
        return toEntity(doc as WithId<UserTemplateDocument>);
    }

    async activate(id: string): Promise<void> {
        const col = await this.collection();
        await col.updateOne(
            { _id: id },
            { $set: { status: "active", expiresAt: null, updatedAt: new Date() } },
        );
    }

    async archive(id: string): Promise<void> {
        const col = await this.collection();
        await col.updateOne(
            { _id: id },
            { $set: { status: "archived", updatedAt: new Date() } },
        );
    }

    async promoteToSystem(id: string): Promise<void> {
        const col = await this.collection();
        await col.updateOne(
            { _id: id },
            { $set: { isSystem: true, updatedAt: new Date() } },
        );
    }

    async incrementUsage(id: string): Promise<void> {
        const col = await this.collection();
        await col.updateOne(
            { _id: id },
            { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date(), updatedAt: new Date() } },
        );
    }
}
