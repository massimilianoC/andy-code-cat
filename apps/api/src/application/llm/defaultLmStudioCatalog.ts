import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import { decorateSeedModel } from "./modelRegistryPresets";

const DEFAULT_MODEL_ID = "local/default-chat";

export function buildDefaultLmStudioCatalog(baseUrl: string): LlmProviderCatalog {
    const now = new Date();

    const models: LlmProviderCatalog["models"] = [decorateSeedModel({
        id: DEFAULT_MODEL_ID,
        provider: "lmstudio",
        role: "dialogue",
        capabilities: ["chat"],
        isDefault: true,
        isFallback: true,
        isActive: true,
        displayName: "Local Default Chat",
        description: "Local LM Studio fallback model for offline chat and testing.",
    })];

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
