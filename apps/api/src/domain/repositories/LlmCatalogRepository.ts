import type { LlmProviderCatalog } from "../entities/LlmCatalog";

export interface LlmCatalogRepository {
    upsertProvider(catalog: {
        provider: string;
        baseUrl: string;
        apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
        authType?: "api-key" | "bearer" | "none";
        isActive: boolean;
        models: LlmProviderCatalog["models"];
    }): Promise<void>;
    listActiveProviders(): Promise<LlmProviderCatalog[]>;
    listAllProviders(): Promise<LlmProviderCatalog[]>;
    upsertModel(input: {
        provider: string;
        baseUrl?: string;
        apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
        authType?: "api-key" | "bearer" | "none";
        isActive?: boolean;
        modelId: string;
        patch: Partial<LlmProviderCatalog["models"][number]>;
    }): Promise<LlmProviderCatalog>;
    deleteModel(provider: string, modelId: string): Promise<LlmProviderCatalog>;
}
