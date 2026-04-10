import type { LlmProviderCatalog, PipelineModelRole } from "../../domain/entities/LlmCatalog";
import { SILICONFLOW_MODEL_PRICES } from "./siliconflowPricing";

const DEFAULT_MODELS: Record<PipelineModelRole, string> = {
    coding: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    coding_fast: "Qwen/Qwen3-Coder-30B-A3B-Instruct-2507",
    dialogue: "Qwen/Qwen3-32B",
    dialogue_fast: "Qwen/Qwen3-8B",
    vision: "Qwen/Qwen2.5-VL-72B-Instruct",
    vision_fast: "Qwen/Qwen2.5-VL-7B-Instruct",
    quality_check: "deepseek-ai/DeepSeek-V3",
    image_gen: "black-forest-labs/FLUX.1-dev",
    image_gen_fast: "black-forest-labs/FLUX.1-schnell",
    embeddings: "BAAI/bge-m3"
};

const FALLBACK_MODELS: Partial<Record<PipelineModelRole, string>> = {
    coding: "Qwen/Qwen2.5-Coder-32B-Instruct",
    coding_fast: "Qwen/Qwen2.5-Coder-32B-Instruct",
    dialogue: "deepseek-ai/DeepSeek-V3",
    dialogue_fast: "zai-org/GLM-4.5-Air",
    vision: "zai-org/GLM-4.6V",
    vision_fast: "zai-org/GLM-4.5V",
    quality_check: "Qwen/Qwen2.5-72B-Instruct",
    image_gen: "black-forest-labs/FLUX.1-schnell",
    embeddings: "BAAI/bge-large-en-v1.5"
};

function inferCapabilities(role: PipelineModelRole): string[] {
    if (role === "vision" || role === "vision_fast") {
        return ["vision", "chat"];
    }

    if (role === "image_gen" || role === "image_gen_fast") {
        return ["image_generation"];
    }

    if (role === "embeddings") {
        return ["embeddings"];
    }

    return ["chat"];
}

export function buildDefaultSiliconFlowCatalog(baseUrl: string): LlmProviderCatalog {
    const now = new Date();
    const models: LlmProviderCatalog["models"] = [];

    for (const [role, modelId] of Object.entries(DEFAULT_MODELS) as Array<[PipelineModelRole, string]>) {
        const sfPrice = SILICONFLOW_MODEL_PRICES[modelId];
        models.push({
            id: modelId,
            provider: "siliconflow",
            role,
            capabilities: inferCapabilities(role),
            isDefault: true,
            isFallback: false,
            isActive: true,
            ...(sfPrice ? { priceInputUsdPerM: sfPrice.input, priceOutputUsdPerM: sfPrice.output } : {})
        });

        const fallback = FALLBACK_MODELS[role];
        if (fallback) {
            const sfPriceFb = SILICONFLOW_MODEL_PRICES[fallback];
            models.push({
                id: fallback,
                provider: "siliconflow",
                role,
                capabilities: inferCapabilities(role),
                isDefault: false,
                isFallback: true,
                isActive: true,
                ...(sfPriceFb ? { priceInputUsdPerM: sfPriceFb.input, priceOutputUsdPerM: sfPriceFb.output } : {})
            });
        }
    }

    return {
        provider: "siliconflow",
        baseUrl,
        apiType: "openai-compatible",
        authType: "bearer",
        isActive: true,
        models,
        createdAt: now,
        updatedAt: now
    };
}
