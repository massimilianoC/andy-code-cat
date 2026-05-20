"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Full-bleed animated background for the VibeCore entry section.
 * Spinning-orb technique by Louis Hoebregts — pure CSS, no JS loops.
 * `aria-hidden` keeps it invisible to screen readers.
 *
 * Performance notes:
 * - Orb count reduced to 8 (from 16) to halve GPU compositing cost on older hardware.
 * - box-shadow offset reduced to ±50vmin (from ±80vmin) and blur to 8-10vmin (from 11-13vmin).
 * - IntersectionObserver pauses all animations when the section is scrolled out of view.
 * - `contain: layout paint` on the orb layer isolates repaints from the rest of the page.
 */

const ORBS: Array<{
    color: string; top: number; left: number; dur: number; delay: number;
    ox: number; oy: number; dir: 1 | -1; blur: number;
}> = [
    { color: "#7c3aed", top: 15, left: 25, dur:  45, delay:  -20, ox: -10, oy:   8, dir: -1, blur:  9 },
    { color: "#3b82f6", top: 75, left: 65, dur:  90, delay:  -60, ox:  12, oy: -15, dir:  1, blur: 10 },
    { color: "#f43f5e", top: 40, left: 85, dur:  60, delay:  -40, ox:  -5, oy: -20, dir:  1, blur:  8 },
    { color: "#4f46e5", top: 85, left: 20, dur:  75, delay:  -30, ox:   8, oy:   6, dir: -1, blur: 10 },
    { color: "#06b6d4", top: 10, left: 70, dur: 110, delay:  -80, ox: -18, oy:  12, dir:  1, blur:  9 },
    { color: "#7c3aed", top: 55, left: 10, dur:  55, delay:  -15, ox:  15, oy:  -8, dir:  1, blur: 10 },
    { color: "#14b8a6", top: 30, left: 45, dur:  85, delay:  -70, ox:  -6, oy:  18, dir: -1, blur:  8 },
    { color: "#f43f5e", top: 70, left: 90, dur:  40, delay:  -25, ox:  20, oy:   4, dir: -1, blur:  9 },
];

export function VibeCoreBackground() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                // Pause animations when the background is fully hidden by the scrolled-over main
                setPaused(!entry.isIntersecting);
            },
            { threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={containerRef}
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ zIndex: 0 }}
        >
            {/* Deep dark base */}
            <div className="absolute inset-0" style={{ background: "#070714" }} />

            {/* Spinning orbs — isolated paint layer, animations paused when off-screen */}
            <div className={`absolute inset-0 vc-orb-layer${paused ? " vc-orb-paused" : ""}`}>
                {ORBS.map((orb, i) => (
                    <span
                        key={i}
                        className="vc-orb"
                        style={{
                            color: orb.color,
                            top: `${orb.top}%`,
                            left: `${orb.left}%`,
                            animationDuration: `${orb.dur}s`,
                            animationDelay: `${orb.delay}s`,
                            transformOrigin: `${orb.ox}vw ${orb.oy}vh`,
                            boxShadow: `${orb.dir * 50}vmin 0 ${orb.blur}vmin currentColor`,
                        }}
                    />
                ))}
            </div>

            {/* Dark veil — preserves text contrast */}
            <div className="absolute inset-0" style={{ background: "rgba(7,7,20,0.74)" }} />
        </div>
    );
}

