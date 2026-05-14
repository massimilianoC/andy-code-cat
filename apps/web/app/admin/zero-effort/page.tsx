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

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCT_KEY = "default";
const CLASSIFY_TASK_KEY  = "vibe_intent_classify";
const PREFILL_TASK_KEY   = "vibe_intent_prefill";
const OPTIMIZE_TASK_KEY  = "zero_effort_optimize";
const GENERATE_TASK_KEY  = "zero_effort_generate";

const TASK_DEFAULTS: Record<string, PromptTaskSettingDto> = {
    [CLASSIFY_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "Qwen/Qwen3-8B",
        temperature: 0.0,
        maxCompletionTokens: 256,
        systemTemplate: "",
    },
    [PREFILL_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "Qwen/Qwen3-8B",
        temperature: 0.3,
        maxCompletionTokens: 768,
        systemTemplate: "",
    },
    [OPTIMIZE_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.7,
        maxCompletionTokens: 1200,
        systemTemplate: "",
    },
    [GENERATE_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
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

    const [classifyTask, setClassifyTask] = useState<PromptTaskSettingDto>(TASK_DEFAULTS[CLASSIFY_TASK_KEY]);
    const [prefillTask,  setPrefillTask]  = useState<PromptTaskSettingDto>(TASK_DEFAULTS[PREFILL_TASK_KEY]);
    const [optimizeTask, setOptimizeTask] = useState<PromptTaskSettingDto>(TASK_DEFAULTS[OPTIMIZE_TASK_KEY]);
    const [generateTask, setGenerateTask] = useState<PromptTaskSettingDto>(TASK_DEFAULTS[GENERATE_TASK_KEY]);

    useEffect(() => {
        const t = getToken();
        if (!t) { router.replace("/login"); return; }
        setToken(t);
        void Promise.all([
            getAdminConfig(t),
            getAdminLlmRegistry(t),
        ]).then(([cfg, registry]) => {
            const productSettings = cfg.governanceByProduct?.[DEFAULT_PRODUCT_KEY]?.promptTaskSettings ?? {};
            setClassifyTask({ ...TASK_DEFAULTS[CLASSIFY_TASK_KEY],  ...productSettings[CLASSIFY_TASK_KEY] });
            setPrefillTask({  ...TASK_DEFAULTS[PREFILL_TASK_KEY],   ...productSettings[PREFILL_TASK_KEY] });
            setOptimizeTask({ ...TASK_DEFAULTS[OPTIMIZE_TASK_KEY],  ...productSettings[OPTIMIZE_TASK_KEY] });
            setGenerateTask({ ...TASK_DEFAULTS[GENERATE_TASK_KEY],  ...productSettings[GENERATE_TASK_KEY] });
            setProviders(registry.providers ?? []);
        })
        .catch(() => setError("Unable to load config."))
        .finally(() => setLoading(false));
    }, [router]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const hasChanges = useMemo(() => true, [classifyTask, prefillTask, optimizeTask, generateTask]);

    async function handleSave() {
        if (!token) return;
        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            await updateProductGovernance(token, DEFAULT_PRODUCT_KEY, {
                promptTaskSettings: {
                    [CLASSIFY_TASK_KEY]:  classifyTask,
                    [PREFILL_TASK_KEY]:   prefillTask,
                    [OPTIMIZE_TASK_KEY]:  optimizeTask,
                    [GENERATE_TASK_KEY]:  generateTask,
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
                    <CardTitle>Vibe Mode &amp; Zero Effort — Model Settings</CardTitle>
                    <CardDescription>
                        Configura provider e modello per ogni fase del pipeline VibeCore e Zero Effort.
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
                        title="Zero Effort Prefill — Estrazione brief (vibe_intent_prefill)"
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

            {/* ── Zero Effort pipeline section ─────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Zero Effort — Pipeline di generazione</CardTitle>
                    <CardDescription>
                        Modelli usati per ottimizzare il brief in prompt strutturato e generare il contenuto HTML.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                    <PromptTaskSettingsCard
                        title="Ottimizzazione Brief (zero_effort_optimize)"
                        description="Trasforma il brief normalizzato in un prompt strutturato e dettagliato, pronto per la generazione."
                        helperText="Usa un modello capace di seguire istruzioni complesse. Temperature moderata (0.6–0.8). Token limite consigliato: 1000–1500."
                        value={optimizeTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setOptimizeTask((prev) => ({ ...prev, [field]: value }))
                        }
                    />
                    <PromptTaskSettingsCard
                        title="Generazione Contenuto (zero_effort_generate)"
                        description="Genera il sito HTML/CSS/JS completo a partire dal prompt ottimizzato."
                        helperText="Usa un modello con finestra di contesto estesa. Temperature bassa (0.3–0.6). Token limite consigliato: 10000–16000."
                        value={generateTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setGenerateTask((prev) => ({ ...prev, [field]: value }))
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


// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCT_KEY = "default";
const OPTIMIZE_TASK_KEY = "zero_effort_optimize";
const GENERATE_TASK_KEY = "zero_effort_generate";

const TASK_DEFAULTS: Record<string, PromptTaskSettingDto> = {
    [OPTIMIZE_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
        temperature: 0.7,
        maxCompletionTokens: 1200,
        systemTemplate: "",
    },
    [GENERATE_TASK_KEY]: {
        enabled: true,
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M2.5",
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

    const [optimizeTask, setOptimizeTask] = useState<PromptTaskSettingDto>(
        TASK_DEFAULTS[OPTIMIZE_TASK_KEY],
    );
    const [generateTask, setGenerateTask] = useState<PromptTaskSettingDto>(
        TASK_DEFAULTS[GENERATE_TASK_KEY],
    );

    useEffect(() => {
        const t = getToken();
        if (!t) { router.replace("/login"); return; }
        setToken(t);
        void getAdminConfig(t)
            .then((cfg) => {
                const productSettings = cfg.governanceByProduct?.[DEFAULT_PRODUCT_KEY]?.promptTaskSettings ?? {};
                setOptimizeTask({
                    ...TASK_DEFAULTS[OPTIMIZE_TASK_KEY],
                    ...productSettings[OPTIMIZE_TASK_KEY],
                });
                setGenerateTask({
                    ...TASK_DEFAULTS[GENERATE_TASK_KEY],
                    ...productSettings[GENERATE_TASK_KEY],
                });
            })
            .catch(() => setError("Unable to load config."))
            .finally(() => setLoading(false));
    }, [router]);

    const hasChanges = useMemo(() => true, [optimizeTask, generateTask]);

    async function handleSave() {
        if (!token) return;
        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            await updateProductGovernance(token, DEFAULT_PRODUCT_KEY, {
                promptTaskSettings: {
                    [OPTIMIZE_TASK_KEY]: optimizeTask,
                    [GENERATE_TASK_KEY]: generateTask,
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
                    <CardTitle>Zero Effort — Task Settings</CardTitle>
                    <CardDescription>
                        Configura il provider, il modello e i parametri usati nelle due fasi del pipeline Zero Effort:
                        l&apos;ottimizzazione del brief in prompt strutturato e la generazione del contenuto HTML.
                        Le impostazioni si applicano al prodotto <code className="text-xs font-mono bg-muted px-1 rounded">default</code>.
                    </CardDescription>
                </CardHeader>
            </Card>

            <PromptTaskSettingsCard
                title="Ottimizzazione Brief (zero_effort_optimize)"
                description="Trasforma il brief normalizzato in un prompt strutturato e dettagliato, pronto per la generazione."
                helperText="Usa un modello capace di seguire istruzioni complesse. Temperature moderata (0.6–0.8). Token limite consigliato: 1000–1500."
                value={optimizeTask}
                onFieldChange={(field, value) =>
                    setOptimizeTask((prev) => ({ ...prev, [field]: value }))
                }
            />

            <PromptTaskSettingsCard
                title="Generazione Contenuto (zero_effort_generate)"
                description="Genera il sito HTML/CSS/JS completo a partire dal prompt ottimizzato."
                helperText="Usa un modello con finestra di contesto estesa. Temperature bassa (0.3–0.6). Token limite consigliato: 10000–16000."
                value={generateTask}
                onFieldChange={(field, value) =>
                    setGenerateTask((prev) => ({ ...prev, [field]: value }))
                }
            />

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
