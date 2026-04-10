import { type Collection } from "mongodb";
import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import type { LlmCatalogRepository } from "../../domain/repositories/LlmCatalogRepository";
import { getDb } from "../db/mongo";

interface LlmProviderCatalogDocument {
    provider: string;
    baseUrl: string;
    apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
    authType?: "api-key" | "bearer" | "none";
    isActive: boolean;
    models: LlmProviderCatalog["models"];
    createdAt: Date;
    updatedAt: Date;
}

function mapDocument(doc: LlmProviderCatalogDocument): LlmProviderCatalog {
    return {
        provider: doc.provider,
        baseUrl: doc.baseUrl,
        apiType: doc.apiType,
        authType: doc.authType,
        isActive: doc.isActive,
        models: doc.models,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
    };
}

export class MongoLlmCatalogRepository implements LlmCatalogRepository {
    private async collection(): Promise<Collection<LlmProviderCatalogDocument>> {
        const db = await getDb();
        const collection = db.collection<LlmProviderCatalogDocument>("llm_providers");
        await collection.createIndex({ provider: 1 }, { unique: true });
        await collection.createIndex({ isActive: 1 });
        return collection;
    }

    async upsertProvider(catalog: {
        provider: string;
        baseUrl: string;
        apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
        authType?: "api-key" | "bearer" | "none";
        isActive: boolean;
        models: LlmProviderCatalog["models"];
    }): Promise<void> {
        const collection = await this.collection();
        const now = new Date();

        await collection.updateOne(
            { provider: catalog.provider },
            {
                $set: {
                    baseUrl: catalog.baseUrl,
                    apiType: catalog.apiType,
                    authType: catalog.authType,
                    isActive: catalog.isActive,
                    models: catalog.models,
                    updatedAt: now
                },
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true }
        );
    }

    async listActiveProviders(): Promise<LlmProviderCatalog[]> {
        const collection = await this.collection();
        const docs = await collection
            .find({ isActive: true })
            .sort({ provider: 1 })
            .toArray();
        return docs.map(mapDocument);
    }
}
