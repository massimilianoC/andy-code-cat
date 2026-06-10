# Output Language Control — Implementation Spec

**Status:** Draft  
**Version:** 1.0  
**Feature branch:** `feat/output-language-control` (da creare da `develop`)

---

## 1. Obiettivo

Rendere la lingua dell'output generato dalla piattaforma un parametro di prima classe, determinato in modo coerente e parametrico rispetto a:

- la lingua dell'interfaccia utente (UI language, `andy_lang` in localStorage)
- la lingua inferita dall'intento/testo dell'utente nel flusso Vibe
- una selezione esplicita dell'utente nel flusso Zero Effort narrativo
- il testo libero dell'utente in God Mode

Il risultato deve essere una direttiva di lingua chiara e non ambigua iniettata nel system prompt del motore generativo, con una catena di fallback deterministica che termina sempre su `"en"` (inglese).

---

## 2. Principio di design

> La lingua dell'output non deve mai essere lasciata all'interpretazione implicita del modello LLM. Deve essere un'istruzione esplicita, risoluta prima della composizione del system prompt, e coerente con ciò che l'utente si aspetta.

---

## 3. Catena di risoluzione della lingua (per modalità)

### 3.1 Vibe Mode / Vibe Coding Mode

| Priorità | Sorgente | Come |
|----------|----------|------|
| 1 (massima) | Lingua inferita dal prompt dell'utente | LLM in VibePrefill rileva la lingua dominante del testo libero |
| 2 | `uiLanguage` inviato dal client | Campo aggiunto al `VibeClassifyRequest` / `VibePrefillRequest` |
| 3 (fallback) | `"en"` | Default hardcoded |

**Logica:** Il motore Vibe lavora su testo libero. La lingua del testo è il segnale più forte: se l'utente scrive in italiano, il brief e l'output devono essere in italiano. Se il testo è ambiguo (es. solo nomi propri), si usa la lingua UI. Se nemmeno quella è disponibile, si usa inglese.

**Nota:** La lingua inferita viene restituita in `VibePrefillResponse.outputLanguage` così la UI può mostrare/confermare quale lingua è stata rilevata prima della generazione.

### 3.2 Zero Effort Mode (narrativo, form guidato)

| Priorità | Sorgente | Come |
|----------|----------|------|
| 1 (massima) | Selezione esplicita nel form | Campo `language` nel form zero effort, pre-compilato ma editabile |
| 2 | `uiLanguage` inviato dal client | Pre-compilazione automatica del campo |
| 3 (fallback) | `"en"` | Se UI language non è disponibile |

**Logica:** Il form ha un selettore (o campo testo libero) di lingua precompilato con la lingua UI. L'utente può modificarlo. La lingua selezionata viene inclusa nel `LaunchZeroEffortProjectInput` e nel brief normalizzato.

### 3.3 God Mode (prompt libero, senza orchestrazione Zero Effort)

| Priorità | Sorgente | Come |
|----------|----------|------|
| 1 | Lingua specificata esplicitamente nel prompt dall'utente | L'utente scrive "in italiano" o "in English" nel testo |
| 2 (fallback) | Default del system prompt: inglese | Layer A non inietta direttiva attiva — il modello genera in base al training default (EN) |

**Logica:** In God Mode non c'è orchestrazione Zero Effort. Non viene iniettato Layer L nel system prompt. Il comportamento è quello di default del modello (tendenzialmente inglese). Se l'utente vuole un'altra lingua, la specifica nel prompt libero. Nessuna auto-inferenza forzata.

---

## 4. Nuova architettura: Layer L (Language Directive)

### 4.1 Definizione

Introdurre **Layer L** nel sistema di composizione del prompt:

```
Layer A — Base constraints
Layer L — Language directive          ← NUOVO (inserito tra A e B)
Layer B — Preset output format
Layer T — Template resolution
Layer C — Style context
Layer G — Brand context
Layer D — Document context
Layer X — Data context
Layer E — Pre-prompt template
Layer F — Governance system prompt
Budget policy
Request override
```

### 4.2 Formato del Layer L

```
## LAYER L — OUTPUT LANGUAGE

Produce all user-visible copy, labels, navigation, headings, body text,
calls-to-action, and placeholder content in: **{LANGUAGE_NAME}** ({BCP47_CODE}).

This directive applies to all text in the generated artifact (HTML, CSS comments
excluded). It overrides any other language implied by template names or style labels.
```

Dove `{LANGUAGE_NAME}` è il nome leggibile (es. "Italian", "English", "Spanish") e `{BCP47_CODE}` è il codice BCP-47 (es. `it`, `en`, `es`).

### 4.3 Quando Layer L viene iniettato

| Modalità | Layer L iniettato? |
|----------|-------------------|
| Vibe Mode | ✅ Sì — lingua risolta dal VibePrefill |
| Zero Effort | ✅ Sì — lingua dal form / UI / fallback EN |
| God Mode | ❌ No — l'utente controlla via prompt libero |
| Optimize (ottimizzazione brief) | ❌ No — preserva la lingua del testo input (già gestito da regola esistente) |

### 4.4 Implementazione `buildLanguageLayer()`

```typescript
// apps/api/src/application/llm/systemPromptLayers.ts

const LANGUAGE_NAMES: Record<string, string> = {
    en: "English",
    it: "Italian",
    fr: "French",
    de: "German",
    es: "Spanish",
    pt: "Portuguese",
    nl: "Dutch",
    pl: "Polish",
    ru: "Russian",
    ja: "Japanese",
    zh: "Chinese",
    ar: "Arabic",
};

export function buildLanguageLayer(bcp47: string): string {
    const code = bcp47.toLowerCase().split("-")[0];
    const name = LANGUAGE_NAMES[code] ?? bcp47;
    return [
        "## LAYER L — OUTPUT LANGUAGE",
        "",
        `Produce all user-visible copy, labels, navigation, headings, body text,`,
        `calls-to-action, and placeholder content in: **${name}** (${code}).`,
        "",
        `This directive applies to all text in the generated artifact.`,
        `It overrides any other language implied by template names or style labels.`,
    ].join("\n");
}
```

---

## 5. Modifiche ai contratti (`packages/contracts/src/vibecore.ts`)

### 5.1 `VibeClassifyRequest`

```typescript
export interface VibeClassifyRequest {
    prompt: string;
    attachmentMeta?: AttachmentMeta[];
    generationMode?: VibeGenerationMode;
    provider?: string;
    model?: string;
    projectId?: string;
    /** BCP-47 language code from the client UI (e.g. "it", "en"). Used as fallback signal. */
    uiLanguage?: string;
}
```

### 5.2 `VibePrefillRequest`

```typescript
export interface VibePrefillRequest {
    prompt: string;
    attachmentMeta?: AttachmentMeta[];
    generationMode?: VibeGenerationMode;
    provider?: string;
    model?: string;
    projectId?: string;
    /** BCP-47 language code from the client UI (e.g. "it", "en"). Used as fallback signal. */
    uiLanguage?: string;
}
```

### 5.3 `ZeroEffortDraft`

```typescript
export interface ZeroEffortDraft {
    businessName: string;
    siteType: "landing_page" | "portfolio" | "showcase" | "business_site";
    primaryGoal: string;
    audience: string;
    tone?: string;
    primaryCta?: string;
    styleHint?: string;
    contactInfo?: Array<{ key: string; value: string }>;
    styleAttributes?: string[];
    attachedDocuments?: string[];
    /** Resolved BCP-47 output language for this draft. */
    outputLanguage: string;
}
```

### 5.4 `VibePrefillResponse`

```typescript
export interface VibePrefillResponse {
    draft: ZeroEffortDraft;
    dataDashboardDraft?: DataDashboardDraft;
    resolvedMode?: VibeResolvedMode;
    confidence: number;
    skipped: boolean;
    projectId?: string;
    /** BCP-47 language resolved for output. Mirrors draft.outputLanguage. */
    outputLanguage: string;
}
```

### 5.5 `LaunchZeroEffortProjectInput` (da aggiungere o verificare in `pipeline.ts`)

```typescript
export interface LaunchZeroEffortProjectInput {
    // ... campi esistenti ...
    /** Resolved BCP-47 output language. Defaults to "en". */
    outputLanguage?: string;
}
```

---

## 6. Modifiche backend

### 6.1 `VibePrefill.ts` — inferenza lingua

Aggiungere logica di risoluzione lingua nel use-case:

```typescript
function resolveOutputLanguage(
    input: VibePrefillRequest,
    inferredFromPrompt: string | null,
): string {
    // 1. Lingua inferita dal LLM dal testo del prompt (più forte)
    if (inferredFromPrompt && inferredFromPrompt.length >= 2) return inferredFromPrompt;
    // 2. Lingua UI dal client
    if (input.uiLanguage && input.uiLanguage.length >= 2) return input.uiLanguage.toLowerCase().split("-")[0];
    // 3. Fallback
    return "en";
}
```

Il system prompt di VibePrefill viene aggiornato per restituire il campo `outputLanguage` nel JSON:

```
Required JSON shape:
{
  "businessName": "...",
  "siteType": "...",
  "primaryGoal": "...",
  "audience": "...",
  "tone": "...",
  "primaryCta": "...",
  "styleHint": "...",
  "contactInfo": [...],
  "styleAttributes": [...],
  "outputLanguage": "<BCP-47 code of the dominant language in the user's prompt, e.g. 'it', 'en', 'fr'. Return null if unclear.>"
}
```

Se il LLM restituisce `null`, si usa il fallback `uiLanguage` → `"en"`.

### 6.2 `VibePrefill.ts` — default draft in lingua risolta

Il `defaultDraft()` viene parametrizzato sulla lingua risolta:

```typescript
function defaultDraft(prompt: string, lang: string): ZeroEffortDraft {
    const isItalian = lang === "it";
    return {
        businessName: prompt.trim().slice(0, 64) || (isItalian ? "Progetto" : "Project"),
        siteType: "landing_page",
        primaryGoal: prompt.trim().slice(0, 500) || (isItalian
            ? "Sito web moderno e professionale."
            : "Modern and professional website."),
        audience: isItalian
            ? "Pubblico generale interessato all'attività."
            : "General audience interested in the activity.",
        outputLanguage: lang,
    };
}
```

Per evitare di hardcodare tante lingue nel codice, i default generici in lingue diverse dall'italiano possono restare in inglese: l'LLM genererà comunque in `lang` grazie al Layer L nel system prompt di generazione.

### 6.3 `LaunchZeroEffortProject.ts` — brief normalizzato language-neutral

Le intestazioni del brief normalizzato (`# BRIEF DI PROGETTO`, `## [IDENTITÀ]`, ecc.) sono testo strutturale interno non visibile all'utente. Possono restare in inglese o diventare language-neutral (es. `## [IDENTITY]`). Il punto critico è che il brief include una riga `Output language: {bcp47}` che viene letta dal Layer L:

```typescript
function buildNormalizedBrief(input: NormalizedBriefInput): string {
    // ... sezioni esistenti ...
    const header = `# PROJECT BRIEF — ${input.businessName}`;
    // Aggiungere alla fine del brief:
    const langLine = `Output language: ${input.outputLanguage ?? "en"}`;
    // ...
}
```

**Nota:** Le intestazioni interne del brief (viste solo dal LLM, non dall'utente) vengono migrate da italiano a inglese per coerenza con il Layer L:
- `## [IDENTITÀ]` → `## [IDENTITY]`
- `## [OBIETTIVO]` → `## [GOAL]`
- `## [AUDIENCE]` → `## [AUDIENCE]` (invariato)
- `## [STILE]` → `## [STYLE]`
- `## [CONTATTI]` → `## [CONTACTS]`

### 6.4 `systemPromptComposer.ts` — aggiunta Layer L

```typescript
export function composeSystemPrompt(opts: {
    // ... parametri esistenti ...
    /** Resolved BCP-47 output language. If omitted, Layer L is not injected (God Mode). */
    outputLanguage?: string | null;
}): string {
    return [
        buildBaseConstraintsLayer(),
        opts.outputLanguage ? buildLanguageLayer(opts.outputLanguage) : "",   // Layer L
        opts.presetLayer ?? buildPresetLayer(opts.presetId),
        // ... resto invariato ...
    ]
        .filter(Boolean)
        .join(LAYER_SEPARATOR)
        .trim();
}
```

### 6.5 Punti di iniezione di `outputLanguage` nei use-case di generazione

I seguenti use-case devono ricevere `outputLanguage` e passarlo a `composeSystemPrompt`:

| Use-case | Come arriva `outputLanguage` |
|---|---|
| `LaunchZeroEffortProject` | Da `input.outputLanguage` (form) |
| `VibeModeGenerate` | Da `VibePrefillResponse.outputLanguage` (già nel draft) |
| `GodModeGenerate` | Non passato → Layer L omesso |
| `RegenerateMediaByKey` | Non passato (media regen, lingua irrilevante) |

---

## 7. Modifiche frontend

### 7.1 Invio `uiLanguage` con ogni richiesta Vibe

In `apps/web/lib/api/vibecore.ts`:

```typescript
import i18n from "@/lib/i18n";

export async function vibeClassify(req: VibeClassifyRequest) {
    return apiPost("/vibecore/classify", {
        ...req,
        uiLanguage: req.uiLanguage ?? i18n.language ?? "en",
    });
}

export async function vibePrefill(req: VibePrefillRequest) {
    return apiPost("/vibecore/prefill", {
        ...req,
        uiLanguage: req.uiLanguage ?? i18n.language ?? "en",
    });
}
```

### 7.2 Selettore lingua nel form Zero Effort

Nel componente form Zero Effort (narrativo):

```tsx
// Stato locale
const [outputLanguage, setOutputLanguage] = useState<string>(i18n.language ?? "en");

// Quando arriva il draft da VibePrefill, aggiorna con la lingua inferita:
useEffect(() => {
    if (prefillResponse?.outputLanguage) {
        setOutputLanguage(prefillResponse.outputLanguage);
    }
}, [prefillResponse]);

// UI: campo lingua con pre-compilazione e override manuale
<LanguageField
    value={outputLanguage}
    onChange={setOutputLanguage}
    label={t("zeroEffort.outputLanguage")}
    hint={t("zeroEffort.outputLanguageHint")}
/>
```

**Comportamento del campo lingua:**
- Pre-compilato con `uiLanguage` (o lingua inferita dal VibePrefill)
- Campo testo libero + lista suggerimenti (en, it, fr, de, es, pt...)
- Non obbligatorio — se vuoto, fallback `"en"` lato server
- Mostra un badge quando la lingua è stata auto-inferita dal prompt ("Detected: Italian")

### 7.3 Nessuna modifica a God Mode UI

In God Mode il form non ha un selettore lingua. Un hint testuale statico informa l'utente:

```
💡 Output language follows your prompt. Add "in Italian" or "en español" to set it explicitly.
```

---

## 8. Traduzioni i18n necessarie

Aggiungere a `apps/web/i18n/en.json` e `it.json`:

```json
"zeroEffort": {
    "outputLanguage": "Output language",
    "outputLanguageHint": "Language of the generated content. Detected from your brief or set manually.",
    "outputLanguageDetected": "Detected: {{language}}",
    "outputLanguageFallback": "Default: English"
}
```

---

## 9. Strategia di non-regressione

### 9.1 Backward compatibility dei contratti

- `uiLanguage` è `optional` in tutti i nuovi contratti: i client esistenti che non lo inviano ricevono il fallback `"en"` → comportamento corrente preservato.
- `outputLanguage` in `ZeroEffortDraft` è aggiunto come campo required ma con default `"en"` nel `defaultDraft()`.
- `VibePrefillResponse.outputLanguage` è aggiunto come campo required ma i consumer esistenti che non lo leggono non sono impattati.

### 9.2 God Mode invariato

Layer L non viene iniettato in God Mode. Nessun cambiamento comportamentale per quella modalità.

### 9.3 Optimize invariato

`optimizeUserPromptInstruction.ts` già contiene `"Write in the same language as the user's input."` — non viene toccato.

### 9.4 Test di regressione da aggiungere

| Test | File |
|---|---|
| VibePrefill restituisce `outputLanguage: "it"` se prompt in italiano | `VibePrefill.test.ts` |
| VibePrefill restituisce `outputLanguage: "en"` per prompt ambiguo + uiLanguage="en" | `VibePrefill.test.ts` |
| `buildLanguageLayer("it")` produce la direttiva corretta | `systemPromptLayers.test.ts` |
| `composeSystemPrompt` con `outputLanguage="it"` include Layer L | `systemPromptComposer.test.ts` |
| `composeSystemPrompt` senza `outputLanguage` non include Layer L | `systemPromptComposer.test.ts` |
| LaunchZeroEffortProject propaga `outputLanguage` al brief | `LaunchZeroEffortProject.test.ts` |

---

## 10. Riepilogo cambiamenti per file

| File | Tipo di modifica |
|---|---|
| `packages/contracts/src/vibecore.ts` | Aggiunta `uiLanguage`, `outputLanguage` ai contratti |
| `apps/api/src/application/llm/systemPromptLayers.ts` | Aggiunta `buildLanguageLayer()` |
| `apps/api/src/application/llm/systemPromptComposer.ts` | Layer L nel compose stack, param `outputLanguage?` |
| `apps/api/src/application/use-cases/VibePrefill.ts` | Inferenza lingua + `resolveOutputLanguage()` + `defaultDraft` parametrico |
| `apps/api/src/application/use-cases/LaunchZeroEffortProject.ts` | Brief headers EN-neutral, riga `Output language`, propagazione `outputLanguage` |
| `apps/api/src/application/use-cases/VibeModeGenerate.ts` | Passa `outputLanguage` a `composeSystemPrompt` |
| `apps/web/lib/api/vibecore.ts` | Aggiunta `uiLanguage` a ogni request |
| `apps/web/components/` (form ZE) | Campo lingua pre-compilato con rilevamento automatico |
| `apps/web/i18n/en.json` + `it.json` | Nuove chiavi `zeroEffort.outputLanguage*` |

---

## 11. Fuori scope (esplicito)

- Traduzione dell'interfaccia utente (già gestita da i18next, non cambia)
- Lingua dei template/presets (etichette in catalogo, gestione separata)
- Lingua dei documenti caricati (già gestita da `DocumentBriefExtractor.contentLanguage`)
- Auto-rilevamento lingua in God Mode (by design: è una modalità libera)
- Multi-lingua all'interno dello stesso output (non supportato, un solo Language Layer per generazione)
