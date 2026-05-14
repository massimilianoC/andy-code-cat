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
}

export interface VibeClassifyResponse {
    templateId: string | null;
    formatHint: FormatHint | null;
    confidence: number;
    reasoning: string;
    skipped: boolean;
}
