"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface LlmProviderErrorDialogState {
    title: string;
    message: string;
    code?: string;
    provider?: string;
    model?: string;
    keyEnvironmentVariable?: string;
}

interface LlmProviderErrorDialogProps {
    open: boolean;
    error: LlmProviderErrorDialogState | null;
    onOpenChange: (open: boolean) => void;
}

export function LlmProviderErrorDialog({ open, error, onOpenChange }: LlmProviderErrorDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <DialogTitle>{error?.title ?? "Errore provider LLM"}</DialogTitle>
                        {error?.code ? <Badge variant="destructive">{error.code}</Badge> : null}
                    </div>
                    <DialogDescription>{error?.message}</DialogDescription>
                </DialogHeader>

                <div className="space-y-3 rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground">
                    {error?.provider ? (
                        <div>
                            <span className="font-medium">Provider:</span> {error.provider}
                        </div>
                    ) : null}
                    {error?.model ? (
                        <div>
                            <span className="font-medium">Modello:</span> {error.model}
                        </div>
                    ) : null}
                    {error?.keyEnvironmentVariable ? (
                        <div>
                            <span className="font-medium">Variabile richiesta:</span> {error.keyEnvironmentVariable}
                        </div>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button type="button" onClick={() => onOpenChange(false)}>
                        Chiudi
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}