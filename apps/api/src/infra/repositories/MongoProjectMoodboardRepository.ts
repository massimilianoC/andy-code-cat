import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { ProjectMoodboard, CreateProjectMoodboardInput, UpdateProjectMoodboardInput } from "../../domain/entities/ProjectMoodboard";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";

interface ProjectMoodboardDocument {
    _id: string;
    projectId: string;
    userId: string;
    inheritFromUser: boolean;
    visualTags?: string[];
    paletteTags?: string[];
    typographyTags?: string[];
    layoutTags?: string[];
    toneTags?: string[];
    audienceTags?: string[];
    featureTags?: string[];
    sectorTags?: string[];
    referenceTags?: string[];
    eraTags?: string[];
    projectBrief?: string;
    targetBusiness?: string;
    styleNotes?: string;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: ProjectMoodboardDocument): ProjectMoodboard {
    return {
        id: doc._id,
        projectId: doc.projectId,
        userId: doc.userId,
        inheritFromUser: doc.inheritFromUser,
        visualTags: doc.visualTags,
        paletteTags: doc.paletteTags,
        typographyTags: doc.typographyTags,
        layoutTags: doc.layoutTags,
        toneTags: doc.toneTags,
        audienceTags: doc.audienceTags,
        featureTags: doc.featureTags,
        sectorTags: doc.sectorTags,
        referenceTags: doc.referenceTags,
        eraTags: doc.eraTags,
        projectBrief: doc.projectBrief,
        targetBusiness: doc.targetBusiness,
        styleNotes: doc.styleNotes,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export class MongoProjectMoodboardRepository implements ProjectMoodboardRepository {
    private async collection(): Promise<Collection<ProjectMoodboardDocument>> {
        const db = await getDb();
        const col = db.collection<ProjectMoodboardDocument>("project_moodboards");
        await col.createIndex({ projectId: 1 }, { unique: true });
        return col;
    }

    async findByProjectId(projectId: string): Promise<ProjectMoodboard | null> {
        const col = await this.collection();
        const doc = await col.findOne({ projectId });
        return doc ? toEntity(doc) : null;
    }

    async initForProject(input: CreateProjectMoodboardInput): Promise<ProjectMoodboard> {
        const col = await this.collection();
        const now = new Date();
        const id = randomUUID();

        try {
            await col.insertOne({
                _id: id,
                projectId: input.projectId,
                userId: input.userId,
                inheritFromUser: true,
                createdAt: now,
                updatedAt: now,
            });
        } catch (err: unknown) {
            const code = (err as { code?: number }).code;
            if (code !== 11000) throw err;
        }

        const doc = await col.findOne({ projectId: input.projectId });
        if (!doc) throw new Error("Failed to init project moodboard");
        return toEntity(doc);
    }

    async upsert(projectId: string, userId: string, input: UpdateProjectMoodboardInput): Promise<ProjectMoodboard> {
        const col = await this.collection();
        const now = new Date();

        const setFields: Partial<ProjectMoodboardDocument> = { updatedAt: now };
        if (input.inheritFromUser !== undefined) setFields.inheritFromUser = input.inheritFromUser;
        if (input.visualTags !== undefined) setFields.visualTags = input.visualTags;
        if (input.paletteTags !== undefined) setFields.paletteTags = input.paletteTags;
        if (input.typographyTags !== undefined) setFields.typographyTags = input.typographyTags;
        if (input.layoutTags !== undefined) setFields.layoutTags = input.layoutTags;
        if (input.toneTags !== undefined) setFields.toneTags = input.toneTags;
        if (input.audienceTags !== undefined) setFields.audienceTags = input.audienceTags;
        if (input.featureTags !== undefined) setFields.featureTags = input.featureTags;
        if (input.sectorTags !== undefined) setFields.sectorTags = input.sectorTags;
        if (input.referenceTags !== undefined) setFields.referenceTags = input.referenceTags;
        if (input.eraTags !== undefined) setFields.eraTags = input.eraTags;
        if (input.projectBrief !== undefined) setFields.projectBrief = input.projectBrief;
        if (input.targetBusiness !== undefined) setFields.targetBusiness = input.targetBusiness;
        if (input.styleNotes !== undefined) setFields.styleNotes = input.styleNotes;

        await col.updateOne(
            { projectId },
            {
                $set: setFields,
                $setOnInsert: {
                    _id: randomUUID(),
                    projectId,
                    userId,
                    // Only set default inheritFromUser on insert if not already in $set —
                    // having the same path in both $set and $setOnInsert causes a MongoDB conflict.
                    ...(setFields.inheritFromUser === undefined ? { inheritFromUser: true } : {}),
                    createdAt: now,
                },
            },
            { upsert: true }
        );

        const doc = await col.findOne({ projectId });
        if (!doc) throw new Error("Failed to persist project moodboard");
        return toEntity(doc);
    }

    async deleteByProjectId(projectId: string): Promise<void> {
        const col = await this.collection();
        await col.deleteOne({ projectId });
    }
}
