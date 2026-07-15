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
