// ── VibeCore pipeline contracts ──────────────────────────────────────────────

export type FormatHint =
    | "one_pager"
    | "a3_document"
    | "ratio_1_1"
    | "ratio_16_9"
    | "interactive_form"
    | "portfolio"
    | "brochure";

export interface AttachmentMeta {
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

export interface VibeClassifyRequest {
    prompt: string;
    attachmentMeta?: AttachmentMeta[];
    /**
     * Optional. When omitted the API auto-creates a draft project so the LLM
     * cost is always attributable to a (user, project) pair (double-sandbox).
     * The resulting projectId is returned in the response.
     */
    projectId?: string;
}

export interface VibeClassifyResponse {
    templateId: string | null;
    formatHint: FormatHint | null;
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
    attachmentMeta?: AttachmentMeta[];
    templateId?: string | null;
    formatHint?: FormatHint | null;
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
}

export interface VibePrefillResponse {
    draft: ZeroEffortDraft;
    confidence: number;
    skipped: boolean;
    /**
     * The project this prefill was billed against. Either echoes the
     * incoming projectId or returns the freshly-created draft project id.
     * Optional only for backward compatibility with pre-cost-attribution clients.
     */
    projectId?: string;
}

