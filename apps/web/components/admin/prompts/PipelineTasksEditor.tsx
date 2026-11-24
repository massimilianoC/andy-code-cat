"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import {
    getAdminConfig,
    getAdminLlmRegistry,
    getAdminPromptRegistry,
    updateProductGovernance,
    type AdminLlmProviderDto,
    type PromptTaskSettingDto,
    type PromptTaskDescriptorDto,
} from "@/lib/api/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PromptTaskSettingsCard } from "@/components/admin/PromptTaskSettingsCard";
import { resolvePromptTaskSettingAgainstCatalog } from "@/lib/adminLlmCatalog";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PRODUCT_KEY = "default";
const CLASSIFY_TASK_KEY       = "vibe_intent_classify";
const PREFILL_TASK_KEY        = "vibe_intent_prefill";
// These three storage keys are FROZEN — they are live MongoDB keys under
// PlatformConfig.governanceByProduct.<product>.promptTaskSettings in production.
// resolvePromptTaskSettingFromConfig silently falls back to unrelated defaults (much smaller
// token budgets) on an unknown key, with no error raised — renaming these would silently
// truncate every optimized brief/generation in production. Only the local constant NAMES may
// change; the string VALUES must not. See docs/specs/GUIDED_MODE_PREFILL_SPEC.md.
const OPTIMIZE_TASK_KEY       = "zero_effort_optimize";
const GENERATE_TASK_KEY       = "zero_effort_generate";
const VIBE_GENERATE_TASK_KEY  = "vibe_mode_generate";
const PROJECT_MODE_GENERATE_TASK_KEY = "god_mode_generate";

// Routing-only structural defaults (provider/model/temperature/token budget). These are NOT
// prompt text — the actual default *text* for a task's system-template slot (when one
// exists) always comes from the /v1/admin/prompt-registry endpoint, never from a literal
// string here. See taskPromptRegistry.ts on the backend for the source of truth.
const TASK_ROUTING_DEFAULTS: Record<string, Omit<PromptTaskSettingDto, "systemTemplate" | "systemTemplateBaselineHash">> = {
    [CLASSIFY_TASK_KEY]:          { enabled: true, provider: "", model: "", temperature: 0.0, maxCompletionTokens: 24000 },
    [PREFILL_TASK_KEY]:           { enabled: true, provider: "", model: "", temperature: 0.3, maxCompletionTokens: 32000 },
    [OPTIMIZE_TASK_KEY]:          { enabled: true, provider: "", model: "", temperature: 0.7, maxCompletionTokens: 32000 },
    [GENERATE_TASK_KEY]:          { enabled: true, provider: "", model: "", temperature: 0.5, maxCompletionTokens: 14000 },
    [VIBE_GENERATE_TASK_KEY]:     { enabled: true, provider: "", model: "", temperature: 0.5, maxCompletionTokens: 14000 },
    [PROJECT_MODE_GENERATE_TASK_KEY]: { enabled: true, provider: "", model: "", temperature: 0.5, maxCompletionTokens: 14000 },
};

function emptyTask(key: string): PromptTaskSettingDto {
    return { ...TASK_ROUTING_DEFAULTS[key], systemTemplate: "", systemTemplateBaselineHash: undefined };
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * The model, temperature, token budget and (where the registry has a slot) system template of
 * each Vibe / Guided / Project pipeline stage. Saves only these six tasks, so it cannot overwrite
 * what the System prompts editor saves (docs/specs/SUPER_ADMIN_SPEC.md, "Information architecture").
 */
export function PipelineTasksEditor() {
    const router = useRouter();
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const [providers, setProviders] = useState<AdminLlmProviderDto[]>([]);
    const [registryTasks, setRegistryTasks] = useState<Record<string, PromptTaskDescriptorDto>>({});

    function mergeTask(
        key: string,
        saved: Partial<PromptTaskSettingDto> | undefined,
        nextProviders: AdminLlmProviderDto[],
        preferredProvider?: string,
    ): PromptTaskSettingDto {
        return resolvePromptTaskSettingAgainstCatalog(
            { ...emptyTask(key), ...(saved ?? {}) },
            nextProviders,
            { preferredProvider, requiredCapability: "chat" },
        );
    }

    const [classifyTask,      setClassifyTask]      = useState<PromptTaskSettingDto>(emptyTask(CLASSIFY_TASK_KEY));
    const [prefillTask,       setPrefillTask]        = useState<PromptTaskSettingDto>(emptyTask(PREFILL_TASK_KEY));
    const [optimizeTask,      setOptimizeTask]       = useState<PromptTaskSettingDto>(emptyTask(OPTIMIZE_TASK_KEY));
    const [generateTask,      setGenerateTask]       = useState<PromptTaskSettingDto>(emptyTask(GENERATE_TASK_KEY));
    const [vibeGenerateTask,  setVibeGenerateTask]   = useState<PromptTaskSettingDto>(emptyTask(VIBE_GENERATE_TASK_KEY));
    const [projectModeGenerateTask, setProjectModeGenerateTask] = useState<PromptTaskSettingDto>(emptyTask(PROJECT_MODE_GENERATE_TASK_KEY));

    // Snapshot taken right after a successful load/save — used to gate the Save button on
    // whether anything actually changed, instead of always allowing a save.
    const [savedSnapshot, setSavedSnapshot] = useState<string>("");

    function currentTasks(): Record<string, PromptTaskSettingDto> {
        return {
            [CLASSIFY_TASK_KEY]: classifyTask,
            [PREFILL_TASK_KEY]: prefillTask,
            [OPTIMIZE_TASK_KEY]: optimizeTask,
            [GENERATE_TASK_KEY]: generateTask,
            [VIBE_GENERATE_TASK_KEY]: vibeGenerateTask,
            [PROJECT_MODE_GENERATE_TASK_KEY]: projectModeGenerateTask,
        };
    }

    const hasChanges = JSON.stringify(currentTasks()) !== savedSnapshot;

    useEffect(() => {
        const t = getToken();
        if (!t) { router.replace("/login"); return; }
        setToken(t);
        void Promise.all([
            getAdminConfig(t),
            getAdminLlmRegistry(t),
            getAdminPromptRegistry(t),
        ]).then(([cfg, registry, promptRegistry]) => {
            const productSettings = cfg.governanceByProduct?.[DEFAULT_PRODUCT_KEY]?.promptTaskSettings ?? {};
            const nextProviders = registry.providers ?? [];
            const tasksByKey = Object.fromEntries(promptRegistry.tasks.map((task) => [task.key, task]));
            setRegistryTasks(tasksByKey);

            const nextClassify = mergeTask(CLASSIFY_TASK_KEY, productSettings[CLASSIFY_TASK_KEY], nextProviders, registry.activeProvider);
            const nextPrefill = mergeTask(PREFILL_TASK_KEY, productSettings[PREFILL_TASK_KEY], nextProviders, registry.activeProvider);
            const nextOptimize = mergeTask(OPTIMIZE_TASK_KEY, productSettings[OPTIMIZE_TASK_KEY], nextProviders, registry.activeProvider);
            const nextGenerate = mergeTask(GENERATE_TASK_KEY, productSettings[GENERATE_TASK_KEY], nextProviders, registry.activeProvider);
            const nextVibeGenerate = mergeTask(VIBE_GENERATE_TASK_KEY, productSettings[VIBE_GENERATE_TASK_KEY], nextProviders, registry.activeProvider);
            const nextProjectModeGenerate = mergeTask(PROJECT_MODE_GENERATE_TASK_KEY, productSettings[PROJECT_MODE_GENERATE_TASK_KEY], nextProviders, registry.activeProvider);

            setClassifyTask(nextClassify);
            setPrefillTask(nextPrefill);
            setOptimizeTask(nextOptimize);
            setGenerateTask(nextGenerate);
            setVibeGenerateTask(nextVibeGenerate);
            setProjectModeGenerateTask(nextProjectModeGenerate);
            setProviders(nextProviders);
            setSavedSnapshot(JSON.stringify({
                [CLASSIFY_TASK_KEY]: nextClassify,
                [PREFILL_TASK_KEY]: nextPrefill,
                [OPTIMIZE_TASK_KEY]: nextOptimize,
                [GENERATE_TASK_KEY]: nextGenerate,
                [VIBE_GENERATE_TASK_KEY]: nextVibeGenerate,
                [PROJECT_MODE_GENERATE_TASK_KEY]: nextProjectModeGenerate,
            }));
        })
        .catch(() => setError("Unable to load the configuration."))
        .finally(() => setLoading(false));
    }, [router]);

    /** Attaches the registry's current defaultTextHash as the saved baseline whenever a non-empty override is being persisted; clears it otherwise. */
    function withBaselineHash(key: string, task: PromptTaskSettingDto): PromptTaskSettingDto {
        if (!task.systemTemplate.trim()) return { ...task, systemTemplateBaselineHash: undefined };
        return { ...task, systemTemplateBaselineHash: registryTasks[key]?.defaultTextHash };
    }

    async function handleSave() {
        if (!token) return;
        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            const payload = {
                [CLASSIFY_TASK_KEY]:          withBaselineHash(CLASSIFY_TASK_KEY, classifyTask),
                [PREFILL_TASK_KEY]:           withBaselineHash(PREFILL_TASK_KEY, prefillTask),
                [OPTIMIZE_TASK_KEY]:          withBaselineHash(OPTIMIZE_TASK_KEY, optimizeTask),
                [GENERATE_TASK_KEY]:          generateTask,
                [VIBE_GENERATE_TASK_KEY]:     vibeGenerateTask,
                [PROJECT_MODE_GENERATE_TASK_KEY]: projectModeGenerateTask,
            };
            await updateProductGovernance(token, DEFAULT_PRODUCT_KEY, { promptTaskSettings: payload });
            setSuccess(true);
            setSavedSnapshot(JSON.stringify(payload));
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
            {/* ── VibeCore section ─────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Vibe — prompt analysis</CardTitle>
                    <CardDescription>
                        The two stages that read the user's prompt before anything is generated.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                    <PromptTaskSettingsCard
                        title="Layer Φ — intent classification (vibe_intent_classify)"
                        description="Picks the template (templateId) and the format hint. A fast model, temperature 0."
                        helperText="Use a fast, instruction-following model. The canonical preset-selection contract (procedure + annotated catalog) is always appended by the backend after this template and cannot be overridden."
                        value={classifyTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setClassifyTask((prev) => ({ ...prev, [field]: value }))
                        }
                        registryDefaultText={registryTasks[CLASSIFY_TASK_KEY]?.defaultText}
                        registryDefaultTextHash={registryTasks[CLASSIFY_TASK_KEY]?.defaultTextHash}
                        routingOnly={registryTasks[CLASSIFY_TASK_KEY]?.operatorSlotId === undefined}
                    />
                    <PromptTaskSettingsCard
                        title="Brief prefill (vibe_intent_prefill)"
                        description="Chooses the preset from the same catalog as Vibe and drafts the whole Guided brief: structure, content, features, interactions, visuals, constraints and success criteria."
                        helperText="The backend always prepends the current contract and catalog: this override is advisory and cannot narrow the schema. Keep at least 6,000 tokens — the full 19-field brief needs ~2,100–5,800 output tokens, and below that the descriptive fields are cut short."
                        value={prefillTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setPrefillTask((prev) => ({ ...prev, [field]: value }))
                        }
                        registryDefaultText={registryTasks[PREFILL_TASK_KEY]?.defaultText}
                        registryDefaultTextHash={registryTasks[PREFILL_TASK_KEY]?.defaultTextHash}
                        routingOnly={registryTasks[PREFILL_TASK_KEY]?.operatorSlotId === undefined}
                    />
                </CardContent>
            </Card>

            {/* ── Guided Mode pipeline section ─────────────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Guided and Project generation</CardTitle>
                    <CardDescription>
                        The stages that turn the brief into a structured prompt and generate the site.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                    <PromptTaskSettingsCard
                        title="Brief optimization (zero_effort_optimize)"
                        description="Turns the normalized brief into a detailed, structured generation prompt."
                        helperText="Use a model that follows complex instructions. Moderate temperature (0.6–0.8). 32,000 tokens by default so optimized prompts are not cut short."
                        value={optimizeTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setOptimizeTask((prev) => ({ ...prev, [field]: value }))
                        }
                        registryDefaultText={registryTasks[OPTIMIZE_TASK_KEY]?.defaultText}
                        registryDefaultTextHash={registryTasks[OPTIMIZE_TASK_KEY]?.defaultTextHash}
                        routingOnly={registryTasks[OPTIMIZE_TASK_KEY]?.operatorSlotId === undefined}
                    />
                    <PromptTaskSettingsCard
                        title="Guided generation (zero_effort_generate)"
                        description="Generates the full HTML/CSS/JS site from the optimized prompt (direct Guided flow)."
                        helperText="Use a long-context model. Low temperature (0.3–0.6). Suggested token budget: 10,000–16,000."
                        value={generateTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setGenerateTask((prev) => ({ ...prev, [field]: value }))
                        }
                        registryDefaultText={registryTasks[GENERATE_TASK_KEY]?.defaultText}
                        registryDefaultTextHash={registryTasks[GENERATE_TASK_KEY]?.defaultTextHash}
                        routingOnly={registryTasks[GENERATE_TASK_KEY]?.operatorSlotId === undefined}
                    />
                    <PromptTaskSettingsCard
                        title="Vibe generation (vibe_mode_generate)"
                        description="Generates the site for projects started from Vibe (including Auto background runs and the launch page)."
                        helperText="Use a long-context model. Low temperature. Suggested token budget: 10,000–16,000."
                        value={vibeGenerateTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setVibeGenerateTask((prev) => ({ ...prev, [field]: value }))
                        }
                        registryDefaultText={registryTasks[VIBE_GENERATE_TASK_KEY]?.defaultText}
                        registryDefaultTextHash={registryTasks[VIBE_GENERATE_TASK_KEY]?.defaultTextHash}
                        routingOnly={registryTasks[VIBE_GENERATE_TASK_KEY]?.operatorSlotId === undefined}
                    />
                    <PromptTaskSettingsCard
                        title="Project generation (god_mode_generate)"
                        description="Generates the site for projects started from Project mode or from the workspace with auto-templating."
                        helperText="Use a long-context model. Low temperature. Suggested token budget: 10,000–16,000."
                        value={projectModeGenerateTask}
                        providers={providers}
                        onFieldChange={(field, value) =>
                            setProjectModeGenerateTask((prev) => ({ ...prev, [field]: value }))
                        }
                        registryDefaultText={registryTasks[PROJECT_MODE_GENERATE_TASK_KEY]?.defaultText}
                        registryDefaultTextHash={registryTasks[PROJECT_MODE_GENERATE_TASK_KEY]?.defaultTextHash}
                        routingOnly={registryTasks[PROJECT_MODE_GENERATE_TASK_KEY]?.operatorSlotId === undefined}
                    />
                </CardContent>
            </Card>

            {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {error}
                </div>
            )}
            {success && (
                <div className="rounded-md border border-success/40 bg-success/10 px-4 py-2 text-sm text-success">
                    Pipeline tasks saved.
                </div>
            )}

            <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
                {hasChanges && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
                <Button onClick={handleSave} disabled={saving || !hasChanges}>
                    {saving ? "Saving…" : "Save pipeline tasks"}
                </Button>
            </div>
        </div>
    );
}
