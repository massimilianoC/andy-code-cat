"use client";

export type PreviewViewport = "mobile" | "tablet" | "desktop";

/**
 * Device reference dimensions (CSS logical pixels):
 *   mobile  — iPhone 15 / Samsung S24 average  390 × 844  (ratio ~9:19.5)
 *   tablet  — iPad 10.9" / 10" Android avg     820 × 1180 (ratio ~0.695:1)
 *   desktop — full container, no fixed height
 */
export interface ViewportDims {
    w: number;
    h: number;
}

export function viewportDimensions(v: PreviewViewport): ViewportDims | null {
    if (v === "mobile") return { w: 390, h: 844 };
    if (v === "tablet") return { w: 820, h: 1180 };
    return null;
}

/** Returns the constrained iframe width in pixels, or null for full-width (desktop). */
export function viewportWidth(v: PreviewViewport): number | null {
    return viewportDimensions(v)?.w ?? null;
}

interface PreviewViewportSelectorProps {
    value: PreviewViewport;
    onChange: (v: PreviewViewport) => void;
}

// Ordered: desktop first, then tablet, then mobile
const OPTIONS: { key: PreviewViewport; icon: string; label: string; detail: string }[] = [
    { key: "desktop", icon: "🖥",  label: "Desktop", detail: "full · 13\"+" },
    { key: "tablet",  icon: "🪟",  label: "Tablet",  detail: "820×1180 · 10.9\"" },
    { key: "mobile",  icon: "📱",  label: "Mobile",  detail: "390×844 · 6.7\"" },
];

export function PreviewViewportSelector({ value, onChange }: PreviewViewportSelectorProps) {
    return (
        <div className="preview-viewport-selector">
            {OPTIONS.map((opt) => (
                <button
                    key={opt.key}
                    type="button"
                    className="secondary"
                    data-active={value === opt.key ? "true" : "false"}
                    onClick={() => onChange(opt.key)}
                    title={`${opt.label} — ${opt.detail}`}
                    style={{ fontSize: "0.72rem", padding: "0.15rem 0.55rem", gap: "0.3rem", display: "inline-flex", alignItems: "center" }}
                >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                    <span style={{ opacity: 0.55, fontSize: "0.68rem" }}>{opt.detail}</span>
                </button>
            ))}
        </div>
    );
}
