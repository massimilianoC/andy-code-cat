import { z } from "zod";

const httpsUrl = z.string().trim().url().refine((value) => new URL(value).protocol === "https:", "Must use HTTPS");

const privacyNoticeSchema = z.object({
    version: z.string().trim().min(1).max(80),
    url: httpsUrl,
    controllerName: z.string().trim().min(1).max(160),
    contactEmail: z.string().trim().email().max(254),
}).strict();

const recipientEmailSchema = z.string().trim().email().max(254);

/** `mailto`: a local hand-off to the visitor's email client. Nothing is stored by the platform. */
export const mailtoFormSettingsSchema = z.object({
    enabled: z.boolean(),
    mode: z.literal("mailto"),
    recipientEmail: recipientEmailSchema,
    privacyNotice: privacyNoticeSchema,
}).strict();

/**
 * `capture`: submissions on the published site are validated by the server against the deployed
 * manifest and stored for the project owner (docs/specs/FORMS_CAPTURE.md). A recipient address is
 * not used; one kept from an earlier mailto configuration is accepted and ignored.
 */
export const captureFormSettingsSchema = z.object({
    enabled: z.boolean(),
    mode: z.literal("capture"),
    recipientEmail: recipientEmailSchema.optional(),
    privacyNotice: privacyNoticeSchema,
}).strict();

/** Owner-controlled settings. The LLM never receives this configuration. */
export const projectFormSettingsSchema = z.discriminatedUnion("mode", [
    mailtoFormSettingsSchema,
    captureFormSettingsSchema,
]);

export const updateProjectFormSettingsSchema = projectFormSettingsSchema;

export const FORM_DELIVERY_MODES = ["mailto", "capture"] as const;
export type FormDeliveryMode = typeof FORM_DELIVERY_MODES[number];

export type ProjectFormSettingsInput = z.infer<typeof projectFormSettingsSchema>;
export type UpdateProjectFormSettingsInput = z.infer<typeof updateProjectFormSettingsSchema>;

// ── Public capture submit (POST /p/{publishId}/_pf/forms/{formId}/submit) ─────────────────────

/** Upper bound of one submission request body, in bytes. */
export const FORM_SUBMISSION_MAX_BYTES = 16 * 1024;

/** Name of the honeypot input rendered by the platform in capture forms. */
export const FORM_HONEYPOT_FIELD = "pf_hp";

export const formSubmissionValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Envelope only. The field values are validated by the server against the form definition of the
 * deployed service manifest, never against anything the request says about itself.
 */
export const formSubmissionRequestSchema = z.object({
    fields: z.record(formSubmissionValueSchema),
    /** Honeypot: must be empty. A filled honeypot is answered 202 and nothing is stored. */
    hp: z.string().max(500).optional(),
}).strict();

export type FormSubmissionRequest = z.infer<typeof formSubmissionRequestSchema>;

export type FormSubmissionIssueReason =
    | "unknown_field"
    | "required"
    | "invalid_type"
    | "too_short"
    | "too_long"
    | "invalid_format"
    | "out_of_range"
    | "invalid_option";

/** One validation problem. It names the manifest field, never echoes the submitted value. */
export interface FormSubmissionIssue {
    /** Manifest field id; null for a key that is not part of the form (the key is not echoed). */
    field: string | null;
    reason: FormSubmissionIssueReason;
}

export type FormSubmissionErrorCode =
    | "FORM_SITE_NOT_FOUND"
    | "FORM_SITE_SUSPENDED"
    | "FORM_SITE_HOST_REFUSED"
    | "FORM_ORIGIN_REFUSED"
    | "FORM_CAPTURE_DISABLED"
    | "FORM_NOT_FOUND"
    | "FORM_SUBMISSION_INVALID"
    | "FORM_SUBMISSION_TOO_LARGE"
    | "FORM_SUBMISSION_UNSUPPORTED_MEDIA_TYPE"
    | "FORM_RATE_LIMITED"
    | "FORM_TEMPORARILY_UNAVAILABLE";

export interface FormSubmissionErrorResponse {
    ok: false;
    error: string;
    code: FormSubmissionErrorCode;
    issues?: FormSubmissionIssue[];
}
