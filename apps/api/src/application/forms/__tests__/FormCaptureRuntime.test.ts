import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { FORM_HONEYPOT_FIELD, runtimePlanSchema, type ServiceManifestV1 } from "@andy-code-cat/contracts";
import { PF_FORMS_CAPTURE_V1 } from "../../platform-runtime/browserRuntimeAssets";
import { prepareArtifactServices } from "../../platform-runtime/prepareArtifactServices";
import { formCaptureSubmitPath } from "../FormRuntimeCompiler";

const manifest: ServiceManifestV1 = {
    version: "service-manifest-v1",
    forms: [{
        id: "contact",
        kind: "contact",
        title: "Contact",
        purposeKey: "contact-request",
        submitLabel: "Send",
        successMessage: "Thanks",
        privacyNoticeRef: "project-default",
        steps: [{ id: "one", title: "One", fields: [{ id: "email", type: "email", label: "Email", required: true, dataCategory: "contact" }] }],
    }],
};

const privacyNotice = { version: "2026-11-01", url: "https://example.com/privacy", controllerName: "Example SRL", contactEmail: "privacy@example.com" };
const capture = { enabled: true, mode: "capture" as const, recipientEmail: "owner@example.com", privacyNotice };
const mailto = { enabled: true, mode: "mailto" as const, recipientEmail: "owner@example.com", privacyNotice };
const artifacts = { html: "<main><div data-pf-form-id='contact'></div></main>", css: "", js: "window.generated = 1;" };

interface FakeForm {
    attributes: Record<string, string>;
    resetCalls: number;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): string | null;
    querySelectorAll(): never[];
    reset(): void;
}

function fakeForm(): FakeForm {
    return {
        attributes: {},
        resetCalls: 0,
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name] ?? null; },
        querySelectorAll() { return []; },
        reset() { this.resetCalls += 1; },
    };
}

/** Runs the browser module in a bare VM context with just the globals it touches. */
function loadCaptureAdapter(source: string, fetchImpl: (url: string, init: { body: string; signal?: { addEventListener(type: string, fn: () => void): void } }) => Promise<unknown>, globals: Record<string, unknown> = {}) {
    const adapters = new Map<string, { deliver(context: Record<string, unknown>): Promise<void> }>();
    const requests: Array<{ url: string; body: unknown }> = [];
    const window = {
        PageForgeRuntime: {
            registerModule() { /* mount is exercised in the browser only */ },
            registerAdapter(mode: string, adapter: { deliver(context: Record<string, unknown>): Promise<void> }) { adapters.set(mode, adapter); },
        },
    };
    vm.runInNewContext(source, {
        window,
        document: { documentElement: { lang: "" } },
        fetch: async (url: string, init: { body: string }) => {
            requests.push({ url, body: JSON.parse(init.body) });
            return fetchImpl(url, init);
        },
        ...globals,
    });
    return { adapter: adapters.get("capture")!, requests };
}

function configOf(files: Record<string, string>): Record<string, unknown> {
    const source = files["pf-runtime-config.v1.js"]!;
    return JSON.parse(source.slice(source.indexOf("(") + 1, source.lastIndexOf(")"))) as Record<string, unknown>;
}

describe("capture form runtime selection", () => {
    it("selects pf-forms-capture (and not mailto) for capture settings, with the same-origin submit path on publish", () => {
        const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: capture, delivery: "external-files", publishId: "ab12cd34" });

        expect(Object.keys(result.runtimeFiles).sort()).toEqual([
            "pf-forms-capture.v1.js", "pf-forms-ui.v1.js", "pf-runtime-config.v1.js", "pf-runtime-core.v1.js",
        ]);
        expect(runtimePlanSchema.parse(result.runtimePlan).capabilities).toEqual([{ id: "forms", mode: "capture", manifestVersion: "service-manifest-v1" }]);
        const forms = configOf(result.runtimeFiles).forms as Record<string, unknown>;
        expect(forms.mode).toBe("capture");
        expect(forms.submitUrls).toEqual({ contact: "/p/ab12cd34/_pf/forms/contact/submit" });
        expect(formCaptureSubmitPath("ab12cd34", "contact")).toBe("/p/ab12cd34/_pf/forms/contact/submit");
        // The recipient of an earlier mailto configuration is not published by a capture form.
        expect(result.runtimeFiles["pf-runtime-config.v1.js"]).not.toContain("owner@example.com");
        expect(result.artifacts.html).toContain(`name='${FORM_HONEYPOT_FIELD}'`);
        expect(result.artifacts.html).toContain("src='pf-forms-capture.v1.js?");
        // Generated JavaScript stays byte-identical and separate from platform code.
        expect(result.artifacts.js).toBe(artifacts.js);
    });

    it("has no submit URL in preview and ZIP, so the runtime shows the published-only notice", () => {
        for (const delivery of ["inline-preview", "external-files"] as const) {
            const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: capture, delivery });
            const forms = configOf(result.runtimeFiles).forms as Record<string, unknown>;
            expect(forms.submitUrls).toBeNull();
            expect(result.runtimeFiles["pf-forms-capture.v1.js"]).toContain("saves data only on the published site");
        }
    });

    it("keeps mailto settings on the mailto module, without a honeypot", () => {
        const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: mailto, delivery: "external-files", publishId: "ab12cd34" });
        expect(Object.keys(result.runtimeFiles)).toContain("pf-forms-mailto.v1.js");
        expect(Object.keys(result.runtimeFiles)).not.toContain("pf-forms-capture.v1.js");
        expect(result.runtimePlan?.capabilities[0]?.mode).toBe("mailto");
        expect(result.artifacts.html).not.toContain(FORM_HONEYPOT_FIELD);
    });

    it("compiles nothing for disabled capture settings", () => {
        const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: { ...capture, enabled: false }, delivery: "external-files", publishId: "ab12cd34" });
        expect(result.artifacts).toEqual(artifacts);
        expect(result.runtimeFiles).toEqual({});
    });

    it("ships syntactically valid platform modules", () => {
        const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: capture, delivery: "external-files", publishId: "ab12cd34" });
        for (const [name, source] of Object.entries(result.runtimeFiles)) {
            expect(() => new vm.Script(source, { filename: name }), name).not.toThrow();
        }
    });

    it("posts declared fields and the honeypot to the submit URL, and shows the outcome", async () => {
        const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: capture, delivery: "external-files", publishId: "ab12cd34" });
        const harness = loadCaptureAdapter(result.runtimeFiles["pf-forms-capture.v1.js"]!, async () => ({ status: 201, json: async () => ({ ok: true }) }));
        const statuses: string[] = [];
        const form = fakeForm();
        await harness.adapter.deliver({
            form,
            definition: { id: "contact", successMessage: "Thanks", fields: [{ id: "email", type: "email" }] },
            values: new Map([["email", "ada@example.com"], ["undeclared", "x"], [FORM_HONEYPOT_FIELD, ""]]),
            settings: { submitUrls: { contact: "/p/ab12cd34/_pf/forms/contact/submit" } },
            showStatus: (message: string) => statuses.push(message),
            emit: () => true,
        });
        expect(harness.requests).toEqual([{ url: "/p/ab12cd34/_pf/forms/contact/submit", body: { fields: { email: "ada@example.com" } } }]);
        expect(statuses.at(-1)).toBe("Thanks");
        expect(form.attributes["data-pf-state"]).toBe("success");
        expect(form.resetCalls).toBe(1);
    });

    it("sends nothing without a submit URL and says the form saves only on the published site", async () => {
        const harness = loadCaptureAdapter(PF_FORMS_CAPTURE_V1, async () => { throw new Error("must not fetch"); });
        const statuses: string[] = [];
        await harness.adapter.deliver({
            form: fakeForm(),
            definition: { id: "contact", successMessage: "Thanks", fields: [{ id: "email", type: "email" }] },
            values: new Map([["email", "ada@example.com"]]),
            settings: { submitUrls: null },
            showStatus: (message: string) => statuses.push(message),
            emit: () => true,
        });
        expect(harness.requests).toEqual([]);
        expect(statuses).toEqual([expect.stringContaining("solo sul sito pubblicato")]);
    });

    it("refuses an unknown stored mode instead of choosing one", () => {
        const unknown = { ...capture, mode: "relay" } as unknown as typeof capture;
        expect(() => prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: unknown, delivery: "external-files" }))
            .toThrow("Unsupported form runtime mode 'relay'");
    });

    it("does not send while the device is offline, and keeps the answers in the form", async () => {
        const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: capture, delivery: "external-files", publishId: "ab12cd34" });
        const harness = loadCaptureAdapter(result.runtimeFiles["pf-forms-capture.v1.js"]!, async () => ({ status: 201 }), { navigator: { onLine: false } });
        const statuses: string[] = [];
        const form = fakeForm();
        await harness.adapter.deliver({
            form, definition: { id: "contact", fields: [{ id: "email", type: "email" }] }, values: new Map([["email", "ada@example.com"]]),
            settings: { submitUrls: { contact: "/p/ab12cd34/_pf/forms/contact/submit" } }, showStatus: (m: string) => statuses.push(m), emit: () => true,
        });
        expect(harness.requests).toEqual([]);
        expect(statuses.at(-1)).toContain("offline");
        expect(form.attributes["data-pf-state"]).toBe("error");
        expect(form.resetCalls).toBe(0);
    });

    it("gives up after the timeout instead of staying busy, and says the outcome is unknown", async () => {
        const result = prepareArtifactServices({ artifacts, serviceManifest: manifest, formSettings: capture, delivery: "external-files", publishId: "ab12cd34" });
        class FakeAbortController {
            listeners: Array<() => void> = [];
            signal = { addEventListener: (_type: string, fn: () => void) => { this.listeners.push(fn); } };
            abort() { this.listeners.forEach((fn) => fn()); }
        }
        const harness = loadCaptureAdapter(
            result.runtimeFiles["pf-forms-capture.v1.js"]!,
            (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
            { AbortController: FakeAbortController, setTimeout: (fn: () => void) => { queueMicrotask(fn); return 1; }, clearTimeout: () => undefined },
        );
        const statuses: string[] = [];
        const form = fakeForm();
        await harness.adapter.deliver({
            form, definition: { id: "contact", fields: [{ id: "email", type: "email" }] }, values: new Map([["email", "ada@example.com"]]),
            settings: { submitUrls: { contact: "/p/ab12cd34/_pf/forms/contact/submit" } }, showStatus: (m: string) => statuses.push(m), emit: () => true,
        });
        expect(statuses.at(-1)).toContain("troppo lenta"); // page without lang: Italian messages
        expect(form.attributes["aria-busy"]).toBe("false");
        expect(form.attributes["data-pf-state"]).toBe("error");
    });
});
