import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { DidacticArtifactKnowledge } from "../../domain/entities/DidacticArtifactKnowledge";
import type { DidacticArtifactKnowledgeRepository } from "../../domain/repositories/DidacticArtifactKnowledgeRepository";

interface DidacticArtifactKnowledgeDocument {
    _id: string;
    projectId: string;
    snapshotId: string;
    userId: string;
    overview: string;
    topics: unknown[];
    quizzes: unknown[];
    groundingHash: string;
    model?: string;
    provider?: string;
    generatedAt: Date;
}

function toEntity(doc: DidacticArtifactKnowledgeDocument): DidacticArtifactKnowledge {
    return {
        id: doc._id,
        projectId: doc.projectId,
        snapshotId: doc.snapshotId,
        userId: doc.userId,
        overview: doc.overview,
        topics: (doc.topics ?? []) as DidacticArtifactKnowledge["topics"],
        quizzes: (doc.quizzes ?? []) as DidacticArtifactKnowledge["quizzes"],
        groundingHash: doc.groundingHash,
        model: doc.model,
        provider: doc.provider,
        generatedAt: doc.generatedAt,
    };
}

export class MongoDidacticArtifactKnowledgeRepository implements DidacticArtifactKnowledgeRepository {
    private async collection(): Promise<Collection<DidacticArtifactKnowledgeDocument>> {
        const db = await getDb();
        const col = db.collection<DidacticArtifactKnowledgeDocument>("didactic_artifact_knowledge");
        await col.createIndex({ projectId: 1, snapshotId: 1 }, { unique: true });
        return col;
    }

    async findByProjectAndSnapshot(projectId: string, snapshotId: string): Promise<DidacticArtifactKnowledge | null> {
        const col = await this.collection();
        const doc = await col.findOne({ projectId, snapshotId });
        return doc ? toEntity(doc) : null;
    }

    async upsert(knowledge: DidacticArtifactKnowledge): Promise<DidacticArtifactKnowledge> {
        const col = await this.collection();
        const now = new Date();
        const doc: DidacticArtifactKnowledgeDocument = {
            _id: knowledge.id || randomUUID(),
            projectId: knowledge.projectId,
            snapshotId: knowledge.snapshotId,
            userId: knowledge.userId,
            overview: knowledge.overview,
            topics: knowledge.topics as unknown[],
            quizzes: knowledge.quizzes as unknown[],
            groundingHash: knowledge.groundingHash,
            model: knowledge.model,
            provider: knowledge.provider,
            generatedAt: knowledge.generatedAt ?? now,
        };

        await col.updateOne(
            { projectId: knowledge.projectId, snapshotId: knowledge.snapshotId },
            { $set: doc },
            { upsert: true }
        );

        const saved = await col.findOne({ projectId: knowledge.projectId, snapshotId: knowledge.snapshotId });
        if (!saved) throw new Error("Failed to persist didactic knowledge");
        return toEntity(saved);
    }

    async deleteBySnapshot(projectId: string, snapshotId: string): Promise<void> {
        const col = await this.collection();
        await col.deleteOne({ projectId, snapshotId });
    }
}
