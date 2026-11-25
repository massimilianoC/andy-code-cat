import { describe, expect, it } from "vitest";
import { formSubmissionRequestSchema, projectFormSettingsSchema } from "../forms";

const privacyNotice = {
    version: "2026-07-14",
    url: "https://example.com/privacy",
    controllerName: "Example SRL",
    contactEmail: "privacy@example.com",
};

describe("projectFormSettingsSchema", () => {
    it("keeps validating settings stored by the mailto-only version", () => {
        const stored = { enabled: true, mode: "mailto", recipientEmail: "owner@example.com", privacyNotice };
        expect(projectFormSettingsSchema.parse(stored)).toEqual(stored);
    });

    it("requires a recipient for mailto only", () => {
        expect(projectFormSettingsSchema.safeParse({ enabled: true, mode: "mailto", privacyNotice }).success).toBe(false);
        expect(projectFormSettingsSchema.safeParse({ enabled: true, mode: "capture", privacyNotice }).success).toBe(true);
        expect(projectFormSettingsSchema.safeParse({ enabled: true, mode: "capture", recipientEmail: "owner@example.com", privacyNotice }).success).toBe(true);
    });

    it("requires the privacy notice in both modes and rejects unknown modes and keys", () => {
        expect(projectFormSettingsSchema.safeParse({ enabled: true, mode: "capture" }).success).toBe(false);
        expect(projectFormSettingsSchema.safeParse({ enabled: true, mode: "relay", privacyNotice }).success).toBe(false);
        expect(projectFormSettingsSchema.safeParse({ enabled: true, mode: "capture", privacyNotice, endpoint: "https://example.com" }).success).toBe(false);
    });
});

describe("formSubmissionRequestSchema", () => {
    it("accepts scalar values only and no extra envelope keys", () => {
        expect(formSubmissionRequestSchema.safeParse({ fields: { email: "a@example.com", age: 3, ok: true } }).success).toBe(true);
        expect(formSubmissionRequestSchema.safeParse({ fields: { nested: { a: 1 } } }).success).toBe(false);
        expect(formSubmissionRequestSchema.safeParse({ fields: {}, projectId: "x" }).success).toBe(false);
    });
});
