import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";

const DEFAULT_MODEL_ID = "local/default-chat";

export function buildDefaultLmStudioCatalog(baseUrl: string): LlmProviderCatalog {
    const now = new Date();

    const models: LlmProviderCatalog["models"] = [{
        id: DEFAULT_MODEL_ID,
        provider: "lmstudio",
        role: "dialogue",
        capabilities: ["chat"],
        isDefault: true,
        isFallback: true,
        isActive: true,
    }];

    return {
        provider: "lmstudio",
        baseUrl,
        apiType: "openai-compatible",
        authType: "none",
        isActive: true,
        models,
        createdAt: now,
        updatedAt: now,
    };
}
