import type { UserLimits } from "./User";

export interface ProductPromptTemplates {
    generationSystem: string;
    focusedEditSystem: string;
    reviewSystem: string;
}

export interface ProductInjectionConfig {
    headHtml: string;
    headerHtml: string;
    footerHtml: string;
    scriptInHead: string;
    scriptBeforeBodyClose: string;
    googleTagManagerId: string;
    googleAnalyticsId: string;
    matomoSiteId: string;
    matomoUrl: string;
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
    injections: ProductInjectionConfig;
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
