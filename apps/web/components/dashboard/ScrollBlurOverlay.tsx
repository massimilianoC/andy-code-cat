"use client";

import { useScrollRatio } from "@/hooks/useScrollRatio";

/**
 * Progressive blur overlay for the VibeCore sticky section.
 * `position: absolute` — lives inside the sticky VibeCoreEntry wrapper,
 * so it only blurs the VibeCore content as the legacy dashboard slides over it.
 * `pointer-events: none` — never intercepts clicks or drag events.
 */
export function ScrollBlurOverlay() {
    const ratio = useScrollRatio(80, 500);

    if (ratio <= 0) return null;

    return (
        <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none z-20"
            style={{
                opacity: ratio,
                backdropFilter: `blur(${ratio * 10}px) saturate(${1 + ratio * 0.4})`,
                background: `rgba(10,10,18,${ratio * 0.78})`,
            }}
        />
    );
}
