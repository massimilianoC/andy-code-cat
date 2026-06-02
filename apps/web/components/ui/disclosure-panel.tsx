"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DisclosurePanelProps {
    title: string;
    subtitle?: string;
    defaultOpen?: boolean;
    className?: string;
    contentClassName?: string;
    children: ReactNode;
}

export function DisclosurePanel({
    title,
    subtitle,
    defaultOpen = false,
    className,
    contentClassName,
    children,
}: DisclosurePanelProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={cn("rounded-md border border-border bg-background/60", className)}>
            <Button
                type="button"
                variant="ghost"
                className="flex h-auto w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setOpen((value) => !value)}
            >
                <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{title}</div>
                    {subtitle ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
                    ) : null}
                </div>
                <ChevronDown
                    className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        open ? "rotate-180" : "rotate-0",
                    )}
                />
            </Button>
            {open ? (
                <div className={cn("border-t border-border px-3 py-3", contentClassName)}>
                    {children}
                </div>
            ) : null}
        </div>
    );
}
