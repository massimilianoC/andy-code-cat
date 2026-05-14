"use client";

import { useScrollRatio } from "@/hooks/useScrollRatio";

/**
 * Sticky overlay that fades in as the user scrolls down past the VibeCore section.
 * `pointer-events: none` — never intercepts clicks.
 * `position: fixed` so it covers the VibeCore section regardless of layout.
 */
export function ScrollBlurOverlay() {
    const ratio = useScrollRatio(80, 220);

    if (ratio <= 0) return null;

    return (
        <div
            aria-hidden="true"
            className="fixed inset-0 pointer-events-none z-10"
            style={{
                opacity: ratio,
                backdropFilter: `blur(${ratio * 8}px)`,
                background: `rgba(10,10,18,${ratio * 0.7})`,
                transition: "none",
            }}
        />
    );
}
