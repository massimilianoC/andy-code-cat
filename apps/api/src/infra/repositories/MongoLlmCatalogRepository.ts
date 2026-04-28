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
        updatedAt: doc.updatedAt,
    };
}

function normalizeModels(models: LlmProviderCatalog["models"]): LlmProviderCatalog["models"] {
    const next = [...models];
    const roles = [...new Set(next.map((model) => model.role))];

    for (const role of roles) {
        const indexes = next
            .map((model, index) => ({ model, index }))
            .filter(({ model }) => model.role === role);

        if (indexes.length === 0) continue;

        let defaultFound = false;
        for (const { model, index } of indexes) {
            if (model.isDefault && !defaultFound) {
                defaultFound = true;
                next[index] = { ...model, isFallback: false };
                continue;
            }

            if (model.isDefault && defaultFound) {
                next[index] = { ...model, isDefault: false, isFallback: true };
            }
        }

        if (!defaultFound) {
            const promoted = indexes.find(({ model }) => model.isActive) ?? indexes[0];
            if (!promoted) {
                continue;
            }
            next[promoted.index] = {
                ...promoted.model,
                isDefault: true,
                isFallback: false,
            };
        }
    }

    return next;
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
                    models: normalizeModels(catalog.models),
                    updatedAt: now,
                },
                $setOnInsert: {
                    createdAt: now,
                },
            },
            { upsert: true },
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

    async listAllProviders(): Promise<LlmProviderCatalog[]> {
        const collection = await this.collection();
        const docs = await collection
            .find({})
            .sort({ provider: 1 })
            .toArray();
        return docs.map(mapDocument);
    }

    async upsertModel(input: {
        provider: string;
        baseUrl?: string;
        apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
        authType?: "api-key" | "bearer" | "none";
        isActive?: boolean;
        modelId: string;
        patch: Partial<LlmProviderCatalog["models"][number]>;
    }): Promise<LlmProviderCatalog> {
        const collection = await this.collection();
        const now = new Date();
        const existing = await collection.findOne({ provider: input.provider });
        const existingModels = existing?.models ?? [];
        const current = existingModels.find((model) => model.id === input.modelId);

        const mergedModel: LlmProviderCatalog["models"][number] = {
            id: input.modelId,
            provider: input.provider,
            role: input.patch.role ?? current?.role ?? "dialogue",
            capabilities: input.patch.capabilities ?? current?.capabilities ?? ["chat"],
            isDefault: input.patch.isDefault ?? current?.isDefault ?? false,
            isFallback: input.patch.isFallback ?? current?.isFallback ?? true,
            isActive: input.patch.isActive ?? current?.isActive ?? true,
            displayName: input.patch.displayName ?? current?.displayName,
            description: input.patch.description ?? current?.description,
            promptTemplate: input.patch.promptTemplate ?? current?.promptTemplate,
            focusPromptTemplate: input.patch.focusPromptTemplate ?? current?.focusPromptTemplate,
            priceTier: input.patch.priceTier ?? current?.priceTier,
            priceInputUsdPerM: input.patch.priceInputUsdPerM ?? current?.priceInputUsdPerM,
            priceOutputUsdPerM: input.patch.priceOutputUsdPerM ?? current?.priceOutputUsdPerM,
        };

        const models = normalizeModels([
            ...existingModels.filter((model) => model.id !== input.modelId),
            mergedModel,
        ]);

        await collection.updateOne(
            { provider: input.provider },
            {
                $set: {
                    baseUrl: input.baseUrl ?? existing?.baseUrl ?? "",
                    apiType: input.apiType ?? existing?.apiType ?? "openai-compatible",
                    authType: input.authType ?? existing?.authType ?? "bearer",
                    isActive: input.isActive ?? existing?.isActive ?? true,
                    models,
                    updatedAt: now,
                },
                $setOnInsert: {
                    createdAt: now,
                },
            },
            { upsert: true },
        );

        const updated = await collection.findOne({ provider: input.provider });
        if (!updated) {
            throw new Error("Failed to persist LLM model registry item");
        }

        return mapDocument(updated);
    }

    async deleteModel(provider: string, modelId: string): Promise<LlmProviderCatalog> {
        const collection = await this.collection();
        const existing = await collection.findOne({ provider });
        if (!existing) {
            throw new Error("LLM provider not found");
        }

        const models = normalizeModels(existing.models.filter((model) => model.id !== modelId));
        const now = new Date();

        await collection.updateOne(
            { provider },
            {
                $set: {
                    models,
                    updatedAt: now,
                },
            },
        );

        const updated = await collection.findOne({ provider });
        if (!updated) {
            throw new Error("Failed to persist LLM provider after delete");
        }

        return mapDocument(updated);
    }
}
