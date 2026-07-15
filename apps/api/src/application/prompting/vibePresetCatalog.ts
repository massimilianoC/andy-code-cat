import { PRESET_CATALOG, type ProjectPreset } from "../../domain/entities/ProjectPreset";

/**
 * Canonical preset context shared by intent classification and Zero Effort prefill.
 * Visibility in a UI catalog is deliberately not used as an AI-selection filter:
 * hidden specialist presets (for example freerunner) must remain matchable.
 */
export const VIBE_SELECTABLE_PRESETS: readonly ProjectPreset[] = PRESET_CATALOG;

function compact(value: string, max: number): string {
    return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildVibePresetCatalogContext(): string {
    return VIBE_SELECTABLE_PRESETS.map((preset) => [
        `id=${preset.id}`,
        `labels=${preset.labelEn || preset.label} | ${preset.labelIt || preset.label}`,
        `intent=${compact(preset.hint, 260)}`,
        `category=${preset.categoryLabel ?? preset.category ?? "custom"}`,
        `tags=${(preset.tags ?? []).join(", ") || "none"}`,
        `output=${preset.outputSpec.pageModel}/${preset.outputSpec.sectionModel}/${preset.outputSpec.viewportModel ?? "document_scroll"}${preset.outputSpec.printReady ? "/print-ready" : ""}`,
        `brief=${compact(preset.briefTemplate, 700)}`,
        `style=${compact(preset.styleTemplate, 420)}`,
        preset.briefGuideQuestions.length > 0
            ? `discovery=${preset.briefGuideQuestions.map((question) => compact(question, 180)).join(" | ")}`
            : "",
    ].filter(Boolean).join("\n")).join("\n\n");
}

export function buildCanonicalPresetSelectionRules(): string {
    return `CANONICAL PRESET SELECTION CONTRACT (always authoritative)
- Select presetId exclusively from the complete catalog below.
- Match the intended deliverable, behavior, viewport, interaction model, and specialist description; do not match only surface words.
- Prefer the most specific preset. Never collapse a playable, presentation, print, form, immersive, or branching experience into landing/website.
- "infinite runner", "endless runner", "runner infinito", "gioco di corsa infinita" and equivalent requests map to freerunner.
- Generic 2D playable games map to videogame; educational/training games to seriousgame; explicit 3D games to game3d; VR/WebXR/A-Frame to vr-aframe; branching narratives to interactive-story.
- data-dashboard is selected only for an explicit analytical/data-dashboard request or explicit data-dashboard mode.
- When evidence is ambiguous, choose neutral. Do not use landing as a generic fallback.

COMPLETE PRESET CATALOG — shared with Zero Effort prefill:
${buildVibePresetCatalogContext()}`;
}
