"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MediaThumbnail } from "./MediaThumbnail";
import type { MediaItem, MediaFilter } from "./types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface MediaGridProps {
    /** Full list of items (filtering is applied internally). */
    items: MediaItem[];
    /** Currently selected item id. */
    selectedId?: string | null;
    /** Called when the user clicks an item. */
    onSelect?: (item: MediaItem) => void;
    /** Optional declarative filter chips. The first filter is active by default when `defaultFilter` is not set. */
    filters?: MediaFilter[];
    /** Key of the initially active filter (defaults to "all"). */
    defaultFilter?: string;
    /** Section title shown in the header. */
    title?: string;
    /** Extra actions rendered at the right of the header (e.g. refresh button). */
    headerActions?: React.ReactNode;
    /** Text shown when the (filtered) list is empty. */
    emptyMessage?: string;
    /** Grid column count (Tailwind grid-cols). Defaults to 2. */
    columns?: 1 | 2 | 3 | 4;
    /** Additional CSS class on the outermost wrapper. */
    className?: string;
}

/* ------------------------------------------------------------------ */
/*  Column helpers                                                     */
/* ------------------------------------------------------------------ */

const colsClass: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
};

/* ------------------------------------------------------------------ */
/*  Built-in "all" filter                                              */
/* ------------------------------------------------------------------ */

const ALL_FILTER: MediaFilter = {
    key: "all",
    label: "Tutti",
    match: () => true,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reusable media grid with optional type-filter chips.
 *
 * Designed to work as:
 * - EDIT-mode image sidebar (page assets)
 * - Project asset gallery panel
 * - Account media library
 * - Any thumbnail-grid picker
 */
export function MediaGrid({
    items,
    selectedId,
    onSelect,
    filters,
    defaultFilter,
    title,
    headerActions,
    emptyMessage = "Nessun elemento",
    columns = 2,
    className,
}: MediaGridProps) {
    /* ---- filter state ---- */
    const allFilters = React.useMemo<MediaFilter[]>(
        () => (filters && filters.length > 0 ? [ALL_FILTER, ...filters] : [ALL_FILTER]),
        [filters],
    );

    const [activeFilter, setActiveFilter] = React.useState<string>(
        defaultFilter ?? "all",
    );

    const activeMatcher = React.useMemo(
        () => allFilters.find((f) => f.key === activeFilter)?.match ?? ALL_FILTER.match,
        [allFilters, activeFilter],
    );

    const filtered = React.useMemo(
        () => items.filter(activeMatcher),
        [items, activeMatcher],
    );

    return (
        <div
            className={cn(
                "flex flex-col h-full min-h-0 bg-card/40 border-l border-border",
                className,
            )}
        >
            {/* ---- Header ---- */}
            <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
                <span className="text-[0.68rem] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    {title ?? "Media"}
                    <Badge variant="outline" className="ml-1 text-[0.6rem] px-1.5 py-0">
                        {filtered.length}
                    </Badge>
                </span>
                {headerActions && (
                    <div className="flex items-center gap-1">{headerActions}</div>
                )}
            </div>

            {/* ---- Filter chips (only if >1 filter beyond "all") ---- */}
            {allFilters.length > 1 && (
                <div className="flex flex-wrap gap-1 px-2 pb-1.5 shrink-0">
                    {allFilters.map((f) => (
                        <button
                            key={f.key}
                            type="button"
                            onClick={() => setActiveFilter(f.key)}
                            className={cn(
                                "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[0.6rem] font-medium border transition-colors cursor-pointer",
                                activeFilter === f.key
                                    ? "border-primary/60 bg-primary/15 text-foreground"
                                    : "border-border bg-transparent text-muted-foreground hover:bg-card/60",
                            )}
                        >
                            {f.icon}
                            {f.label}
                        </button>
                    ))}
                </div>
            )}

            {/* ---- Grid ---- */}
            <ScrollArea className="flex-1 min-h-0">
                {filtered.length === 0 ? (
                    <p className="text-center text-muted-foreground text-xs py-6 px-2">
                        {emptyMessage}
                    </p>
                ) : (
                    <div className={cn("grid gap-1.5 p-2", colsClass[columns])}>
                        {filtered.map((item) => (
                            <MediaThumbnail
                                key={item.id}
                                item={item}
                                selected={selectedId === item.id}
                                onClick={onSelect}
                            />
                        ))}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}
