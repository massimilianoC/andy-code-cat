"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { MediaItem } from "./types";

export interface MediaThumbnailProps {
    item: MediaItem;
    selected?: boolean;
    onClick?: (item: MediaItem) => void;
    className?: string;
}

/**
 * A single media thumbnail card.
 *
 * Renders a preview image (foreground or background placeholder),
 * an optional label, and dimensions badge.
 * Reusable anywhere a compact media preview is needed.
 */
export function MediaThumbnail({ item, selected, onClick, className }: MediaThumbnailProps) {
    const dims =
        item.width && item.height ? `${item.width}×${item.height}` : undefined;
    const isBg = item.mediaType === "background";
    const [imageFailed, setImageFailed] = React.useState(false);

    React.useEffect(() => {
        setImageFailed(false);
    }, [item.src]);

    return (
        <button
            type="button"
            onClick={() => onClick?.(item)}
            title={`${isBg ? "BG: " : ""}${item.alt || item.label || item.id}${dims ? `\n${dims}` : ""}`}
            className={cn(
                "flex flex-col items-center gap-1 p-1.5 rounded-md border cursor-pointer w-full",
                "transition-colors duration-150",
                selected
                    ? "border-primary/80 bg-primary/10"
                    : "border-border bg-card/30 hover:bg-card/60",
                className,
            )}
        >
            {/* Preview area */}
            <div className="w-full aspect-[4/3] rounded overflow-hidden bg-background/80 flex items-center justify-center">
                {item.src && !imageFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={item.src}
                        alt={item.alt || item.label || item.id}
                        className="max-w-full max-h-full object-contain block"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() => setImageFailed(true)}
                    />
                ) : (
                    <span className="px-2 text-center text-[10px] text-muted-foreground leading-tight">
                        {item.label || item.alt || item.id}
                    </span>
                )}
            </div>

            {/* Label + dims */}
            <span className="text-[0.62rem] text-muted-foreground truncate max-w-full text-center leading-tight">
                {isBg ? "🎨 " : ""}
                {item.label ?? item.id}
                {dims ? ` ${dims}` : ""}
            </span>
        </button>
    );
}
