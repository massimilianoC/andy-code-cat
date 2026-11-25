import type { FormDefinitionV1, FormFieldV1, FormSubmissionIssue, FormSubmissionIssueReason } from "@andy-code-cat/contracts";
import type { FormSubmissionValue } from "../../domain/entities/FormSubmission";

/**
 * Server-side validation of a capture submission against the form definition of the DEPLOYED
 * service manifest (FORMS_CAPTURE.md §Validation). The definition is the only authority: a key it
 * does not declare is refused, every declared constraint is enforced, and nothing the browser
 * checked is trusted.
 *
 * Issues name the manifest field and a reason; they never carry the submitted value.
 */

/** Default length caps when the manifest declares none. */
export const DEFAULT_TEXT_MAX_LENGTH = 500;
export const DEFAULT_TEXTAREA_MAX_LENGTH = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEL_RE = /^[+0-9][0-9 ().\-/]{2,39}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
// C0 controls except tab, line feed and carriage return; plus DEL.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type FormSubmissionValidation =
    | { ok: true; values: Record<string, FormSubmissionValue> }
    | { ok: false; issues: FormSubmissionIssue[] };

function fieldsOf(form: FormDefinitionV1): FormFieldV1[] {
    return form.steps.flatMap((step) => step.fields);
}

function isValidDate(value: string): boolean {
    const match = DATE_RE.exec(value);
    if (!match) return false;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

type FieldResult = { value?: FormSubmissionValue; reason?: FormSubmissionIssueReason };

function validateCheckbox(field: FormFieldV1, raw: unknown): FieldResult {
    let checked: boolean;
    if (raw === undefined || raw === false || raw === "" || raw === "false") checked = false;
    else if (raw === true || raw === "true" || raw === "on") checked = true;
    else return { reason: "invalid_type" };
    if (field.required && !checked) return { reason: "required" };
    return { value: checked };
}

function validateNumber(field: FormFieldV1, raw: unknown): FieldResult {
    if (raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
        return field.required ? { reason: "required" } : {};
    }
    let value: number;
    if (typeof raw === "number") value = raw;
    else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim()) && raw.trim().length <= 32) value = Number(raw.trim());
    else return { reason: "invalid_type" };
    if (!Number.isFinite(value)) return { reason: "invalid_type" };
    if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        return { reason: "out_of_range" };
    }
    return { value };
}

function validateString(field: FormFieldV1, raw: unknown): FieldResult {
    if (raw === undefined) return field.required ? { reason: "required" } : {};
    if (typeof raw !== "string") return { reason: "invalid_type" };
    const value = field.type === "textarea" ? raw.replace(/\r\n?/g, "\n").trim() : raw.trim();
    if (value === "") return field.required ? { reason: "required" } : {};
    if (FORBIDDEN_CONTROL_RE.test(value)) return { reason: "invalid_format" };
    if (field.type !== "textarea" && /[\r\n]/.test(value)) return { reason: "invalid_format" };

    // The manifest's own cap wins (it is bounded at 1000 by the contract); the defaults apply when
    // it declares none. The request body is bounded separately (FORM_SUBMISSION_MAX_BYTES).
    const maxLength = field.maxLength
        ?? (field.type === "textarea" ? DEFAULT_TEXTAREA_MAX_LENGTH : DEFAULT_TEXT_MAX_LENGTH);
    if (value.length > maxLength) return { reason: "too_long" };
    if (field.minLength !== undefined && value.length < field.minLength) return { reason: "too_short" };

    switch (field.type) {
        case "email":
            if (value.length > 254 || !EMAIL_RE.test(value)) return { reason: "invalid_format" };
            break;
        case "tel":
            if (!TEL_RE.test(value)) return { reason: "invalid_format" };
            break;
        case "url":
            if (!isHttpUrl(value)) return { reason: "invalid_format" };
            break;
        case "date":
            if (!isValidDate(value)) return { reason: "invalid_format" };
            break;
        case "time":
            if (!TIME_RE.test(value)) return { reason: "invalid_format" };
            break;
        case "select":
        case "radio":
            if (!(field.options ?? []).some((option) => option.value === value)) return { reason: "invalid_option" };
            break;
        default:
            break;
    }
    return { value };
}

function validateField(field: FormFieldV1, raw: unknown): FieldResult {
    if (field.type === "checkbox") return validateCheckbox(field, raw);
    if (field.type === "number") return validateNumber(field, raw);
    return validateString(field, raw);
}

export function validateFormSubmission(form: FormDefinitionV1, submitted: Record<string, unknown>): FormSubmissionValidation {
    const fields = fieldsOf(form);
    const declared = new Map(fields.map((field) => [field.id, field]));
    const issues: FormSubmissionIssue[] = [];

    for (const key of Object.keys(submitted)) {
        if (!declared.has(key)) issues.push({ field: null, reason: "unknown_field" });
    }

    const values: Record<string, FormSubmissionValue> = {};
    for (const field of fields) {
        const raw = Object.prototype.hasOwnProperty.call(submitted, field.id) ? submitted[field.id] : undefined;
        const result = validateField(field, raw);
        if (result.reason) issues.push({ field: field.id, reason: result.reason });
        else if (result.value !== undefined) values[field.id] = result.value;
    }

    return issues.length > 0 ? { ok: false, issues } : { ok: true, values };
}
