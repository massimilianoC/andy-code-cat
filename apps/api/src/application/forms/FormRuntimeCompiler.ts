import type { FormDefinitionV1, FormFieldV1, ProjectFormSettingsInput, ServiceManifestV1 } from "@andy-code-cat/contracts";

export interface FormRuntimeArtifacts {
    html: string;
    css: string;
    js: string;
}

export interface FormRuntimeCompileResult {
    artifacts: FormRuntimeArtifacts;
    compiledFormIds: string[];
}

const RUNTIME_MARKER = "data-pf-form-runtime=\"service-manifest-v1\"";

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
    const fields = form.steps.flatMap((step) => step.fields).map((field) => renderField(field, form.id)).join("");
    return `<form class='pf-form' ${RUNTIME_MARKER} data-pf-form-id='${escapeHtml(form.id)}' novalidate>
  <h2 class='pf-form__title'>${escapeHtml(form.title)}</h2>
  ${form.description ? `<p class='pf-form__intro'>${escapeHtml(form.description)}</p>` : ""}
  ${fields}
  <p class='pf-form__privacy'>I dati saranno trattati da ${escapeHtml(settings.privacyNotice.controllerName)} secondo la <a href='${escapeHtml(settings.privacyNotice.url)}' target='_blank' rel='noopener noreferrer'>privacy policy</a>.</p>
  <div class='pf-form__actions'><button type='submit'>${escapeHtml(form.submitLabel)}</button></div>
  <p class='pf-form__status' aria-live='polite' role='status'></p>
</form>`;
}

function runtimeConfig(manifest: ServiceManifestV1, settings: ProjectFormSettingsInput): string {
    return JSON.stringify({
        version: "form-runtime-v1",
        mode: "mailto",
        recipientEmail: settings.recipientEmail,
        forms: manifest.forms.map((form) => ({
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
    }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function mailtoRuntime(config: string): string {
    return `\n;(() => {
  const config = ${config};
  const encode = (value) => encodeURIComponent(String(value).replace(/[\\r\\n]+/g, " "));
  const showStatus = (form, message) => { const node = form.querySelector(".pf-form__status"); if (node) node.textContent = message; };
  document.querySelectorAll("form[data-pf-form-runtime='service-manifest-v1']").forEach((form) => {
    if (form.dataset.pfMounted === "true") return;
    form.dataset.pfMounted = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const definition = config.forms.find((item) => item.id === form.dataset.pfFormId);
      if (!definition) return;
      const values = new FormData(form);
      const lines = definition.fields.map((field) => {
        const raw = field.type === "checkbox"
          ? (form.querySelector("[name='" + CSS.escape(field.id) + "']")?.checked ? "Sì" : "No")
          : (values.get(field.id) || "");
        return field.label + ": " + String(raw).trim();
      }).filter((line) => !line.endsWith(": "));
      const body = lines.join("\\n");
      const uri = "mailto:" + encode(config.recipientEmail) + "?subject=" + encode(definition.title) + "&body=" + encode(body);
      if (uri.length > 1800) {
        navigator.clipboard?.writeText(body).catch(() => undefined);
        showStatus(form, "Il riepilogo è stato copiato. Apri la tua app email e incollalo nel messaggio.");
        return;
      }
      window.location.assign(uri);
      showStatus(form, "La bozza è stata aperta. Verifica e invia dalla tua app email.");
    });
  });
})();`;
}

const RUNTIME_CSS = `
.pf-form{display:grid;gap:1rem;max-width:42rem}.pf-form__field{display:grid;gap:.4rem}.pf-form__label,.pf-form legend{font-weight:600}.pf-form input,.pf-form select,.pf-form textarea{width:100%;box-sizing:border-box}.pf-form__choice{display:flex;gap:.5rem;align-items:flex-start}.pf-form__choice input{width:auto;margin-top:.25rem}.pf-form__description,.pf-form__privacy,.pf-form__status{margin:0;color:inherit;opacity:.8}.pf-form__actions button{cursor:pointer}
`;

/**
 * Deterministically replaces declared slots with a portable mailto form.
 * It has no network behaviour and is deliberately independent from Express,
 * MongoDB, and React so the same result can be used by preview, publish and ZIP.
 */
export function compileMailtoForms(
    artifacts: FormRuntimeArtifacts,
    manifest: ServiceManifestV1 | undefined,
    settings: ProjectFormSettingsInput | undefined,
): FormRuntimeCompileResult {
    if (!manifest || !settings?.enabled) {
        return { artifacts: { ...artifacts }, compiledFormIds: [] };
    }
    if (artifacts.html.includes(RUNTIME_MARKER)) {
        return { artifacts: { ...artifacts }, compiledFormIds: manifest.forms.map((form) => form.id) };
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
            css: `${artifacts.css.trim()}\n${RUNTIME_CSS}`.trim(),
            js: `${artifacts.js.trim()}\n${mailtoRuntime(runtimeConfig(manifest, settings))}`.trim(),
        },
        compiledFormIds,
    };
}
