/**
 * CostTransaction — immutable ledger record for every billable event.
 *
 * Each event (LLM call, image generation, compute task, platform fee…) creates
 * exactly one CostTransaction.  The collection is append-only: corrections are
 * expressed as new offsetting entries, never as in-place edits.
 *
 * Cost decomposition (all EUR unless noted):
 *   providerCostEur   = providerCostUsd × usdToEurRate
 *   infraCostEur      = providerCostEur × infraCostPct          (platform infra share)
 *   platformMarkupEur = (providerCostEur + infraCostEur) × markupPct
 *   totalEur          = providerCostEur + infraCostEur + platformMarkupEur
 */

export const ResourceType = {
    // LLM
    LLM_CHAT: "llm.chat",
    LLM_PREPROMPT: "llm.preprompt",
    LLM_PROMPT_OPT: "llm.prompt_opt",
    LLM_TEMPLATE_DRAFT: "llm.template_draft",
    LLM_EMBEDDING: "llm.embedding",
    LLM_BACKGROUND: "llm.background",
    // Image / Video
    IMAGE_GEN: "image.gen",
    IMAGE_PROMPT_OPT: "image.prompt_opt",
    IMAGE_SUGGEST: "image.suggest",
    VIDEO_GEN: "video.gen",
    // Compute / Internal
    COMPUTE_TASK: "compute.task",
    COMPUTE_GPU: "compute.gpu",
    COMPUTE_LAMBDA: "compute.lambda",
    COMPUTE_STORAGE: "compute.storage",
    // Platform fees
    PLATFORM_EXPORT: "platform.export",
    PLATFORM_DOMAIN: "platform.domain",
    PLATFORM_EVENT: "platform.event",
    PLATFORM_FIXED: "platform.fixed",
} as const;

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

export interface CostUnits {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    imageCount?: number;
    videoSeconds?: number;
    computeMs?: number;
    storageBytes?: number;
}

/**
 * One of these fields is populated — identifies the originating object.
 * Kept as plain strings (not ObjectId) so the entity has no infra dependency.
 */
export interface CostSourceRef {
    conversationId?: string;
    messageId?: string;
    backgroundTaskId?: string;
    promptExecutionLogId?: string;
    assetId?: string;
    enrichmentTraceId?: string;
    backgroundJobId?: string;
    exportId?: string;
    sessionId?: string;
}

export interface CostRatesSnapshot {
    usdToEurRate: number;
    platformMarkupPct: number;
    infraCostPct: number;
    /** Fixed fee in EUR applied for this specific transaction (0 when none). */
    fixedFeeEur?: number;
    textEurPer1kTokens: number;
    imageEurPerAsset: number;
    videoEurPerAsset: number;
}

export interface CostTransaction {
    id: string;
    txId: string;                    // human-readable "TX-YYYYMMDD-XXXXXXXX"

    userId: string;
    projectId: string;

    resourceType: ResourceType;
    resourceSubtype?: string;        // e.g. model id, image size, task key

    /** Raw USD charged by third-party provider (0 if local/internal). */
    providerCostUsd: number;
    /** providerCostUsd converted to EUR. */
    providerCostEur: number;
    /** Infrastructure share (compute, bandwidth). */
    infraCostEur: number;
    /** Platform markup on top of provider + infra. */
    platformMarkupEur: number;
    /** Total charge = providerCostEur + infraCostEur + platformMarkupEur. */
    totalEur: number;

    /** Immutable snapshot of rates at creation time — for audit. */
    ratesSnapshot: CostRatesSnapshot;

    units: CostUnits;
    sourceRef: CostSourceRef;
    meta: Record<string, unknown>;

    status: "settled" | "voided";
    voidedByTxId?: string;

    createdAt: Date;
}
