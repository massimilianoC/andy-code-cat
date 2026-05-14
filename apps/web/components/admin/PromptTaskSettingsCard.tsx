"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";
import type { PromptTaskSettingDto, AdminLlmProviderDto } from "@/lib/api/admin";

// Shared class matching shadcn Input visual style for native <select>.
// `[color-scheme:dark]` forces the browser to render native dropdown chrome in dark mode.
const SELECT_CLASS =
    "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
    "disabled:cursor-not-allowed disabled:opacity-50 " +
    "[color-scheme:dark]";

/** Maps the org prefix of a model ID to a human-readable manufacturer name. */
function getManufacturer(modelId: string): string {
    const org = modelId.split("/")[0];
    const NAMES: Record<string, string> = {
        "google":             "Google",
        "anthropic":          "Anthropic",
        "openai":             "OpenAI",
        "Qwen":               "Qwen / Alibaba",
        "deepseek-ai":        "DeepSeek",
        "deepseek":           "DeepSeek",
        "MiniMaxAI":          "MiniMax",
        "zai-org":            "Zhipu AI",
        "z-ai":               "Zhipu AI",
        "THUDM":              "Zhipu AI",
        "black-forest-labs":  "Black Forest Labs",
        "BAAI":               "BAAI",
        "liquid":             "Liquid AI",
        "nvidia":             "NVIDIA",
        "moonshotai":         "Moonshot / Kimi",
        "meta-llama":         "Meta",
        "mistralai":          "Mistral",
        "microsoft":          "Microsoft",
        "tencent":            "Tencent",
        "ByteDance-Seed":     "ByteDance",
        "stepfun-ai":         "StepFun",
        "baidu":              "Baidu",
        "inclusionAI":        "InclusionAI",
        "nex-agi":            "Nex AGI",
        "Tongyi-MAI":         "Alibaba Tongyi",
        "Wan-AI":             "Wan AI",
    };
    return NAMES[org] ?? org;
}

/** Groups models by manufacturer, preserving insertion order within each group. */
function groupByManufacturer<T extends { id: string }>(models: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const m of models) {
        const maker = getManufacturer(m.id);
        const bucket = map.get(maker);
        if (bucket) {
            bucket.push(m);
        } else {
            map.set(maker, [m]);
        }
    }
    return map;
}

interface PromptTaskSettingsCardProps {
    title: string;
    description: string;
    helperText?: string;
    value: PromptTaskSettingDto;
    onFieldChange: <K extends keyof PromptTaskSettingDto>(key: K, value: PromptTaskSettingDto[K]) => void;
    /** When provided, renders provider + model as catalog-driven dropdowns. */
    providers?: AdminLlmProviderDto[];
}

export function PromptTaskSettingsCard({
    title,
    description,
    helperText,
    value,
    onFieldChange,
    providers,
}: PromptTaskSettingsCardProps) {
    const activeProviders = providers?.filter((p) => p.isActive) ?? [];
    const selectedProvider = activeProviders.find((p) => p.provider === value.provider) ?? activeProviders[0];
    const modelOptions = selectedProvider?.models.filter((m) => m.isActive) ?? [];

    function handleProviderChange(providerKey: string) {
        onFieldChange("provider", providerKey);
        const prov = activeProviders.find((p) => p.provider === providerKey);
        const firstModel = prov?.models.find((m) => m.isActive)?.id ?? "";
        onFieldChange("model", firstModel);
    }

    return (
        <div className="border-t border-border pt-4 space-y-4">
            <div className="space-y-1">
                <Label>{title}</Label>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>

            <div className="flex items-center gap-3">
                <Button
                    type="button"
                    variant={value.enabled ? "default" : "outline"}
                    onClick={() => onFieldChange("enabled", !value.enabled)}
                >
                    {value.enabled ? "Enabled" : "Disabled"}
                </Button>
                {helperText ? <span className="text-xs text-muted-foreground">{helperText}</span> : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Provider */}
                <div className="space-y-1">
                    <Label>Provider</Label>
                    {activeProviders.length > 0 ? (
                        <select
                            className={SELECT_CLASS}
                            value={value.provider}
                            onChange={(e) => handleProviderChange(e.target.value)}
                        >
                            {activeProviders.map((p) => (
                                <option key={p.provider} value={p.provider}>
                                    {p.provider}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <Input
                            value={value.provider}
                            onChange={(e) => onFieldChange("provider", e.target.value)}
                            placeholder="siliconflow"
                        />
                    )}
                </div>

                {/* Model */}
                <div className="space-y-1">
                    <Label>Model</Label>
                    {modelOptions.length > 0 ? (
                        <select
                            className={SELECT_CLASS}
                            value={value.model}
                            onChange={(e) => onFieldChange("model", e.target.value)}
                        >
                            {Array.from(groupByManufacturer(modelOptions)).map(([maker, group]) => (
                                <optgroup key={maker} label={maker}>
                                    {group.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.displayName ?? m.id}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    ) : (
                        <Input
                            value={value.model}
                            onChange={(e) => onFieldChange("model", e.target.value)}
                            placeholder="model-id"
                        />
                    )}
                </div>

                <div className="space-y-1">
                    <Label>Temperature</Label>
                    <Input
                        type="number"
                        step="0.1"
                        value={String(value.temperature)}
                        onChange={(e) => onFieldChange("temperature", Number(e.target.value) || 0)}
                    />
                </div>
                <div className="space-y-1">
                    <Label>Max completion tokens</Label>
                    <Input
                        type="number"
                        value={String(value.maxCompletionTokens)}
                        onChange={(e) => onFieldChange("maxCompletionTokens", Number(e.target.value) || 256)}
                    />
                </div>
            </div>

            <div className="space-y-1">
                <Label>System template override</Label>
                <MonacoCodeEditor
                    language="markdown"
                    value={value.systemTemplate}
                    onChange={(v) => onFieldChange("systemTemplate", v)}
                />
            </div>
        </div>
    );
}

