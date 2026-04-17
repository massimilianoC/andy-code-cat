"use client";

export type PreviewViewport = "mobile" | "tablet" | "desktop";

/** Returns the constrained iframe width in pixels, or null for full-width. */
export function viewportWidth(v: PreviewViewport): number | null {
    if (v === "mobile") return 390;
    if (v === "tablet") return 768;
    return null;
}

interface PreviewViewportSelectorProps {
    value: PreviewViewport;
    onChange: (v: PreviewViewport) => void;
}

const OPTIONS: { key: PreviewViewport; icon: string; label: string; detail: string }[] = [
    { key: "mobile", icon: "📱", label: "Mobile", detail: "390px · 6.7\"" },
    { key: "tablet", icon: "🪟", label: "Tablet", detail: "768px · 10\"" },
    { key: "desktop", icon: "🖥", label: "Desktop", detail: "13\"+" },
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
