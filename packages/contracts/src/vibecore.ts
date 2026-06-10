// ── VibeCore pipeline contracts ──────────────────────────────────────────────

export type FormatHint =
    | "one_pager"
    | "a3_document"
    | "ratio_1_1"
    | "ratio_16_9"
    | "interactive_form"
    | "portfolio"
    | "brochure"
    | "analytics_dashboard";

export type VibeGenerationMode = "auto" | "website" | "data_dashboard";
export type VibeResolvedMode = Exclude<VibeGenerationMode, "auto">;

export interface DataDashboardDraft {
    dashboardName: string;
    dashboardGoal: string;
    primaryAudience: string;
    primaryDatasets: string[];
    mainEntities: string[];
    timeDimension?: string;
    kpiCandidates: string[];
    questionCandidates: string[];
    preferredVisualizationStyle?: "executive" | "operations" | "exploratory" | "monitoring";
    notes?: string;
}

export interface AttachmentMeta {
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

export interface VibeClassifyRequest {
    prompt: string;
    attachmentMeta?: AttachmentMeta[];
    generationMode?: VibeGenerationMode;
    /** Optional one-shot provider override for this pipeline run. */
    provider?: string;
    /** Optional one-shot model override for this pipeline run. */
    model?: string;
    /**
     * Optional. When omitted the API auto-creates a draft project so the LLM
     * cost is always attributable to a (user, project) pair (double-sandbox).
     * The resulting projectId is returned in the response.
     */
    projectId?: string;
    /** BCP-47 UI language from the client (e.g. "it", "en"). Used as output language hint. */
    uiLanguage?: string;
}

export interface VibeClassifyResponse {
    templateId: string | null;
    formatHint: FormatHint | null;
    resolvedMode?: VibeResolvedMode;
    confidence: number;
    reasoning: string;
    skipped: boolean;
    /**
     * The project this classification was billed against. Either echoes the
     * incoming projectId or returns the freshly-created draft project id.
     * Optional only for backward compatibility with pre-cost-attribution clients.
     */
    projectId?: string;
}

// ── Zero-Effort LLM Prefill ───────────────────────────────────────────────────
// See docs/specs/ZERO_EFFORT_PREFILL_SPEC.md

export interface VibePrefillRequest {
    prompt: string;
    /** If provided, backend loads project assets and injects Layer D document context into the prefill prompt. */
    projectId?: string;
    generationMode?: VibeGenerationMode;
    /** Optional one-shot provider override for this pipeline run. */
    provider?: string;
    /** Optional one-shot model override for this pipeline run. */
    model?: string;
    attachmentMeta?: AttachmentMeta[];
    templateId?: string | null;
    formatHint?: FormatHint | null;
    /** BCP-47 UI language from the client (e.g. "it", "en"). Used as output language hint. */
    uiLanguage?: string;
}

/**
 * Shape mirrors ZeroEffortLaunchInput (packages/contracts/src/pipeline.ts)
 * but is inlined here so the vibecore module stays self-contained.
 */
export interface ZeroEffortDraft {
    businessName: string;
    siteType: "landing_page" | "portfolio" | "showcase" | "business_site";
    primaryGoal: string;
    audience: string;
    tone?: string;
    primaryCta?: string;
    styleHint?: string;
    contactInfo?: Array<{ key: string; value: string }>;
    styleAttributes?: string[];
    /** Filenames of project documents that were analysed to generate this draft (informational only). */
    attachedDocuments?: string[];
    /** BCP-47 output language inferred by the prefill engine (e.g. "it", "en"). */
    outputLanguage?: string;
}

export interface VibePrefillResponse {
    draft: ZeroEffortDraft;
    dataDashboardDraft?: DataDashboardDraft;
    resolvedMode?: VibeResolvedMode;
    confidence: number;
    skipped: boolean;
    /**
     * The project this prefill was billed against. Either echoes the
     * incoming projectId or returns the freshly-created draft project id.
     * Optional only for backward compatibility with pre-cost-attribution clients.
     */
    projectId?: string;
}

export interface VibeConfigResponse {
    attachmentPolicy: {
        maxAttachmentsPerPrompt: number;
        maxFileSizeBytes: number;
        maxTotalBytes: number;
        warningThresholdBytes: number;
    };
    documentContextPolicy: {
        maxAssetsPerPrompt: number;
        fallbackInlineExtractionMaxAssets: number;
    };
}

