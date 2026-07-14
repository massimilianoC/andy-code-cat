import { describe, expect, it } from "vitest";
import type { ServiceManifestV1 } from "@andy-code-cat/contracts";
import { compileMailtoForms } from "../FormRuntimeCompiler";

const manifest: ServiceManifestV1 = {
    version: "service-manifest-v1",
    forms: [{
        id: "contact",
        kind: "contact",
        title: "Contattaci",
        purposeKey: "contact-request",
        submitLabel: "Apri email",
        successMessage: "La bozza è stata aperta.",
        privacyNoticeRef: "project-default",
        steps: [{
            id: "details",
            title: "Dettagli",
            fields: [
                { id: "email", type: "email", label: "Email", required: true, dataCategory: "contact" },
                { id: "message", type: "textarea", label: "Messaggio", required: true, dataCategory: "request" },
            ],
        }],
    }],
};

const settings = {
    enabled: true as const,
    mode: "mailto" as const,
    recipientEmail: "owner@example.test",
    privacyNotice: {
        version: "2026-07-14",
        url: "https://example.test/privacy",
        controllerName: "Example SRL",
        contactEmail: "privacy@example.test",
    },
};

describe("compileMailtoForms", () => {
    it("replaces only declared slots and puts all executable behaviour in artifacts.js", () => {
        const result = compileMailtoForms({
            html: "<main><div data-pf-form-id='contact'></div></main>",
            css: ".host{display:block}",
            js: "",
        }, manifest, settings);

        expect(result.compiledFormIds).toEqual(["contact"]);
        expect(result.artifacts.html).toContain("data-pf-form-runtime=\"service-manifest-v1\"");
        expect(result.artifacts.html).toContain("https://example.test/privacy");
        expect(result.artifacts.html).not.toContain("mailto:");
        expect(result.artifacts.js).toContain("window.location.assign(uri)");
        expect(result.artifacts.js).toContain("owner@example.test");
    });

    it("is idempotent and leaves artifacts without enabled settings untouched", () => {
        const input = { html: "<main><div data-pf-form-id='contact'></div></main>", css: "", js: "" };
        const first = compileMailtoForms(input, manifest, settings);
        const second = compileMailtoForms(first.artifacts, manifest, settings);
        const disabled = compileMailtoForms(input, manifest, { ...settings, enabled: false });

        expect(second.artifacts).toEqual(first.artifacts);
        expect(disabled.artifacts).toEqual(input);
    });

    it("fails closed when a configured manifest has no matching declarative slot", () => {
        expect(() => compileMailtoForms({ html: "<main></main>", css: "", js: "" }, manifest, settings)).toThrow("Form slot missing");
    });
});
