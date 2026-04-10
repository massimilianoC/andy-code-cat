/**
 * SiliconFlow model pricing lookup table.
 *
 * All text-model prices are in USD per million tokens (input / output).
 * Image-gen prices are in USD per image (stored in the `input` field; `output` is 0).
 * Embeddings are free (0 / 0).
 *
 * Source: https://www.siliconflow.com/pricing
 * Last scraped: 2026-04-09  (authoritative CSV: docs/cost-providers/siliconflow_pricing.csv)
 * Last probe:   2026-04-09  (report: docs/cost-providers/sf-probe-2026-04-09.json)
 *
 * To update: re-scrape the pricing page, update the CSV, then keep this file in sync.
 */
export interface SfModelPrice {
    /** USD per million input tokens (text LLMs) — or USD per image (image-gen). */
    input: number;
    /** USD per million output tokens (text LLMs) — 0 for image-gen/embeddings. */
    output: number;
    /** Price unit — to exclude image-gen from the per-token percentile computation. */
    priceUnit: "per_m_tokens" | "per_image" | "free";
}

export const SILICONFLOW_MODEL_PRICES: Readonly<Record<string, SfModelPrice>> = {
    // ── DeepSeek ────────────────────────────────────────────────────────────
    "deepseek-ai/DeepSeek-V3.2": { input: 0.27, output: 0.42, priceUnit: "per_m_tokens" },
    "deepseek-ai/DeepSeek-V3.2-Exp": { input: 0.27, output: 0.41, priceUnit: "per_m_tokens" },
    "deepseek-ai/DeepSeek-V3.1-Terminus": { input: 0.27, output: 1.00, priceUnit: "per_m_tokens" },
    "deepseek-ai/DeepSeek-V3.1": { input: 0.27, output: 1.00, priceUnit: "per_m_tokens" },
    "deepseek-ai/DeepSeek-R1": { input: 0.50, output: 2.18, priceUnit: "per_m_tokens" },
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B": { input: 0.18, output: 0.18, priceUnit: "per_m_tokens" },
    "deepseek-ai/DeepSeek-V3": { input: 0.25, output: 1.00, priceUnit: "per_m_tokens" },

    // ── Qwen ────────────────────────────────────────────────────────────────
    "Qwen/Qwen3-32B": { input: 0.14, output: 0.57, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-14B": { input: 0.07, output: 0.28, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-8B": { input: 0.06, output: 0.06, priceUnit: "per_m_tokens" },
    "Qwen/QwQ-32B": { input: 0.15, output: 0.58, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-235B-A22B-Instruct-2507": { input: 0.09, output: 0.60, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-235B-A22B-Thinking-2507": { input: 0.13, output: 0.60, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-30B-A3B-Instruct-2507": { input: 0.09, output: 0.30, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-30B-A3B-Thinking-2507": { input: 0.09, output: 0.30, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-Coder-480B-A35B-Instruct": { input: 0.25, output: 1.00, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-Coder-480B-A35B": { input: 0.25, output: 1.00, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-Coder-30B-A3B-Instruct": { input: 0.07, output: 0.28, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-Coder-30B-A3B-Instruct-2507": { input: 0.07, output: 0.28, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-VL-235B-A22B-Instruct": { input: 0.30, output: 1.50, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-VL-235B-A22B-Thinking": { input: 0.45, output: 3.50, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-VL-32B-Instruct": { input: 0.20, output: 0.60, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-VL-32B-Thinking": { input: 0.20, output: 1.50, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-VL-30B-A3B-Instruct": { input: 0.29, output: 1.00, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-VL-30B-A3B-Thinking": { input: 0.29, output: 1.00, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-VL-8B-Instruct": { input: 0.18, output: 0.68, priceUnit: "per_m_tokens" },
    "Qwen/Qwen2.5-72B-Instruct": { input: 0.59, output: 0.59, priceUnit: "per_m_tokens" },
    "Qwen/Qwen2.5-VL-72B-Instruct": { input: 0.59, output: 0.59, priceUnit: "per_m_tokens" },
    "Qwen/Qwen2.5-VL-32B-Instruct": { input: 0.27, output: 0.27, priceUnit: "per_m_tokens" },
    "Qwen/Qwen2.5-VL-7B-Instruct": { input: 0.10, output: 0.10, priceUnit: "per_m_tokens" }, // estimated
    "Qwen/Qwen2.5-7B-Instruct": { input: 0.05, output: 0.05, priceUnit: "per_m_tokens" },
    "Qwen/Qwen2.5-32B-Instruct": { input: 0.27, output: 0.27, priceUnit: "per_m_tokens" }, // estimated
    "Qwen/Qwen2.5-Coder-32B-Instruct": { input: 0.27, output: 0.27, priceUnit: "per_m_tokens" }, // estimated

    // ── Z.ai / GLM (Zhipu AI) ───────────────────────────────────────────────
    "zai-org/GLM-5.1": { input: 1.40, output: 4.40, priceUnit: "per_m_tokens" },
    "zai-org/GLM-5V-Turbo": { input: 1.20, output: 4.00, priceUnit: "per_m_tokens" },
    "zai-org/GLM-5": { input: 0.95, output: 2.55, priceUnit: "per_m_tokens" },
    "zai-org/GLM-4.7": { input: 0.42, output: 2.20, priceUnit: "per_m_tokens" },
    "zai-org/GLM-4.6": { input: 0.39, output: 1.90, priceUnit: "per_m_tokens" },
    "zai-org/GLM-4.6V": { input: 0.30, output: 0.90, priceUnit: "per_m_tokens" },
    "zai-org/GLM-4.5-Air": { input: 0.14, output: 0.86, priceUnit: "per_m_tokens" },
    "zai-org/GLM-4.5V": { input: 0.14, output: 0.86, priceUnit: "per_m_tokens" }, // estimated
    "THUDM/glm-4-9b-chat": { input: 0.00, output: 0.00, priceUnit: "free" },

    // ── Moonshot AI / Kimi ──────────────────────────────────────────────────
    "moonshotai/Kimi-K2-Instruct": { input: 0.58, output: 2.29, priceUnit: "per_m_tokens" },
    "moonshotai/Kimi-K2-Instruct-0905": { input: 0.40, output: 2.00, priceUnit: "per_m_tokens" },
    "moonshotai/Kimi-K2.5": { input: 0.23, output: 3.00, priceUnit: "per_m_tokens" },

    // ── MiniMax ─────────────────────────────────────────────────────────────
    "MiniMaxAI/MiniMax-M2.5": { input: 0.30, output: 1.20, priceUnit: "per_m_tokens" },

    // ── Tencent Hunyuan ──────────────────────────────────────────────────────
    "tencent/Hunyuan-A13B-Instruct": { input: 0.14, output: 0.57, priceUnit: "per_m_tokens" },

    // ── Others ──────────────────────────────────────────────────────────────
    "openai/gpt-oss-120b": { input: 0.05, output: 0.45, priceUnit: "per_m_tokens" },
    "openai/gpt-oss-20b": { input: 0.04, output: 0.18, priceUnit: "per_m_tokens" },
    "nex-agi/DeepSeek-V3.1-Nex-N1": { input: 0.27, output: 1.00, priceUnit: "per_m_tokens" },
    "inclusionAI/Ling-flash-2.0": { input: 0.14, output: 0.57, priceUnit: "per_m_tokens" },
    "inclusionAI/Ring-flash-2.0": { input: 0.14, output: 0.57, priceUnit: "per_m_tokens" },
    "stepfun-ai/Step-3.5-Flash": { input: 0.10, output: 0.30, priceUnit: "per_m_tokens" },
    "ByteDance-Seed/Seed-OSS-36B-Instruct": { input: 0.21, output: 0.57, priceUnit: "per_m_tokens" },
    "baidu/ERNIE-4.5-300B-A47B": { input: 0.28, output: 1.10, priceUnit: "per_m_tokens" },

    // ── Embeddings ───────────────────────────────────────────────────────────
    "BAAI/bge-m3": { input: 0.00, output: 0.00, priceUnit: "free" },
    "BAAI/bge-large-en-v1.5": { input: 0.00, output: 0.00, priceUnit: "free" },
    "Qwen/Qwen3-Embedding-8B": { input: 0.04, output: 0.00, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-Embedding-4B": { input: 0.02, output: 0.00, priceUnit: "per_m_tokens" },
    "Qwen/Qwen3-Embedding-0.6B": { input: 0.00, output: 0.00, priceUnit: "free" },

    // ── Image Generation — price per image ──────────────────────────────────
    "black-forest-labs/FLUX.1-dev": { input: 0.014, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX.1-schnell": { input: 0.0014, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX.1-Kontext-pro": { input: 0.04, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX.1-Kontext-dev": { input: 0.015, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX.1-Kontext-max": { input: 0.08, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX.2-pro": { input: 0.03, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX.2-flex": { input: 0.06, output: 0, priceUnit: "per_image" },
    "Qwen/Qwen-Image": { input: 0.02, output: 0, priceUnit: "per_image" },
    "Qwen/Qwen-Image-Edit": { input: 0.04, output: 0, priceUnit: "per_image" },
    "Tongyi-MAI/Z-Image-Turbo": { input: 0.005, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX-1.1-pro": { input: 0.04, output: 0, priceUnit: "per_image" },
    "black-forest-labs/FLUX-1.1-pro-Ultra": { input: 0.06, output: 0, priceUnit: "per_image" },
    "Wan-AI/Wan2.2-I2V-A14B": { input: 0.29, output: 0, priceUnit: "per_image" },
    "Wan-AI/Wan2.2-T2V-A14B": { input: 0.29, output: 0, priceUnit: "per_image" },
};

/**
 * Returns the price entry for a SiliconFlow model ID, or undefined if unknown.
 */
export function getSiliconFlowPrice(modelId: string): SfModelPrice | undefined {
    return SILICONFLOW_MODEL_PRICES[modelId];
}
