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

    /**
     * Flip activation for a set of models in ONE write.
     *
     * `models` carries full descriptors, not just ids, because most of the catalog is
     * live-discovered and exists nowhere in Mongo until someone rules on it: activating a
     * discovered model has to materialise it, or the decision is forgotten at the next restart.
     * Descriptors for ids already stored are ignored except for the activation flag — the
     * operator's other edits (role, display name, prompt template) are not overwritten by a
     * value rediscovered from the provider.
     *
     * One write rather than N: "activate everything from this author" is a single user action
     * and must not become two hundred read-modify-write round trips on the same document.
     */
    setModelsActive(input: {
        provider: string;
        models: LlmProviderCatalog["models"];
        isActive: boolean;
    }): Promise<LlmProviderCatalog>;

    /**
     * Record which stored models the provider still lists. Models absent from `liveModelIds` are
     * marked deprecated; they are never deleted, because their ids are referenced by stored model
     * locks, execution logs and published builds.
     */
    markAvailability(input: {
        provider: string;
        liveModelIds: string[];
        checkedAt: Date;
    }): Promise<{ live: number; deprecated: number }>;
}
