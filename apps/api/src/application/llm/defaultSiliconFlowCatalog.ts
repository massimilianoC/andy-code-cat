import type { LlmProviderCatalog, PipelineModelRole } from "../../domain/entities/LlmCatalog";
import { decorateSeedModel } from "./modelRegistryPresets";
import { computePriceTier, SILICONFLOW_MODEL_PRICES } from "./siliconflowPricing";

const DEFAULT_MODELS: Record<PipelineModelRole, string> = {
    coding: "deepseek-ai/DeepSeek-V3.2",
    coding_fast: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    dialogue: "MiniMaxAI/MiniMax-M2.5",
    dialogue_fast: "Qwen/Qwen3-8B",
    vision: "Qwen/Qwen3-VL-32B-Instruct",
    vision_fast: "Qwen/Qwen3-VL-8B-Instruct",
    quality_check: "deepseek-ai/DeepSeek-V3",
    image_gen: "black-forest-labs/FLUX.1-dev",
    image_gen_fast: "black-forest-labs/FLUX.1-schnell",
    embeddings: "Qwen/Qwen3-Embedding-8B"
};

const FALLBACK_MODELS: Partial<Record<PipelineModelRole, string>> = {
    coding: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    coding_fast: "Qwen/Qwen3-8B",
    dialogue: "moonshotai/Kimi-K2.5",
    dialogue_fast: "zai-org/GLM-4.5-Air",
    vision: "Qwen/Qwen3-VL-30B-A3B-Instruct",
    vision_fast: "zai-org/GLM-5V-Turbo",
    quality_check: "Qwen/Qwen2.5-72B-Instruct",
    image_gen: "black-forest-labs/FLUX.1-schnell",
    embeddings: "Qwen/Qwen3-Embedding-4B"
};

/**
 * Additional selectable models exposed in the superadmin UI.
 * Not assigned to a specific pipeline role; they are offered as manual overrides
 * for task-level configuration (e.g. vibe_intent_classify, zero_effort_optimize).
 * IDs are deduplicated against DEFAULT_MODELS + FALLBACK_MODELS at build time.
 */
const SUPPLEMENTAL_MODELS: Array<{ id: string; capabilities: string[] }> = [
    // Google — Gemma 4
    { id: "google/gemma-4-31B-it", capabilities: ["chat"] },
    { id: "google/gemma-4-26B-A4B-it", capabilities: ["chat"] },
    // Qwen — extra reasoning / large models
    { id: "Qwen/Qwen3-32B", capabilities: ["chat"] },
    { id: "Qwen/Qwen3.6-35B-A3B", capabilities: ["chat"] },
    { id: "Qwen/Qwen3.5-397B-A17B", capabilities: ["chat"] },
    // DeepSeek — R1 reasoning
    { id: "deepseek-ai/DeepSeek-R1", capabilities: ["chat"] },
    // Moonshot / Kimi — extra large
    { id: "moonshotai/Kimi-K2.6", capabilities: ["chat"] },
    // Tencent Hunyuan
    { id: "tencent/Hunyuan-A13B-Instruct", capabilities: ["chat"] },
    // Current high-capacity alternates
    { id: "zai-org/GLM-5.1", capabilities: ["chat"] },
    { id: "Qwen/Qwen3.5-122B-A10B", capabilities: ["chat"] },
];

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
        models.push(decorateSeedModel({
            id: modelId,
            provider: "siliconflow",
            role,
            capabilities: inferCapabilities(role),
            isDefault: true,
            isFallback: false,
            isActive: true,
            ...(sfPrice ? {
                priceInputUsdPerM: sfPrice.input,
                priceOutputUsdPerM: sfPrice.output,
                priceTier: computePriceTier(sfPrice),
            } : {})
        }));

        const fallback = FALLBACK_MODELS[role];
        if (fallback) {
            const sfPriceFb = SILICONFLOW_MODEL_PRICES[fallback];
            models.push(decorateSeedModel({
                id: fallback,
                provider: "siliconflow",
                role,
                capabilities: inferCapabilities(role),
                isDefault: false,
                isFallback: true,
                isActive: true,
                ...(sfPriceFb ? {
                    priceInputUsdPerM: sfPriceFb.input,
                    priceOutputUsdPerM: sfPriceFb.output,
                    priceTier: computePriceTier(sfPriceFb),
                } : {})
            }));
        }
    }

    // Append supplemental models (deduplicated against role-assigned models above)
    const existingIds = new Set(models.map((m) => m.id));
    for (const m of SUPPLEMENTAL_MODELS) {
        if (existingIds.has(m.id)) continue;
        const sfPrice = SILICONFLOW_MODEL_PRICES[m.id];
        models.push(decorateSeedModel({
            id: m.id,
            provider: "siliconflow",
            role: "dialogue",
            capabilities: m.capabilities,
            isDefault: false,
            isFallback: false,
            isActive: true,
            ...(sfPrice ? {
                priceInputUsdPerM: sfPrice.input,
                priceOutputUsdPerM: sfPrice.output,
                priceTier: computePriceTier(sfPrice),
            } : {}),
        }));
        existingIds.add(m.id);
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
