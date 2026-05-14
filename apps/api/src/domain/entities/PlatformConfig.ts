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
        maxCompletionTokens: 1200,
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
        model: "Qwen/Qwen2.5-VL-72B-Instruct",
        temperature: 0.1,
        maxCompletionTokens: 600,
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

export interface ProductGovernanceConfig {
    promptTemplates: ProductPromptTemplates;
    promptTaskSettings?: Record<string, PromptTaskSetting>;
    injections: ProductInjectionConfig;
    cookieBanner?: ProductCookieBannerConfig;
    legal?: ProductLegalConfig;
    nginx: ProductNginxConfig;
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
}

export function resolvePromptTaskSettingFromConfig(
    platformConfig: Pick<PlatformConfig, "governanceByProduct"> | null | undefined,
    productKey: string,
    taskKey: string,
): PromptTaskSetting {
    const defaultTask = (DEFAULT_PROMPT_TASK_SETTINGS[taskKey] ?? DEFAULT_PROMPT_TASK_SETTINGS.optimize_user_prompt)!;
    const fromDefault = platformConfig?.governanceByProduct?.default?.promptTaskSettings?.[taskKey];
    const fromProduct = platformConfig?.governanceByProduct?.[productKey]?.promptTaskSettings?.[taskKey];

    return {
        enabled: fromProduct?.enabled ?? fromDefault?.enabled ?? defaultTask.enabled,
        provider: fromProduct?.provider || fromDefault?.provider || defaultTask.provider,
        model: fromProduct?.model || fromDefault?.model || defaultTask.model,
        temperature: fromProduct?.temperature ?? fromDefault?.temperature ?? defaultTask.temperature,
        maxCompletionTokens: fromProduct?.maxCompletionTokens ?? fromDefault?.maxCompletionTokens ?? defaultTask.maxCompletionTokens,
        systemTemplate: fromProduct?.systemTemplate || fromDefault?.systemTemplate || defaultTask.systemTemplate,
    };
}
