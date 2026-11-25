/**
 * Layer T resolution persisted on the project when Layer Φ (VibeClassify) resolves a
 * formatHint but no presetId (presetId already covers Layer B and is stored separately —
 * this field only carries the residual formatHint signal). Reused verbatim as
 * systemPromptLayers.TemplateResolution when composing subsequent turns, so Layer T stays
 * live across the whole conversation instead of only the first Vibe classify call.
 */
export interface ProjectTemplateResolution {
    formatHint?: string | null;
    confidence: number;
    reasoning: string;
    source: "layer_phi" | "user_explicit" | "guided_form";
}

/**
 * The project-owned BaaS configuration is deliberately separate from the LLM
 * manifest. Future service adapters may extend this object without changing
 * the immutable artifact contract.
 */
export interface ProjectFormPrivacyNotice {
    version: string;
    url: string;
    controllerName: string;
    contactEmail: string;
}

/** `mailto`: local hand-off to the visitor's email client; nothing is stored. */
export interface ProjectMailtoFormSettings {
    enabled: boolean;
    mode: "mailto";
    recipientEmail: string;
    privacyNotice: ProjectFormPrivacyNotice;
}

/** `capture`: validated server-side and stored in `form_submissions` (FORMS_CAPTURE.md). */
export interface ProjectCaptureFormSettings {
    enabled: boolean;
    mode: "capture";
    /** Kept from an earlier mailto configuration, never used by capture. */
    recipientEmail?: string;
    privacyNotice: ProjectFormPrivacyNotice;
}

export type ProjectFormSettings = ProjectMailtoFormSettings | ProjectCaptureFormSettings;

export interface ProjectServiceConfig {
    forms?: ProjectFormSettings;
}

export interface Project {
    id: string;
    ownerUserId: string;
    name: string;
    /** Optional preset ID from the PRESET_CATALOG. Undefined for fast-created projects. */
    presetId?: string;
    /** Layer T resolution when no preset matched — see ProjectTemplateResolution. */
    templateResolution?: ProjectTemplateResolution;
    /**
     * Resolved BCP-47 output language (e.g. "it", "en") persisted at Guided Mode launch /
     * Vibe intake. This is the explicit, highest-priority source for Layer L (OUTPUT LANGUAGE)
     * at generation time; when absent, the composer falls back to the client UI language sent
     * with the request, and finally to English. See OUTPUT_LANGUAGE_CONTROL_SPEC.md.
     */
    outputLanguage?: string;
    serviceConfig?: ProjectServiceConfig;
    createdAt: Date;
}
