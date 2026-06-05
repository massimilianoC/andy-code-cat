import type { UserLimits } from "./User";

export interface ProductPromptTemplates {
    generationSystem: string;
    focusedEditSystem: string;
    reviewSystem: string;
}

export interface PromptTaskSetting {
    enabled: boolean;
    provider: string;
    model: string;
    temperature: number;
    maxCompletionTokens: number;
    systemTemplate: string;
}

const LEGACY_ZERO_EFFORT_OPTIMIZER_MAX_COMPLETION_TOKENS = 1200;
const ZERO_EFFORT_OPTIMIZER_MAX_COMPLETION_TOKENS = 32000;

export const DEFAULT_PROMPT_TASK_SETTINGS: Record<string, PromptTaskSetting> = {
    optimize_user_prompt: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.7,
        maxCompletionTokens: 1200,
        systemTemplate: "",
    },
    optimize_image_prompt: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.4,
        maxCompletionTokens: 700,
        systemTemplate: "",
    },
    suggest_image_direction: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.5,
        maxCompletionTokens: 500,
        systemTemplate: "",
    },
    draft_template_model: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.5,
        maxCompletionTokens: 1800,
        systemTemplate: "",
    },
    zero_effort_optimize: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.7,
        maxCompletionTokens: ZERO_EFFORT_OPTIMIZER_MAX_COMPLETION_TOKENS,
        systemTemplate: "",
    },
    zero_effort_generate: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.5,
        maxCompletionTokens: 14000,
        systemTemplate: "",
    },
    // Document Context Layer (DCL) enrichment tasks
    enrich_document: {
        enabled: true,
        provider: "siliconflow",
        model: "Qwen/Qwen2.5-72B-Instruct",
        temperature: 0.1,
        maxCompletionTokens: 800,
        systemTemplate: "",
    },
    enrich_image: {
        enabled: true,
        provider: "siliconflow",
        model: "Qwen/Qwen3-VL-32B-Instruct",
        temperature: 0.1,
        maxCompletionTokens: 600,
        systemTemplate: "",
    },
    // VibeCore — Layer Φ: pre-run intent & format classifier
    vibe_intent_classify: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.0,
        maxCompletionTokens: 256,
        systemTemplate: "",
    },
    // VibeCore — Zero Effort LLM prefill (brief field extraction)
    vibe_intent_prefill: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.3,
        maxCompletionTokens: 768,
        systemTemplate: "",
    },
    // Vibe Mode — final generation step (workspace model when arriving from Vibe Mode expert path)
    vibe_mode_generate: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.5,
        maxCompletionTokens: 14000,
        systemTemplate: "",
    },
    // God Mode — default model for standalone God Mode workspace generation
    god_mode_generate: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.5,
        maxCompletionTokens: 14000,
        systemTemplate: "",
    },
};

export interface ProductInjectionConfig {
    headHtml: string;
    headerHtml: string;
    footerHtml: string;
    scriptInHead: string;
    scriptBeforeBodyClose: string;
    /** Global CSS injected into the <head> of generated pages. */
    globalCss: string;
    googleTagManagerId: string;
    googleAnalyticsId: string;
    matomoSiteId: string;
    matomoUrl: string;
}

/** Cookie banner text for a single locale. */
export interface CookieBannerLocaleText {
    message: string;
    acceptLabel: string;
    rejectLabel: string;
}

/** Cookie banner display and content configuration. */
export interface ProductCookieBannerConfig {
    enabled: boolean;
    position: "bottom" | "top" | "bottom-left" | "bottom-right";
    /** Keys are IETF locale codes (e.g. "en", "it"). */
    texts: Record<string, CookieBannerLocaleText>;
}

/**
 * Multilingual legal page configuration.
 * Keys in each record are IETF locale codes (e.g. "en", "it").
 * URL takes precedence; HTML acts as a fallback in-platform page.
 */
export interface ProductLegalConfig {
    privacyPolicyUrls: Record<string, string>;
    cookiePolicyUrls: Record<string, string>;
    privacyPolicyHtml: Record<string, string>;
    cookiePolicyHtml: Record<string, string>;
}

export interface ProductNginxConfig {
    publicDomain: string;
    publishSubdomainPattern: string;
    cacheTtlSeconds: number;
    clientMaxBodySizeMb: number;
    extraServerDirectives: string;
}

export interface ProductAttachmentPolicy {
    maxAttachmentsPerPrompt: number;
    maxFileSizeBytes: number;
    maxTotalBytes: number;
    warningThresholdBytes: number;
}

export interface ProductDocumentContextPolicy {
    maxAssetsPerPrompt: number;
    fallbackInlineExtractionMaxAssets: number;
}

export interface ProductGovernanceConfig {
    promptTemplates: ProductPromptTemplates;
    promptTaskSettings?: Record<string, PromptTaskSetting>;
    injections: ProductInjectionConfig;
    cookieBanner?: ProductCookieBannerConfig;
    legal?: ProductLegalConfig;
    nginx: ProductNginxConfig;
    attachmentPolicy?: ProductAttachmentPolicy;
    documentContextPolicy?: ProductDocumentContextPolicy;
}

/**
 * Per-resource-type cost policy override.
 * When set, these values override the global PlatformCostRates for the specified resource type.
 * Unset fields fall back to the global rates.
 */
export interface ResourceTypeCostPolicy {
    /** Percentage markup override (e.g. 0.15 = 15%). */
    markupPct?: number;
    /** Infrastructure cost percentage override (e.g. 0.05 = 5%). */
    infraPct?: number;
    /** Fixed fee in EUR added per transaction. */
    fixedFeeEur?: number;
    /** For LLM types: EUR per 1 000 tokens. */
    tokenRateEurPer1k?: number;
    /** For image / video types: EUR per generated asset. */
    assetRateEur?: number;
    /** When true, prefer provider-reported cost over flat-rate estimate. */
    useProviderCost?: boolean;
    /** Informational note (not used in cost computation). */
    note?: string;
}

/**
 * Live cost-rate overrides stored in platform config.
 * When present, these override the env-var defaults used by CostTransactionService.
 */
export interface PlatformCostRates {
    usdToEurRate: number;
    platformMarkupPct: number;
    infraCostPct: number;
    textEurPer1kTokens: number;
    imageEurPerAsset: number;
    videoEurPerAsset: number;
    computeEurPerMs: number;
    storageEurPerGbMonth: number;
    /** Per-resource-type policy overrides. Keys are ResourceType values (e.g. "llm.chat"). */
    perType?: Record<string, ResourceTypeCostPolicy>;
    updatedAt: Date;
    updatedByUserId?: string;
}

export type MediaStockProviderId = "pexels" | "pixabay" | "unsplash" | "loremflickr" | "picsum";

export interface MediaProviderPolicy {
    stockImage: {
        /** Superadmin-selected primary provider for stock image retrieval. */
        primaryProvider: MediaStockProviderId;
        /** When false, resolver fails after the primary provider instead of degrading. */
        fallbackEnabled: boolean;
        /** Ordered fallback providers used only when fallbackEnabled is true. */
        fallbackProviders: MediaStockProviderId[];
        /** Last-resort non-semantic placeholder provider. Kept explicit because it is lowest quality. */
        allowPicsumFallback: boolean;
        /** Overrides IMAGE_STOCK_PERSIST_STRICT for media resolution when set. */
        strictPersistence?: boolean;
    };
}

/**
 * Singleton platform-wide configuration document.
 * Stored in the `platform_config` collection under id "global".
 */
export interface PlatformConfig {
    id: string;
    /** When false, the public POST /v1/auth/register endpoint returns 403. */
    registrationOpen: boolean;
    /** When true, newly registered users must verify their email before accessing the platform. */
    emailVerificationRequired: boolean;
    /** Default resource limits assigned to every new user at registration time. */
    defaultUserLimits: UserLimits;
    /** Per-product global runtime governance: templates, script/html injection and nginx knobs. */
    governanceByProduct?: Record<string, ProductGovernanceConfig>;
    updatedAt: Date;
    /** userId of the superadmin that last modified this config. */
    updatedByUserId?: string;
    /** Live cost-rate overrides. When absent, CostTransactionService falls back to env vars. */
    costRates?: PlatformCostRates;
    /** Superadmin media-provider policy for deterministic media orchestration. */
    mediaProviderPolicy?: MediaProviderPolicy;
}

export const DEFAULT_PRODUCT_ATTACHMENT_POLICY: ProductAttachmentPolicy = {
    maxAttachmentsPerPrompt: 12,
    maxFileSizeBytes: 20 * 1024 * 1024,
    maxTotalBytes: 50 * 1024 * 1024,
    warningThresholdBytes: 35 * 1024 * 1024,
};

export const DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY: ProductDocumentContextPolicy = {
    maxAssetsPerPrompt: 5,
    fallbackInlineExtractionMaxAssets: 3,
};

export function resolvePromptTaskSettingFromConfig(
    platformConfig: Pick<PlatformConfig, "governanceByProduct"> | null | undefined,
    productKey: string,
    taskKey: string,
): PromptTaskSetting {
    const defaultTask = (DEFAULT_PROMPT_TASK_SETTINGS[taskKey] ?? DEFAULT_PROMPT_TASK_SETTINGS.optimize_user_prompt)!;
    const fromDefault = platformConfig?.governanceByProduct?.default?.promptTaskSettings?.[taskKey];
    const fromProduct = platformConfig?.governanceByProduct?.[productKey]?.promptTaskSettings?.[taskKey];
    const configuredMaxCompletionTokens =
        fromProduct?.maxCompletionTokens ?? fromDefault?.maxCompletionTokens ?? defaultTask.maxCompletionTokens;
    // Existing deployments may have persisted the old cost-saving default. It was
    // too small for rich Vibe/Xero briefs and caused provider-side truncation.
    const maxCompletionTokens =
        taskKey === "zero_effort_optimize"
            && configuredMaxCompletionTokens === LEGACY_ZERO_EFFORT_OPTIMIZER_MAX_COMPLETION_TOKENS
            ? ZERO_EFFORT_OPTIMIZER_MAX_COMPLETION_TOKENS
            : configuredMaxCompletionTokens;

    return {
        enabled: fromProduct?.enabled ?? fromDefault?.enabled ?? defaultTask.enabled,
        provider: fromProduct?.provider || fromDefault?.provider || defaultTask.provider,
        model: fromProduct?.model || fromDefault?.model || defaultTask.model,
        temperature: fromProduct?.temperature ?? fromDefault?.temperature ?? defaultTask.temperature,
        maxCompletionTokens,
        systemTemplate: fromProduct?.systemTemplate || fromDefault?.systemTemplate || defaultTask.systemTemplate,
    };
}

export function resolveAttachmentPolicyFromConfig(
    platformConfig: Pick<PlatformConfig, "governanceByProduct"> | null | undefined,
    productKey: string,
): ProductAttachmentPolicy {
    const fromDefault = platformConfig?.governanceByProduct?.default?.attachmentPolicy;
    const fromProduct = platformConfig?.governanceByProduct?.[productKey]?.attachmentPolicy;
    const merged: ProductAttachmentPolicy = {
        ...DEFAULT_PRODUCT_ATTACHMENT_POLICY,
        ...(fromDefault ?? {}),
        ...(fromProduct ?? {}),
    };
    const maxTotalBytes = Math.max(1, merged.maxTotalBytes);
    return {
        ...merged,
        maxAttachmentsPerPrompt: Math.max(1, merged.maxAttachmentsPerPrompt),
        maxFileSizeBytes: Math.max(1, merged.maxFileSizeBytes),
        maxTotalBytes,
        warningThresholdBytes: Math.min(Math.max(1, merged.warningThresholdBytes), maxTotalBytes),
    };
}

export function resolveDocumentContextPolicyFromConfig(
    platformConfig: Pick<PlatformConfig, "governanceByProduct"> | null | undefined,
    productKey: string,
): ProductDocumentContextPolicy {
    const fromDefault = platformConfig?.governanceByProduct?.default?.documentContextPolicy;
    const fromProduct = platformConfig?.governanceByProduct?.[productKey]?.documentContextPolicy;
    const merged: ProductDocumentContextPolicy = {
        ...DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY,
        ...(fromDefault ?? {}),
        ...(fromProduct ?? {}),
    };
    return {
        maxAssetsPerPrompt: Math.max(1, merged.maxAssetsPerPrompt),
        fallbackInlineExtractionMaxAssets: Math.max(1, merged.fallbackInlineExtractionMaxAssets),
    };
}
