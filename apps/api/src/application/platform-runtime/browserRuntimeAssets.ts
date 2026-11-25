export const PF_RUNTIME_CORE_V1 = String.raw`;(() => {
  const existing = window.PageForgeRuntime;
  if (existing && existing.version === "runtime-core-v1") return;
  const modules = new Map();
  const adapters = new Map();
  let config = {};
  let booted = false;
  const runtime = {
    version: "runtime-core-v1",
    configure(next) { config = Object.freeze(Object.assign({}, next || {})); },
    getConfig() { return config; },
    registerModule(module) {
      if (!module || typeof module.id !== "string" || typeof module.mount !== "function") return;
      modules.set(module.id, module);
      if (booted) module.mount(runtime);
    },
    registerAdapter(mode, adapter) {
      if (typeof mode === "string" && adapter && typeof adapter.deliver === "function") adapters.set(mode, adapter);
    },
    getAdapter(mode) { return adapters.get(mode); },
    emit(name, detail, cancelable) {
      return document.dispatchEvent(new CustomEvent(name, {
        detail: Object.freeze(Object.assign({ version: "pf-event-v1" }, detail || {})),
        cancelable: Boolean(cancelable),
      }));
    },
    boot() {
      if (booted) return;
      booted = true;
      modules.forEach((module) => module.mount(runtime));
    },
  };
  window.PageForgeRuntime = runtime;
  const boot = () => runtime.boot();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else window.setTimeout(boot, 0);
})();`;

export const PF_FORMS_UI_V1 = String.raw`;(() => {
  const runtime = window.PageForgeRuntime;
  if (!runtime) return;
  const showStatus = (form, message) => {
    const node = form.querySelector(".pf-form__status");
    if (node) node.textContent = message;
  };
  runtime.registerModule({
    id: "forms-ui",
    mount(core) {
      const config = core.getConfig();
      const formsConfig = config.forms;
      if (!formsConfig || !formsConfig.enabled) return;
      document.querySelectorAll("form[data-pf-form-runtime='service-manifest-v1']").forEach((form) => {
        if (form.dataset.pfMounted === "true") return;
        const definition = formsConfig.definitions.find((item) => item.id === form.dataset.pfFormId);
        const adapter = core.getAdapter(formsConfig.mode);
        if (!definition || !adapter) {
          showStatus(form, "Il servizio del modulo non è disponibile.");
          return;
        }
        form.dataset.pfMounted = "true";
        const steps = Array.from(form.querySelectorAll("[data-pf-step]"));
        let currentStep = 0;
        const showStep = (index) => {
          currentStep = Math.max(0, Math.min(index, steps.length - 1));
          steps.forEach((step, stepIndex) => { step.hidden = stepIndex !== currentStep; });
          const progress = form.querySelector("[data-pf-step-current]");
          if (progress) progress.textContent = String(currentStep + 1);
        };
        const validateStep = () => {
          const fields = Array.from((steps[currentStep] && steps[currentStep].querySelectorAll("input, select, textarea")) || []);
          const invalid = fields.find((field) => !field.checkValidity());
          if (invalid) {
            invalid.reportValidity();
            showStatus(form, "Completa i campi obbligatori prima di continuare.");
            return false;
          }
          showStatus(form, "");
          return true;
        };
        form.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest("[data-pf-next]")) {
            if (validateStep()) showStep(currentStep + 1);
          } else if (target.closest("[data-pf-back]")) {
            showStep(currentStep - 1);
          }
        });
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          if (!validateStep() || !form.checkValidity()) {
            form.reportValidity();
            return;
          }
          Promise.resolve(adapter.deliver({
            form,
            definition,
            values: new FormData(form),
            settings: formsConfig,
            showStatus: (message) => showStatus(form, message),
            emit: core.emit,
          })).catch(() => showStatus(form, "Non è stato possibile preparare la bozza. Copia i dati manualmente."));
        });
        showStep(0);
        core.emit("pf:form-mounted", { formId: definition.id, mode: formsConfig.mode }, false);
      });
    },
  });
})();`;

export const PF_FORMS_MAILTO_V1 = String.raw`;(() => {
  const runtime = window.PageForgeRuntime;
  if (!runtime) return;
  const encodeHeader = (value) => encodeURIComponent(String(value).replace(/[\r\n]+/g, " ").trim());
  const encodeBody = (value) => encodeURIComponent(String(value).replace(/\r?\n/g, "\r\n"));
  const renderManualCopy = (form, body) => {
    let box = form.querySelector("[data-pf-manual-copy]");
    if (!box) {
      box = document.createElement("div");
      box.className = "pf-form__manual-copy";
      box.setAttribute("data-pf-manual-copy", "true");
      const label = document.createElement("p");
      label.textContent = "Copia questo riepilogo nella tua app email:";
      const textarea = document.createElement("textarea");
      textarea.readOnly = true;
      textarea.rows = 8;
      box.append(label, textarea);
      form.append(box);
    }
    const textarea = box.querySelector("textarea");
    if (textarea) {
      textarea.value = body;
      textarea.focus();
      textarea.select();
    }
  };
  runtime.registerAdapter("mailto", {
    async deliver(context) {
      const definition = context.definition;
      const lines = definition.fields.map((field) => {
        const raw = field.type === "checkbox"
          ? (context.values.has(field.id) ? "Sì" : "No")
          : (context.values.get(field.id) || "");
        const value = String(raw).trim();
        return value ? field.label + ": " + value : "";
      }).filter(Boolean);
      const body = lines.join("\r\n");
      const uri = "mailto:" + context.settings.recipientEmail
        + "?subject=" + encodeHeader(definition.title)
        + "&body=" + encodeBody(body);
      const maxChars = context.settings.mailtoMaxUriChars || 1800;
      if (uri.length > maxChars) {
        let copied = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(body);
            copied = true;
          }
        } catch (_) {
          copied = false;
        }
        if (copied) context.showStatus("Il riepilogo è stato copiato. Incollalo nella tua app email.");
        else {
          renderManualCopy(context.form, body);
          context.showStatus("Il riepilogo è troppo lungo per aprire una bozza affidabile. Copialo manualmente.");
        }
        context.emit("pf:mailto-fallback", {
          formId: definition.id,
          mode: "mailto",
          reason: "uri-too-long",
          copyStatus: copied ? "copied" : "manual",
          uriLength: uri.length,
        }, false);
        return;
      }
      context.showStatus("Richiesta di apertura della bozza inviata. Verifica la tua app email prima di inviare.");
      const shouldOpen = context.emit("pf:mailto", {
        formId: definition.id,
        mode: "mailto",
        status: "draft-requested",
        uriLength: uri.length,
      }, true);
      if (shouldOpen) window.location.assign(uri);
    },
  });
})();`;

/**
 * Capture adapter: posts the declared fields, as JSON, to the same-origin submit path the platform
 * wrote into the runtime config at publish time (`/p/{publishId}/_pf/forms/{formId}/submit`).
 * Preview and ZIP have no backend and no submit URL: the form then says so and sends nothing —
 * it never pretends to have saved. Events carry ids and outcomes, never submitted values.
 */
export const PF_FORMS_CAPTURE_V1 = String.raw`;(() => {
  const runtime = window.PageForgeRuntime;
  if (!runtime) return;
  const italian = String(document.documentElement.lang || "it").toLowerCase().indexOf("it") === 0;
  const MESSAGES = italian ? {
    unavailable: "Questo modulo salva i dati solo sul sito pubblicato. In anteprima e nell'export ZIP l'invio non è attivo: nessun dato è stato inviato.",
    sending: "Invio in corso…",
    success: "Grazie, il modulo è stato inviato.",
    invalid: "Alcuni campi non sono validi. Controlla i campi evidenziati e riprova.",
    rateLimited: "Troppi invii in poco tempo. Attendi qualche minuto e riprova.",
    failed: "Invio non riuscito: i dati non sono stati salvati. Riprova più tardi.",
  } : {
    unavailable: "This form saves data only on the published site. In preview and in the ZIP export sending is disabled: nothing was sent.",
    sending: "Sending…",
    success: "Thank you, the form has been sent.",
    invalid: "Some fields are not valid. Check the highlighted fields and try again.",
    rateLimited: "Too many submissions in a short time. Wait a few minutes and try again.",
    failed: "Sending failed: your data was not saved. Please try again later.",
  };
  const setState = (form, state) => { form.setAttribute("data-pf-state", state); };
  const setBusy = (form, busy) => {
    form.setAttribute("aria-busy", busy ? "true" : "false");
    form.querySelectorAll("button[type='submit']").forEach((button) => { button.disabled = busy; });
  };
  const clearInvalid = (form) => {
    form.querySelectorAll("[aria-invalid='true']").forEach((node) => node.removeAttribute("aria-invalid"));
  };
  const markInvalid = (form, issues) => {
    let first = null;
    (Array.isArray(issues) ? issues : []).forEach((issue) => {
      if (!issue || typeof issue.field !== "string" || !/^[a-z0-9-]+$/.test(issue.field)) return;
      form.querySelectorAll("[name='" + issue.field + "']").forEach((node) => {
        node.setAttribute("aria-invalid", "true");
        if (!first && !node.closest("[hidden]")) first = node;
      });
    });
    if (first && typeof first.focus === "function") first.focus();
  };
  // Without a submit URL (preview, ZIP) the notice is shown up front, not only after a click.
  runtime.registerModule({
    id: "forms-capture",
    mount(core) {
      const formsConfig = core.getConfig().forms;
      if (!formsConfig || formsConfig.mode !== "capture" || formsConfig.submitUrls) return;
      document.querySelectorAll("form[data-pf-form-runtime='service-manifest-v1']").forEach((form) => {
        setState(form, "unavailable");
        const status = form.querySelector(".pf-form__status");
        if (status) status.textContent = MESSAGES.unavailable;
      });
    },
  });
  runtime.registerAdapter("capture", {
    async deliver(context) {
      const form = context.form;
      const definition = context.definition;
      const emit = (status, extra) => context.emit("pf:form-capture", Object.assign({ formId: definition.id, mode: "capture", status: status }, extra || {}), false);
      try {
        const urls = context.settings.submitUrls;
        const url = urls && typeof urls === "object" ? urls[definition.id] : undefined;
        if (typeof url !== "string" || url.indexOf("/p/") !== 0) {
          setState(form, "unavailable");
          context.showStatus(MESSAGES.unavailable);
          emit("unavailable");
          return;
        }
        if (form.getAttribute("aria-busy") === "true") return;
        clearInvalid(form);
        const fields = {};
        definition.fields.forEach((field) => {
          if (field.type === "checkbox") {
            fields[field.id] = context.values.has(field.id);
            return;
          }
          const raw = context.values.get(field.id);
          if (typeof raw === "string" && raw.trim() !== "") fields[field.id] = raw;
        });
        const body = { fields: fields };
        const honeypot = context.values.get("pf_hp");
        if (typeof honeypot === "string" && honeypot !== "") body.hp = honeypot;

        setBusy(form, true);
        setState(form, "sending");
        context.showStatus(MESSAGES.sending);
        let response = null;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(body),
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
          });
        } catch (_) {
          response = null;
        }
        setBusy(form, false);

        if (response && (response.status === 201 || response.status === 202)) {
          form.reset();
          setState(form, "success");
          context.showStatus(definition.successMessage || MESSAGES.success);
          emit("stored");
          return;
        }
        setState(form, "error");
        if (response && response.status === 400) {
          let payload = null;
          try { payload = await response.json(); } catch (_) { payload = null; }
          markInvalid(form, payload && payload.issues);
          context.showStatus(MESSAGES.invalid);
        } else if (response && response.status === 429) {
          context.showStatus(MESSAGES.rateLimited);
        } else {
          context.showStatus(MESSAGES.failed);
        }
        emit("failed", { httpStatus: response ? response.status : 0 });
      } catch (_) {
        setBusy(form, false);
        setState(form, "error");
        context.showStatus(MESSAGES.failed);
        emit("failed", { httpStatus: 0 });
      }
    },
  });
})();`;
