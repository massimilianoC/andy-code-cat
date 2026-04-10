import { randomUUID } from "crypto";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import type { LlmPromptConfig } from "../../domain/entities/LlmPromptConfig";
import type { LlmPromptConfigRepository } from "../../domain/repositories/LlmPromptConfigRepository";

interface LlmPromptConfigDocument {
    _id: string;
    projectId: string;
    enabled: boolean;
    responseFormatVersion: string;
    prePromptTemplate: string;
    createdAt: Date;
    updatedAt: Date;
}

function toEntity(doc: LlmPromptConfigDocument): LlmPromptConfig {
    return {
        id: doc._id,
        projectId: doc.projectId,
        enabled: doc.enabled,
        responseFormatVersion: doc.responseFormatVersion,
        prePromptTemplate: doc.prePromptTemplate,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export class MongoLlmPromptConfigRepository implements LlmPromptConfigRepository {
    private async collection(): Promise<Collection<LlmPromptConfigDocument>> {
        const db = await getDb();
        const collection = db.collection<LlmPromptConfigDocument>("llm_prompt_configs");
        await collection.createIndex({ projectId: 1 }, { unique: true });
        return collection;
    }

    async findByProjectId(projectId: string): Promise<LlmPromptConfig | null> {
        const collection = await this.collection();
        const doc = await collection.findOne({ projectId });
        return doc ? toEntity(doc) : null;
    }

    async upsertForProject(
        projectId: string,
        config: {
            enabled: boolean;
            responseFormatVersion: string;
            prePromptTemplate: string;
        }
    ): Promise<LlmPromptConfig> {
        const collection = await this.collection();
        const now = new Date();

        await collection.updateOne(
            { projectId },
            {
                $set: {
                    enabled: config.enabled,
                    responseFormatVersion: config.responseFormatVersion,
                    prePromptTemplate: config.prePromptTemplate,
                    updatedAt: now,
                },
                $setOnInsert: {
                    _id: randomUUID(),
                    createdAt: now,
                },
            },
            { upsert: true }
        );

        const doc = await collection.findOne({ projectId });
        if (!doc) {
            throw new Error("Failed to persist prompt config");
        }

        return toEntity(doc);
    }
}
