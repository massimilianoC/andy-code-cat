import { describe, expect, it } from "vitest";
import type { FormDefinitionV1 } from "@andy-code-cat/contracts";
import { DEFAULT_TEXT_MAX_LENGTH, validateFormSubmission } from "../FormSubmissionValidator";

const form: FormDefinitionV1 = {
    id: "contact",
    kind: "contact",
    title: "Contact",
    purposeKey: "contact-request",
    submitLabel: "Send",
    successMessage: "Thanks",
    privacyNoticeRef: "project-default",
    steps: [{
        id: "one",
        title: "One",
        fields: [
            { id: "name", type: "text", label: "Name", required: true, maxLength: 20, minLength: 2, dataCategory: "identity" },
            { id: "email", type: "email", label: "Email", required: true, dataCategory: "contact" },
            { id: "message", type: "textarea", label: "Message", required: false, dataCategory: "request" },
            { id: "topic", type: "select", label: "Topic", required: false, options: [{ value: "sales", label: "Sales" }, { value: "support", label: "Support" }], dataCategory: "request" },
            { id: "privacy", type: "checkbox", label: "I accept", required: true, dataCategory: "consent" },
        ],
    }, {
        id: "two",
        title: "Two",
        fields: [
            { id: "people", type: "number", label: "People", required: false, min: 1, max: 10, dataCategory: "request" },
            { id: "day", type: "date", label: "Day", required: false, dataCategory: "request" },
            { id: "site", type: "url", label: "Site", required: false, dataCategory: "contact" },
            { id: "phone", type: "tel", label: "Phone", required: false, dataCategory: "contact" },
            { id: "at", type: "time", label: "At", required: false, dataCategory: "request" },
        ],
    }],
};

const valid = { name: "Ada", email: "ada@example.com", privacy: true };

function reasons(result: ReturnType<typeof validateFormSubmission>) {
    return result.ok ? [] : result.issues;
}

describe("validateFormSubmission", () => {
    it("accepts a valid submission and normalises values", () => {
        const result = validateFormSubmission(form, {
            ...valid, name: "  Ada  ", message: "line 1\r\nline 2", topic: "sales", people: "3", day: "2026-02-28",
            site: "https://example.com/a", phone: "+39 06 1234 5678", at: "09:30",
        });
        expect(result).toEqual({
            ok: true,
            values: {
                name: "Ada", email: "ada@example.com", message: "line 1\nline 2", topic: "sales", privacy: true,
                people: 3, day: "2026-02-28", site: "https://example.com/a", phone: "+39 06 1234 5678", at: "09:30",
            },
        });
    });

    it("rejects a key the manifest does not declare, without echoing it", () => {
        expect(reasons(validateFormSubmission(form, { ...valid, isAdmin: "yes" }))).toEqual([{ field: null, reason: "unknown_field" }]);
    });

    it("enforces required fields, including a required checkbox", () => {
        expect(reasons(validateFormSubmission(form, { email: "ada@example.com", privacy: false }))).toEqual([
            { field: "name", reason: "required" },
            { field: "privacy", reason: "required" },
        ]);
        expect(reasons(validateFormSubmission(form, { ...valid, name: "   " }))).toEqual([{ field: "name", reason: "required" }]);
    });

    it("enforces types", () => {
        expect(reasons(validateFormSubmission(form, { ...valid, name: 42 }))).toEqual([{ field: "name", reason: "invalid_type" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, privacy: "maybe" }))).toEqual([{ field: "privacy", reason: "invalid_type" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, people: "three" }))).toEqual([{ field: "people", reason: "invalid_type" }]);
    });

    it("enforces lengths, ranges and formats", () => {
        expect(reasons(validateFormSubmission(form, { ...valid, name: "x".repeat(21) }))).toEqual([{ field: "name", reason: "too_long" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, name: "x" }))).toEqual([{ field: "name", reason: "too_short" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, people: 11 }))).toEqual([{ field: "people", reason: "out_of_range" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, email: "not-an-email" }))).toEqual([{ field: "email", reason: "invalid_format" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, day: "2026-02-30" }))).toEqual([{ field: "day", reason: "invalid_format" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, site: "javascript:alert(1)" }))).toEqual([{ field: "site", reason: "invalid_format" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, at: "25:00" }))).toEqual([{ field: "at", reason: "invalid_format" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, name: "Ada\nBob" }))).toEqual([{ field: "name", reason: "invalid_format" }]);
        expect(reasons(validateFormSubmission(form, { ...valid, name: "Ada\u0000" }))).toEqual([{ field: "name", reason: "invalid_format" }]);
    });

    it("applies the default cap when the manifest declares no maxLength", () => {
        const noCap = { ...form, steps: [{ ...form.steps[0]!, fields: [{ id: "city", type: "text" as const, label: "City", required: true, dataCategory: "contact" as const }] }] };
        expect(validateFormSubmission(noCap, { city: "x".repeat(DEFAULT_TEXT_MAX_LENGTH) }).ok).toBe(true);
        expect(reasons(validateFormSubmission(noCap, { city: "x".repeat(DEFAULT_TEXT_MAX_LENGTH + 1) }))).toEqual([{ field: "city", reason: "too_long" }]);
    });

    it("accepts only declared options", () => {
        expect(reasons(validateFormSubmission(form, { ...valid, topic: "other" }))).toEqual([{ field: "topic", reason: "invalid_option" }]);
    });

    it("never puts a submitted value into an issue", () => {
        const secret = "SECRET-VALUE-123";
        const result = validateFormSubmission(form, { ...valid, email: secret, topic: secret, [secret]: secret });
        expect(JSON.stringify(result)).not.toContain(secret);
    });
});
