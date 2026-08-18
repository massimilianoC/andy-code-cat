"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminConfig,
    getAdminLlmRegistry,
    updateProductGovernance,
    type AdminLlmProviderDto,
    type PromptTaskSettingDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PromptTaskSettingsCard } from "@/components/admin/PromptTaskSettingsCard";
import { resolvePromptTaskSettingAgainstCatalog } from "@/lib/adminLlmCatalog";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCT_KEY = "default";
const CLASSIFY_TASK_KEY       = "vibe_intent_classify";
const PREFILL_TASK_KEY        = "vibe_intent_prefill";
const OPTIMIZE_TASK_KEY       = "zero_effort_optimize";
const GENERATE_TASK_KEY       = "zero_effort_generate";
const VIBE_GENERATE_TASK_KEY  = "vibe_mode_generate";
const GOD_MODE_GENERATE_TASK_KEY = "god_mode_generate";

// ── Default system prompts (mirrors API hardcoded prompts) ─────────────────
// These are shown in the "System template override" textarea.
// Override is honoured by the API only when non-empty.

const CLASSIFY_DEFAULT_PROMPT =
`You are a deliverable-type and template classifier.
Given a user prompt and optional attachment metadata, return a JSON object:
{
  "templateId": "<preset id from the canonical catalog, or null>",
  "formatHint": "<one of: one_pager, a3_document, ratio_1_1, ratio_16_9, interactive_form, portfolio, brochure, analytics_dashboard or null>",
  "confidence": <number 0.0-1.0>,
  "reasoning": "<one sentence naming the exact words that decided the choice>"
}

Rules:
- Select templateId by applying the CANONICAL PRESET SELECTION CONTRACT below. It is the
  only selection authority. Nothing corrects or overrides your answer afterwards.
- Set templateId only if your confidence is >= 0.65. Below that, return null.
- Set formatHint independently of templateId; it can be non-null even when templateId is null.
- reasoning must quote or name the decisive words from the request. If the only decisive
  words are atmosphere or craft words (interactive, animated, immersive, kinetic,
  micro-interactions, Awwwards-level), you have no evidence: lower your confidence and
  prefer the matching web preset or null.
- Never infer a game, XR, or interactive-story preset from animation, interaction or
  immersion language alone. See STEP 2 of the procedure.
- Return valid JSON only — no markdown fences, no extra text.

Available templates: {{TEMPLATE_LIST}}`;

// Keep this byte-identical to VibePrefill.ts's SYSTEM_PROMPT (apps/api/src/application/use-cases/VibePrefill.ts).
// A prior drift here (this block was missing the nine expressive fields) caused the prefill LLM
// to see two contradictory "Required JSON shape" blocks once an operator saved this page even
// without editing it — models follow the FIRST shape they see, so the brief silently collapsed
// to ~2 filled sections. The backend now also demotes this override to an advisory suffix placed
// AFTER the authoritative contract, but keep this mirror in sync regardless — do not let it drift again.
const PREFILL_DEFAULT_PROMPT =
`You are a multi-format project brief architect.
Given a user's free-form description of a project, return a JSON object that
populates a structured project brief.

Required JSON shape (return ONLY valid JSON, no markdown fences, no extra text):
{
  "businessName": "brand or project name (string, required)",
  "presetId": "the preset id selected by applying the CANONICAL PRESET SELECTION CONTRACT appended below (string, required)",
  "outputLanguage": "BCP-47 language code of the content to generate, e.g. 'it', 'en', 'de', 'fr' (string, required)",
  "primaryGoal": "rich structured project brief — 900 to 2200 chars when possible (string, required)",
  "audience": "target audience description — 120 to 500 chars when possible (string, required)",
  "tone": "communication tone, e.g. professional, playful (string or null)",
  "primaryCta": "main call-to-action button text (string or null)",
  "styleHint": "visual, UX, interaction, and production notes — 180 to 900 chars when useful (string or null)",
  "projectSummary": "concise product/output concept and value proposition (string or null)",
  "contentStructure": "ordered sections, screens, slides, scenes, steps, states or levels with purpose (string or null)",
  "contentRequirements": "copy, data, entities, messages, assets and information that must appear (string or null)",
  "functionalRequirements": "behaviors, mechanics, validation, calculations and user capabilities (string or null)",
  "interactionModel": "navigation, controls, input methods, feedback, state transitions and edge cases (string or null)",
  "visualDirection": "composition, hierarchy, palette, typography, imagery, motion and atmosphere (string or null)",
  "successCriteria": "observable criteria for a complete and successful first generation (string or null)",
  "constraints": "explicit limits, compatibility, accessibility, responsive, legal or content constraints (string or null)",
  "mustAvoid": "things the result must not do, inferred only from explicit negative instructions (string or null)",
  "contactInfo": [{"key": "Email", "value": "..."}],
  "styleAttributes": ["minimal"]
}

presetId — do NOT guess from this prompt alone. Apply the CANONICAL PRESET SELECTION
CONTRACT appended below: it carries the full annotated catalog, the mandatory selection
procedure, and the per-preset SELECT WHEN / DO NOT SELECT WHEN clauses.

Rules:
- businessName: extract from the prompt; fall back to "Project" if unclear.
- presetId: apply the CANONICAL PRESET SELECTION CONTRACT below. Choose the MOST SPECIFIC
  preset whose SELECT WHEN clause is satisfied and whose DO NOT SELECT WHEN clause is not.
  A game or XR preset requires concrete mechanic evidence (procedure STEP 2) — animation,
  interaction, micro-interactions, kinetic motion, immersion and Awwwards-level ambition
  are website craft vocabulary, never gameplay evidence. When evidence is genuinely
  ambiguous use "neutral"; never use "landing" as a generic fallback.
- outputLanguage: detect the language the user wants the CONTENT in. If the user writes in Italian but asks "in tedesco" or "in German", outputLanguage must be "de". Use BCP-47 base code only (2–3 chars). Default "en" if truly ambiguous.
- primaryGoal: produce a robust structured brief that can be injected into downstream generation prompts. Include: project intent, selected template interpretation, required sections/screens, key functionality, success criteria, assumptions needed.
- audience: infer who uses or views the result; include needs, context, and expectations.
- COMPLETENESS CONTRACT (mandatory): every one of the nine expressive fields — projectSummary,
  contentStructure, contentRequirements, functionalRequirements, interactionModel, visualDirection,
  successCriteria, constraints, mustAvoid — MUST be a non-empty string of 250 to 900 characters.
  Use null ONLY when the request and the attached documents give literally zero signal for that
  field. Absence of an explicit user statement is not a reason to emit null — infer a concrete,
  defensible default consistent with the selected preset.
- contactInfo: extract any contact data mentioned (email, phone, address, socials); empty array if none.
- styleAttributes: pick 1–3 matching from: minimal, premium, dark, bright, bold, elegant, corporate, playful, tech, artisan, luxury, eco
- IMPORTANT: write fields in order shown — businessName, presetId, outputLanguage first.
- Return ONLY the JSON object.`;

const OPTIMIZE_DEFAULT_PROMPT =
`You rewrite a user's raw creative brief into a stronger, richer, production-ready content prompt for the current project.

GOAL
- Preserve the user's original intent, meaning, domain, and explicit preferences.
- Enrich the brief so the platform can generate a better result with less effort from the user.
- Expand the brief coherently with stronger guidance about message, audience, tone, content priorities, visual mood, and calls to action.

STYLE POLICY
- Keep the result modern, fresh, vivid, and professional.
- Respect the script, style, sector, and preferences already expressed by the user.
- If the user already provided a detailed brief, refine it lightly instead of rewriting aggressively.

IMPORTANT BOUNDARIES
- Do NOT mention technical output architecture.
- Do NOT mention HTML, CSS, JS, JSON, single-file output, embedding, implementation details, or code constraints.
- Focus only on business intent, content direction, storytelling quality, brand feel, and creative guidance.
- Treat [SOURCE_REQUEST] as authoritative. Enrichment is additive only: never remove, weaken or contradict explicit requirements, template choices, constraints or prohibitions; preserve [MUST_AVOID].

OUTPUT RULES
- Return only the optimized prompt text.
- Write in the same language as the user's input.
- Make it directly usable as the next user prompt in a generation workflow.`;

const TASK_DEFAULTS: Record<string, PromptTaskSettingDto> = {
    [CLASSIFY_TASK_KEY]: {
        enabled: true,
        provider: "",
        model: "",
        temperature: 0.0,
        maxCompletionTokens: 256,
        systemTemplate: CLASSIFY_DEFAULT_PROMPT,
    },
    [PREFILL_TASK_KEY]: {
        enabled: true,
        provider: "",
        model: "",
        temperature: 0.3,
        maxCompletionTokens: 6000,
        systemTemplate: PREFILL_DEFAULT_PROMPT,
    },
    [OPTIMIZE_TASK_KEY]: {
        enabled: true,
        provider: "",
        model: "",
        temperature: 0.7,
        maxCompletionTokens: 32000,
        systemTemplate: OPTIMIZE_DEFAULT_PROMPT,
    },
    [GENERATE_TASK_KEY]: {
        enabled: true,
        provider: "",
        model: "",
        temperature: 0.5,
        maxCompletionTokens: 14000,
        systemTemplate: "",
    },
    [VIBE_GENERATE_TASK_KEY]: {
        enabled: true,
        provider: "",
        model: "",
        temperature: 0.5,
        maxCompletionTokens: 14000,
        systemTemplate: "",
    },
    [GOD_MODE_GENERATE_TASK_KEY]: {
        enabled: true,
        provider: "",
        model: "",
        temperature: 0.5,
        maxCompletionTokens: 14000,
        systemTemplate: "",
    },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ZeroEffortAdminPage() {
    const router = useRouter();
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const [providers, setProviders] = useState<AdminLlmProviderDto[]>([]);

    function mergeTask(
        key: string,
        saved: Partial<PromptTaskSettingDto> | undefined,
        nextProviders: AdminLlmProviderDto[],
        preferredProvider?: string,
    ): PromptTaskSettingDto {
        return resolvePromptTaskSettingAgainstCatalog(
            {
                ...TASK_DEFAULTS[key],
                ...(saved ?? {}),
                systemTemplate: saved?.systemTemplate || TASK_DEFAULTS[key].systemTemplate,
            },
            nextProviders,
            { preferredProvider, requiredCapability: "chat" },
        );
    }

    const [classifyTask,      setClassifyTask]      = useState<PromptTaskSettingDto>(TASK_DEFAULTS[CLASSIFY_TASK_KEY]);
    const [prefillTask,       setPrefillTask]        = useState<PromptTaskSettingDto>(TASK_DEFAULTS[PREFILL_TASK_KEY]);
    const [optimizeTask,      setOptimizeTask]       = useState<PromptTaskSettingDto>(TASK_DEFAULTS[OPTIMIZE_TASK_KEY]);
    const [generateTask,      setGenerateTask]       = useState<PromptTaskSettingDto>(TASK_DEFAULTS[GENERATE_TASK_KEY]);
    const [vibeGenerateTask,  setVibeGenerateTask]   = useState<PromptTaskSettingDto>(TASK_DEFAULTS[VIBE_GENERATE_TASK_KEY]);
    const [godModeGenerateTask, setGodModeGenerateTask] = useState<PromptTaskSettingDto>(TASK_DEFAULTS[GOD_MODE_GENERATE_TASK_KEY]);

    useEffect(() => {
        const t = getToken();
        if (!t) { router.replace("/login"); return; }
        setToken(t);
        void Promise.all([
            getAdminConfig(t),
            getAdminLlmRegistry(t),
        ]).then(([cfg, registry]) => {
            const productSettings = cfg.governanceByProduct?.[DEFAULT_PRODUCT_KEY]?.promptTaskSettings ?? {};
            const nextProviders = registry.providers ?? [];
            setClassifyTask(mergeTask(CLASSIFY_TASK_KEY, productSettings[CLASSIFY_TASK_KEY], nextProviders, registry.activeProvider));
            setPrefillTask(mergeTask(PREFILL_TASK_KEY, productSettings[PREFILL_TASK_KEY], nextProviders, registry.activeProvider));
            setOptimizeTask(mergeTask(OPTIMIZE_TASK_KEY, productSettings[OPTIMIZE_TASK_KEY], nextProviders, registry.activeProvider));
            setGenerateTask(mergeTask(GENERATE_TASK_KEY, productSettings[GENERATE_TASK_KEY], nextProviders, registry.activeProvider));
            setVibeGenerateTask(mergeTask(VIBE_GENERATE_TASK_KEY, productSettings[VIBE_GENERATE_TASK_KEY], nextProviders, registry.activeProvider));
            setGodModeGenerateTask(mergeTask(GOD_MODE_GENERATE_TASK_KEY, productSettings[GOD_MODE_GENERATE_TASK_KEY], nextProviders, registry.activeProvider));
            setProviders(nextProviders);
        })
        .catch(() => setError("Unable to load config."))
        .finally(() => setLoading(false));
    }, [router]);

    // Never persist a systemTemplate that is byte-identical to the shipped default: the
    // textarea is pre-filled with the default whenever nothing is stored (see mergeTask
    // above), so saving unrelated fields (provider, temperature...) used to silently write
    // the current default text into PlatformConfig as if it were an intentional override.
    // That override then front-ran the live backend contract on every future prompt change,
    // which is exactly how a prior drift (missing 9 brief fields) went unnoticed. Persisting
    // "" instead means the API always falls back to its own current default.
    function stripDefaultTemplate(key: string, task: PromptTaskSettingDto): PromptTaskSettingDto {
        return task.systemTemplate?.trim() === TASK_DEFAULTS[key].systemTemplate.trim()
            ? { ...task, systemTemplate: "" }
            : task;
    }

    async function handleSave() {
        if (!token) return;
        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            await updateProductGovernance(token, DEFAULT_PRODUCT_KEY, {
                promptTaskSettings: {
                    [CLASSIFY_TASK_KEY]:          stripDefaultTemplate(CLASSIFY_TASK_KEY, classifyTask),
                    [PREFILL_TASK_KEY]:           stripDefaultTemplate(PREFILL_TASK_KEY, prefillTask),
                    [OPTIMIZE_TASK_KEY]:          stripDefaultTemplate(OPTIMIZE_TASK_KEY, optimizeTask),
                    [GENERATE_TASK_KEY]:          generateTask,
                    [VIBE_GENERATE_TASK_KEY]:     vibeGenerateTask,
                    [GOD_MODE_GENERATE_TASK_KEY]: godModeGenerateTask,
                },
            });
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed.");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Vibe Mode &amp; Guided Mode — Model Settings</CardTitle>
                    <CardDescription>
                        Configura provider e modello per ogni fase del pipeline VibeCore e Guided Mode.
                        Le impostazioni si applicano al prodotto <code className="text-xs font-mono bg-muted px-1 rounded">default</code>.
                    </CardDescription>
                </CardHeader>
            </Card>

            {/* ── VibeCore section ─────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">VibeCore — Fase di analisi prompt</CardTitle>
                    <CardDescription>
                        Modelli usati nelle due fasi preliminari che analizzano il prompt utente prima della generazione.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                    <PromptTaskSettingsCard
                        title="Layer Φ — Classificazione intento (vibe_intent_classify)"
                        description="Classifica il prompt per templateId e formatHint. Modello rapido, temperatura 0."
                        helperText="Usa un modello fast/istruzione-following. Max token: 256. Il contratto canonico di selezione preset (procedura + catalogo annotato) è sempre aggiunto dal backend dopo questo template e non può essere sovrascritto."
                        value={classifyTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setClassifyTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                    <PromptTaskSettingsCard
                        title="Prefill Brief — Estrazione brief (vibe_intent_prefill)"
                        description="Seleziona presetId dallo stesso catalogo di Vibe e compila il brief Zero Effort completo: struttura, contenuti, funzioni, interazioni, visual, vincoli e criteri di successo."
                        helperText="Il backend antepone sempre il contratto e il catalogo correnti: questo override è ora consultivo e non può restringere lo schema. Consigliati almeno 6000 token (il brief completo a 19 campi richiede ~2.100–5.800 token di output; sotto questa soglia i campi espressivi vengono troncati silenziosamente)."
                        value={prefillTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setPrefillTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                </CardContent>
            </Card>

            {/* ── Guided Mode pipeline section ─────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Guided Mode — Pipeline di generazione</CardTitle>
                    <CardDescription>
                        Modelli usati per ottimizzare il brief in prompt strutturato e generare il contenuto HTML.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                    <PromptTaskSettingsCard
                        title="Ottimizzazione Brief (zero_effort_optimize)"
                        description="Trasforma il brief normalizzato in un prompt strutturato e dettagliato, pronto per la generazione."
                        helperText="Usa un modello capace di seguire istruzioni complesse. Temperature moderata (0.6–0.8). Default: 32000 token per evitare prompt ottimizzati troncati."
                        value={optimizeTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setOptimizeTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                    <PromptTaskSettingsCard
                        title="Generazione Contenuto (zero_effort_generate)"
                        description="Genera il sito HTML/CSS/JS completo a partire dal prompt ottimizzato (flusso Guided Mode diretto)."
                        helperText="Usa un modello con finestra di contesto estesa. Temperature bassa (0.3–0.6). Token limite consigliato: 10000–16000."
                        value={generateTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setGenerateTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                    <PromptTaskSettingsCard
                        title="Vibe Mode — Generazione finale (vibe_mode_generate)"
                        description="Modello usato per la generazione HTML quando si arriva da Vibe Mode (flusso easy/medium via launch page)."
                        helperText="Usa un modello con finestra di contesto estesa. Temperature bassa. Token limite consigliato: 10000–16000."
                        value={vibeGenerateTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setVibeGenerateTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                    <PromptTaskSettingsCard
                        title="Guided Mode — Generazione finale (god_mode_generate)"
                        description="Modello usato per la generazione HTML quando si arriva da Vibe Mode Expert o dal workspace in modalità autoTemplating."
                        helperText="Usa un modello con finestra di contesto estesa. Temperature bassa. Token limite consigliato: 10000–16000."
                        value={godModeGenerateTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setGodModeGenerateTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                </CardContent>
            </Card>

            {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {error}
                </div>
            )}
            {success && (
                <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-400">
                    Impostazioni salvate con successo.
                </div>
            )}

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Salvataggio..." : "Salva impostazioni"}
                </Button>
            </div>
        </div>
    );
}
