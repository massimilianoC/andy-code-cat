import { z } from "zod";

// ── Plan & limits ─────────────────────────────────────────────────────────────

export const userPlanSchema = z.enum(["free", "pro", "enterprise", "unlimited"]);
export type UserPlan = z.infer<typeof userPlanSchema>;

export const userLimitsSchema = z.object({
    maxProjects: z.number().int().min(-1).default(-1),
    maxMonthlyTokensK: z.number().int().min(-1).default(-1),
    maxStorageMb: z.number().int().min(-1).default(-1),
    maxPublishedSites: z.number().int().min(-1).default(-1),
    plan: userPlanSchema.default("unlimited"),
    planExpiresAt: z.coerce.date().optional(),
});
export type UserLimitsInput = z.infer<typeof userLimitsSchema>;

export const setUserLimitsSchema = userLimitsSchema.partial();
export type SetUserLimitsInput = z.infer<typeof setUserLimitsSchema>;

// ── Platform config ───────────────────────────────────────────────────────────

const promptTaskSettingSchema = z.object({
    enabled: z.boolean().default(true),
    provider: z.string().min(1).max(80).default("siliconflow"),
    model: z.string().min(1).max(200).default("MiniMaxAI/MiniMax-M2.5"),
    temperature: z.number().min(0).max(2).default(0.7),
    maxCompletionTokens: z.number().int().min(64).max(32000).default(1200),
    systemTemplate: z.string().max(20000).default(""),
});

const mediaStockProviderSchema = z.enum(["pexels", "pixabay", "unsplash", "loremflickr", "picsum"]);

const mediaProviderPolicySchema = z.object({
    stockImage: z.object({
        primaryProvider: mediaStockProviderSchema.default("pexels"),
        fallbackEnabled: z.boolean().default(true),
        fallbackProviders: z.array(mediaStockProviderSchema).max(5).default(["pixabay", "unsplash", "loremflickr"]),
        allowPicsumFallback: z.boolean().default(true),
        strictPersistence: z.boolean().optional(),
    }).partial().optional(),
}).partial();

export const setPlatformConfigSchema = z.object({
    registrationOpen: z.boolean().optional(),
    emailVerificationRequired: z.boolean().optional(),
    defaultUserLimits: setUserLimitsSchema.optional(),
    mediaProviderPolicy: mediaProviderPolicySchema.optional(),
    governanceByProduct: z.record(z.string().min(1), z.object({
        promptTemplates: z.object({
            generationSystem: z.string().max(20000).default(""),
            focusedEditSystem: z.string().max(20000).default(""),
            reviewSystem: z.string().max(20000).default(""),
        }).partial().optional(),
        promptTaskSettings: z.record(z.string().min(1), promptTaskSettingSchema.partial()).optional(),
        injections: z.object({
            headHtml: z.string().max(40000).default(""),
            headerHtml: z.string().max(40000).default(""),
            footerHtml: z.string().max(40000).default(""),
            scriptInHead: z.string().max(40000).default(""),
            scriptBeforeBodyClose: z.string().max(40000).default(""),
            globalCss: z.string().max(40000).default(""),
            googleTagManagerId: z.string().max(128).default(""),
            googleAnalyticsId: z.string().max(128).default(""),
            matomoSiteId: z.string().max(128).default(""),
            matomoUrl: z.string().max(2048).default(""),
        }).partial().optional(),
        /** Cookie banner config. Keys in `texts` are IETF locale codes (e.g. "en", "it"). */
        cookieBanner: z.object({
            enabled: z.boolean().default(false),
            position: z.enum(["bottom", "top", "bottom-left", "bottom-right"]).default("bottom"),
            texts: z.record(
                z.string().min(2).max(10),
                z.object({
                    message: z.string().max(2000).default(""),
                    acceptLabel: z.string().max(100).default(""),
                    rejectLabel: z.string().max(100).default(""),
                }),
            ).default({}),
        }).partial().optional(),
        /**
         * Multilingual legal pages. Keys are IETF locale codes; values are URL or inline HTML.
         * URL takes precedence when both are supplied; HTML acts as a fallback in-platform page.
         */
        legal: z.object({
            privacyPolicyUrls: z.record(z.string().min(2).max(10), z.string().max(2048)).default({}),
            cookiePolicyUrls: z.record(z.string().min(2).max(10), z.string().max(2048)).default({}),
            privacyPolicyHtml: z.record(z.string().min(2).max(10), z.string().max(100000)).default({}),
            cookiePolicyHtml: z.record(z.string().min(2).max(10), z.string().max(100000)).default({}),
        }).partial().optional(),
        nginx: z.object({
            publicDomain: z.string().max(255).default(""),
            publishSubdomainPattern: z.string().max(255).default("{publishId}"),
            cacheTtlSeconds: z.number().int().min(0).max(86400).default(300),
            clientMaxBodySizeMb: z.number().int().min(1).max(1024).default(20),
            extraServerDirectives: z.string().max(40000).default(""),
        }).partial().optional(),
    }).default({})).optional(),
});
export type SetPlatformConfigInput = z.infer<typeof setPlatformConfigSchema>;

export const adminLlmModelPatchSchema = z.object({
    displayName: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).optional(),
    role: z.enum([
        "coding",
        "coding_fast",
        "dialogue",
        "dialogue_fast",
        "vision",
        "vision_fast",
        "quality_check",
        "image_gen",
        "image_gen_fast",
        "embeddings",
    ]).optional(),
    capabilities: z.array(z.enum(["chat", "vision", "image_generation", "video_generation", "tools", "embeddings"])).max(10).optional(),
    isDefault: z.boolean().optional(),
    isFallback: z.boolean().optional(),
    isActive: z.boolean().optional(),
    promptTemplate: z.string().max(20000).optional(),
    focusPromptTemplate: z.string().max(20000).optional(),
    priceInputUsdPerM: z.number().min(0).optional(),
    priceOutputUsdPerM: z.number().min(0).optional(),
    baseUrl: z.string().max(2048).optional(),
    apiType: z.enum(["openai-compatible", "anthropic-compatible", "custom"]).optional(),
    authType: z.enum(["api-key", "bearer", "none"]).optional(),
    providerActive: z.boolean().optional(),
});
export type AdminLlmModelPatchInput = z.infer<typeof adminLlmModelPatchSchema>;

export const adminSeedLlmRegistrySchema = z.object({
    providers: z.array(z.string().min(1).max(80)).max(10).optional(),
});
export type AdminSeedLlmRegistryInput = z.infer<typeof adminSeedLlmRegistrySchema>;

const presetPageModelSchema = z.enum(["single_page", "multi_page", "slide_deck", "print_a4"]);
const presetSectionModelSchema = z.enum(["scroll", "paginated", "masonry", "stepped_form"]);

export const adminPresetRecommendedModelSchema = z.object({
    provider: z.string().min(1).max(80),
    modelId: z.string().min(1).max(200),
    label: z.string().max(120).optional(),
});

export const adminProjectPresetPatchSchema = z.object({
    label: z.string().min(1).max(120).optional(),
    labelIt: z.string().min(1).max(120).optional(),
    labelEn: z.string().min(1).max(120).optional(),
    hint: z.string().max(240).optional(),
    icon: z.string().max(80).optional(),
    category: z.string().min(1).max(80).optional(),
    categoryLabel: z.string().max(120).optional(),
    categoryHint: z.string().max(120).optional(),
    tags: z.array(z.string().min(1).max(80)).max(20).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
    scope: z.enum(["global", "user", "project"]).optional(),
    status: z.enum(["draft", "pending_review", "published", "archived"]).optional(),
    ownerUserId: z.string().max(120).optional(),
    recommendedModel: adminPresetRecommendedModelSchema.optional(),
    outputSpec: z.object({
        pageModel: presetPageModelSchema.optional(),
        sectionModel: presetSectionModelSchema.optional(),
        recommendedPageCount: z.number().int().min(1).max(100).optional(),
        aspectRatio: z.enum(["16:9", "4:3", "A4_portrait", "A4_landscape", "free"]).optional(),
        cssConstraints: z.string().max(40000).optional(),
        printReady: z.boolean().optional(),
        systemPromptModule: z.string().max(40000).optional(),
    }).optional(),
    defaultTags: z.object({
        visualTags: z.array(z.string().min(1).max(80)).max(20).optional(),
        paletteTags: z.array(z.string().min(1).max(80)).max(20).optional(),
        typographyTags: z.array(z.string().min(1).max(80)).max(20).optional(),
        layoutTags: z.array(z.string().min(1).max(80)).max(20).optional(),
        toneTags: z.array(z.string().min(1).max(80)).max(20).optional(),
        featureTags: z.array(z.string().min(1).max(80)).max(20).optional(),
        audienceTags: z.array(z.string().min(1).max(80)).max(20).optional(),
        sectorTags: z.array(z.string().min(1).max(80)).max(20).optional(),
    }).optional(),
    briefTemplate: z.string().max(20000).optional(),
    styleTemplate: z.string().max(20000).optional(),
    briefGuideQuestions: z.array(z.string().min(1).max(240)).max(8).optional(),
});
export type AdminProjectPresetPatchInput = z.infer<typeof adminProjectPresetPatchSchema>;

export const adminSeedPresetRegistrySchema = z.object({
    resetToDefaults: z.boolean().optional(),
});
export type AdminSeedPresetRegistryInput = z.infer<typeof adminSeedPresetRegistrySchema>;

export const adminDraftProjectTemplateSchema = z.object({
    instructions: z.string().min(1).max(12000),
    category: z.string().max(80).optional(),
    labelHint: z.string().max(120).optional(),
    existingDraft: z.object({
        label: z.string().max(120).optional(),
        labelIt: z.string().max(120).optional(),
        labelEn: z.string().max(120).optional(),
        hint: z.string().max(240).optional(),
        category: z.string().max(80).optional(),
        tags: z.array(z.string().min(1).max(80)).max(20).optional(),
        briefTemplate: z.string().max(20000).optional(),
        styleTemplate: z.string().max(20000).optional(),
        outputSpec: z.object({
            pageModel: presetPageModelSchema.optional(),
            sectionModel: presetSectionModelSchema.optional(),
            recommendedPageCount: z.number().int().min(1).max(100).optional(),
            aspectRatio: z.enum(["16:9", "4:3", "A4_portrait", "A4_landscape", "free"]).optional(),
            printReady: z.boolean().optional(),
            cssConstraints: z.string().max(40000).optional(),
            systemPromptModule: z.string().max(40000).optional(),
        }).partial().optional(),
    }).partial().optional(),
});
export type AdminDraftProjectTemplateInput = z.infer<typeof adminDraftProjectTemplateSchema>;

// ── User management ───────────────────────────────────────────────────────────

export const adminUserRoleSchema = z.enum(["user", "admin", "superadmin"]);

export const adminCreateUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    roles: z.array(adminUserRoleSchema).min(1).default(["user"]),
    emailVerified: z.boolean().default(true),
    limits: userLimitsSchema.optional(),
});
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const setUserRolesSchema = z.object({
    roles: z.array(adminUserRoleSchema).min(1),
});
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;

export const blockUserSchema = z.object({
    blocked: z.boolean(),
});
export type BlockUserInput = z.infer<typeof blockUserSchema>;

export const adminUpdateUserProfileSchema = z.object({
    email: z.string().email().optional(),
    firstName: z.string().max(100).nullable().optional(),
    lastName: z.string().max(100).nullable().optional(),
    emailVerified: z.boolean().optional(),
});
export type AdminUpdateUserProfileInput = z.infer<typeof adminUpdateUserProfileSchema>;

export const adminResetUserPasswordSchema = z.object({
    newPassword: z.string().min(8).max(128),
    requireChangeOnNextLogin: z.boolean().default(true),
});
export type AdminResetUserPasswordInput = z.infer<typeof adminResetUserPasswordSchema>;

export const adminSetPasswordResetRequiredSchema = z.object({
    required: z.boolean(),
});
export type AdminSetPasswordResetRequiredInput = z.infer<typeof adminSetPasswordResetRequiredSchema>;

export const listUsersQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    role: adminUserRoleSchema.optional(),
    isBlocked: z.enum(["true", "false"]).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// ── Publication control ───────────────────────────────────────────────────────

export const adminBlockDeploymentSchema = z.object({
    blocked: z.boolean(),
});
export type AdminBlockDeploymentInput = z.infer<typeof adminBlockDeploymentSchema>;

export const adminSetSlugSchema = z.object({
    customSlug: z.string()
        .min(2)
        .max(63)
        .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers and hyphens allowed")
        .nullable(),
});
export type AdminSetSlugInput = z.infer<typeof adminSetSlugSchema>;

// ── DTOs returned by admin endpoints ─────────────────────────────────────────

export interface AdminUserDto {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: string[];
    limits?: {
        maxProjects: number;
        maxMonthlyTokensK: number;
        maxStorageMb: number;
        maxPublishedSites: number;
        plan: string;
        planExpiresAt?: string;
    };
    createdAt: string;
}

export interface PlatformStatsDto {
    totalUsers: number;
    blockedUsers: number;
    totalProjects: number;
    totalLiveDeployments: number;
    usersByRole: Record<string, number>;
}

export interface PlatformConfigDto {
    registrationOpen: boolean;
    emailVerificationRequired: boolean;
    defaultUserLimits: {
        maxProjects: number;
        maxMonthlyTokensK: number;
        maxStorageMb: number;
        maxPublishedSites: number;
        plan: string;
        planExpiresAt?: string;
    };
    governanceByProduct?: Record<string, {
        promptTemplates: {
            generationSystem: string;
            focusedEditSystem: string;
            reviewSystem: string;
        };
        promptTaskSettings?: Record<string, {
            enabled: boolean;
            provider: string;
            model: string;
            temperature: number;
            maxCompletionTokens: number;
            systemTemplate: string;
        }>;
        injections: {
            headHtml: string;
            headerHtml: string;
            footerHtml: string;
            scriptInHead: string;
            scriptBeforeBodyClose: string;
            globalCss: string;
            googleTagManagerId: string;
            googleAnalyticsId: string;
            matomoSiteId: string;
            matomoUrl: string;
        };
        cookieBanner?: {
            enabled: boolean;
            position: "bottom" | "top" | "bottom-left" | "bottom-right";
            texts: Record<string, { message: string; acceptLabel: string; rejectLabel: string }>;
        };
        legal?: {
            privacyPolicyUrls: Record<string, string>;
            cookiePolicyUrls: Record<string, string>;
            privacyPolicyHtml: Record<string, string>;
            cookiePolicyHtml: Record<string, string>;
        };
        nginx: {
            publicDomain: string;
            publishSubdomainPattern: string;
            cacheTtlSeconds: number;
            clientMaxBodySizeMb: number;
            extraServerDirectives: string;
        };
    }>;
    updatedAt: string;
    updatedByUserId?: string;
    mediaProviderPolicy?: {
        stockImage: {
            primaryProvider: "pexels" | "pixabay" | "unsplash" | "loremflickr" | "picsum";
            fallbackEnabled: boolean;
            fallbackProviders: Array<"pexels" | "pixabay" | "unsplash" | "loremflickr" | "picsum">;
            allowPicsumFallback: boolean;
            strictPersistence?: boolean;
        };
    };
}

export interface AdminDeploymentDto {
    id: string;
    publishId: string;
    customSlug?: string;
    projectId: string;
    userId: string;
    status: string;
    url: string;
    isAdminBlocked: boolean;
    adminBlockedAt?: string;
    createdAt: string;
    updatedAt: string;
}
