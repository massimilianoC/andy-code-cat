export type LlmCapability =
    | "chat"
    | "vision"
    | "image_generation"
    | "video_generation"
    | "tools"
    | "embeddings";

export interface CostPolicyConfig {
    textEurPer1kTokens: number;
    imageEurPerAsset: number;
    videoEurPerAsset: number;
    /** USD → EUR conversion rate. Defaults to 0.92. */
    usdToEurRate?: number;
    /** Markup factor applied on top of the provider-reported cost (e.g. 1.1 = +10%). Defaults to 1.0. */
    providerMarkupFactor?: number;
}

export interface CostPolicyInput {
    capability?: LlmCapability;
    tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    imageCount?: number;
    audioCount?: number;
    videoCount?: number;
    /** Actual cost in USD reported by the provider (e.g. OpenRouter usage.cost). When present, overrides flat-rate estimate. */
    providerCostUsd?: number;
}

export interface CostEstimate {
    currency: "EUR";
    amount: number;
    /** How the amount was derived: "provider" = from provider-reported USD cost; "flat-rate" = token-based flat rate. */
    source: "provider" | "flat-rate";
    breakdown: {
        tokenCost: number;
        imageCost: number;
        videoCost: number;
    };
    unitRates: {
        textEurPer1kTokens: number;
        imageEurPerAsset: number;
        videoEurPerAsset: number;
    };
    /** Raw provider-reported cost in USD, when available. */
    providerCostUsd?: number;
}

export function estimateCost(input: CostPolicyInput, cfg: CostPolicyConfig): CostEstimate {
    const capability = input.capability ?? "chat";

    // Prefer provider-reported cost when available — it is always more accurate
    // than the flat-rate estimate, especially for cheap models (e.g. Gemma on Parasail).
    if (input.providerCostUsd !== undefined && input.providerCostUsd > 0) {
        const rate = cfg.usdToEurRate ?? 0.92;
        const markup = cfg.providerMarkupFactor ?? 1.0;
        const amount = Number((input.providerCostUsd * rate * markup).toFixed(6));
        return {
            currency: "EUR",
            amount,
            source: "provider",
            breakdown: { tokenCost: 0, imageCost: 0, videoCost: 0 },
            unitRates: {
                textEurPer1kTokens: cfg.textEurPer1kTokens,
                imageEurPerAsset: cfg.imageEurPerAsset,
                videoEurPerAsset: cfg.videoEurPerAsset,
            },
            providerCostUsd: input.providerCostUsd,
        };
    }

    const tokens = Math.max(0, Number(input.tokenUsage?.totalTokens ?? 0));
    const imageAssets = Math.max(0, Number(input.imageCount ?? 0)) + Math.max(0, Number(input.audioCount ?? 0));
    const videoAssets = Math.max(0, Number(input.videoCount ?? 0));

    const tokenCost = ["chat", "vision", "tools", "embeddings"].includes(capability)
        ? (tokens / 1000) * cfg.textEurPer1kTokens
        : 0;

    const imageCost = capability === "image_generation" ? imageAssets * cfg.imageEurPerAsset : 0;
    const videoCost = capability === "video_generation" ? videoAssets * cfg.videoEurPerAsset : 0;

    const amount = Number((tokenCost + imageCost + videoCost).toFixed(6));

    return {
        currency: "EUR",
        amount,
        source: "flat-rate",
        breakdown: {
            tokenCost: Number(tokenCost.toFixed(6)),
            imageCost: Number(imageCost.toFixed(6)),
            videoCost: Number(videoCost.toFixed(6)),
        },
        unitRates: {
            textEurPer1kTokens: cfg.textEurPer1kTokens,
            imageEurPerAsset: cfg.imageEurPerAsset,
            videoEurPerAsset: cfg.videoEurPerAsset,
        },
    };
}
