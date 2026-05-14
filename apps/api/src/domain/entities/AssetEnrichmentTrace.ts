export type EnrichmentAssetKind =
    | "pdf"
    | "docx"
    | "txt"
    | "md"
    | "image_raster"
    | "image_svg"
    | "unknown";

export type EnrichmentStatus = "pending" | "ready" | "failed" | "skipped";

// ── Provenance ─────────────────────────────────────────────────────────────

export interface EnrichmentProvenance {
    traceVersion: number;
    enrichmentStatus: EnrichmentStatus;
    enrichedAt: Date | null;
    processingMs: number | null;
    parserName: string;
    parserVersion: string;
    llmProvider: string | null;
    llmModel: string | null;
    llmTokensUsed: number | null;
    llmCostEur: number | null;
    errorMessage: string | null;
}

// ── Document track ────────────────────────────────────────────────────────

export interface DocumentTextLayer {
    wordCount: number;
    charCount: number;
    languageHint: string;
    pageCount: number | null;
    sectionCount: number | null;
    extractedTextSnippet: string;
    fullTextStored: boolean;
}

export type DocumentTypeHint =
    | "brochure"
    | "landing_copy"
    | "product_sheet"
    | "menu"
    | "faq"
    | "press_release"
    | "case_study"
    | "specification"
    | "cv_resume"
    | "report"
    | "generic_document"
    | "unknown";

export interface DocumentBrief {
    documentType: DocumentTypeHint;
    detectedTitle: string | null;
    detectedBrandName: string | null;
    purposeSentence: string;
    keyMessages: string[];
    toneLabel: string;
    targetAudience: string | null;
    ctaText: string | null;
    primaryTopics: string[];
    contentLanguage: string;
    suggestedStyleRole: string;
}

// ── Image track ───────────────────────────────────────────────────────────

export interface ImageColorPalette {
    dominantHex: string[];
    dominantNames: string[];
    backgroundTone: "light" | "dark" | "mixed" | "unknown";
    accentColor: string | null;
    paletteLabel: string;
}

export interface ImageVisualAnalysis {
    sceneDescription: string;
    detectedObjects: string[];
    detectedThemes: string[];
    moodLabel: string;
    moodScore: number | null;
    visualComplexity: "minimal" | "moderate" | "complex" | "unknown";
    compositionType: string | null;
}

export type ImageCategory =
    | "photograph"
    | "illustration"
    | "logo"
    | "icon"
    | "screenshot"
    | "diagram"
    | "infographic"
    | "texture_pattern"
    | "typographic"
    | "abstract"
    | "unknown";

export interface ImageDesignSignals {
    imageCategory: ImageCategory;
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

// ── Top-level trace ───────────────────────────────────────────────────────

export interface AssetEnrichmentTrace {
    assetId: string;
    projectId: string;
    userId: string;
    assetKind: EnrichmentAssetKind;

    provenance: EnrichmentProvenance;

    textLayer: DocumentTextLayer | null;
    documentBrief: DocumentBrief | null;

    colorPalette: ImageColorPalette | null;
    visualAnalysis: ImageVisualAnalysis | null;
    designSignals: ImageDesignSignals | null;

    distilledTitle: string;
    distilledSummary: string;
    distilledTags: string[];
    distilledColors: string[];
}

export const CURRENT_TRACE_VERSION = 1;
