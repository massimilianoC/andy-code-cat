"use client";

import React from "react";

export interface TagOption {
    id: string;
    label: string;
    emoji?: string;
    description?: string;
}

interface TagPickerProps {
    tags: TagOption[];
    selected: string[];
    onChange: (ids: string[]) => void;
    max?: number;
    className?: string;
}

export default function TagPicker({ tags, selected, onChange, max = 5, className = "" }: TagPickerProps) {
    function toggle(id: string) {
        if (selected.includes(id)) {
            onChange(selected.filter((s) => s !== id));
        } else {
            if (max && selected.length >= max) return;
            onChange([...selected, id]);
        }
    }

    return (
        <div className={`flex flex-wrap gap-2 ${className}`}>
            {tags.map((tag) => {
                const isSelected = selected.includes(tag.id);
                const isDisabled = !isSelected && selected.length >= max;
                return (
                    <button
                        key={tag.id}
                        type="button"
                        title={tag.description}
                        disabled={isDisabled}
                        onClick={() => toggle(tag.id)}
                        className={[
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all select-none",
                            isSelected
                                ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                : isDisabled
                                ? "bg-secondary/50 border-border text-muted-foreground/30 cursor-not-allowed"
                                : "bg-card border-border text-foreground hover:border-primary hover:text-primary cursor-pointer",
                        ].join(" ")}
                    >
                        {tag.emoji && <span className="text-base leading-none">{tag.emoji}</span>}
                        {tag.label}
                    </button>
                );
            })}
            {max && (
                <span className="self-center text-xs text-muted-foreground ml-1">
                    {selected.length}/{max}
                </span>
            )}
        </div>
    );
}
