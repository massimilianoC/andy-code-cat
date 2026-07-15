import { describe, expect, it } from "vitest";
import type { ServiceManifestV1 } from "@andy-code-cat/contracts";
import { compileMailtoForms, stripLegacyConcatenatedMailtoRuntime } from "../FormRuntimeCompiler";

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
    it("replaces declared slots and keeps platform behaviour separate from generated JavaScript", () => {
        const result = compileMailtoForms({
            html: "<main><div data-pf-form-id='contact'></div></main>",
            css: ".host{display:block}",
            js: "window.generatedArtifact = true;",
        }, manifest, settings, { delivery: "external-files" });

        expect(result.compiledFormIds).toEqual(["contact"]);
        expect(result.artifacts.html).toContain("data-pf-form-runtime=\"service-manifest-v1\"");
        expect(result.artifacts.html).toContain("https://example.test/privacy");
        expect(result.artifacts.html).not.toContain("mailto:");
        expect(result.artifacts.html).toContain("src='pf-runtime-core.v1.js?");
        expect(result.artifacts.js).toBe("window.generatedArtifact = true;");
        expect(result.runtimeFiles["pf-forms-mailto.v1.js"]).toContain("window.location.assign(uri)");
        expect(result.runtimeFiles["pf-runtime-config.v1.js"]).toContain("owner@example.test");
        expect(result.runtimePlan?.assets.map((asset) => asset.fileName)).toEqual([
            "pf-runtime-core.v1.js",
            "pf-runtime-config.v1.js",
            "pf-forms-ui.v1.js",
            "pf-forms-mailto.v1.js",
        ]);
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

    it("renders deterministic multi-step navigation and an interceptable delivery event", () => {
        const multiStepManifest: ServiceManifestV1 = {
            ...manifest,
            forms: [{
                ...manifest.forms[0]!,
                steps: [
                    manifest.forms[0]!.steps[0]!,
                    {
                        id: "request",
                        title: "Richiesta",
                        fields: [{ id: "topic", type: "text", label: "Argomento", required: true, dataCategory: "request" }],
                    },
                ],
            }],
        };
        const result = compileMailtoForms(
            { html: "<div data-pf-form-id='contact'></div>", css: "", js: "" },
            multiStepManifest,
            settings,
        );

        expect(result.artifacts.html).toContain("data-pf-step='1' hidden");
        expect(result.artifacts.html).toContain("data-pf-next");
        expect(result.artifacts.html).toContain("data-pf-back");
        expect(result.runtimeFiles["pf-forms-ui.v1.js"]).toContain("form.checkValidity()");
        expect(result.runtimeFiles["pf-forms-mailto.v1.js"]).toContain("pf:mailto");
        expect(result.runtimeFiles["pf-forms-mailto.v1.js"]).not.toContain("detail: { formId: definition.id, uri }");
    });

    it("isolates the platform runtime even when generated JavaScript is invalid", () => {
        const invalidGeneratedJs = "const ok = true;\n{ \"version\": \"media-manifest-v1\" }";
        const result = compileMailtoForms({
            html: "<div data-pf-form-id='contact'></div>",
            css: "",
            js: invalidGeneratedJs,
        }, manifest, settings);

        expect(result.artifacts.js).toBe(invalidGeneratedJs);
        expect(result.artifacts.html.indexOf("data-pf-runtime-module='runtime-core'"))
            .toBeLessThan(result.artifacts.html.indexOf("data-pf-runtime-module='forms-mailto'"));
    });

    it("repackages a prepared preview into external files without carrying inline runtime code", () => {
        const preview = compileMailtoForms({
            html: "<div data-pf-form-id='contact'></div>",
            css: "",
            js: "window.generated = true;",
        }, manifest, settings, { delivery: "inline-preview" });
        const published = compileMailtoForms(
            preview.artifacts,
            manifest,
            settings,
            { delivery: "external-files" },
        );

        expect(published.artifacts.html).toContain("src='pf-runtime-core.v1.js?");
        expect(published.artifacts.html).not.toContain("const modules = new Map()");
        expect(published.artifacts.js).toBe("window.generated = true;");
    });

    it("migrates only a complete legacy mailto runtime suffix out of generated JavaScript", () => {
        const generatedJs = "window.generated = true;";
        const legacySuffix = `
;(() => {
  const config = {"version":"form-runtime-v1","mode":"mailto","recipientEmail":"owner@example.test","forms":[]};
  document.querySelectorAll("form[data-pf-form-runtime='service-manifest-v1']").forEach((form) => {
    form.dataset.pfMounted = "true";
    window.location.assign(uri);
  });
})();`;
        const migrated = compileMailtoForms({
            html: `<form data-pf-form-runtime="service-manifest-v1" data-pf-form-id="contact"></form>`,
            css: "",
            js: generatedJs + legacySuffix,
        }, manifest, settings, { delivery: "external-files" });

        expect(migrated.artifacts.js).toBe(generatedJs);
        expect(migrated.runtimeFiles["pf-forms-mailto.v1.js"]).toBeDefined();
        expect(stripLegacyConcatenatedMailtoRuntime(generatedJs + legacySuffix + "\nwindow.after = true;"))
            .toBe(generatedJs + legacySuffix + "\nwindow.after = true;");
        expect(stripLegacyConcatenatedMailtoRuntime(`${generatedJs}\nconst config = {"version":"form-runtime-v1"};`))
            .toBe(`${generatedJs}\nconst config = {"version":"form-runtime-v1"};`);
    });
});
