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
    /**
     * Human-readable notices for the user, merged by the route with its own attachment
     * warnings. Populated when the classification could not run as asked — a model the caller
     * selected that the operator has not activated, for instance — so a skipped classification
     * is visible rather than silently answered by a different model.
     */
    warnings?: string[];
}

// ── Guided Mode LLM Prefill ────────────────────────────────────────────────────
// See docs/specs/GUIDED_MODE_PREFILL_SPEC.md

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
 * Shape mirrors GuidedLaunchInput (packages/contracts/src/pipeline.ts)
 * but is inlined here so the vibecore module stays self-contained.
 */
export interface GuidedDraft {
    businessName: string;
    /** PRESET_CATALOG id (e.g. "slideshow", "landing", "website", "videogame"). */
    presetId: string;
    primaryGoal: string;
    audience: string;
    tone?: string;
    primaryCta?: string;
    styleHint?: string;
    /** Verbatim user request; inferred fields may enrich but never contradict it. */
    sourceRequest?: string;
    projectSummary?: string;
    contentStructure?: string;
    contentRequirements?: string;
    functionalRequirements?: string;
    interactionModel?: string;
    visualDirection?: string;
    successCriteria?: string;
    constraints?: string;
    mustAvoid?: string;
    contactInfo?: Array<{ key: string; value: string }>;
    styleAttributes?: string[];
    /** Filenames of project documents that were analysed to generate this draft (informational only). */
    attachedDocuments?: string[];
    /** BCP-47 output language inferred by the prefill engine (e.g. "it", "en"). */
    outputLanguage?: string;
}

export interface VibePrefillResponse {
    draft: GuidedDraft;
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
    /**
     * Human-readable notices for the user. Populated when `skipped` is true so a failed
     * automatic prefill is visible instead of presenting an empty wizard with no explanation.
     * The route merges these with its own attachment warnings.
     */
    warnings?: string[];
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


// ── Draft → intake (the brief a prefill draft launches) ──────────────────────

/** Pre-preset drafts named the site type instead of a preset. */
const LEGACY_SITE_TYPE_PRESET: Record<string, string> = {
    landing_page: "landing",
    business_site: "website",
    portfolio: "neutral",
    showcase: "neutral",
};

function draftText(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/**
 * The launch intake a prefill draft stands for, before the user changes anything.
 *
 * One mapping for the two places a draft becomes a brief: the launch page fills its form with it
 * (the user may then edit), and a background run launches it as-is (BACKGROUND_RUNS.md §6.1:
 * the brief is auto-approved). Two copies of this mapping would be two brief builders.
 *
 * The result is unvalidated: the caller parses it with `launchWorkspacePipelineSchema`, which
 * refuses a draft too thin to launch (no goal, no audience) instead of inventing the missing parts.
 */
export function guidedIntakeFromDraft(
    draft: Partial<GuidedDraft> & { siteType?: unknown },
    context: {
        /** Used when the draft has no business name (the project's own name). */
        projectName?: string;
        /** Used when the draft did not infer an output language (the UI language). */
        defaultOutputLanguage: string;
        /** Names of the documents the brief was drafted from, when the draft does not list them. */
        attachmentNames?: string[];
    },
): Record<string, unknown> & {
    businessName: string;
    presetId: string;
    primaryGoal: string;
    audience: string;
    outputLanguage: string;
    contactInfo: Array<{ key: string; value: string }>;
    styleAttributes: string[];
    attachmentNames: string[];
} {
    const presetId = draftText(draft.presetId)?.trim()
        || LEGACY_SITE_TYPE_PRESET[String(draft.siteType ?? "")]
        || "landing";
    const primaryGoal = draftText(draft.primaryGoal) ?? "";
    const outputLanguage = draftText(draft.outputLanguage)?.trim() || context.defaultOutputLanguage;
    const attachmentNames = Array.isArray(draft.attachedDocuments) && draft.attachedDocuments.length > 0
        ? draft.attachedDocuments.filter((name): name is string => typeof name === "string")
        : context.attachmentNames ?? [];
    return {
        businessName: draftText(draft.businessName)?.trim() || context.projectName || "",
        presetId,
        primaryGoal,
        audience: draftText(draft.audience) ?? "",
        tone: draftText(draft.tone),
        primaryCta: draftText(draft.primaryCta),
        styleHint: draftText(draft.styleHint),
        sourceRequest: draftText(draft.sourceRequest) || primaryGoal,
        projectSummary: draftText(draft.projectSummary),
        contentStructure: draftText(draft.contentStructure),
        contentRequirements: draftText(draft.contentRequirements),
        functionalRequirements: draftText(draft.functionalRequirements),
        interactionModel: draftText(draft.interactionModel),
        visualDirection: draftText(draft.visualDirection),
        successCriteria: draftText(draft.successCriteria),
        constraints: draftText(draft.constraints),
        mustAvoid: draftText(draft.mustAvoid),
        contactInfo: Array.isArray(draft.contactInfo)
            ? draft.contactInfo.filter((item) => item && typeof item.key === "string" && typeof item.value === "string"
                && item.key.trim().length > 0 && item.value.trim().length > 0)
            : [],
        styleAttributes: Array.isArray(draft.styleAttributes)
            ? draft.styleAttributes.filter((attr): attr is string => typeof attr === "string")
            : [],
        outputLanguage,
        attachmentNames,
    };
}
