import { z } from "zod";

/**
 * Declarative service contract emitted by the LLM. It describes user intent and
 * allowed fields only; delivery configuration and executable behaviour remain
 * platform-owned.
 */
export const formKindSchema = z.enum([
    "contact",
    "commercial_lead",
    "quote_request",
    "booking_request",
    "newsletter_request",
    "feedback",
    "survey",
    "onboarding",
    "custom",
]);

export const formFieldTypeSchema = z.enum([
    "text",
    "email",
    "tel",
    "textarea",
    "number",
    "select",
    "radio",
    "checkbox",
    "date",
    "time",
    "url",
    "hidden_context",
]);

export const formDataCategorySchema = z.enum([
    "identity",
    "contact",
    "request",
    "preference",
    "consent",
    "context",
]);

const idSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(48);
const safeText = (max: number) => z.string().trim().min(1).max(max);

export const formFieldOptionSchema = z.object({
    value: z.string().trim().min(1).max(80),
    label: safeText(120),
}).strict();

export const formFieldSchema = z.object({
    id: idSchema,
    type: formFieldTypeSchema,
    label: safeText(120),
    description: z.string().trim().max(300).optional(),
    placeholder: z.string().trim().max(160).optional(),
    required: z.boolean(),
    autocomplete: z.string().trim().max(80).optional(),
    minLength: z.number().int().min(0).max(1000).optional(),
    maxLength: z.number().int().min(1).max(1000).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    patternKey: z.enum(["postal_code", "vat_id", "fiscal_code", "custom_safe"]).optional(),
    options: z.array(formFieldOptionSchema).min(1).max(20).optional(),
    dataCategory: formDataCategorySchema,
}).strict().superRefine((field, context) => {
    if (["select", "radio"].includes(field.type) && !field.options?.length) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "select and radio fields require options" });
    }
    if (!["select", "radio"].includes(field.type) && field.options) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "options are allowed only for select and radio fields" });
    }
    if (field.type === "hidden_context" && field.dataCategory !== "context") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["dataCategory"], message: "hidden_context fields must be context data" });
    }
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["minLength"], message: "minLength cannot exceed maxLength" });
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["min"], message: "min cannot exceed max" });
    }
});

export const formStepSchema = z.object({
    id: idSchema,
    title: safeText(120),
    description: z.string().trim().max(300).optional(),
    fields: z.array(formFieldSchema).min(1).max(5),
}).strict().superRefine((step, context) => {
    const ids = new Set<string>();
    for (const [index, field] of step.fields.entries()) {
        if (ids.has(field.id)) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "id"], message: "field ids must be unique within a step" });
        }
        ids.add(field.id);
    }
});

export const formDefinitionSchema = z.object({
    id: idSchema,
    kind: formKindSchema,
    title: safeText(120),
    description: z.string().trim().max(500).optional(),
    purposeKey: idSchema,
    steps: z.array(formStepSchema).min(1).max(5),
    submitLabel: safeText(60),
    successMessage: safeText(300),
    privacyNoticeRef: z.literal("project-default"),
}).strict().superRefine((form, context) => {
    const stepIds = new Set<string>();
    const fieldIds = new Set<string>();
    for (const [stepIndex, step] of form.steps.entries()) {
        if (stepIds.has(step.id)) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["steps", stepIndex, "id"], message: "step ids must be unique" });
        }
        stepIds.add(step.id);
        for (const [fieldIndex, field] of step.fields.entries()) {
            if (fieldIds.has(field.id)) {
                context.addIssue({ code: z.ZodIssueCode.custom, path: ["steps", stepIndex, "fields", fieldIndex, "id"], message: "field ids must be unique across a form" });
            }
            fieldIds.add(field.id);
        }
    }
    if (fieldIds.size > 20) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["steps"], message: "a form cannot contain more than 20 fields" });
    }
    if (form.kind === "newsletter_request") {
        for (const requiredId of ["email", "privacy-acknowledgement", "marketing-consent"]) {
            if (!fieldIds.has(requiredId)) {
                context.addIssue({ code: z.ZodIssueCode.custom, path: ["steps"], message: `newsletter_request requires ${requiredId}` });
            }
        }
    }
});

export const serviceManifestSchema = z.object({
    version: z.literal("service-manifest-v1"),
    forms: z.array(formDefinitionSchema).min(1).max(5),
}).strict().superRefine((manifest, context) => {
    const ids = new Set<string>();
    for (const [index, form] of manifest.forms.entries()) {
        if (ids.has(form.id)) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["forms", index, "id"], message: "form ids must be unique" });
        }
        ids.add(form.id);
    }
});

export type ServiceManifestV1 = z.infer<typeof serviceManifestSchema>;
export type FormDefinitionV1 = z.infer<typeof formDefinitionSchema>;
export type FormFieldV1 = z.infer<typeof formFieldSchema>;
