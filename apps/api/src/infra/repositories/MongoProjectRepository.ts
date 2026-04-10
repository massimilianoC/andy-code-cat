import { ObjectId, type Collection } from "mongodb";
import type { Project } from "../../domain/entities/Project";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import { getDb } from "../db/mongo";

interface ProjectDocument {
    _id: ObjectId;
    ownerUserId: ObjectId;
    name: string;
    presetId?: string;
    createdAt: Date;
}

function mapDocument(doc: ProjectDocument): Project {
    return {
        id: doc._id.toHexString(),
        ownerUserId: doc.ownerUserId.toHexString(),
        name: doc.name,
        presetId: doc.presetId,
        createdAt: doc.createdAt
    };
}

export class MongoProjectRepository implements ProjectRepository {
    private async collection(): Promise<Collection<ProjectDocument>> {
        const db = await getDb();
        return db.collection<ProjectDocument>("projects");
    }

    async create(ownerUserId: string, name: string, presetId?: string): Promise<Project> {
        const collection = await this.collection();
        const now = new Date();
        const ownerObjectId = new ObjectId(ownerUserId);

        const doc: Omit<ProjectDocument, '_id'> & { _id: ObjectId } = {
            _id: new ObjectId(),
            ownerUserId: ownerObjectId,
            name,
            createdAt: now,
        };
        if (presetId !== undefined) (doc as ProjectDocument).presetId = presetId;

        const result = await collection.insertOne(doc as ProjectDocument);
        const created = await collection.findOne({ _id: result.insertedId });
        if (!created) {
            throw new Error("Cannot load created project");
        }

        return mapDocument(created);
    }

    async listForUser(userId: string): Promise<Project[]> {
        const collection = await this.collection();
        const ownerObjectId = new ObjectId(userId);
        const docs = await collection.find({ ownerUserId: ownerObjectId }).sort({ createdAt: -1 }).toArray();
        return docs.map(mapDocument);
    }

    async findByIdForUser(projectId: string, userId: string): Promise<Project | null> {
        const collection = await this.collection();
        const doc = await collection.findOne({
            _id: new ObjectId(projectId),
            ownerUserId: new ObjectId(userId)
        });
        return doc ? mapDocument(doc) : null;
    }

    async deleteById(projectId: string, userId: string): Promise<boolean> {
        const collection = await this.collection();
        const result = await collection.deleteOne({
            _id: new ObjectId(projectId),
            ownerUserId: new ObjectId(userId),
        });
        return result.deletedCount > 0;
    }

    async rename(projectId: string, userId: string, name: string): Promise<Project | null> {
        const collection = await this.collection();
        const result = await collection.findOneAndUpdate(
            { _id: new ObjectId(projectId), ownerUserId: new ObjectId(userId) },
            { $set: { name } },
            { returnDocument: "after" }
        );
        return result ? mapDocument(result) : null;
    }
}
