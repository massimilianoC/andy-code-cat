import { z } from "zod";
import type { GenerationWorkspaceDto } from "./assets";

const optionalTrimmedString = (max: number) =>
    z.preprocess(
        (value) => {
            if (typeof value === "string") {
                const trimmed = value.trim().slice(0, max);
                return trimmed.length > 0 ? trimmed : undefined;
            }
            return value == null ? undefined : value;
        },
        z.string().max(max).optional(),
    );

const requiredTrimmedString = (max: number, min = 1) =>
    z.preprocess(
        (value) => (typeof value === "string" ? value.trim().slice(0, max) : value),
        z.string().min(min).max(max),
    );

export const guidedContactItemSchema = z.object({
    key: requiredTrimmedString(60),
    value: requiredTrimmedString(200),
});

export const guidedLaunchSchema = z.object({
    businessName: requiredTrimmedString(120, 2),
    /** PRESET_CATALOG id (e.g. "slideshow", "landing", "website"). Defaults to "landing". */
    presetId: z.string().min(2).max(60).default("landing"),
    // Increased limit: accepts free-form rich description (paste from docs, MD, etc.)
    primaryGoal: requiredTrimmedString(3000, 8),
    audience: requiredTrimmedString(1000, 3),
    tone: optionalTrimmedString(80),
    primaryCta: optionalTrimmedString(120),
    styleHint: optionalTrimmedString(1000),
    /** Original user request. It remains authoritative over inferred enrichment. */
    sourceRequest: optionalTrimmedString(4000),
    projectSummary: optionalTrimmedString(1600),
    contentStructure: optionalTrimmedString(2400),
    contentRequirements: optionalTrimmedString(2400),
    functionalRequirements: optionalTrimmedString(2400),
    interactionModel: optionalTrimmedString(1800),
    visualDirection: optionalTrimmedString(1800),
    successCriteria: optionalTrimmedString(1600),
    constraints: optionalTrimmedString(1600),
    mustAvoid: optionalTrimmedString(1200),
    // New fields from guided 4-step flow (all optional for backward compat)
    contactInfo: z.array(guidedContactItemSchema).max(15).optional(),
    styleAttributes: z.array(z.string().trim().max(80)).max(20).optional(),
    // Output language: BCP-47 code (e.g. "it", "en", "fr"). Default "en".
    outputLanguage: z.string().min(2).max(10).toLowerCase().optional(),
    /**
     * Filenames of documents attached during intake (I9 — SSOT program). Previously the client
     * listed these in its own client-rebuilt brief text and never sent them to the server; the
     * server-built brief silently omitted them. Sending them here lets the single canonical
     * brief builder include an Attachments section, so the persisted/optimized/reviewed brief
     * text is always identical.
     */
    attachmentNames: z.array(z.string().trim().max(200)).max(30).optional(),
});

// "zero-effort" accepted for one release for backward compatibility with cached
// frontend bundles/clients still sending the legacy literal — see
// docs/specs/GUIDED_MODE_PREFILL_SPEC.md for the removal ticket.
export const executeProjectPipelineSchema = z.object({
    mode: z.enum(["guided", "zero-effort"]).default("guided"),
    input: guidedLaunchSchema,
});

export type GuidedLaunchInput = z.infer<typeof guidedLaunchSchema>;
export type ExecuteProjectPipelineInput = z.infer<typeof executeProjectPipelineSchema>;

export interface GuidedLaunchResultDto {
    mode: "guided";
    status: "prepared";
    projectId: string;
    conversationId: string;
    jobId: string;
    normalizedBrief: string;
    suggestedNextActions: string[];
    workspace: GenerationWorkspaceDto;
}
