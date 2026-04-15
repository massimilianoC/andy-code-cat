"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";
import type { PromptTaskSettingDto } from "@/lib/api/admin";

interface PromptTaskSettingsCardProps {
    title: string;
    description: string;
    helperText?: string;
    value: PromptTaskSettingDto;
    onFieldChange: <K extends keyof PromptTaskSettingDto>(key: K, value: PromptTaskSettingDto[K]) => void;
}

export function PromptTaskSettingsCard({
    title,
    description,
    helperText,
    value,
    onFieldChange,
}: PromptTaskSettingsCardProps) {
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
                <div className="space-y-1">
                    <Label>Provider</Label>
                    <Input value={value.provider} onChange={(e) => onFieldChange("provider", e.target.value)} placeholder="siliconflow" />
                </div>
                <div className="space-y-1">
                    <Label>Model</Label>
                    <Input value={value.model} onChange={(e) => onFieldChange("model", e.target.value)} placeholder="MiniMaxAI/MiniMax-M2.5" />
                </div>
                <div className="space-y-1">
                    <Label>Temperature</Label>
                    <Input type="number" step="0.1" value={String(value.temperature)} onChange={(e) => onFieldChange("temperature", Number(e.target.value) || 0)} />
                </div>
                <div className="space-y-1">
                    <Label>Max completion tokens</Label>
                    <Input type="number" value={String(value.maxCompletionTokens)} onChange={(e) => onFieldChange("maxCompletionTokens", Number(e.target.value) || 256)} />
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
