"use client";

/**
 * Full-bleed SVG blob background for the VibeCore entry section.
 * Pure CSS animation — no JS loops, no canvas.
 * `aria-hidden` keeps it invisible to screen readers.
 */
export function VibeCoreBackground() {
    return (
        <div
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ zIndex: 0 }}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 1440 900"
                preserveAspectRatio="xMidYMid slice"
                className="absolute inset-0 w-full h-full"
                aria-hidden="true"
            >
                <defs>
                    <filter id="vc-blur">
                        <feGaussianBlur stdDeviation="80" />
                    </filter>
                </defs>
                <g filter="url(#vc-blur)">
                    {/* violet — top-left */}
                    <ellipse
                        className="vc-blob-1"
                        cx="300"
                        cy="200"
                        rx="320"
                        ry="280"
                        fill="#8b5cf6"
                        fillOpacity="0.18"
                        style={{ willChange: "transform" }}
                    />
                    {/* blue — top-right */}
                    <ellipse
                        className="vc-blob-2"
                        cx="1160"
                        cy="180"
                        rx="280"
                        ry="260"
                        fill="#3b82f6"
                        fillOpacity="0.13"
                        style={{ willChange: "transform" }}
                    />
                    {/* emerald — bottom-left */}
                    <ellipse
                        className="vc-blob-3"
                        cx="200"
                        cy="720"
                        rx="260"
                        ry="200"
                        fill="#10b981"
                        fillOpacity="0.10"
                        style={{ willChange: "transform" }}
                    />
                    {/* violet — bottom-right */}
                    <ellipse
                        className="vc-blob-4"
                        cx="1280"
                        cy="750"
                        rx="300"
                        ry="240"
                        fill="#8b5cf6"
                        fillOpacity="0.12"
                        style={{ willChange: "transform" }}
                    />
                </g>
            </svg>
            {/* Dark overlay for contrast */}
            <div className="absolute inset-0" style={{ background: "rgba(10,10,18,0.88)" }} />
        </div>
    );
}
