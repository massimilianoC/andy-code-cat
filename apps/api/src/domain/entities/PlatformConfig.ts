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
