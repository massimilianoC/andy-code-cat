"use client";

/**
 * Full-bleed animated background for the VibeCore entry section.
 * Spinning-orb technique by Louis Hoebregts — pure CSS, no JS loops.
 * `aria-hidden` keeps it invisible to screen readers.
 */

const ORBS: Array<{
    color: string; top: number; left: number; dur: number; delay: number;
    ox: number; oy: number; dir: 1 | -1; blur: number;
}> = [
    { color: "#7c3aed", top: 15, left: 25, dur:  45, delay:  -20, ox: -10, oy:   8, dir: -1, blur: 11 },
    { color: "#3b82f6", top: 75, left: 65, dur:  90, delay:  -60, ox:  12, oy: -15, dir:  1, blur: 12 },
    { color: "#f43f5e", top: 40, left: 85, dur:  60, delay:  -40, ox:  -5, oy: -20, dir:  1, blur: 10 },
    { color: "#4f46e5", top: 85, left: 20, dur:  75, delay:  -30, ox:   8, oy:   6, dir: -1, blur: 13 },
    { color: "#06b6d4", top: 10, left: 70, dur: 110, delay:  -80, ox: -18, oy:  12, dir:  1, blur: 11 },
    { color: "#7c3aed", top: 55, left: 10, dur:  55, delay:  -15, ox:  15, oy:  -8, dir:  1, blur: 12 },
    { color: "#14b8a6", top: 30, left: 45, dur:  85, delay:  -70, ox:  -6, oy:  18, dir: -1, blur: 10 },
    { color: "#f43f5e", top: 70, left: 90, dur:  40, delay:  -25, ox:  20, oy:   4, dir: -1, blur: 11 },
    { color: "#4f46e5", top: 20, left:  5, dur: 100, delay:  -55, ox: -12, oy: -10, dir:  1, blur: 12 },
    { color: "#3b82f6", top: 90, left: 50, dur:  65, delay:  -45, ox:   4, oy:  14, dir:  1, blur: 10 },
    { color: "#06b6d4", top: 50, left: 75, dur:  95, delay:  -85, ox: -20, oy:  -5, dir: -1, blur: 13 },
    { color: "#7c3aed", top:  5, left: 40, dur:  70, delay:  -35, ox:  10, oy: -22, dir: -1, blur: 11 },
    { color: "#14b8a6", top: 60, left: 30, dur: 120, delay: -100, ox:  -8, oy:  10, dir:  1, blur: 12 },
    { color: "#f43f5e", top: 80, left: 80, dur:  50, delay:  -10, ox:   6, oy: -16, dir:  1, blur: 10 },
    { color: "#4f46e5", top: 25, left: 60, dur:  80, delay:  -65, ox: -22, oy:   2, dir: -1, blur: 11 },
    { color: "#3b82f6", top: 45, left: 15, dur: 115, delay:  -90, ox:  16, oy:  20, dir:  1, blur: 13 },
];

export function VibeCoreBackground() {
    return (
        <div
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ zIndex: 0 }}
        >
            {/* Deep dark base */}
            <div className="absolute inset-0" style={{ background: "#070714" }} />

            {/* Spinning orbs */}
            <div className="absolute inset-0">
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
                            boxShadow: `${orb.dir * 80}vmin 0 ${orb.blur}vmin currentColor`,
                        }}
                    />
                ))}
            </div>

            {/* Dark veil — preserves text contrast */}
            <div className="absolute inset-0" style={{ background: "rgba(7,7,20,0.74)" }} />
        </div>
    );
}
