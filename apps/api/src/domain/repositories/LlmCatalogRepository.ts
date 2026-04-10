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
}
