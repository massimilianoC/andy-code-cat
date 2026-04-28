"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminConfig,
    updateProductGovernance,
    type PromptTaskSettingDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PromptTaskSettingsCard } from "@/components/admin/PromptTaskSettingsCard";

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
