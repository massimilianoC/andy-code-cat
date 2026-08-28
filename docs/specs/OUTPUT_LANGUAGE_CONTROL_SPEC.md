# Output Language Control — Implementation Spec

**Status:** Implemented (2026-07-02) — regression fix restoring Layer L end-to-end
**Version:** 1.1
**Feature branch:** implemented on `feat/brand-reusable-context`

> **Implementation note (v1.1).** The intake half (Vibe classify/prefill language inference,
> zero-effort launch form language selector, normalized-brief `Output language:` line) was already
> in place, but the resolved language never reached the generation system prompt — Layer L was never
> injected at `chat-preview` time. Two gaps were closed:
> 1. **Persistence.** `Project.outputLanguage` is now stored at zero-effort launch (see §5.5/§6.3),
>    so the explicit language survives to every later generation turn — not just the intake brief text.
> 2. **Resolution + fallback.** `resolveContext` (the single composition path) resolves Layer L as
>    **`project.outputLanguage` → request `uiLanguage` (client i18n) → none (EN default)`**, and the
>    workspace now sends its current UI language with every `chat-preview` call.
>
> This means the God-Mode workspace now DOES receive Layer L via the UI-language fallback (an
> intentional evolution of the original §3.3 "no Layer L in Workspace" design, per maintainer request
> 2026-07-02): the operator wanted the UI language to drive output language when no explicit choice
> was made. A user who wants a different language still sets it explicitly (zero-effort form, which
> persists, or by writing it in the prompt).

---

## 1. Goal

Make the language of the platform's generated output a first-class parameter, determined consistently and parametrically from:

- the user interface language (UI language, `andy_lang` in localStorage)
- the language inferred from the user's intent/text in the Vibe flow
- an explicit user selection in the narrative Guided Mode flow
- the user's free text in Workspace

The result must be a clear, unambiguous language directive injected into the generative engine's system prompt, with a deterministic fallback chain that always ends on `"en"` (English).

---

## 2. Design Principle

> The output language must never be left to the LLM's implicit interpretation. It must be an explicit instruction, resolved before system prompt composition, and consistent with what the user expects.

---

## 3. Language Resolution Chain (by Mode)

### 3.1 Vibe Mode / Vibe Coding Mode

| Priority | Source | How |
|----------|----------|------|
| 1 (highest) | Language inferred from the user's prompt | The LLM in VibePrefill detects the dominant language of the free text |
| 2 | `uiLanguage` sent by the client | Field added to `VibeClassifyRequest` / `VibePrefillRequest` |
| 3 (fallback) | `"en"` | Hardcoded default |

**Logic:** The Vibe engine works on free text. The text's language is the strongest signal: if the user writes in Italian, the brief and output must be in Italian. If the text is ambiguous (e.g. only proper nouns), the UI language is used. If that is not available either, English is used.

**Note:** The inferred language is returned in `VibePrefillResponse.outputLanguage` so the UI can show/confirm which language was detected before generation.

### 3.2 Guided Mode (narrative, guided form)

| Priority | Source | How |
|----------|----------|------|
| 1 (highest) | Explicit selection in the form | `language` field in the zero-effort form, pre-filled but editable |
| 2 | `uiLanguage` sent by the client | Automatic pre-fill of the field |
| 3 (fallback) | `"en"` | If the UI language is unavailable |

**Logic:** The form has a language selector (or free-text field) pre-filled with the UI language. The user can change it. The selected language is included in `LaunchZeroEffortProjectInput` and in the normalized brief.

### 3.3 Workspace (free prompt, no Guided Mode orchestration)

| Priority | Source | How |
|----------|----------|------|
| 1 | Language explicitly specified by the user in the prompt | The user writes "in Italian" or "in English" in the text |
| 2 (fallback) | System prompt default: English | Layer A does not inject an active directive — the model generates based on the default training language (EN) |

**Logic:** In Workspace there is no Guided Mode orchestration. Layer L is not injected into the system prompt. The behavior is the model's default (tends to be English). If the user wants another language, they specify it in the free prompt. No forced auto-inference.

---

## 4. New Architecture: Layer L (Language Directive)

### 4.1 Definition

Introduce **Layer L** into the prompt composition system:

```
Layer A — Base constraints
Layer L — Language directive          ← NEW (inserted between A and B)
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

### 4.2 Layer L Format

```
## LAYER L — OUTPUT LANGUAGE

Produce all user-visible copy, labels, navigation, headings, body text,
calls-to-action, and placeholder content in: **{LANGUAGE_NAME}** ({BCP47_CODE}).

This directive applies to all text in the generated artifact (HTML, CSS comments
excluded). It overrides any other language implied by template names or style labels.
```

Where `{LANGUAGE_NAME}` is the human-readable name (e.g. "Italian", "English", "Spanish") and `{BCP47_CODE}` is the BCP-47 code (e.g. `it`, `en`, `es`).

### 4.3 When Layer L Is Injected

| Mode | Layer L injected? |
|----------|-------------------|
| Vibe Mode | ✅ Yes — language resolved by VibePrefill |
| Guided Mode | ✅ Yes — language from the form / UI / EN fallback |
| Workspace | ❌ No — the user controls it via free prompt |
| Optimize (brief optimization) | ❌ No — preserves the input text's language (already handled by an existing rule) |

### 4.4 `buildLanguageLayer()` Implementation

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

## 5. Contract Changes (`packages/contracts/src/vibecore.ts`)

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

### 5.5 `LaunchZeroEffortProjectInput` (to be added or verified in `pipeline.ts`)

```typescript
export interface LaunchZeroEffortProjectInput {
    // ... existing fields ...
    /** Resolved BCP-47 output language. Defaults to "en". */
    outputLanguage?: string;
}
```

---

## 6. Backend Changes

### 6.1 `VibePrefill.ts` — Language Inference

Add language-resolution logic in the use-case:

```typescript
function resolveOutputLanguage(
    input: VibePrefillRequest,
    inferredFromPrompt: string | null,
): string {
    // 1. Language inferred by the LLM from the prompt text (strongest)
    if (inferredFromPrompt && inferredFromPrompt.length >= 2) return inferredFromPrompt;
    // 2. UI language from the client
    if (input.uiLanguage && input.uiLanguage.length >= 2) return input.uiLanguage.toLowerCase().split("-")[0];
    // 3. Fallback
    return "en";
}
```

VibePrefill's system prompt is updated to return the `outputLanguage` field in the JSON:

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

If the LLM returns `null`, the fallback `uiLanguage` → `"en"` is used.

### 6.2 `VibePrefill.ts` — Default Draft in the Resolved Language

`defaultDraft()` is parameterized on the resolved language:

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

To avoid hardcoding many languages in the code, the generic defaults for languages other than Italian can stay in English: the LLM will still generate in `lang` thanks to Layer L in the generation system prompt.

### 6.3 `LaunchZeroEffortProject.ts` — Language-neutral Normalized Brief

The normalized brief's headings (`# BRIEF DI PROGETTO`, `## [IDENTITÀ]`, etc.) are internal structural text not visible to the user. They can stay in English or become language-neutral (e.g. `## [IDENTITY]`). The critical point is that the brief includes an `Output language: {bcp47}` line that is read by Layer L:

```typescript
function buildNormalizedBrief(input: NormalizedBriefInput): string {
    // ... existing sections ...
    const header = `# PROJECT BRIEF — ${input.businessName}`;
    // Add at the end of the brief:
    const langLine = `Output language: ${input.outputLanguage ?? "en"}`;
    // ...
}
```

**Note:** The brief's internal headings (seen only by the LLM, not by the user) are migrated from Italian to English for consistency with Layer L:
- `## [IDENTITÀ]` → `## [IDENTITY]`
- `## [OBIETTIVO]` → `## [GOAL]`
- `## [AUDIENCE]` → `## [AUDIENCE]` (unchanged)
- `## [STILE]` → `## [STYLE]`
- `## [CONTATTI]` → `## [CONTACTS]`

### 6.4 `systemPromptComposer.ts` — Adding Layer L

```typescript
export function composeSystemPrompt(opts: {
    // ... existing parameters ...
    /** Resolved BCP-47 output language. If omitted, Layer L is not injected (Workspace). */
    outputLanguage?: string | null;
}): string {
    return [
        buildBaseConstraintsLayer(),
        opts.outputLanguage ? buildLanguageLayer(opts.outputLanguage) : "",   // Layer L
        opts.presetLayer ?? buildPresetLayer(opts.presetId),
        // ... rest unchanged ...
    ]
        .filter(Boolean)
        .join(LAYER_SEPARATOR)
        .trim();
}
```

### 6.5 `outputLanguage` Injection Points in the Generation Use-cases

The following use-cases must receive `outputLanguage` and pass it to `composeSystemPrompt`:

| Use-case | How `outputLanguage` arrives |
|---|---|
| `LaunchZeroEffortProject` | From `input.outputLanguage` (form) |
| `VibeModeGenerate` | From `VibePrefillResponse.outputLanguage` (already in the draft) |
| `WorkspaceGenerate` | Not passed → Layer L omitted |
| `RegenerateMediaByKey` | Not passed (media regen, language irrelevant) |

---

## 7. Frontend Changes

### 7.1 Sending `uiLanguage` With Every Vibe Request

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

### 7.2 Language Selector in the Guided Mode Form

In the Guided Mode (narrative) form component:

```tsx
// Local state
const [outputLanguage, setOutputLanguage] = useState<string>(i18n.language ?? "en");

// When the draft arrives from VibePrefill, update with the inferred language:
useEffect(() => {
    if (prefillResponse?.outputLanguage) {
        setOutputLanguage(prefillResponse.outputLanguage);
    }
}, [prefillResponse]);

// UI: language field with pre-fill and manual override
<LanguageField
    value={outputLanguage}
    onChange={setOutputLanguage}
    label={t("zeroEffort.outputLanguage")}
    hint={t("zeroEffort.outputLanguageHint")}
/>
```

**Language field behavior:**
- Pre-filled with `uiLanguage` (or the language inferred by VibePrefill)
- Free-text field + suggestion list (en, it, fr, de, es, pt...)
- Not mandatory — if empty, server-side fallback to `"en"`
- Shows a badge when the language was auto-inferred from the prompt ("Detected: Italian")

### 7.3 No Change to the Workspace UI

In Workspace, the form has no language selector. A static text hint informs the user:

```
💡 Output language follows your prompt. Add "in Italian" or "en español" to set it explicitly.
```

---

## 8. Required i18n Translations

Add to `apps/web/i18n/en.json` and `it.json`:

```json
"zeroEffort": {
    "outputLanguage": "Output language",
    "outputLanguageHint": "Language of the generated content. Detected from your brief or set manually.",
    "outputLanguageDetected": "Detected: {{language}}",
    "outputLanguageFallback": "Default: English"
}
```

---

## 9. Non-regression Strategy

### 9.1 Contract Backward Compatibility

- `uiLanguage` is `optional` in all new contracts: existing clients that do not send it get the `"en"` fallback → current behavior preserved.
- `outputLanguage` in `ZeroEffortDraft` is added as a required field but with a `"en"` default in `defaultDraft()`.
- `VibePrefillResponse.outputLanguage` is added as a required field, but existing consumers that don't read it are unaffected.

### 9.2 Workspace Unchanged

Layer L is not injected in Workspace. No behavioral change for that mode.

### 9.3 Optimize Unchanged

`optimizeUserPromptInstruction.ts` already contains `"Write in the same language as the user's input."` — it is not touched.

### 9.4 Regression Tests to Add

| Test | File |
|---|---|
| VibePrefill returns `outputLanguage: "it"` for an Italian prompt | `VibePrefill.test.ts` |
| VibePrefill returns `outputLanguage: "en"` for an ambiguous prompt + uiLanguage="en" | `VibePrefill.test.ts` |
| `buildLanguageLayer("it")` produces the correct directive | `systemPromptLayers.test.ts` |
| `composeSystemPrompt` with `outputLanguage="it"` includes Layer L | `systemPromptComposer.test.ts` |
| `composeSystemPrompt` without `outputLanguage` does not include Layer L | `systemPromptComposer.test.ts` |
| LaunchZeroEffortProject propagates `outputLanguage` to the brief | `LaunchZeroEffortProject.test.ts` |

---

## 10. Change Summary by File

| File | Type of change |
|---|---|
| `packages/contracts/src/vibecore.ts` | Adds `uiLanguage`, `outputLanguage` to the contracts |
| `apps/api/src/application/llm/systemPromptLayers.ts` | Adds `buildLanguageLayer()` |
| `apps/api/src/application/llm/systemPromptComposer.ts` | Layer L in the compose stack, `outputLanguage?` param |
| `apps/api/src/application/use-cases/VibePrefill.ts` | Language inference + `resolveOutputLanguage()` + parametric `defaultDraft` |
| `apps/api/src/application/use-cases/LaunchZeroEffortProject.ts` | EN-neutral brief headers, `Output language` line, `outputLanguage` propagation |
| `apps/api/src/application/use-cases/VibeModeGenerate.ts` | Passes `outputLanguage` to `composeSystemPrompt` |
| `apps/web/lib/api/vibecore.ts` | Adds `uiLanguage` to every request |
| `apps/web/components/` (ZE form) | Language field pre-filled with automatic detection |
| `apps/web/i18n/en.json` + `it.json` | New `zeroEffort.outputLanguage*` keys |

---

## 11. Out of Scope (Explicit)

- Translation of the user interface (already handled by i18next, unchanged)
- Language of templates/presets (catalog labels, handled separately)
- Language of uploaded documents (already handled by `DocumentBriefExtractor.contentLanguage`)
- Auto-detection of language in Workspace (by design: it is a free-form mode)
- Multiple languages within the same output (not supported, one Language Layer per generation)
