import { describe, expect, it } from "vitest";
import { tryParseStructuredJson } from "../llmParser";

const serviceManifest = {
    version: "service-manifest-v1",
    forms: [{
        id: "contact",
        kind: "contact",
        title: "Contact",
        purposeKey: "contact-request",
        submitLabel: "Send",
        successMessage: "Draft opened",
        privacyNoticeRef: "project-default",
        steps: [{
            id: "details",
            title: "Details",
            fields: [{ id: "email", type: "email", label: "Email", required: true, dataCategory: "contact" }],
        }],
    }],
};

describe("llmParser serviceManifest", () => {
    it("preserves a valid root manifest without affecting artifact parsing", () => {
        const result = tryParseStructuredJson(JSON.stringify({
            chat: { summary: "Done", bullets: [], nextActions: [] },
            artifacts: { html: "<div data-pf-form-id='contact'></div>", css: "", js: "" },
            serviceManifest,
        }));

        expect(result.parseValid).toBe(true);
        expect(result.structured?.serviceManifest?.forms[0]?.id).toBe("contact");
    });

    it("rescues a nested JSON-encoded manifest and drops invalid manifests safely", () => {
        const nested = tryParseStructuredJson(JSON.stringify({
            chat: { summary: "Done", bullets: [], nextActions: [] },
            artifacts: { html: "<div data-pf-form-id='contact'></div>", css: "", js: "", serviceManifest: JSON.stringify(serviceManifest) },
        }));
        const invalid = tryParseStructuredJson(JSON.stringify({
            chat: { summary: "Done", bullets: [], nextActions: [] },
            artifacts: { html: "<main></main>", css: "", js: "" },
            serviceManifest: { version: "service-manifest-v1", forms: [{ id: "Bad Id" }] },
        }));

        expect(nested.structured?.serviceManifest?.forms).toHaveLength(1);
        expect(invalid.parseValid).toBe(true);
        expect(invalid.structured?.serviceManifest).toBeUndefined();
    });

    it("normalizes nullable optional properties emitted by strict structured-output providers", () => {
        const providerManifest = structuredClone(serviceManifest);
        Object.assign(providerManifest.forms[0]!, { description: null });
        Object.assign(providerManifest.forms[0]!.steps[0]!, { description: null });
        Object.assign(providerManifest.forms[0]!.steps[0]!.fields[0]!, {
            description: null,
            placeholder: null,
            autocomplete: null,
            minLength: null,
            maxLength: null,
            min: null,
            max: null,
            patternKey: null,
            options: null,
        });
        const result = tryParseStructuredJson(JSON.stringify({
            chat: { summary: "Done", bullets: [], nextActions: [] },
            artifacts: { html: "<div data-pf-form-id='contact'></div>", css: "", js: "" },
            serviceManifest: providerManifest,
        }));

        expect(result.structured?.serviceManifest?.forms[0]?.steps[0]?.fields[0]?.id).toBe("email");
    });
});
