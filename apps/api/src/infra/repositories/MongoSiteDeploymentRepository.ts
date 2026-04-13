import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { SiteDeployment, SiteDeploymentStatus } from "../../domain/entities/SiteDeployment";
import type { SiteDeploymentRepository, CreateSiteDeploymentInput, ListDeploymentsResult } from "../../domain/repositories/SiteDeploymentRepository";

const COLLECTION = "site_deployments";

interface SiteDeploymentDocument {
    _id: string;
    publishId: string;
    customSlug?: string;
    projectId: string;
    userId: string;
    snapshotId: string;
    status: SiteDeploymentStatus;
    url: string;
    filesDeployed: string[];
    errorMessage?: string;
    isAdminBlocked?: boolean;
    adminBlockedAt?: Date;
    adminBlockedByUserId?: string;
    createdAt: Date;
    updatedAt: Date;
    deployedAt?: Date;
}

function toEntity(doc: SiteDeploymentDocument): SiteDeployment {
    return {
        id: doc._id,
        publishId: doc.publishId,
        customSlug: doc.customSlug,
        projectId: doc.projectId,
        userId: doc.userId,
        snapshotId: doc.snapshotId,
        status: doc.status,
        url: doc.url,
        filesDeployed: doc.filesDeployed,
        errorMessage: doc.errorMessage,
        isAdminBlocked: doc.isAdminBlocked,
        adminBlockedAt: doc.adminBlockedAt,
        adminBlockedByUserId: doc.adminBlockedByUserId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        deployedAt: doc.deployedAt,
    };
}

export class MongoSiteDeploymentRepository implements SiteDeploymentRepository {
    private async col(): Promise<Collection<SiteDeploymentDocument>> {
        const db = await getDb();
        return db.collection<SiteDeploymentDocument>(COLLECTION);
    }

    async create(input: CreateSiteDeploymentInput): Promise<SiteDeployment> {
        const col = await this.col();
        const now = new Date();
        const doc: SiteDeploymentDocument = {
            _id: randomUUID(),
            publishId: input.publishId,
            ...(input.customSlug ? { customSlug: input.customSlug } : {}),
            projectId: input.projectId,
            userId: input.userId,
            snapshotId: input.snapshotId,
            status: "deploying",
            url: input.url,
            filesDeployed: input.filesDeployed,
            createdAt: now,
            updatedAt: now,
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async findById(id: string): Promise<SiteDeployment | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: id });
        return doc ? toEntity(doc) : null;
    }

    async findByPublishId(publishId: string): Promise<SiteDeployment | null> {
        const col = await this.col();
        const doc = await col.findOne({ publishId, status: "live" });
        return doc ? toEntity(doc) : null;
    }

    async findActiveByProjectId(projectId: string): Promise<SiteDeployment | null> {
        const col = await this.col();
        const doc = await col.findOne(
            { projectId, status: "live" },
            { sort: { updatedAt: -1 } }
        );
        return doc ? toEntity(doc) : null;
    }

    async findByProjectId(projectId: string): Promise<SiteDeployment[]> {
        const col = await this.col();
        const docs = await col.find({ projectId }).sort({ createdAt: -1 }).toArray();
        return docs.map(toEntity);
    }

    async updateStatus(
        id: string,
        status: SiteDeploymentStatus,
        data?: Partial<Pick<SiteDeployment, "filesDeployed" | "deployedAt" | "errorMessage" | "snapshotId" | "updatedAt">>
    ): Promise<SiteDeployment | null> {
        const col = await this.col();
        const $set: Record<string, unknown> = { status, updatedAt: new Date() };
        if (data) {
            if (data.filesDeployed !== undefined) $set.filesDeployed = data.filesDeployed;
            if (data.deployedAt !== undefined) $set.deployedAt = data.deployedAt;
            if (data.errorMessage !== undefined) $set.errorMessage = data.errorMessage;
            if (data.snapshotId !== undefined) $set.snapshotId = data.snapshotId;
        }
        const result = await col.findOneAndUpdate(
            { _id: id },
            { $set },
            { returnDocument: "after" }
        );
        return result ? toEntity(result) : null;
    }

    async deleteById(id: string): Promise<boolean> {
        const col = await this.col();
        const result = await col.deleteOne({ _id: id });
        return result.deletedCount === 1;
    }

    async isPublishIdTaken(publishId: string): Promise<boolean> {
        const col = await this.col();
        const count = await col.countDocuments({ publishId, status: { $in: ["deploying", "live"] } });
        return count > 0;
    }

    async isCustomSlugTaken(slug: string, excludeDeploymentId?: string): Promise<boolean> {
        const col = await this.col();
        const filter: Record<string, unknown> = {
            customSlug: slug,
            status: { $in: ["deploying", "live"] },
        };
        if (excludeDeploymentId) {
            filter["_id"] = { $ne: excludeDeploymentId };
        }
        const count = await col.countDocuments(filter);
        return count > 0;
    }

    async updateCustomSlug(id: string, customSlug: string | null): Promise<SiteDeployment | null> {
        const col = await this.col();
        const $set: Record<string, unknown> = { updatedAt: new Date() };
        const update: Record<string, unknown> = { $set };
        if (customSlug !== null) {
            $set["customSlug"] = customSlug;
        } else {
            (update as any)["$unset"] = { customSlug: "" };
        }
        const result = await col.findOneAndUpdate({ _id: id }, update, { returnDocument: "after" });
        return result ? toEntity(result) : null;
    }

    async ensureIndexes(): Promise<void> {
        const col = await this.col();
        await col.createIndex({ publishId: 1 }, { unique: true });
        await col.createIndex({ customSlug: 1 }, { sparse: true });  // sparse: allows multiple null/missing
        await col.createIndex({ projectId: 1, status: 1 });
        await col.createIndex({ userId: 1, createdAt: -1 });
    }

    async setAdminBlocked(publishId: string, blocked: boolean, adminUserId: string): Promise<SiteDeployment | null> {
        const col = await this.col();
        const now = new Date();
        const $set: Record<string, unknown> = {
            isAdminBlocked: blocked,
            updatedAt: now,
        };
        if (blocked) {
            $set.adminBlockedAt = now;
            $set.adminBlockedByUserId = adminUserId;
        } else {
            $set.adminBlockedAt = undefined;
            $set.adminBlockedByUserId = undefined;
        }
        const result = await col.findOneAndUpdate(
            { publishId },
            { $set },
            { returnDocument: "after" }
        );
        return result ? toEntity(result) : null;
    }

    async listAllPaginated(page: number, limit: number): Promise<ListDeploymentsResult> {
        const col = await this.col();
        const skip = (page - 1) * limit;
        const [deployments, total] = await Promise.all([
            col.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
            col.countDocuments({}),
        ]);
        return { deployments: deployments.map(toEntity), total };
    }

    async countLive(): Promise<number> {
        const col = await this.col();
        return col.countDocuments({ status: "live" });
    }
}
