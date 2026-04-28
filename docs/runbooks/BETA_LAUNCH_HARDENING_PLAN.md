# Beta Launch Hardening Plan

**Data redazione:** 2026-04-15
**Autore audit:** Claude Sonnet 4.6 (assistente)
**Destinatario:** agente di implementazione autonomo
**Branch target:** `feat/beta-launch-hardening` (da creare da `develop`)

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

Conventional commits richiesti:
- `feat(api): add rate limiting on auth and llm endpoints`
- `fix(i18n): translate hardcoded Italian strings in workspace`
- `fix(api): fix Italian fallback in httpError normalizer`
- `chore(config): update fallback language to English`

---

## 4. Blockers — descrizione e spec di implementazione

---

### BLOCKER 1 — Rate limiting mancante sugli endpoint auth e LLM

**File da modificare:** `apps/api/src/app.ts`

**Problema:** nessun rate limiting. `/v1/auth/register`, `/v1/auth/login` e gli endpoint LLM
sono esposti a brute force, credential stuffing e abuso di token.

**Dipendenze da installare:**

```bash
npm install express-rate-limit -w apps/api
```

**Spec di implementazione:**

In `apps/api/src/app.ts`, dopo `app.use(express.json(...))` e prima delle route,
aggiungere tre limitatori distinti:

```typescript
import rateLimit from "express-rate-limit";

// Limiter 1 — auth: 10 tentativi ogni 15 minuti per IP
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: "RATE_LIMITED", userMessage: "Too many attempts. Please try again later." },
});

// Limiter 2 — LLM: 30 richieste al minuto per IP (protezione token exhaustion)
const llmRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: "RATE_LIMITED", userMessage: "Too many requests. Please slow down." },
});

// Limiter 3 — generale: 200 req/min per IP (protezione DDoS leggera)
const globalRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});
```

Applicare **prima** delle route, nell'ordine corretto:

```typescript
app.use(globalRateLimiter);                         // globale
app.use("/v1/auth", authRateLimiter);               // specifico auth
app.use("/v1/llm", llmRateLimiter);                 // specifico LLM
app.use("/v1/generation-workspace", llmRateLimiter); // generazione
```

`app.set("trust proxy", 1)` è già presente a riga 27 — non rimuoverlo (necessario per
leggere l'IP reale dietro nginx).

---

### BLOCKER 2 — Fallback italiano (con typo) in httpError.ts

**File da modificare:** `apps/api/src/presentation/http/errors/httpError.ts`

**Problema:** riga 75 restituisce `"Si e verificato un errore inatteso."` (italiano, typo: manca `è`)
come `userMessage` per tutti gli errori non classificati. Raggiunge il browser dell'utente.

**Modifica puntuale:**

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

Anche alla riga 54, la validazione Zod restituisce un messaggio in italiano:

```typescript
// PRIMA (riga 54):
userMessage: "Alcuni campi della richiesta non sono validi.",

// DOPO:
userMessage: "Some request fields are invalid.",
```

---

### BLOCKER 3 — fallbackLng italiano in i18n.ts

**File da modificare:** `apps/web/lib/i18n.ts`

**Problema:** riga 16 imposta `fallbackLng: "it"`. Un utente anglofono senza `localStorage["andy_lang"]`
vede l'interfaccia in italiano alla prima visita.

**Modifica puntuale:**

```typescript
// PRIMA (riga 16):
fallbackLng: "it",

// DOPO:
fallbackLng: "en",
```

---

### BLOCKER 4 — 16 stringhe italiane hardcoded nel workspace (file principale)

**File da modificare:** `apps/web/app/workspace/[projectId]/page.tsx`

**Problema:** il workspace (pagina più usata della piattaforma) contiene stringhe italiane
hardcoded che non rispondono al cambio lingua. Sono stringhe usate in:
- fallback di catch block (`.message ?? "Errore X"`)
- notifiche (`updateNotification(..., { message: "Stringa" })`)
- label di bottoni in stato loading/saving
- attributi `title`

**Step 1 — Aggiungere le chiavi ai file i18n**

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

**Step 2 — Sostituire le stringhe hardcoded nel componente**

Il componente workspace è già un `"use client"`. Verificare che `useTranslation` sia già
importato e il hook `const { t } = useTranslation();` sia già dichiarato nel corpo del componente.
Se non c'è, aggiungerlo vicino agli altri hook.

Sostituzioni puntuali (usare il numero di riga come riferimento per individuare il contesto,
ma verificare il contesto prima di editare perché le righe potrebbero essere slittate):

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

**Nota critica:** le stringhe nei catch block vengono passate a `updateNotification` come
`message`, oppure a `setError`. In entrambi i casi devono essere string calcolate, non JSX.
Poiché `t()` ritorna una string quando chiamato fuori da JSX, la sostituzione è diretta.

---

### BLOCKER 5 — Stringa italiana hardcoded in ProjectConfigPopup.tsx

**File da modificare:** `apps/web/components/ProjectConfigPopup.tsx`

**Problema:** riga 590 ha `"Salvataggio…"` hardcoded nel testo del bottone.

**Step 1 — Aggiungere chiavi i18n** (se non già fatto nel BLOCKER 4)

Le chiavi `workspace.actions.saving` e `workspace.actions.save` sono già definite
nel BLOCKER 4. Non aggiungere chiavi duplicate.

**Step 2 — Modificare il componente**

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

## 5. Parallelizzazione consigliata

I 5 blockers sono **indipendenti tra loro** e possono essere eseguiti in parallelo
su track separate, oppure in sequenza nella stessa sessione.

```
TRACK A — API (apps/api/)
├── BLOCKER 1: rate limiting in app.ts
└── BLOCKER 2: fix httpError.ts (2 stringhe, 2 righe)

TRACK B — Frontend i18n (apps/web/)
├── BLOCKER 3: fallbackLng in lib/i18n.ts (1 riga)
├── BLOCKER 4: chiavi JSON + sostituzioni workspace page (~18 modifiche)
└── BLOCKER 5: ProjectConfigPopup.tsx (import hook + 1 sostituzione)
```

TRACK A e TRACK B non condividono file — possono procedere in parallelo senza conflitti.

All'interno di TRACK B, eseguire in ordine:
1. Prima aggiungere le chiavi JSON (BLOCKER 4 Step 1) — prerequisito per le sostituzioni
2. Poi BLOCKER 3 (1 riga, indipendente)
3. Poi BLOCKER 4 Step 2 (sostituzioni workspace)
4. Poi BLOCKER 5 (dipende dalle chiavi JSON già aggiunte)

---

## 6. Verifiche dopo implementazione

### TRACK A

```bash
# Avviare il server in dev
docker ps --format '{{.Names}}'
# Poi test manuale con curl:
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"wrong"}'; done
# Deve restituire 429 dopo 10 tentativi
```

```bash
# Verificare che httpError.ts non abbia più stringhe italiane:
grep -n "italiano\|Si e\|campi della" apps/api/src/presentation/http/errors/httpError.ts
# Deve restituire vuoto
```

### TRACK B

```bash
# Cercare stringhe italiane rimanenti nei file modificati:
grep -n '"Errore\|"Caricamento\|"Salvataggio\|"ZIP scaricato\|"Sessione scaduta' \
  apps/web/app/workspace/\[projectId\]/page.tsx \
  apps/web/components/ProjectConfigPopup.tsx
# Deve restituire vuoto

# Verificare che le chiavi siano presenti in entrambi i file JSON:
node -e "
  const en = require('./apps/web/i18n/en.json');
  const it = require('./apps/web/i18n/it.json');
  console.log('EN workspace keys:', Object.keys(en.workspace || {}));
  console.log('IT workspace keys:', Object.keys(it.workspace || {}));
"
```

```bash
# Test visivo cambio lingua (se app in esecuzione):
# 1. Aprire il browser su localhost:3000
# 2. F12 > Console: localStorage.setItem('andy_lang', 'en'); location.reload();
# 3. Navigare al workspace — verificare che tutti i bottoni e messaggi siano in inglese
# 4. Forzare un errore (disconnettere API) — verificare che il messaggio di errore sia in inglese
```

---

## 7. Fuori scope per questo piano

I seguenti item sono stati identificati nell'audit ma **non fanno parte di questo piano**
perché richiedono infrastruttura esterna o decisioni di prodotto:

| Item | Motivo esclusione |
|---|---|
| Email verification (`AUTH_BYPASS_EMAIL_VERIFICATION=false`) | Richiede provider email (Resend/SendGrid) configurato |
| CORS ristretto al dominio reale | Richiede dominio di produzione definito |
| nginx `limit_req` per DDoS | Infrastruttura deploy, non codice applicativo |
| Request timeout middleware | Da valutare insieme a strategia LLM streaming |

Questi blockers rimangono aperti e devono essere gestiti prima del deploy pubblico.

---

## 8. File da aggiornare a fine lavoro

Dopo aver completato tutte le modifiche, aggiornare:

1. `docs/INDEX.md` — nessuna modifica strutturale, nessun aggiornamento necessario
2. `docs/runbooks/TESTABLE_STEPS.md` — aggiungere step per rate limiting test
3. `docs/guides/I18N.md` — aggiornare la tabella "Componenti coperti" aggiungendo:
   - `workspace/[projectId]/page.tsx` → `workspace.*`
   - `components/ProjectConfigPopup.tsx` → `workspace.actions.*`
   E rimuovere dalla sezione "Componenti esclusi (by design)" queste due voci.

---

*Piano generato il 2026-04-15. Verificare con `git log` che nessun commit successivo
abbia già risolto parzialmente questi blockers prima di iniziare l'implementazione.*
