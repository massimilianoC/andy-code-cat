/**
 * Cost transaction contracts — shared DTOs for API responses consumed by the frontend.
 * All monetary values are in EUR unless noted.
 */

export interface CostUnitsDto {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    imageCount?: number;
    videoSeconds?: number;
    computeMs?: number;
    storageBytes?: number;
}

export interface CostSourceRefDto {
    conversationId?: string;
    messageId?: string;
    backgroundTaskId?: string;
    promptExecutionLogId?: string;
    assetId?: string;
    backgroundJobId?: string;
    exportId?: string;
    sessionId?: string;
}

export interface CostTransactionDto {
    id: string;
    txId: string;
    userId: string;
    projectId: string;
    resourceType: string;
    resourceSubtype?: string;
    providerCostUsd: number;
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    totalEur: number;
    units: CostUnitsDto;
    sourceRef: CostSourceRefDto;
    meta: Record<string, unknown>;
    status: "settled" | "voided";
    createdAt: string;
}

export interface CostSummaryDto {
    totalEur: number;
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    txCount: number;
}

export interface CostTypeBreakdownDto {
    resourceType: string;
    totalEur: number;
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    txCount: number;
}

export interface CostTrendPointDto {
    date: string;
    totalEur: number;
    txCount: number;
}

export interface ProjectCostSummaryDto {
    summary: CostSummaryDto;
    breakdown: CostTypeBreakdownDto[];
    trend: CostTrendPointDto[];
}

export interface UserCostSummaryDto {
    summary: CostSummaryDto;
    breakdown: CostTypeBreakdownDto[];
    trend: CostTrendPointDto[];
    topProjects: Array<{ projectId: string; totalEur: number }>;
}

export interface AdminCostDashboardDto {
    summary: CostSummaryDto;
    breakdown: CostTypeBreakdownDto[];
    trend: CostTrendPointDto[];
    topProjects: Array<{ projectId: string; totalEur: number }>;
    currentRates: CostRatesDto | null;
}

/**
 * Per-resource-type cost policy override.
 * Unset fields fall back to the global PlatformCostRates defaults.
 */
export interface ResourceTypeCostPolicyDto {
    /** Percentage markup override for this type (e.g. 0.15 = 15%). Unset = use global. */
    markupPct?: number;
    /** Infra cost share override (e.g. 0.05 = 5%). Unset = use global. */
    infraPct?: number;
    /** Fixed fee in EUR added per transaction, regardless of usage volume. */
    fixedFeeEur?: number;
    /** For LLM types: base token rate (EUR per 1 000 tokens). Unset = use global textEurPer1kTokens. */
    tokenRateEurPer1k?: number;
    /** For image / video types: base rate per generated asset (EUR). Unset = use global imageEurPerAsset / videoEurPerAsset. */
    assetRateEur?: number;
    /** When true AND the provider reports actual cost (e.g. OpenRouter), that is used as the base instead of flat-rate. */
    useProviderCost?: boolean;
    /** Informational note shown in the admin UI — not used in cost computation. */
    note?: string;
}

export interface CostRatesDto {
    usdToEurRate: number;
    platformMarkupPct: number;
    infraCostPct: number;
    textEurPer1kTokens: number;
    imageEurPerAsset: number;
    videoEurPerAsset: number;
    computeEurPerMs: number;
    storageEurPerGbMonth: number;
    /** Per-resource-type policy overrides. Keys are ResourceType string values (e.g. "llm.chat"). */
    perType?: Record<string, ResourceTypeCostPolicyDto>;
    updatedAt: string;
    updatedByUserId?: string;
}

export interface PagedCostTransactionsDto {
    items: CostTransactionDto[];
    total: number;
    page: number;
    limit: number;
}
