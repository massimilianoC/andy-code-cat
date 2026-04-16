import type { AssetStyleRole } from "../../domain/entities/ProjectAsset";

export interface AssetSemanticMetadata {
    title: string;
    summary: string;
    description: string;
    tags: string[];
    colors: string[];
    mediaKind: "image" | "background" | "logo" | "icon" | "document" | "reference";
    classifierProvider: string;
    classifierModel: string;
    classifiedAt: Date;
}

const KNOWN_COLORS = [
    "red", "orange", "yellow", "green", "blue", "indigo", "violet", "purple", "pink",
    "black", "white", "gray", "grey", "gold", "silver", "brown", "teal", "cyan",
];

const STOPWORDS = new Set([
    "the", "and", "for", "with", "that", "this", "your", "from", "into", "della", "delle",
    "dello", "degli", "dell", "per", "con", "una", "uno", "the", "image", "background",
    "hero", "section", "project", "asset", "generate", "generated",
]);

export function safeAssetLabelFromText(input: string, fallback = "generated-media"): string {
    const normalized = input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
    return normalized || fallback;
}

function extractTags(text: string): string[] {
    const tokens = text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
    return [...new Set(tokens)].slice(0, 8);
}

function extractColors(text: string): string[] {
    const lower = text.toLowerCase();
    const hits = KNOWN_COLORS.filter((color) => lower.includes(color));
    return hits.length > 0 ? hits.slice(0, 5) : ["neutral"];
}

export function guessStyleRole(mediaKind: AssetSemanticMetadata["mediaKind"]): AssetStyleRole {
    switch (mediaKind) {
        case "background": return "background";
        case "logo": return "logo";
        case "icon": return "icon";
        case "reference": return "reference";
        default: return "material";
    }
}

export function buildAssetSemanticMetadata(input: {
    promptOrName: string;
    mimeType: string;
    mediaKind?: AssetSemanticMetadata["mediaKind"];
    classifierProvider?: string;
    classifierModel?: string;
}): AssetSemanticMetadata {
    const text = input.promptOrName.trim();
    const titleBase = text || "Untitled media";
    const mediaKind = input.mediaKind ?? (input.mimeType.startsWith("image/") ? "image" : input.mimeType === "text/uri-list" ? "reference" : "document");
    const tags = extractTags(titleBase);
    const colors = extractColors(titleBase);
    return {
        title: titleBase.slice(0, 80),
        summary: `${mediaKind} asset for ${tags.slice(0, 3).join(", ") || "project context"}`.slice(0, 180),
        description: titleBase.slice(0, 300),
        tags,
        colors,
        mediaKind,
        classifierProvider: input.classifierProvider ?? "system",
        classifierModel: input.classifierModel ?? "heuristic-media-classifier-v1",
        classifiedAt: new Date(),
    };
}

export function buildDeferredSvgPlaceholder(input: {
    title: string;
    prompt: string;
    mode: "foreground" | "background";
    phase: "queued" | "ready" | "failed";
}): Buffer {
    const palette = input.phase === "ready"
        ? { accent: "#22c55e", soft: "rgba(34,197,94,0.18)", label: "READY", subtitle: "AI media rendered and ready to replace the temporary state" }
        : input.phase === "failed"
            ? { accent: "#ef4444", soft: "rgba(239,68,68,0.18)", label: "FAILED", subtitle: "Generation failed — the workspace can safely keep the previous version" }
            : { accent: "#22d3ee", soft: "rgba(34,211,238,0.18)", label: "GENERATING", subtitle: "Loading AI media… this temporary card will be auto-replaced and versioned" };
    const bg = input.mode === "background" ? "#0f172a" : "#111827";
    const prompt = input.prompt.replace(/[<&>]/g, " ").slice(0, 180);
    const title = input.title.replace(/[<&>]/g, " ").slice(0, 56);
    const hint = input.phase === "queued"
        ? "You can keep working while the render finishes in background."
        : input.phase === "failed"
            ? "Retry with a refined prompt or keep the current artwork."
            : "The final asset has been stored in the project media library.";

    const statusGraphic = input.phase === "queued"
        ? `
    <g transform="translate(1080 150)">
      <circle cx="0" cy="0" r="40" fill="none" stroke="${palette.soft}" stroke-width="10" />
      <path d="M 0 -40 A 40 40 0 0 1 34 20" fill="none" stroke="${palette.accent}" stroke-width="10" stroke-linecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="1.1s" repeatCount="indefinite"/>
      </path>
    </g>`
        : `
    <g transform="translate(1080 150)">
      <circle cx="0" cy="0" r="40" fill="${palette.soft}" stroke="${palette.accent}" stroke-width="4" />
      <text x="0" y="14" text-anchor="middle" fill="${palette.accent}" font-size="46" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${input.phase === "ready" ? "✓" : "!"}</text>
    </g>`;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <rect x="50" y="50" width="1180" height="620" rx="24" fill="none" stroke="${palette.accent}" stroke-width="4" opacity="0.9"/>
  <rect x="80" y="92" width="190" height="42" rx="21" fill="${palette.soft}" stroke="${palette.accent}" stroke-width="1.5"/>
  <text x="175" y="120" text-anchor="middle" fill="${palette.accent}" font-size="20" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${palette.label}</text>
  <text x="80" y="180" fill="#f8fafc" font-size="42" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${title}</text>
  ${statusGraphic}
  <text x="80" y="238" fill="#cbd5e1" font-size="24" font-family="Segoe UI, Arial, sans-serif">${palette.subtitle}</text>
  <foreignObject x="80" y="280" width="1120" height="220">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Segoe UI,Arial,sans-serif;font-size:24px;line-height:1.45;color:#e2e8f0;">
      ${prompt}
    </div>
  </foreignObject>
  <rect x="80" y="540" width="1120" height="78" rx="16" fill="rgba(15,23,42,0.55)" stroke="rgba(148,163,184,0.22)" stroke-width="1"/>
  <text x="110" y="587" fill="#cbd5e1" font-size="20" font-family="Segoe UI, Arial, sans-serif">${hint}</text>
  <text x="80" y="650" fill="#94a3b8" font-size="18" font-family="Segoe UI, Arial, sans-serif">Mode: ${input.mode} · Phase: ${input.phase}</text>
</svg>`;

    return Buffer.from(svg.trim(), "utf-8");
}
