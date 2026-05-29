"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";
import { ProviderModelPicker } from "@/components/llm/ProviderModelPicker";
import type { PromptTaskSettingDto, AdminLlmProviderDto } from "@/lib/api/admin";

interface PromptTaskSettingsCardProps {
    title: string;
    description: string;
    helperText?: string;
    value: PromptTaskSettingDto;
    onFieldChange: <K extends keyof PromptTaskSettingDto>(key: K, value: PromptTaskSettingDto[K]) => void;
    /** When provided, renders provider + model as catalog-driven dropdowns. */
    providers?: AdminLlmProviderDto[];
    requiredCapability?: "chat" | "vision" | "image_generation" | "video_generation" | "tools" | "embeddings";
}

export function PromptTaskSettingsCard({
    title,
    description,
    helperText,
    value,
    onFieldChange,
    providers,
    requiredCapability = "chat",
}: PromptTaskSettingsCardProps) {
    const activeProviders = providers
        ? providers
            .filter((provider) => provider.isActive)
            .map((provider) => ({
                ...provider,
                models: provider.models.filter((model) => model.isActive),
            }))
            .filter((provider) => provider.models.length > 0)
        : [];
    const selectedProvider = activeProviders.find((p) => p.provider === value.provider) ?? activeProviders[0];
    const modelOptions = selectedProvider?.models.filter((m) => m.isActive) ?? [];
    const selectedModelValue = modelOptions.some((model) => model.id === value.model)
        ? value.model
        : (modelOptions[0]?.id ?? value.model);

    function handleSelectionChange(next: { provider: string; model: string }) {
        onFieldChange("provider", next.provider);
        onFieldChange("model", next.model);
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

            <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="min-w-0 space-y-1 md:flex-1">
                    <Label>Provider & model</Label>
                    {activeProviders.length > 0 ? (
                        <ProviderModelPicker
                            providers={activeProviders}
                            valueProvider={selectedProvider?.provider ?? value.provider}
                            valueModel={selectedModelValue}
                            onChange={handleSelectionChange}
                            preferredCapability={requiredCapability}
                        />
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Input
                                value={value.provider}
                                onChange={(e) => onFieldChange("provider", e.target.value)}
                                placeholder="siliconflow"
                            />
                            <Input
                                value={value.model}
                                onChange={(e) => onFieldChange("model", e.target.value)}
                                placeholder="model-id"
                            />
                        </div>
                    )}
                </div>

                <div className="space-y-1 md:w-28">
                    <Label>Temperature</Label>
                    <Input
                        type="number"
                        step="0.1"
                        value={String(value.temperature)}
                        onChange={(e) => onFieldChange("temperature", Number(e.target.value) || 0)}
                    />
                </div>
                <div className="space-y-1 md:w-44">
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

