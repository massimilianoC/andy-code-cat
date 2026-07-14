import { z } from "zod";

const httpsUrl = z.string().trim().url().refine((value) => new URL(value).protocol === "https:", "Must use HTTPS");

/** Owner-controlled settings. The LLM never receives this configuration. */
export const projectFormSettingsSchema = z.object({
    enabled: z.boolean(),
    mode: z.literal("mailto"),
    recipientEmail: z.string().trim().email().max(254),
    privacyNotice: z.object({
        version: z.string().trim().min(1).max(80),
        url: httpsUrl,
        controllerName: z.string().trim().min(1).max(160),
        contactEmail: z.string().trim().email().max(254),
    }).strict(),
}).strict();

export const updateProjectFormSettingsSchema = projectFormSettingsSchema;

export type ProjectFormSettingsInput = z.infer<typeof projectFormSettingsSchema>;
export type UpdateProjectFormSettingsInput = z.infer<typeof updateProjectFormSettingsSchema>;
