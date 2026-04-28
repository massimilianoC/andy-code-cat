"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MonacoCodeEditor } from "@/components/admin/MonacoCodeEditor";

interface PromptWorkbenchPanelProps {
    title: string;
    description: string;
    editorLabel: string;
    value: string;
    onChange: (value: string) => void;
    onRun: () => void;
    runLabel: string;
    running?: boolean;
    helperText?: string;
    statusText?: string | null;
}

export function PromptWorkbenchPanel({
    title,
    description,
    editorLabel,
    value,
    onChange,
    onRun,
    runLabel,
    running = false,
    helperText,
    statusText,
}: PromptWorkbenchPanelProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription className="text-xs">{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1">
                    <Label>{editorLabel}</Label>
                    <MonacoCodeEditor
                        language="markdown"
                        height="160px"
                        value={value}
                        onChange={onChange}
                    />
                </div>

                {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
                {statusText ? <p className="text-xs text-primary">{statusText}</p> : null}

                <div className="flex flex-wrap gap-3">
                    <Button type="button" onClick={onRun} disabled={running || !value.trim()}>
                        {running ? "Working…" : runLabel}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
