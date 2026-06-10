import { z } from "zod";
import type { DatasetFactsEnvelopeDto, DatasetTableProfileDto } from "./datasets";

const optionalTrimmedString = (max: number) =>
    z.preprocess(
        (value) => {
            if (typeof value === "string") {
                return value.trim().slice(0, max);
            }
            return value == null ? undefined : value;
        },
        z.string().max(max).optional(),
    );

const requiredTrimmedString = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" ? value.trim().slice(0, max) : value),
        z.string().min(1).max(max),
    );

export const uploadProjectAssetSchema = z.object({
    // file is handled by multer, this schema validates any extra body fields if needed
});

export const exportLayer1Schema = z.object({
    snapshotId: z.string().uuid().optional(),
    conversationId: z.string().min(1).optional(),
});

export type ExportLayer1Input = z.infer<typeof exportLayer1Schema>;

export const prepareWorkspaceSchema = z.object({
    jobId: z.string().uuid(),
    conversationId: z.string().min(1).optional(),
    snapshotId: z.string().uuid().optional(),
});

export type PrepareWorkspaceInput = z.infer<typeof prepareWorkspaceSchema>;

// ---- Asset DTOs ----

export type AssetSourceDto = "user_upload" | "url_reference" | "platform_generated";
export type AssetScopeDto = "project" | "user" | "global";
export type AssetStyleRole = "inspiration" | "material" | "logo" | "background" | "icon" | "watermark" | "reference";
export type AssetGenerationStatusDto = "queued" | "ready" | "failed";

export const userFacingAssetScopeSchema = z.enum(["project", "user"]);

export interface AssetSemanticMetadataDto {
    title: string;
    summary: string;
    description: string;
    tags: string[];
    colors: string[];
    mediaKind: "image" | "background" | "logo" | "icon" | "document" | "reference";
    classifierProvider: string;
    classifierModel: string;
    classifiedAt: string;
}

export interface AssetGenerationMetadataDto {
    provider: string;
    model?: string;
    imageSize?: string;
    numInferenceSteps?: number;
    requestedAt: string;
    completedAt?: string;
    latencyMs?: number;
    revisedPrompt?: string;
    finishReason?: string;
    providerRequestId?: string;
    sourceUrl?: string;
    outputMimeType?: string;
    width?: number;
    height?: number;
    conversationId?: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    mediaKey?: string;
    semanticQuery?: string;
    resolutionRoute?: string;
    fallbackUsed?: boolean;
    tokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    cost?: {
        currency: "EUR";
        amount: number;
        source: "provider" | "flat-rate";
        providerCostUsd?: number;
    };
    errorMessage?: string;
    providerResponse?: Record<string, unknown>;
}

export type EnrichmentStatusDto = "pending" | "ready" | "failed" | "skipped";

export interface DocumentBriefDto {
    documentType: string;
    detectedTitle: string | null;
    detectedBrandName: string | null;
    purposeSentence: string;
    contentSummary: string;
    mainArgumentOrValue: string | null;
    structureSummary: string | null;
    keyMessages: string[];
    toneLabel: string;
    targetAudience: string | null;
    ctaText: string | null;
    primaryTopics: string[];
    contentLanguage: string;
    suggestedStyleRole: string;
}

export interface ImageDesignSignalsDto {
    imageCategory: string;
    hasText: boolean;
    detectedTextSnippet: string | null;
    hasLogo: boolean;
    hasPeople: boolean;
    hasProduct: boolean;
    layoutStyle: string | null;
    aspectRatioLabel: string | null;
    suggestedWebUse: string[];
    suggestedStyleRole: string;
}

export interface AssetEnrichmentTraceDto {
    provenance: {
        enrichmentStatus: EnrichmentStatusDto;
        enrichedAt?: string | null;
        errorMessage?: string | null;
    };
    distilledTitle?: string;
    distilledSummary?: string;
    distilledTags?: string[];
    distilledColors?: string[];
    documentBrief?: DocumentBriefDto | null;
    designSignals?: ImageDesignSignalsDto | null;
    dataset?: {
        sourceFormat: "csv" | "xlsx" | "json" | "xml" | "sql";
        tables: DatasetTableProfileDto[];
        facts: DatasetFactsEnvelopeDto;
        limitations?: string[];
        llmAppendix?: {
            analyticalSummary: string;
            keySignals: string[];
            suggestedQuestions: string[];
            cautions: string[];
        };
    } | null;
}

export interface ProjectAssetDto {
    id: string;
    projectId: string;
    scope: AssetScopeDto;
    originalName: string;
    mimeType: string;
    fileSize: number;
    source: AssetSourceDto;
    label?: string;
    /** Whether this asset is actively used in style context injection. */
    useInProject?: boolean;
    /** How the asset is intended to be used. */
    styleRole?: AssetStyleRole;
    /** Optional free-text description for the asset. */
    descriptionText?: string;
    /** External URL (for URL-reference assets, no file on disk). */
    externalUrl?: string;
    generationStatus?: AssetGenerationStatusDto;
    generationPrompt?: string;
    generationMetadata?: AssetGenerationMetadataDto;
    semanticMetadata?: AssetSemanticMetadataDto;
    enrichmentTrace?: AssetEnrichmentTraceDto | null;
    createdAt: string;
}

export const assetStyleRoleSchema = z.enum(["inspiration", "material", "logo", "background", "icon", "watermark", "reference"]);

export const updateProjectAssetSchema = z.object({
    label: z.string().max(100).optional(),
    useInProject: z.boolean().optional(),
    styleRole: assetStyleRoleSchema.optional(),
    descriptionText: z.string().max(500).optional(),
});

export type UpdateProjectAssetInput = z.infer<typeof updateProjectAssetSchema>;

export const addUrlReferenceSchema = z.object({
    url: z.string().url().max(2000),
    label: z.string().max(100).optional(),
    scope: userFacingAssetScopeSchema.optional(),
    styleRole: assetStyleRoleSchema.optional(),
    descriptionText: z.string().max(500).optional(),
});

export const suggestProjectImageIdeaSchema = z.object({
    prompt: optionalTrimmedString(2000),
    targetMode: z.enum(["foreground", "background"]).default("foreground"),
    selectedElement: z.object({
        stableNodeId: requiredTrimmedString(120),
        selector: requiredTrimmedString(300),
        tag: requiredTrimmedString(64),
        textSnippet: optionalTrimmedString(500),
        currentSrc: optionalTrimmedString(1500),
        currentAlt: optionalTrimmedString(300),
        backgroundImageUrl: optionalTrimmedString(1500),
        mediaMode: z.enum(["foreground", "background", "none"]).optional(),
        originalWidth: z.number().positive().max(10000).optional(),
        originalHeight: z.number().positive().max(10000).optional(),
        aspectRatio: z.number().positive().max(100).optional(),
    }).optional(),
});

export type SuggestProjectImageIdeaInput = z.infer<typeof suggestProjectImageIdeaSchema>;

export interface SuggestProjectImageIdeaResultDto {
    suggestion: string;
    suggestedPrompt: string;
    provider: string;
    model: string;
    durationMs: number;
    skipped: boolean;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    costEstimate?: {
        currency: "EUR";
        amount: number;
        source: "provider" | "flat-rate";
        providerCostUsd?: number;
    };
}

export const generateProjectImageSchema = z.object({
    prompt: requiredTrimmedString(2000),
    fileNameHint: z.string().max(120).optional(),
    scope: userFacingAssetScopeSchema.optional(),
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(160).optional(),
    imageSize: z.string().regex(/^\d+x\d+$/).optional(),
    numInferenceSteps: z.number().int().min(1).max(50).optional(),
    targetMode: z.enum(["foreground", "background"]).default("foreground"),
    selectedElement: z.object({
        stableNodeId: requiredTrimmedString(120),
        selector: requiredTrimmedString(300),
        tag: requiredTrimmedString(64),
        textSnippet: optionalTrimmedString(500),
        currentSrc: optionalTrimmedString(1500),
        currentAlt: optionalTrimmedString(300),
        backgroundImageUrl: optionalTrimmedString(1500),
        mediaMode: z.enum(["foreground", "background", "none"]).optional(),
        originalWidth: z.number().positive().max(10000).optional(),
        originalHeight: z.number().positive().max(10000).optional(),
        aspectRatio: z.number().positive().max(100).optional(),
    }).optional(),
    mediaConfig: z.object({
        fit: z.enum(["cover", "contain", "auto"]).optional(),
        repeat: z.enum(["no-repeat", "repeat", "repeat-x", "repeat-y"]).optional(),
        opacity: z.number().min(0).max(1).optional(),
        filter: z.string().max(120).optional(),
    }).optional(),
});

export type GenerateProjectImageInput = z.infer<typeof generateProjectImageSchema>;

export const regenerateStockProjectImageSchema = z.object({
    query: requiredTrimmedString(300),
    width: z.number().int().positive().max(10000).optional(),
    height: z.number().int().positive().max(10000).optional(),
    offset: z.number().int().min(0).max(100).optional(),
    targetSelector: optionalTrimmedString(300),
    targetMode: z.enum(["foreground", "background"]).default("foreground"),
    scope: userFacingAssetScopeSchema.optional(),
});

export type RegenerateStockProjectImageInput = z.infer<typeof regenerateStockProjectImageSchema>;

export const regenerateMediaByKeySchema = z.object({
    snapshotId: optionalTrimmedString(120),
    offset: z.number().int().min(0).max(100).optional(),
    width: z.number().int().positive().max(10000).optional(),
    height: z.number().int().positive().max(10000).optional(),
    targetSelector: optionalTrimmedString(300),
    targetMode: z.enum(["foreground", "background"]).optional(),
    scope: userFacingAssetScopeSchema.optional(),
});

export type RegenerateMediaByKeyInput = z.infer<typeof regenerateMediaByKeySchema>;

export interface RegenerateStockProjectImageResultDto {
    asset: ProjectAssetDto;
    assetUrl: string;
    provider: string;
    fallbackUsed: boolean;
    attribution: string;
    attemptedProviders: Array<{
        provider: string;
        status: "success" | "failed" | "skipped";
        reason?: string;
    }>;
}

export interface RegenerateMediaByKeyResultDto extends RegenerateStockProjectImageResultDto {
    mediaKey: string;
    traceId?: string;
}

export interface StockImageProviderStatusDto {
    activeProvider: string;
    fallbackMode: "notify";
    fallbackProviders: string[];
    persistenceEnabled: boolean;
    configuredProviders: {
        pexels: boolean;
        pixabay: boolean;
        unsplash: boolean;
        loremflickr: boolean;
        picsum: boolean;
    };
}

export interface GenerateProjectImageResultDto {
    taskId: string;
    status: "queued";
    mode: "placeholder" | "live";
    asset: ProjectAssetDto;
    storagePath: string;
    downloadUrl: string;
    cssDefaults: {
        fit: "cover" | "contain" | "auto";
        repeat: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
        position: "center center";
        opacity: number;
        filter: string;
    };
}

export type AddUrlReferenceInput = z.infer<typeof addUrlReferenceSchema>;

export interface AssetPlaceholderDto {
    path: string;
    usedIn: string;
    recommendedSize?: string;
}

export interface ExportRecordDto {
    id: string;
    projectId: string;
    sourceType: "layer1_snapshot";
    snapshotId?: string;
    status: "pending" | "ready" | "failed";
    fileSize?: number;
    fileSha256?: string;
    filesIncluded: string[];
    assetPlaceholders: AssetPlaceholderDto[];
    downloadCount: number;
    expiresAt: string;
    errorMessage?: string;
    createdAt: string;
    readyAt?: string;
}

export interface ExportLayer1ResponseDto extends ExportRecordDto {
    downloadToken: string;
    downloadUrl: string;
}

// ---- Workspace DTOs ----

export type WorkspaceFileSourceDto =
    | "user_asset"
    | "platform_asset"
    | "layer1_artifact"
    | "generated";

export interface WorkspaceFileDto {
    relativePath: string;
    source: WorkspaceFileSourceDto;
    mimeType?: string;
    assetId?: string;
}

export interface GenerationWorkspaceDto {
    jobId: string;
    projectId: string;
    /** Absolute path on the server — exposed for internal / admin use. */
    rootPath: string;
    outputPath: string;
    files: WorkspaceFileDto[];
    layer1Included: boolean;
    snapshotId?: string;
    createdAt: string;
}

