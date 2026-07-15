import type { FormDefinitionV1, FormFieldV1, ProjectFormSettingsInput, ServiceManifestV1 } from "@andy-code-cat/contracts";
import {
    buildPlatformRuntimePackage,
    injectRuntimeTags,
    stripPlatformRuntimeTags,
} from "../platform-runtime/PlatformRuntimeRegistry";
import type {
    FormRuntimeAdapter,
    FormRuntimeArtifacts,
    FormRuntimeCompileResult,
    FormRuntimeMarkupResult,
    PlatformRuntimeDelivery,
} from "./FormRuntimeAdapter";
export type { FormRuntimeArtifacts, FormRuntimeCompileResult } from "./FormRuntimeAdapter";

const RUNTIME_MARKER = "data-pf-form-runtime=\"service-manifest-v1\"";
const LEGACY_MAILTO_RUNTIME_START = "\n;(() => {\n  const config = {\"version\":\"form-runtime-v1\",\"mode\":\"mailto\",\"recipientEmail\":";
const LEGACY_MAILTO_RUNTIME_FINGERPRINTS = [
    "document.querySelectorAll(\"form[data-pf-form-runtime='service-manifest-v1']\")",
    "form.dataset.pfMounted = \"true\"",
    "window.location.assign(uri)",
] as const;

/**
 * Removes only the complete platform-owned mailto runtime appended by the v1
 * compiler. It deliberately requires the historic header, multiple body
 * fingerprints and an end-of-file closure so generated project code is not
 * modified by a broad text search.
 */
export function stripLegacyConcatenatedMailtoRuntime(js: string): string {
    const start = Math.max(
        js.lastIndexOf(LEGACY_MAILTO_RUNTIME_START),
        js.lastIndexOf(LEGACY_MAILTO_RUNTIME_START.replace(/\n/g, "\r\n")),
    );
    if (start < 0) return js;

    const suffix = js.slice(start);
    if (!suffix.trimEnd().endsWith("})();")) return js;
    if (!LEGACY_MAILTO_RUNTIME_FINGERPRINTS.every((fingerprint) => suffix.includes(fingerprint))) return js;

    return js.slice(0, start).trimEnd();
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    }[character]!));
}

function renderField(field: FormFieldV1, formId: string): string {
    const id = `pf-${formId}-${field.id}`;
    const required = field.required ? " required" : "";
    const describedBy = field.description ? ` aria-describedby='${id}-description'` : "";
    const description = field.description ? `<p id='${id}-description' class='pf-form__description'>${escapeHtml(field.description)}</p>` : "";
    const label = `<label class='pf-form__label' for='${id}'>${escapeHtml(field.label)}${field.required ? " <span aria-hidden='true'>*</span>" : ""}</label>`;
    const attributes = [
        `id='${id}'`, `name='${escapeHtml(field.id)}'`, `data-pf-field='${escapeHtml(field.id)}'`,
        field.autocomplete ? `autocomplete='${escapeHtml(field.autocomplete)}'` : "",
        field.placeholder ? `placeholder='${escapeHtml(field.placeholder)}'` : "",
        field.minLength !== undefined ? `minlength='${field.minLength}'` : "",
        field.maxLength !== undefined ? `maxlength='${field.maxLength}'` : "",
        field.min !== undefined ? `min='${field.min}'` : "",
        field.max !== undefined ? `max='${field.max}'` : "",
        describedBy,
        required,
    ].filter(Boolean).join(" ");

    if (field.type === "hidden_context") {
        return `<input type='hidden' ${attributes} value=''>`;
    }
    if (field.type === "textarea") {
        return `<div class='pf-form__field'>${label}${description}<textarea ${attributes}></textarea></div>`;
    }
    if (field.type === "select") {
        const options = (field.options ?? []).map((option) => `<option value='${escapeHtml(option.value)}'>${escapeHtml(option.label)}</option>`).join("");
        return `<div class='pf-form__field'>${label}${description}<select ${attributes}><option value=''>Seleziona…</option>${options}</select></div>`;
    }
    if (field.type === "radio") {
        const options = (field.options ?? []).map((option, index) => {
            const optionId = `${id}-${index}`;
            return `<label class='pf-form__choice' for='${optionId}'><input id='${optionId}' type='radio' name='${escapeHtml(field.id)}' value='${escapeHtml(option.value)}'${required}> ${escapeHtml(option.label)}</label>`;
        }).join("");
        return `<fieldset class='pf-form__field'><legend>${escapeHtml(field.label)}</legend>${description}${options}</fieldset>`;
    }
    if (field.type === "checkbox") {
        return `<div class='pf-form__field'><label class='pf-form__choice' for='${id}'><input type='checkbox' ${attributes} value='true'> ${escapeHtml(field.label)}</label>${description}</div>`;
    }
    return `<div class='pf-form__field'>${label}${description}<input type='${field.type}' ${attributes}></div>`;
}

function renderForm(form: FormDefinitionV1, settings: ProjectFormSettingsInput): string {
    const steps = form.steps.map((step, index) => {
        const fields = step.fields.map((field) => renderField(field, form.id)).join("");
        const isFirst = index === 0;
        const isLast = index === form.steps.length - 1;
        return `<fieldset class='pf-form__step' data-pf-step='${index}'${isFirst ? "" : " hidden"}>
    <legend>${escapeHtml(step.title)}</legend>
    ${step.description ? `<p class='pf-form__description'>${escapeHtml(step.description)}</p>` : ""}
    ${fields}
    <div class='pf-form__actions'>
      ${isFirst ? "" : "<button type='button' data-pf-back>Indietro</button>"}
      ${isLast ? `<button type='submit'>${escapeHtml(form.submitLabel)}</button>` : "<button type='button' data-pf-next>Continua</button>"}
    </div>
  </fieldset>`;
    }).join("");
    return `<form class='pf-form' ${RUNTIME_MARKER} data-pf-form-id='${escapeHtml(form.id)}' novalidate>
  <h2 class='pf-form__title'>${escapeHtml(form.title)}</h2>
  ${form.description ? `<p class='pf-form__intro'>${escapeHtml(form.description)}</p>` : ""}
  ${form.steps.length > 1 ? `<p class='pf-form__progress' aria-live='polite'>Passaggio <span data-pf-step-current>1</span> di ${form.steps.length}</p>` : ""}
  ${steps}
  <p class='pf-form__privacy'>I dati saranno trattati da ${escapeHtml(settings.privacyNotice.controllerName)} secondo la <a href='${escapeHtml(settings.privacyNotice.url)}' target='_blank' rel='noopener noreferrer'>privacy policy</a>.</p>
  <p class='pf-form__status' aria-live='polite' role='status'></p>
</form>`;
}

const RUNTIME_CSS = `
.pf-form{display:grid;gap:1rem;max-width:42rem}.pf-form__step{display:grid;gap:1rem;border:0;padding:0;margin:0}.pf-form__step[hidden]{display:none}.pf-form__field{display:grid;gap:.4rem}.pf-form__label,.pf-form legend{font-weight:600}.pf-form input,.pf-form select,.pf-form textarea{width:100%;box-sizing:border-box}.pf-form__choice{display:flex;gap:.5rem;align-items:flex-start}.pf-form__choice input{width:auto;margin-top:.25rem}.pf-form__description,.pf-form__privacy,.pf-form__status,.pf-form__progress{margin:0;color:inherit;opacity:.8}.pf-form__actions{display:flex;gap:.75rem}.pf-form__actions button{cursor:pointer}.pf-form__manual-copy{display:grid;gap:.5rem}.pf-form__manual-copy textarea{width:100%;box-sizing:border-box}
`;

function buildPublicConfig(manifest: ServiceManifestV1, settings: ProjectFormSettingsInput): Record<string, unknown> {
    return {
        version: "platform-runtime-config-v1",
        forms: {
            enabled: true,
            mode: "mailto",
            recipientEmail: settings.recipientEmail,
            mailtoMaxUriChars: 1800,
            definitions: manifest.forms.map((form) => ({
                id: form.id,
                title: form.title,
                successMessage: form.successMessage,
                fields: form.steps.flatMap((step) => step.fields).map((field) => ({
                    id: field.id,
                    label: field.label,
                    type: field.type,
                    required: field.required,
                })),
            })),
        },
    };
}

/**
 * Deterministically replaces declared slots with a portable mailto form.
 * It has no network behaviour and is deliberately independent from Express,
 * MongoDB, and React so the same result can be used by preview, publish and ZIP.
 */
function compileMailtoMarkup(
    artifacts: FormRuntimeArtifacts,
    manifest: ServiceManifestV1 | undefined,
    settings: ProjectFormSettingsInput | undefined,
): FormRuntimeMarkupResult {
    if (!manifest || !settings?.enabled) {
        return {
            artifacts: { ...artifacts },
            compiledFormIds: [],
            runtimeModuleIds: [],
            publicConfig: {},
        };
    }
    if (artifacts.html.includes(RUNTIME_MARKER)) {
        return {
            artifacts: { ...artifacts },
            compiledFormIds: manifest.forms.map((form) => form.id),
            runtimeModuleIds: ["forms-mailto"],
            publicConfig: buildPublicConfig(manifest, settings),
        };
    }

    let html = artifacts.html;
    const compiledFormIds: string[] = [];
    for (const form of manifest.forms) {
        const slotSource = `<([a-z][\\w-]*)([^>]*?)data-pf-form-id=['\"]${form.id}['\"]([^>]*)>\\s*</\\1>`;
        const slots = html.match(new RegExp(slotSource, "gi")) ?? [];
        if (slots.length === 0) {
            throw Object.assign(new Error(`Form slot missing for service manifest form '${form.id}'`), { statusCode: 422 });
        }
        if (slots.length > 1) {
            throw Object.assign(new Error(`Form '${form.id}' has multiple slots; form instances are not supported in mailto v1`), { statusCode: 422 });
        }
        html = html.replace(new RegExp(slotSource, "i"), renderForm(form, settings));
        compiledFormIds.push(form.id);
    }

    return {
        artifacts: {
            html,
            css: artifacts.css.includes(".pf-form{")
                ? artifacts.css
                : `${artifacts.css.trim()}\n${RUNTIME_CSS}`.trim(),
            // Generated JavaScript stays byte-separate from platform-owned runtime modules.
            js: artifacts.js,
        },
        compiledFormIds,
        runtimeModuleIds: ["forms-mailto"],
        publicConfig: buildPublicConfig(manifest, settings),
    };
}

export const mailtoFormRuntimeAdapter: FormRuntimeAdapter<ProjectFormSettingsInput> = {
    mode: "mailto",
    compileMarkup: (artifacts, manifest, settings) => compileMailtoMarkup(artifacts, manifest, settings),
};

const FORM_RUNTIME_ADAPTERS: readonly FormRuntimeAdapter[] = [mailtoFormRuntimeAdapter];

/** Selects an explicitly registered platform adapter from owner settings. */
export function compileConfiguredForms(
    artifacts: FormRuntimeArtifacts,
    manifest: ServiceManifestV1 | undefined,
    settings: ProjectFormSettingsInput | undefined,
    options: { delivery?: PlatformRuntimeDelivery } = {},
): FormRuntimeCompileResult {
    if (!settings) return { artifacts: { ...artifacts }, compiledFormIds: [], runtimeFiles: {} };
    const adapter = FORM_RUNTIME_ADAPTERS.find((candidate) => candidate.mode === settings.mode);
    if (!adapter) {
        throw Object.assign(new Error(`Unsupported form runtime mode '${settings.mode}'`), { statusCode: 422 });
    }
    const cleanArtifacts = {
        ...artifacts,
        html: stripPlatformRuntimeTags(artifacts.html),
        js: stripLegacyConcatenatedMailtoRuntime(artifacts.js),
    };
    const markup = adapter.compileMarkup(cleanArtifacts, manifest, settings);
    if (markup.runtimeModuleIds.length === 0) {
        return { artifacts: markup.artifacts, compiledFormIds: markup.compiledFormIds, runtimeFiles: {} };
    }
    const runtime = buildPlatformRuntimePackage({
        moduleIds: markup.runtimeModuleIds,
        publicConfig: markup.publicConfig,
        delivery: options.delivery ?? "inline-preview",
    });
    return {
        artifacts: {
            ...markup.artifacts,
            html: injectRuntimeTags(markup.artifacts.html, runtime.tags),
        },
        compiledFormIds: markup.compiledFormIds,
        runtimePlan: runtime.plan,
        runtimeFiles: runtime.files,
    };
}

export function compileMailtoForms(
    artifacts: FormRuntimeArtifacts,
    manifest: ServiceManifestV1 | undefined,
    settings: ProjectFormSettingsInput | undefined,
    options: { delivery?: PlatformRuntimeDelivery } = {},
): FormRuntimeCompileResult {
    return compileConfiguredForms(artifacts, manifest, settings, options);
}
