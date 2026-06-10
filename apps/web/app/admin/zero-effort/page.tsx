"use client";

import { useEffect, useMemo, useState } from "react";
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
`You are a document-type and template classifier.
Given a user prompt and optional file metadata, return a JSON object:
{
  "templateId": "<id from catalog or null>",
  "formatHint": "<one of: one_pager, a3_document, ratio_1_1, ratio_16_9, interactive_form, portfolio, brochure, analytics_dashboard or null>",
  "confidence": <number 0.0–1.0>,
  "reasoning": "<one sentence>"
}

Rules:
- Set templateId only if confidence >= 0.65 against the template catalog below.
- Set formatHint independently of templateId; it can be non-null even when templateId is null.
- If neither signal is clear, return both as null.
- Choose by intended output, not by surface wording. A request for something playable, game-like, arcade,
  puzzle, challenge, score, controls, levels, HUD, character movement, or interaction loop MUST prefer
  the most specific active game template. Use "videogame" for generic playable browser games; use
  "seriousgame" only when learning/training is the main goal; use "game3d" for explicit 3D scenes/games;
  use "vr-aframe" for explicit VR/immersive A-Frame requests; use "interactive-story" for branching stories.
- Do not choose "landing" or "website" for a prompt that asks to build a playable experience, even if it
  also mentions a title, brand, launch page, or presentation copy.
- Return valid JSON only — no markdown fences, no extra text.

Available templates:
{{TEMPLATE_LIST}}`;

const PREFILL_DEFAULT_PROMPT =
`You are a web project brief extractor.
Given a user's free-form description of a website project, return a JSON object that
populates a structured project brief.

Required JSON shape (return ONLY valid JSON, no markdown fences, no extra text):
{
  "businessName": "brand or project name (string, required)",
  "siteType": "landing_page|portfolio|showcase|business_site (string, required)",
  "primaryGoal": "full project description and main objective — at least 20 chars (string, required)",
  "audience": "target audience description — at least 10 chars (string, required)",
  "tone": "communication tone, e.g. professional, playful (string or null)",
  "primaryCta": "main call-to-action button text (string or null)",
  "styleHint": "visual style notes (string or null)",
  "contactInfo": [{"key": "Email", "value": "..."}],
  "styleAttributes": ["minimal"]
}

Rules:
- businessName: extract from the prompt; fall back to "Progetto" if unclear.
- siteType: infer from context; default "landing_page".
- primaryGoal: expand the user's text into a detailed project description.
- audience: infer who the site is for; describe age group, interests, needs.
- contactInfo: extract any contact data mentioned (email, phone, address, socials); empty array if none.
- styleAttributes: pick 1–3 matching from: minimal, premium, dark, bright, bold, elegant, corporate, playful, tech, artisan, luxury, eco
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
        maxCompletionTokens: 768,
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const hasChanges = useMemo(() => true, [classifyTask, prefillTask, optimizeTask, generateTask, vibeGenerateTask, godModeGenerateTask]);

    async function handleSave() {
        if (!token) return;
        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            await updateProductGovernance(token, DEFAULT_PRODUCT_KEY, {
                promptTaskSettings: {
                    [CLASSIFY_TASK_KEY]:          classifyTask,
                    [PREFILL_TASK_KEY]:           prefillTask,
                    [OPTIMIZE_TASK_KEY]:          optimizeTask,
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
                        helperText="Usa un modello fast/istruzione-following. Max token: 256."
                        value={classifyTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setClassifyTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                    <PromptTaskSettingsCard
                        title="Prefill Brief — Estrazione brief (vibe_intent_prefill)"
                        description="Estrae businessName, siteType, obiettivo, audience e stile dal prompt utente."
                        helperText="Usa un modello capace di estrarre JSON strutturato. Max token: 768."
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
