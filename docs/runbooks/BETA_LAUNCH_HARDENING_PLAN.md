# Beta Launch Hardening Plan

**Audit date:** 2026-04-15
**Audit author:** Claude Sonnet 4.6 (assistant)
**Recipient:** autonomous implementation agent
**Target branch:** `feat/beta-launch-hardening` (create from `develop`)

---

## 1. Situation

The codebase is functionally complete for a closed beta, but it still has **5 blockers** that prevent a safe external launch and a fully polished English-language experience.

The project is a multi-service AI platform (Next.js 14 + Express API + MongoDB + Redis, fully dockerized) that generates websites through a GrapesJS editor with AI refinement. Frontend stack: App Router, Tailwind CSS 3, shadcn/ui, and react-i18next.

The full audit is documented in `docs/runbooks/PRODUCTION_HARDENING_PLAN.md`.

---

## 2. Mandatory architectural references

Before writing code, read these in order:

1. `AGENTS.md` — non-negotiable rules (layer boundaries, sandboxing, UI primitives)
2. `docs/agents/CODE_AGENT_INDEX.md` — current codebase state
3. `docs/guides/I18N.md` — i18n architecture (`useTranslation` pattern, JSON files, translation keys)
4. `docs/guides/GITFLOW_RELEASE_POLICY.md` — branch governance

### Mandatory UI patterns (from `AGENTS.md`)

- Never use raw `<button>` elements → use `Button` from `@/components/ui/button`
- Never use `style={{...}}` → Tailwind classes only
- Never hardcode colors → use semantic tokens such as `bg-card` and `text-foreground`
- Use `cn()` from `@/lib/utils` for conditional classes
- Do not touch `GrapesJsEditorPanel.tsx`

### Mandatory i18n patterns (from `docs/guides/I18N.md`)

```tsx
// In every React component using "use client":
import { useTranslation } from "react-i18next";
const { t } = useTranslation();
// Usage: {t("workspace.errors.export")}
```

Keys must stay aligned between `apps/web/i18n/en.json` and `apps/web/i18n/it.json`.
Always use the default `translation` namespace and do not create new namespaces without a clear need.

---

## 3. Branch and commit guidance

```bash
git checkout develop
git pull origin develop
git checkout -b feat/beta-launch-hardening
```

Required conventional commits:
- `feat(api): add rate limiting on auth and llm endpoints`
- `fix(i18n): translate hardcoded Italian strings in workspace`
- `fix(api): fix Italian fallback in httpError normalizer`
- `chore(config): update fallback language to English`

---

## 4. Blockers — description and implementation spec

---

### BLOCKER 1 — Missing rate limiting on auth and LLM endpoints

**File to edit:** `apps/api/src/app.ts`

**Problem:** no rate limiting. `/v1/auth/register`, `/v1/auth/login` and LLM endpoints
are exposed to brute force, credential stuffing, and token abuse.

**Dependencies to install:**

```bash
npm install express-rate-limit -w apps/api
```

**Implementation spec:**

In `apps/api/src/app.ts`, after `app.use(express.json(...))` and before the routes,
add three separate limiters:

```typescript
import rateLimit from "express-rate-limit";

// Limiter 1 — auth: 10 attempts per 15 minutes per IP
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: "RATE_LIMITED", userMessage: "Too many attempts. Please try again later." },
});

// Limiter 2 — LLM: 30 requests per minute per IP (token exhaustion protection)
const llmRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: "RATE_LIMITED", userMessage: "Too many requests. Please slow down." },
});

// Limiter 3 — global: 200 req/min per IP (light DDoS protection)
const globalRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});
```

Apply **before** the routes, in the correct order:

```typescript
app.use(globalRateLimiter);                         // globale
app.use("/v1/auth", authRateLimiter);               // specifico auth
app.use("/v1/llm", llmRateLimiter);                 // specifico LLM
app.use("/v1/generation-workspace", llmRateLimiter); // generazione
```

`app.set("trust proxy", 1)` is already present at line 27 — do not remove it (required to read
the real IP behind nginx).

---

### BLOCKER 2 — Italian fallback (with typo) in httpError.ts

**File to edit:** `apps/api/src/presentation/http/errors/httpError.ts`

**Problem:** line 75 returns `"Si e verificato un errore inatteso."` (Italian, typo: missing `è`)
as the `userMessage` for all unclassified errors. This reaches the user's browser.

**Targeted change:**

```typescript
// PRIMA (riga 71-76):
return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Unexpected error",
    userMessage: "Si e verificato un errore inatteso.",
};

// DOPO:
return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "Unexpected error",
    userMessage: "An unexpected error occurred.",
};
```

Also at line 54, Zod validation returns an Italian message:

```typescript
// PRIMA (riga 54):
userMessage: "Alcuni campi della richiesta non sono validi.",

// DOPO:
userMessage: "Some request fields are invalid.",
```

---

### BLOCKER 3 — Italian fallbackLng in i18n.ts

**File to edit:** `apps/web/lib/i18n.ts`

**Problem:** line 16 sets `fallbackLng: "it"`. An English-speaking user without `localStorage["andy_lang"]`
sees the interface in Italian on first visit.

**Targeted change:**

```typescript
// PRIMA (riga 16):
fallbackLng: "it",

// DOPO:
fallbackLng: "en",
```

---

### BLOCKER 4 — 16 hardcoded Italian strings in the workspace (main file)

**File to edit:** `apps/web/app/workspace/[projectId]/page.tsx`

**Problem:** the workspace (most-used page of the platform) contains hardcoded Italian strings
that do not respond to language changes. They are used in:
- catch block fallbacks (`.message ?? "Errore X"`)
- notifications (`updateNotification(..., { message: "Stringa" })`)
- button labels in loading/saving state
- `title` attributes

**Step 1 — Add keys to i18n files**

Aggiungere il seguente blocco a `apps/web/i18n/it.json`, in coda al JSON esistente
(prima della chiusura `}`):

```json
"workspace": {
    "errors": {
        "export": "Errore export",
        "capture": "Errore cattura",
        "publish": "Errore pubblicazione",
        "loadConversation": "Errore caricamento conversazione",
        "llm": "Errore LLM",
        "providerCall": "Errore durante la chiamata al provider",
        "providerMissing": "Provider non configurato",
        "copy": "Errore"
    },
    "notifications": {
        "zipDownloaded": "ZIP scaricato",
        "sessionExpired": "Sessione scaduta"
    },
    "actions": {
        "loading": "Caricamento…",
        "saving": "Salvataggio…",
        "save": "Salva versione",
        "reload": "↻ Ricarica"
    }
}
```

Aggiungere il seguente blocco a `apps/web/i18n/en.json`:

```json
"workspace": {
    "errors": {
        "export": "Export error",
        "capture": "Capture error",
        "publish": "Publish error",
        "loadConversation": "Error loading conversation",
        "llm": "LLM error",
        "providerCall": "Error calling the provider",
        "providerMissing": "Provider not configured",
        "copy": "Error"
    },
    "notifications": {
        "zipDownloaded": "ZIP downloaded",
        "sessionExpired": "Session expired"
    },
    "actions": {
        "loading": "Loading…",
        "saving": "Saving…",
        "save": "Save version",
        "reload": "↻ Reload"
    }
}
```

**Step 2 — Replace hardcoded strings in the component**

The workspace component is already a `"use client"`. Verify that `useTranslation` is already
imported and the hook `const { t } = useTranslation();` is already declared in the component body.
If not, add it near the other hooks.

Targeted replacements (use the line number as a reference to locate context,
but verify context before editing since lines may have shifted):

| Riga approx. | Stringa attuale | Sostituzione |
|---|---|---|
| 308 | `"ZIP scaricato"` | `t("workspace.notifications.zipDownloaded")` |
| 314 | `"Sessione scaduta"` (catch export) | `t("workspace.notifications.sessionExpired")` |
| 317 | `"Errore export"` (fallback catch) | `t("workspace.errors.export")` |
| 364 | `"Sessione scaduta"` (catch cattura) | `t("workspace.notifications.sessionExpired")` |
| 367 | `"Errore cattura"` | `t("workspace.errors.capture")` |
| 444 | `"Sessione scaduta"` (catch publish) | `t("workspace.notifications.sessionExpired")` |
| 448 | `"Errore pubblicazione"` | `t("workspace.errors.publish")` |
| 575 | `"Errore caricamento conversazione"` | `t("workspace.errors.loadConversation")` |
| 955 | `label: "Errore LLM"` | `label: t("workspace.errors.llm")` |
| 968 | `"Errore durante la chiamata al provider"` | `t("workspace.errors.providerCall")` |
| 972 | `"Provider non configurato"` | `t("workspace.errors.providerMissing")` |
| 972 | `"Errore LLM"` (secondo ramo) | `t("workspace.errors.llm")` |
| 1901 | `"Errore export"` (title attr) | `t("workspace.errors.export")` |
| 2384 | `"Caricamento…"` (bottone reload) | `t("workspace.actions.loading")` / `t("workspace.actions.reload")` |
| 3157 | `"Salvataggio…"` (bottone save) | `isSaving ? t("workspace.actions.saving") : t("workspace.actions.save")` |
| 3499 | `"Errore"` (copy label) | `t("workspace.errors.copy")` |

**Critical note:** strings in catch blocks are passed to `updateNotification` as
`message`, or to `setError`. In both cases they must be plain strings, not JSX.
Since `t()` returns a string when called outside JSX, the replacement is direct.

---

### BLOCKER 5 — Hardcoded Italian string in ProjectConfigPopup.tsx

**File to edit:** `apps/web/components/ProjectConfigPopup.tsx`

**Problem:** line 590 has `"Salvataggio…"` hardcoded in the button text.

**Step 1 — Add i18n keys** (if not already done in BLOCKER 4)

The keys `workspace.actions.saving` and `workspace.actions.save` are already defined
in BLOCKER 4. Do not add duplicate keys.

**Step 2 — Edit the component**

```tsx
// Aggiungere in cima al componente (se non presente):
import { useTranslation } from "react-i18next";
// Nel corpo del componente:
const { t } = useTranslation();

// PRIMA (riga 590):
{saving ? "Salvataggio…" : "Salva"}

// DOPO:
{saving ? t("workspace.actions.saving") : t("workspace.actions.save")}
```

---

## 5. Recommended parallelization

The 5 blockers are **independent of each other** and can be executed in parallel
on separate tracks, or sequentially in the same session.

```
TRACK A — API (apps/api/)
├── BLOCKER 1: rate limiting in app.ts
└── BLOCKER 2: fix httpError.ts (2 stringhe, 2 righe)

TRACK B — Frontend i18n (apps/web/)
├── BLOCKER 3: fallbackLng in lib/i18n.ts (1 riga)
├── BLOCKER 4: chiavi JSON + sostituzioni workspace page (~18 modifiche)
└── BLOCKER 5: ProjectConfigPopup.tsx (import hook + 1 sostituzione)
```

TRACK A and TRACK B do not share files — they can proceed in parallel without conflicts.

Within TRACK B, execute in order:
1. First add the JSON keys (BLOCKER 4 Step 1) — prerequisite for the replacements
2. Then BLOCKER 3 (1 line, independent)
3. Then BLOCKER 4 Step 2 (workspace replacements)
4. Then BLOCKER 5 (depends on JSON keys already added)

---

## 6. Post-implementation verification

### TRACK A

```bash
# Start the server in dev
docker ps --format '{{.Names}}'
# Then manual test with curl:
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"wrong"}'; done
# Should return 429 after 10 attempts
```

```bash
# Verify that httpError.ts no longer has Italian strings:
grep -n "italiano\|Si e\|campi della" apps/api/src/presentation/http/errors/httpError.ts
# Should return empty
```

### TRACK B

```bash
# Search for remaining Italian strings in modified files:
grep -n '"Errore\|"Caricamento\|"Salvataggio\|"ZIP scaricato\|"Sessione scaduta' \
  apps/web/app/workspace/\[projectId\]/page.tsx \
  apps/web/components/ProjectConfigPopup.tsx
# Should return empty

# Verify that keys are present in both JSON files:
node -e "
  const en = require('./apps/web/i18n/en.json');
  const it = require('./apps/web/i18n/it.json');
  console.log('EN workspace keys:', Object.keys(en.workspace || {}));
  console.log('IT workspace keys:', Object.keys(it.workspace || {}));
"
```

```bash
# Visual language-switch test (if app is running):
# 1. Open browser at localhost:3000
# 2. F12 > Console: localStorage.setItem('andy_lang', 'en'); location.reload();
# 3. Navigate to workspace — verify all buttons and messages are in English
# 4. Force an error (disconnect API) — verify the error message is in English
```

---

## 7. Out of scope for this plan

The following items were identified in the audit but **are not part of this plan**
because they require external infrastructure or product decisions:

| Item | Reason for exclusion |
|---|---|
| Email verification (`AUTH_BYPASS_EMAIL_VERIFICATION=false`) | Requires a configured email provider (Resend/SendGrid) |
| CORS restricted to real domain | Requires a defined production domain |
| nginx `limit_req` for DDoS | Deploy infrastructure, not application code |
| Request timeout middleware | To be evaluated alongside LLM streaming strategy |

These blockers remain open and must be addressed before public deployment.

---

## 8. Files to update after completion

After all changes are done, update:

1. `docs/INDEX.md` — no structural changes, no update needed
2. `docs/runbooks/TESTABLE_STEPS.md` — add a step for the rate limiting test
3. `docs/guides/I18N.md` — update the "Components covered" table by adding:
   - `workspace/[projectId]/page.tsx` → `workspace.*`
   - `components/ProjectConfigPopup.tsx` → `workspace.actions.*`
   And remove these two entries from the "Components excluded (by design)" section.

---

*Plan generated on 2026-04-15. Verify with `git log` that no subsequent commit has already
partially resolved these blockers before starting implementation.*
