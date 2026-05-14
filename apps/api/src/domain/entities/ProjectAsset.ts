import type { AssetEnrichmentTrace } from "./AssetEnrichmentTrace";

/**
 * Who created this asset:
 * - 'user_upload'       → user-uploaded via multipart/form-data HTTP route
 * - 'platform_generated' → created internally by the platform (Layer 1 export,
 *                          brief generation, etc.) — not limited by user quota
 */
export type AssetSource = "user_upload" | "url_reference" | "platform_generated";
export type AssetScope = "project" | "user" | "global";
export type AssetStyleRole = "inspiration" | "material" | "logo" | "background" | "icon" | "watermark" | "reference";
export type AssetGenerationStatus = "queued" | "ready" | "failed";

export interface AssetTokenUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export interface AssetCostEstimate {
    currency: "EUR";
    amount: number;
    source: "provider" | "flat-rate";
    providerCostUsd?: number;
}

export interface AssetGenerationMetadata {
    provider: string;
    model?: string;
    imageSize?: string;
    numInferenceSteps?: number;
    requestedAt: Date;
    completedAt?: Date;
    latencyMs?: number;
    revisedPrompt?: string;
    finishReason?: string;
    providerRequestId?: string;
    sourceUrl?: string;
    outputMimeType?: string;
    width?: number;
    height?: number;
    tokenUsage?: AssetTokenUsage;
    cost?: AssetCostEstimate;
    errorMessage?: string;
    providerResponse?: Record<string, unknown>;
}

export interface AssetSemanticMetadata {
    title: string;
    summary: string;
    description: string;
    tags: string[];
    colors: string[];
    mediaKind: "image" | "background" | "logo" | "icon" | "document" | "reference";
    classifierProvider: string;
    classifierModel: string;
    classifiedAt: Date;
}

export interface AssetGenerationModelSummary {
    provider: string;
    model: string;
    runs: number;
    totalCost: number;
}

export interface AssetGenerationUsageSummary {
    totalCost: number;
    totalImages: number;
    ready: number;
    queued: number;
    failed: number;
    topModels?: AssetGenerationModelSummary[];
}

export interface ProjectAsset {
    id: string;
    projectId: string;
    userId: string;
    /** Scope foundation for future media gallery levels: project, user, or superadmin-global. */
    scope: AssetScope;
    /** Original filename as provided by the user or platform (for display only). */
    originalName: string;
    /** Filename as stored on disk: `{assetId}-{safeFilename}`. Never derived from untrusted input. */
    storedFilename: string;
    mimeType: string;
    fileSize: number;
    /** Who produced this asset. Defaults to 'user_upload' for backwards compatibility. */
    source: AssetSource;
    /** Optional human-readable label (e.g. "Layer 1 HTML export", "Project brief"). */
    label?: string;
    /** Whether this asset is actively used in style context injection. */
    useInProject?: boolean;
    /** How the asset is intended to be used (inspiration board vs working material). */
    styleRole?: AssetStyleRole;
    /** Free-text description of what this asset represents. */
    descriptionText?: string;
    /** External URL for link-only references (no file on disk). */
    externalUrl?: string;
    /** Deferred generation status for placeholder → final asset flows. */
    generationStatus?: AssetGenerationStatus;
    /** Original prompt for platform-generated media, when available. */
    generationPrompt?: string;
    /** Full generation ledger for provider/image runs. */
    generationMetadata?: AssetGenerationMetadata;
    /** Optional semantic classifier output used for later prompt enrichment. */
    semanticMetadata?: AssetSemanticMetadata;
    /** Full enrichment trace produced by the Document Context Layer pipeline. Null until async enrichment has run. */
    enrichmentTrace?: AssetEnrichmentTrace | null;
    createdAt: Date;
}
