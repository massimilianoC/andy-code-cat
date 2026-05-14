/**
 * Super Admin API client.
 * All functions require the caller to hold the "superadmin" role.
 * The bearer token is injected automatically by the `call` helper.
 */
import { call } from "./call";
import type { AiUsageAnalyticsDto } from "./assets";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserLimitsDto {
    maxProjects: number;
    maxMonthlyTokensK: number;
    maxStorageMb: number;
    maxPublishedSites: number;
    plan: string;
    planExpiresAt?: string;
}

export interface AdminUserDto {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: string[];
    limits?: UserLimitsDto;
    createdAt: string;
}

export interface AdminUserDetailDto extends AdminUserDto {
    requiresPasswordChange: boolean;
    projects: { id: string; name: string; presetId?: string; createdAt: string }[];
    tokensConsumedLifetime: number;
}

export interface AdminUpdateUserProfileBody {
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    emailVerified?: boolean;
}

export interface AdminResetUserPasswordBody {
    newPassword: string;
    requireChangeOnNextLogin?: boolean;
}

export interface PlatformStatsDto {
    totalUsers: number;
    blockedUsers: number;
    totalProjects: number;
    totalLiveDeployments: number;
    usersByRole: Record<string, number>;
    totalTokensConsumedLifetime: number;
}

export interface PlatformConfigDto {
    registrationOpen: boolean;
    emailVerificationRequired: boolean;
    defaultUserLimits: UserLimitsDto;
    governanceByProduct?: Record<string, ProductGovernanceDto>;
    updatedAt: string;
    updatedByUserId?: string;
}

export interface ProductPromptTemplatesDto {
    generationSystem: string;
    focusedEditSystem: string;
    reviewSystem: string;
}

export interface PromptTaskSettingDto {
    enabled: boolean;
    provider: string;
    model: string;
    temperature: number;
    maxCompletionTokens: number;
    systemTemplate: string;
}

export interface ProductInjectionsDto {
    headHtml: string;
    headerHtml: string;
    footerHtml: string;
    scriptInHead: string;
    scriptBeforeBodyClose: string;
    /** Global CSS injected into generated pages. */
    globalCss: string;
    googleTagManagerId: string;
    googleAnalyticsId: string;
    matomoSiteId: string;
    matomoUrl: string;
}

export interface CookieBannerLocaleText {
    message: string;
    acceptLabel: string;
    rejectLabel: string;
}

export interface ProductCookieBannerDto {
    enabled: boolean;
    position: "bottom" | "top" | "bottom-left" | "bottom-right";
    texts: Record<string, CookieBannerLocaleText>;
}

export interface ProductLegalDto {
    privacyPolicyUrls: Record<string, string>;
    cookiePolicyUrls: Record<string, string>;
    privacyPolicyHtml: Record<string, string>;
    cookiePolicyHtml: Record<string, string>;
}

export interface ProductNginxDto {
    publicDomain: string;
    publishSubdomainPattern: string;
    cacheTtlSeconds: number;
    clientMaxBodySizeMb: number;
    extraServerDirectives: string;
}

export interface ProductGovernanceDto {
    promptTemplates: ProductPromptTemplatesDto;
    promptTaskSettings?: Record<string, PromptTaskSettingDto>;
    injections: ProductInjectionsDto;
    cookieBanner?: ProductCookieBannerDto;
    legal?: ProductLegalDto;
    nginx: ProductNginxDto;
}

export interface AdminLlmModelDto {
    id: string;
    provider: string;
    role: string;
    capabilities: string[];
    isDefault: boolean;
    isFallback: boolean;
    isActive: boolean;
    displayName?: string;
    description?: string;
    promptTemplate?: string;
    focusPromptTemplate?: string;
    priceTier?: "free" | "€" | "€€" | "€€€" | "€€€€";
    priceInputUsdPerM?: number;
    priceOutputUsdPerM?: number;
}

export interface AdminLlmProviderDto {
    provider: string;
    baseUrl: string;
    apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
    authType?: "api-key" | "bearer" | "none";
    isActive: boolean;
    models: AdminLlmModelDto[];
    createdAt: string;
    updatedAt: string;
}

export interface AdminLlmRegistryDto {
    source: string;
    providers: AdminLlmProviderDto[];
}

export interface AdminPresetRecommendedModelDto {
    provider: string;
    modelId: string;
    label?: string;
}

export interface AdminProjectPresetDto {
    id: string;
    label: string;
    labelIt: string;
    labelEn: string;
    hint: string;
    icon: string;
    category?: string;
    categoryLabel?: string;
    categoryHint?: string;
    tags?: string[];
    sortOrder?: number;
    isActive?: boolean;
    scope?: "global" | "user" | "project";
    status?: "draft" | "pending_review" | "published" | "archived";
    ownerUserId?: string;
    recommendedModel?: AdminPresetRecommendedModelDto;
    outputSpec: {
        pageModel: "single_page" | "multi_page" | "slide_deck" | "print_a4";
        sectionModel: "scroll" | "paginated" | "masonry" | "stepped_form";
        recommendedPageCount?: number;
        aspectRatio?: "16:9" | "4:3" | "A4_portrait" | "A4_landscape" | "free";
        cssConstraints?: string;
        printReady: boolean;
        systemPromptModule: string;
    };
    defaultTags: {
        visualTags?: string[];
        paletteTags?: string[];
        typographyTags?: string[];
        layoutTags?: string[];
        toneTags?: string[];
        featureTags?: string[];
        audienceTags?: string[];
    };
    briefTemplate: string;
    styleTemplate: string;
    briefGuideQuestions: string[];
}

export interface AdminPresetRegistryDto {
    source: string;
    presets: AdminProjectPresetDto[];
}

export interface AdminDraftProjectTemplateInput {
    instructions: string;
    category?: string;
    labelHint?: string;
    existingDraft?: Partial<AdminProjectPresetDto>;
}

export interface AdminDraftProjectTemplateResult {
    draft: Partial<AdminProjectPresetDto>;
    provider: string;
    model: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    costEstimate?: {
        currency: "EUR";
        amount: number;
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
        providerCostUsd?: number;
    };
    durationMs: number;
    rawResponse?: string;
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

// ── Stats ─────────────────────────────────────────────────────────────────────

function auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

export function getAdminStats(token: string): Promise<PlatformStatsDto> {
    return call<PlatformStatsDto>("GET", "/v1/admin/stats", undefined, auth(token));
}

export function getAdminAiAnalytics(token: string): Promise<AiUsageAnalyticsDto> {
    return call<AiUsageAnalyticsDto>("GET", "/v1/admin/ai-analytics", undefined, auth(token));
}

export function getAdminProjectAiAnalytics(
    token: string,
    projectId: string,
): Promise<AiUsageAnalyticsDto & { projectId: string; projectName?: string; ownerUserId?: string }> {
    return call<AiUsageAnalyticsDto & { projectId: string; projectName?: string; ownerUserId?: string }>(
        "GET",
        `/v1/admin/projects/${projectId}/ai-analytics`,
        undefined,
        auth(token),
    );
}

// ── Platform config ───────────────────────────────────────────────────────────

export function getAdminConfig(token: string): Promise<PlatformConfigDto> {
    return call<PlatformConfigDto>("GET", "/v1/admin/config", undefined, auth(token));
}

export function updateAdminConfig(
    token: string,
    body: Partial<{
        registrationOpen: boolean;
        emailVerificationRequired: boolean;
        defaultUserLimits: Partial<UserLimitsDto>;
        governanceByProduct: Record<string, Partial<ProductGovernanceDto>>;
    }>
): Promise<PlatformConfigDto> {
    return call<PlatformConfigDto>("PATCH", "/v1/admin/config", body, auth(token));
}

export function updateProductGovernance(
    token: string,
    productKey: string,
    governancePatch: Partial<ProductGovernanceDto>
): Promise<PlatformConfigDto> {
    return updateAdminConfig(token, {
        governanceByProduct: {
            [productKey]: governancePatch,
        },
    });
}

export function getAdminLlmRegistry(token: string): Promise<AdminLlmRegistryDto> {
    return call<AdminLlmRegistryDto>("GET", "/v1/admin/llm-registry", undefined, auth(token));
}

export function seedAdminLlmRegistry(token: string): Promise<AdminLlmRegistryDto & { ok: boolean; providersUpserted: number; modelsUpserted: number }> {
    return call("POST", "/v1/admin/llm-registry/seed", {}, auth(token));
}

export function updateAdminLlmModel(
    token: string,
    provider: string,
    modelId: string,
    body: Partial<AdminLlmModelDto> & {
        baseUrl?: string;
        apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
        authType?: "api-key" | "bearer" | "none";
        providerActive?: boolean;
    }
): Promise<AdminLlmProviderDto> {
    return call(
        "PUT",
        `/v1/admin/llm-registry/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(modelId)}`,
        body,
        auth(token),
    );
}

export function deleteAdminLlmModel(token: string, provider: string, modelId: string): Promise<AdminLlmProviderDto> {
    return call(
        "DELETE",
        `/v1/admin/llm-registry/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(modelId)}`,
        undefined,
        auth(token),
    );
}

export function getAdminPresetRegistry(token: string): Promise<AdminPresetRegistryDto> {
    return call<AdminPresetRegistryDto>("GET", "/v1/admin/preset-registry", undefined, auth(token));
}

export function seedAdminPresetRegistry(token: string): Promise<AdminPresetRegistryDto & { ok: boolean; upserted: number }> {
    return call("POST", "/v1/admin/preset-registry/seed", {}, auth(token));
}

export function updateAdminPreset(
    token: string,
    presetId: string,
    body: Partial<AdminProjectPresetDto>,
): Promise<AdminProjectPresetDto> {
    return call(
        "PUT",
        `/v1/admin/preset-registry/${encodeURIComponent(presetId)}`,
        body,
        auth(token),
    );
}

export function deleteAdminPreset(token: string, presetId: string): Promise<{ ok: boolean; presets: AdminProjectPresetDto[] }> {
    return call(
        "DELETE",
        `/v1/admin/preset-registry/${encodeURIComponent(presetId)}`,
        undefined,
        auth(token),
    );
}

export function draftAdminPreset(token: string, body: AdminDraftProjectTemplateInput): Promise<AdminDraftProjectTemplateResult> {
    return call(
        "POST",
        "/v1/admin/preset-registry/draft",
        body,
        auth(token),
    );
}

// ── User management ───────────────────────────────────────────────────────────

export interface ListUsersParams {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isBlocked?: boolean;
}

export interface ListUsersResult {
    users: AdminUserDto[];
    total: number;
    page: number;
    limit: number;
}

export function listAdminUsers(token: string, params?: ListUsersParams): Promise<ListUsersResult> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.search) qs.set("search", params.search);
    if (params?.role) qs.set("role", params.role);
    if (params?.isBlocked !== undefined) qs.set("isBlocked", String(params.isBlocked));
    const query = qs.toString();
    return call<ListUsersResult>("GET", `/v1/admin/users${query ? `?${query}` : ""}`, undefined, auth(token));
}

export function getAdminUser(token: string, userId: string): Promise<AdminUserDetailDto> {
    return call<AdminUserDetailDto>("GET", `/v1/admin/users/${userId}`, undefined, auth(token));
}

export interface AdminCreateUserBody {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    roles?: string[];
    emailVerified?: boolean;
}

export function adminCreateUser(token: string, body: AdminCreateUserBody): Promise<AdminUserDto> {
    return call<AdminUserDto>("POST", "/v1/admin/users", body, auth(token));
}

export function adminBlockUser(token: string, userId: string, blocked: boolean): Promise<{ userId: string; isBlocked: boolean }> {
    return call("PATCH", `/v1/admin/users/${userId}/block`, { blocked }, auth(token));
}

export function adminSetUserRoles(token: string, userId: string, roles: string[]): Promise<{ userId: string; roles: string[] }> {
    return call("PATCH", `/v1/admin/users/${userId}/roles`, { roles }, auth(token));
}

export function adminSetUserLimits(token: string, userId: string, limits: Partial<UserLimitsDto>): Promise<{ userId: string; limits: UserLimitsDto }> {
    return call("PATCH", `/v1/admin/users/${userId}/limits`, limits, auth(token));
}

export function adminUpdateUserProfile(
    token: string,
    userId: string,
    body: AdminUpdateUserProfileBody
): Promise<{ userId: string; email: string; firstName?: string; lastName?: string; emailVerified: boolean }> {
    return call("PATCH", `/v1/admin/users/${userId}/profile`, body, auth(token));
}

export function adminResetUserPassword(
    token: string,
    userId: string,
    body: AdminResetUserPasswordBody
): Promise<{ userId: string; reauthRequired: boolean; requiresPasswordChange: boolean }> {
    return call("PATCH", `/v1/admin/users/${userId}/password-reset`, body, auth(token));
}

export function adminSetUserPasswordResetRequired(
    token: string,
    userId: string,
    required: boolean
): Promise<{ userId: string; requiresPasswordChange: boolean }> {
    return call("PATCH", `/v1/admin/users/${userId}/password-reset-required`, { required }, auth(token));
}

export function adminDeleteUser(token: string, userId: string): Promise<{ deleted: boolean; userId: string }> {
    return call("DELETE", `/v1/admin/users/${userId}`, undefined, auth(token));
}

// ── Deployments ───────────────────────────────────────────────────────────────

export interface ListDeploymentsResult {
    deployments: AdminDeploymentDto[];
    total: number;
    page: number;
    limit: number;
}

export function listAdminDeployments(token: string, params?: { page?: number; limit?: number }): Promise<ListDeploymentsResult> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    return call<ListDeploymentsResult>("GET", `/v1/admin/deployments${qs.toString() ? `?${qs}` : ""}`, undefined, auth(token));
}

export function adminBlockDeployment(token: string, publishId: string, blocked: boolean): Promise<{ publishId: string; isAdminBlocked: boolean }> {
    return call("PATCH", `/v1/admin/deployments/${publishId}/block`, { blocked }, auth(token));
}

// ── Projects ──────────────────────────────────────────────────────────────────

export interface AdminProjectActiveDeploymentDto {
    publishId: string;
    customSlug?: string;
    url: string;
    subdomainUrl?: string | null;
    isAdminBlocked: boolean;
}

export interface AdminProjectDto {
    id: string;
    name: string;
    presetId?: string;
    ownerUserId: string;
    ownerEmail: string;
    ownerFirstName?: string;
    ownerLastName?: string;
    ownerIsBlocked: boolean;
    activeDeployment?: AdminProjectActiveDeploymentDto;
    createdAt: string;
}

export interface AdminListProjectsParams {
    page?: number;
    limit?: number;
    search?: string;
    ownerId?: string;
    presetId?: string;
}

export interface AdminListProjectsResult {
    projects: AdminProjectDto[];
    total: number;
    page: number;
    limit: number;
}

export function adminListProjects(token: string, params?: AdminListProjectsParams): Promise<AdminListProjectsResult> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.search) qs.set("search", params.search);
    if (params?.ownerId) qs.set("ownerId", params.ownerId);
    if (params?.presetId) qs.set("presetId", params.presetId);
    const query = qs.toString();
    return call<AdminListProjectsResult>("GET", `/v1/admin/projects${query ? `?${query}` : ""}`, undefined, auth(token));
}

export function adminDeleteProject(token: string, projectId: string): Promise<{ deleted: boolean }> {
    return call("DELETE", `/v1/admin/projects/${projectId}`, undefined, auth(token));
}

// ── Service API keys ──────────────────────────────────────────────────────────

export type ServiceCategory = "image" | "video" | "llm" | "other";

export interface ServiceApiKeyDto {
    id: string;
    service: string;
    label: string;
    category: ServiceCategory;
    ownerType: "platform" | "user";
    enabled: boolean;
    supportsVideo: boolean;
    isDefault: boolean;
    /** Masked plain-text: first 4 + *** + last 4 chars */
    maskedKey: string;
    createdAt: string;
    updatedAt: string;
}

export interface EnvKeyStatusDto {
    pexels: boolean;
    pixabay: boolean;
    unsplash: boolean;
    siliconflow: boolean;
    openrouter: boolean;
}

export function getServiceKeyEnvStatus(token: string): Promise<EnvKeyStatusDto> {
    return call<EnvKeyStatusDto>("GET", "/v1/admin/service-keys/env-status", undefined, auth(token));
}

export function listServiceKeys(token: string): Promise<{ keys: ServiceApiKeyDto[] }> {
    return call<{ keys: ServiceApiKeyDto[] }>("GET", "/v1/admin/service-keys", undefined, auth(token));
}

export function createServiceKey(
    token: string,
    body: {
        service: string;
        label: string;
        category: ServiceCategory;
        plaintextKey: string;
        enabled?: boolean;
        supportsVideo?: boolean;
        isDefault?: boolean;
    },
): Promise<ServiceApiKeyDto> {
    return call<ServiceApiKeyDto>("POST", "/v1/admin/service-keys", body, auth(token));
}

export function updateServiceKey(
    token: string,
    id: string,
    body: {
        label?: string;
        enabled?: boolean;
        supportsVideo?: boolean;
        isDefault?: boolean;
        plaintextKey?: string;
    },
): Promise<ServiceApiKeyDto> {
    return call<ServiceApiKeyDto>("PATCH", `/v1/admin/service-keys/${id}`, body, auth(token));
}

export function deleteServiceKey(token: string, id: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>("DELETE", `/v1/admin/service-keys/${id}`, undefined, auth(token));
}

export interface SeedFromEnvResultDto {
    ok: boolean;
    seeded: string[];
    skipped: string[];
}

export function seedServiceKeysFromEnv(token: string): Promise<SeedFromEnvResultDto> {
    return call<SeedFromEnvResultDto>("POST", "/v1/admin/service-keys/seed-from-env", undefined, auth(token));
}
