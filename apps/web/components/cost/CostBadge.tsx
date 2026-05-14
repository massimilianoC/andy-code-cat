"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import CostDetailDrawer from "./CostDetailDrawer";

export interface CostBadgeProps {
    amount: number;
    projectId?: string;
    userId?: string;
    scope: "project" | "user" | "system";
    label?: string;
    /** When true renders as a small inline badge; otherwise as a KPI card value */
    variant?: "inline" | "kpi";
    className?: string;
}

function formatEur(amount: number): string {
    if (amount === 0) return "€0.00";
    if (amount < 0.001) return `€${amount.toFixed(4)}`;
    if (amount < 0.01) return `€${amount.toFixed(3)}`;
    return `€${amount.toFixed(2)}`;
}

export default function CostBadge({
    amount,
    projectId,
    userId,
    scope,
    label,
    variant = "inline",
    className,
}: CostBadgeProps) {
    const [open, setOpen] = useState(false);
    const formatted = formatEur(amount);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={cn(
                    "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
                    className,
                )}
                aria-label={`${label ?? "Costo"}: ${formatted} — clicca per dettaglio`}
                title="Clicca per vedere il dettaglio costi"
            >
                {variant === "kpi" ? (
                    <span className="text-2xl font-bold text-foreground underline decoration-dotted underline-offset-4 hover:text-primary transition-colors">
                        {formatted}
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground transition-colors">
                        {label && <span>{label}:</span>}
                        <span className="font-mono font-semibold text-foreground underline decoration-dotted underline-offset-2">{formatted}</span>
                    </span>
                )}
            </button>
            {open && (
                <CostDetailDrawer
                    open={open}
                    onClose={() => setOpen(false)}
                    projectId={projectId}
                    userId={userId}
                    scope={scope}
                    label={label}
                />
            )}
        </>
    );
}
