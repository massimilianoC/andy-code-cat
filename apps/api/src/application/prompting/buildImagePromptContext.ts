import type { LlmFocusContext } from "@andy-code-cat/contracts";
import { PRESET_MAP } from "../../domain/entities/ProjectPreset";
import type { Project } from "../../domain/entities/Project";
import type { ProjectMoodboard } from "../../domain/entities/ProjectMoodboard";
import type { UserStyleProfile } from "../../domain/entities/UserStyleProfile";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";

export interface ImagePromptContextPacket {
    projectName: string;
    projectType: string;
    targetMode: "foreground" | "background";
    sectionRole: string;
    contentHint?: string;
    aspectRatioHint?: string;
    paletteHints: string[];
    styleHints: string[];
    brandContextHints: string[];
    compositionHints: string[];
    assetHints: string[];
    selectedAssetIds: string[];
    contextSummary: string;
}

const STYLE_KEYWORDS = [
    "minimal", "modern", "luxury", "premium", "editorial", "cinematic", "clean", "bold",
    "playful", "professional", "warm", "cool", "soft", "organic", "geometric", "dramatic",
    "elegant", "refined", "natural", "vibrant", "moody", "bright", "dark", "immersive",
];

function cleanText(value: unknown): string {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .replace(/[\r\n]+/g, " ")
        .trim();
}

function normalizePhrase(value: string): string {
    return cleanText(value)
        .replace(/[_-]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .slice(0, 80);
}

function uniquePhrases(values: Array<string | undefined | null>, max = 8): string[] {
    const out: string[] = [];
    const seen = new Set<string>();

    for (const raw of values) {
        const normalized = raw ? normalizePhrase(raw) : "";
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
        if (out.length >= max) break;
    }

    return out;
}

function extractTemplateHints(prePromptTemplate?: string): string[] {
    const lower = cleanText(prePromptTemplate).toLowerCase();
    if (!lower) return [];

    return uniquePhrases(
        STYLE_KEYWORDS.filter((keyword) => lower.includes(keyword)),
        6,
    );
}

function inferSectionRole(
    selectedElement: LlmFocusContext["selectedElement"] | undefined,
    targetMode: "foreground" | "background",
): string {
    const haystack = [
        selectedElement?.selector,
        selectedElement?.tag,
        selectedElement?.currentAlt,
        selectedElement?.textSnippet,
    ].filter(Boolean).join(" ").toLowerCase();

    if (haystack.includes("hero") || haystack.includes("banner")) return targetMode === "background" ? "hero background" : "hero image";
    if (haystack.includes("logo")) return "logo area";
    if (haystack.includes("gallery") || haystack.includes("portfolio")) return "gallery image";
    if (haystack.includes("team") || haystack.includes("avatar") || haystack.includes("portrait")) return "portrait slot";
    if (haystack.includes("card") || haystack.includes("tile")) return "content card";
    if (haystack.includes("testimonial") || haystack.includes("review")) return "testimonial section";
    if (haystack.includes("service") || haystack.includes("feature")) return "service feature section";
    if (haystack.includes("product") || haystack.includes("menu")) return "product showcase";
    if (haystack.includes("cta") || haystack.includes("contact")) return "call-to-action section";
    return targetMode === "background" ? "section background" : "content image";
}

function inferAspectRatioHint(selectedElement?: LlmFocusContext["selectedElement"]): string | undefined {
    const ratio = typeof selectedElement?.aspectRatio === "number" && Number.isFinite(selectedElement.aspectRatio)
        ? selectedElement.aspectRatio
        : undefined;

    if (!ratio) return undefined;
    if (ratio >= 1.45) return "wide horizontal composition, safe for hero cropping";
    if (ratio <= 0.8) return "vertical composition, safe for portrait cropping";
    return "balanced composition, safe for square or mid-frame cropping";
}

function collectPaletteHints(input: {
    moodboard?: ProjectMoodboard | null;
    userProfile?: UserStyleProfile | null;
    assets?: ProjectAsset[];
    prePromptTemplate?: string;
}): string[] {
    const assetColors = (input.assets ?? [])
        .flatMap((asset) => asset.semanticMetadata?.colors ?? [])
        .slice(0, 10);

    const freeColorMatches = cleanText(input.userProfile?.preferredColorText)
        .split(/[;,\.]/)
        .map((entry) => normalizePhrase(entry))
        .filter(Boolean);

    const templateMatches = extractTemplateHints(input.prePromptTemplate)
        .filter((entry) => ["warm", "cool", "bright", "dark", "vibrant", "natural"].includes(entry.toLowerCase()));

    return uniquePhrases([
        ...(input.moodboard?.paletteTags ?? []),
        ...(input.userProfile?.paletteTags ?? []),
        ...freeColorMatches,
        ...assetColors,
        ...templateMatches,
    ], 7);
}

function collectStyleHints(input: {
    moodboard?: ProjectMoodboard | null;
    userProfile?: UserStyleProfile | null;
    prePromptTemplate?: string;
    project?: Project | null;
}): string[] {
    const preset = input.project?.presetId ? PRESET_MAP.get(input.project.presetId) : undefined;

    return uniquePhrases([
        ...(input.moodboard?.visualTags ?? []),
        ...(input.moodboard?.toneTags ?? []),
        ...(input.moodboard?.referenceTags ?? []),
        ...(input.moodboard?.eraTags ?? []),
        ...(input.userProfile?.visualTags ?? []),
        ...(input.userProfile?.toneTags ?? []),
        ...(input.userProfile?.typographyTags ?? []),
        ...(input.userProfile?.layoutTags ?? []),
        ...(preset?.defaultTags.visualTags ?? []),
        ...(preset?.defaultTags.toneTags ?? []),
        ...(preset?.defaultTags.layoutTags ?? []),
        ...extractTemplateHints(input.prePromptTemplate),
    ], 10);
}

function collectBrandContextHints(input: {
    moodboard?: ProjectMoodboard | null;
    userProfile?: UserStyleProfile | null;
}): string[] {
    return uniquePhrases([
        input.moodboard?.projectBrief,
        input.moodboard?.targetBusiness,
        input.moodboard?.styleNotes,
        ...(input.moodboard?.sectorTags ?? []),
        ...(input.moodboard?.audienceTags ?? []),
        ...(input.moodboard?.featureTags ?? []),
        input.userProfile?.brandBio,
        ...(input.userProfile?.sectorTags ?? []),
        ...(input.userProfile?.audienceTags ?? []),
        ...(input.userProfile?.featureTags ?? []),
        ...(input.userProfile?.identityTags ?? []),
    ], 8);
}

function collectAssetHints(assets: ProjectAsset[]): { assetHints: string[]; selectedAssetIds: string[] } {
    const chosen = assets
        .filter((asset) => asset.useInProject || asset.styleRole === "reference" || asset.styleRole === "logo" || asset.styleRole === "background" || asset.styleRole === "material")
        .slice(0, 4);

    return {
        assetHints: uniquePhrases(
            chosen.flatMap((asset) => [
                asset.label,
                asset.descriptionText,
                asset.semanticMetadata?.summary,
                ...(asset.semanticMetadata?.tags ?? []),
            ]),
            8,
        ),
        selectedAssetIds: chosen.map((asset) => asset.id),
    };
}

function collectCompositionHints(input: {
    targetMode: "foreground" | "background";
    sectionRole: string;
    selectedElement?: LlmFocusContext["selectedElement"];
}): string[] {
    const hints: string[] = [];

    if (input.targetMode === "background") {
        hints.push("leave clean breathing room for interface overlay");
        hints.push("avoid cluttered focal points in the center");
    } else {
        hints.push("single clear subject with clean separation from the background");
        hints.push("fit naturally inside the existing layout slot");
    }

    if (input.sectionRole.includes("hero")) {
        hints.push("high visual impact with strong first-screen readability");
    }

    const ratio = typeof input.selectedElement?.aspectRatio === "number" && Number.isFinite(input.selectedElement.aspectRatio)
        ? input.selectedElement.aspectRatio
        : undefined;

    if (ratio && ratio >= 1.45) {
        hints.push("wide cinematic framing");
    } else if (ratio && ratio <= 0.8) {
        hints.push("vertical editorial framing");
    } else {
        hints.push("balanced framing");
    }

    return uniquePhrases(hints, 6);
}

export function buildImagePromptContextPacket(input: {
    project: Project;
    moodboard?: ProjectMoodboard | null;
    userProfile?: UserStyleProfile | null;
    assets?: ProjectAsset[];
    targetMode: "foreground" | "background";
    selectedElement?: LlmFocusContext["selectedElement"];
    prePromptTemplate?: string;
}): ImagePromptContextPacket {
    const preset = input.project.presetId ? PRESET_MAP.get(input.project.presetId) : undefined;
    const sectionRole = inferSectionRole(input.selectedElement, input.targetMode);
    const contentHint = normalizePhrase(input.selectedElement?.textSnippet ?? "") || undefined;
    const aspectRatioHint = inferAspectRatioHint(input.selectedElement);
    const paletteHints = collectPaletteHints(input);
    const styleHints = collectStyleHints(input);
    const brandContextHints = collectBrandContextHints(input);
    const { assetHints, selectedAssetIds } = collectAssetHints(input.assets ?? []);
    const compositionHints = collectCompositionHints({
        targetMode: input.targetMode,
        sectionRole,
        selectedElement: input.selectedElement,
    });

    const summaryParts = [
        `project=${input.project.name}`,
        `type=${preset?.labelEn ?? input.project.presetId ?? "generic website"}`,
        `role=${sectionRole}`,
        contentHint ? `content=${contentHint}` : "",
        paletteHints.length ? `palette=${paletteHints.join(", ")}` : "",
        styleHints.length ? `style=${styleHints.join(", ")}` : "",
        brandContextHints.length ? `brand=${brandContextHints.join(", ")}` : "",
    ].filter(Boolean);

    return {
        projectName: input.project.name,
        projectType: preset?.labelEn ?? input.project.presetId ?? "website",
        targetMode: input.targetMode,
        sectionRole,
        contentHint,
        aspectRatioHint,
        paletteHints,
        styleHints,
        brandContextHints,
        compositionHints,
        assetHints,
        selectedAssetIds,
        contextSummary: summaryParts.join(" | "),
    };
}

export function buildContextAwareImagePrompt(input: {
    rawPrompt: string;
    packet: ImagePromptContextPacket;
}): string {
    const paletteLine = input.packet.paletteHints.length
        ? `Color direction: ${input.packet.paletteHints.join(", ")}.`
        : "";
    const styleLine = input.packet.styleHints.length
        ? `Style direction: ${input.packet.styleHints.join(", ")}.`
        : "";
    const brandLine = input.packet.brandContextHints.length
        ? `Brand context: ${input.packet.brandContextHints.join(", ")}.`
        : "";
    const compositionLine = input.packet.compositionHints.length
        ? `Composition: ${input.packet.compositionHints.join(", ")}.`
        : "";
    const assetLine = input.packet.assetHints.length
        ? `Reference cues: ${input.packet.assetHints.join(", ")}.`
        : "";

    return cleanText([
        `Create a ${input.packet.targetMode === "background" ? "background visual" : "foreground image"} for a ${input.packet.projectType} project named ${input.packet.projectName}.`,
        `Main request: ${cleanText(input.rawPrompt)}.`,
        `This visual is intended for the ${input.packet.sectionRole} of the page.`,
        input.packet.contentHint ? `The surrounding section message is: ${input.packet.contentHint}.` : "",
        paletteLine,
        styleLine,
        brandLine,
        compositionLine,
        input.packet.aspectRatioHint ? `${input.packet.aspectRatioHint}.` : "",
        assetLine,
        "Keep the result cohesive with the brand, photoreal or illustratively polished as appropriate, and suitable for a modern professional website.",
        "Avoid text overlays, watermarks, UI chrome, or accidental logos unless explicitly requested by the user.",
    ].filter(Boolean).join(" "));
}
