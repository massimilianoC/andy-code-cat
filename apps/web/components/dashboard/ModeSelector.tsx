"use client";

import { cn } from "@/lib/utils";

export type EntryMode = "vibe" | "guided" | "project";

interface ModeSelectorProps {
    value: EntryMode;
    onChange: (mode: EntryMode) => void;
}

const MODE_CONFIG: Record<
    EntryMode,
    { label: string; color: string; description: string }
> = {
    vibe:    { label: "VIBE",    color: "#8b5cf6", description: "One prompt, the AI does the rest" },
    guided:  { label: "GUIDED",  color: "#3b82f6", description: "Step-by-step guidance with a smart form" },
    project: { label: "PROJECT", color: "#10b981", description: "Full control in the editor" },
};

/**
 * Segmented 3-part pill selector (VIBE / GUIDED / PROJECT).
 * Glow accent color follows the active mode.
 * Mode is persisted in localStorage under `vibe_mode`.
 */
export function ModeSelector({ value, onChange }: ModeSelectorProps) {
    const modes: EntryMode[] = ["vibe", "guided", "project"];

    return (
        <div
            role="group"
            aria-label="Modalità di creazione"
            className="flex items-center gap-px p-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm"
        >
            {modes.map((mode) => {
                const cfg = MODE_CONFIG[mode];
                const isActive = value === mode;

                return (
                    <button
                        key={mode}
                        type="button"
                        title={cfg.description}
                        aria-pressed={isActive}
                        onClick={() => onChange(mode)}
                        className={cn(
                            "relative px-3 py-1 text-xs font-semibold rounded-full transition-all duration-200",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
                            isActive
                                ? "text-white bg-white/10"
                                : "text-white/40 hover:text-white/70 hover:bg-white/5",
                        )}
                        style={
                            isActive
                                ? {
                                      borderColor: `${cfg.color}80`,
                                      boxShadow: `0 0 0 1px ${cfg.color}40, 0 0 12px ${cfg.color}20`,
                                      border: `1px solid ${cfg.color}50`,
                                  }
                                : {}
                        }
                    >
                        {cfg.label}
                    </button>
                );
            })}
        </div>
    );
}
