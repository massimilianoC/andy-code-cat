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

export const uxModeSchema = z.enum(["zero-effort", "godmode"]);
export type UxMode = z.infer<typeof uxModeSchema>;

export const zeroEffortSiteTypeSchema = z.enum([
    "landing_page",
    "portfolio",
    "showcase",
    "business_site",
]);

export const zeroEffortContactItemSchema = z.object({
    key: requiredTrimmedString(60),
    value: requiredTrimmedString(200),
});

export const zeroEffortLaunchSchema = z.object({
    businessName: requiredTrimmedString(120, 2),
    siteType: zeroEffortSiteTypeSchema.default("landing_page"),
    // Increased limit: accepts free-form rich description (paste from docs, MD, etc.)
    primaryGoal: requiredTrimmedString(3000, 8),
    audience: requiredTrimmedString(1000, 3),
    tone: optionalTrimmedString(80),
    primaryCta: optionalTrimmedString(120),
    styleHint: optionalTrimmedString(1000),
    // New fields from guided 4-step flow (all optional for backward compat)
    contactInfo: z.array(zeroEffortContactItemSchema).max(15).optional(),
    styleAttributes: z.array(z.string().trim().max(80)).max(20).optional(),
    // Output language: BCP-47 code (e.g. "it", "en", "fr"). Default "en".
    outputLanguage: z.string().min(2).max(10).toLowerCase().optional(),
});

export const executeProjectPipelineSchema = z.object({
    mode: z.literal("zero-effort").default("zero-effort"),
    input: zeroEffortLaunchSchema,
});

export type ZeroEffortLaunchInput = z.infer<typeof zeroEffortLaunchSchema>;
export type ExecuteProjectPipelineInput = z.infer<typeof executeProjectPipelineSchema>;

export interface ZeroEffortLaunchResultDto {
    mode: "zero-effort";
    status: "prepared";
    projectId: string;
    conversationId: string;
    jobId: string;
    normalizedBrief: string;
    suggestedNextActions: string[];
    workspace: GenerationWorkspaceDto;
}
