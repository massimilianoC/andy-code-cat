import { jsonrepair } from "jsonrepair";
import type { ImageColorPalette, ImageVisualAnalysis, ImageDesignSignals, ImageCategory } from "../../../domain/entities/AssetEnrichmentTrace";
import { normalizeHexList } from "./ColorPaletteNormalizer";

export interface ImageAnalysisInput {
    buffer: Buffer;
    mimeType: string;
    baseUrl: string;
    model: string;
    authHeader: string | undefined;
}

export interface ImageAnalysisOutput {
    colorPalette: ImageColorPalette;
    visualAnalysis: ImageVisualAnalysis;
    designSignals: ImageDesignSignals;
    tokensUsed: number | null;
    /** Structured token breakdown when the provider exposes it. Optional for backward compat. */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

const VISION_PROMPT = `You are an asset classification specialist for a web design platform.
Analyze this image thoroughly and return a JSON object with exactly the following fields.
Do not include any text before or after the JSON object.
Be specific and detailed — generic descriptions like "a scene with objects" are not acceptable.

{
  "sceneDescription": "<3-5 sentence description covering: (1) what the image depicts overall, (2) foreground subjects in detail, (3) background and setting, (4) spatial composition and layout, (5) overall context or narrative conveyed>",
  "detectedObjects": ["<up to 20 specific objects, subjects, or elements visible — be precise, e.g. 'red ceramic mug', 'laptop keyboard', 'mountain range in background'>"],
  "detectedThemes": ["<up to 8 conceptual themes or narratives, e.g. 'technology', 'wellness', 'urban lifestyle', 'minimalism'>"],
  "moodLabel": "<detailed mood or emotional tone, e.g. 'energetic and bold', 'calm and professional', 'nostalgic and warm'>",
  "visualComplexity": "minimal|moderate|complex",
  "compositionType": "<null or detailed composition style, e.g. 'rule of thirds with subject left', 'centered symmetrical', 'flat lay top-down', 'hero shot', 'split-panel', 'full bleed texture'>",
  "imageCategory": "photograph|illustration|logo|icon|screenshot|diagram|infographic|texture_pattern|typographic|abstract|unknown",
  "hasText": false,
  "detectedTextSnippet": "<null or all legible text in the image, up to 500 chars — include headlines, labels, captions, UI text>",
  "hasLogo": false,
  "hasPeople": false,
  "hasProduct": false,
  "layoutStyle": "<null or layout description, e.g. 'horizontal banner', 'square card', 'portrait hero', 'wide landscape', 'isometric grid'>",
  "suggestedWebUse": ["<up to 6 specific web design use cases, e.g. 'hero background', 'product card image', 'team portrait', 'section divider', 'favicon', 'testimonial avatar'>"],
  "dominantHex": ["#rrggbb — up to 8 dominant colors in descending frequency"],
  "dominantNames": ["<descriptive color name for each hex, e.g. 'deep navy', 'warm coral', 'sage green'>"],
  "backgroundTone": "light|dark|mixed",
  "accentColor": "<null or #rrggbb of the most visually prominent accent>",
  "paletteLabel": "<creative palette label, e.g. 'earthy terracotta with sage accents', 'monochrome midnight blues'>",
  "moodScore": 0.8
}`;

function toDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

const VALID_CATEGORIES = new Set<ImageCategory>([
    "photograph", "illustration", "logo", "icon", "screenshot",
    "diagram", "infographic", "texture_pattern", "typographic", "abstract", "unknown",
]);

function safeCategory(raw: unknown): ImageCategory {
    return VALID_CATEGORIES.has(raw as ImageCategory) ? (raw as ImageCategory) : "unknown";
}

function safeComplexity(raw: unknown): ImageVisualAnalysis["visualComplexity"] {
    const valid = new Set(["minimal", "moderate", "complex", "unknown"]);
    return valid.has(raw as string) ? (raw as ImageVisualAnalysis["visualComplexity"]) : "unknown";
}

function safeBgTone(raw: unknown): ImageColorPalette["backgroundTone"] {
    const valid = new Set(["light", "dark", "mixed", "unknown"]);
    return valid.has(raw as string) ? (raw as ImageColorPalette["backgroundTone"]) : "unknown";
}

function strings(v: unknown, max: number): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter(x => typeof x === "string").slice(0, max) as string[];
}

export async function analyzeImage(input: ImageAnalysisInput): Promise<ImageAnalysisOutput> {
    const dataUrl = toDataUrl(input.buffer, input.mimeType);

    const body = {
        model: input.model,
        messages: [
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: dataUrl } },
                    { type: "text", text: VISION_PROMPT },
                ],
            },
        ],
        max_tokens: 1800,
        temperature: 0,
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (input.authHeader) headers["Authorization"] = input.authHeader;

    const res = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Error(`Vision model returned HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const raw = json.choices?.[0]?.message?.content ?? "";
    const promptTokens = Number(json.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(json.usage?.completion_tokens ?? 0);
    const totalTokens = Number(json.usage?.total_tokens ?? (promptTokens + completionTokens));
    const tokensUsed = json.usage?.total_tokens ?? null;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(jsonrepair(raw));
    } catch {
        throw new Error(`Vision model response could not be parsed as JSON. Raw: ${raw.slice(0, 200)}`);
    }

    const dominantHex = normalizeHexList(strings(parsed["dominantHex"], 10));
    const dominantNames = strings(parsed["dominantNames"], dominantHex.length);

    const colorPalette: ImageColorPalette = {
        dominantHex,
        dominantNames,
        backgroundTone: safeBgTone(parsed["backgroundTone"]),
        accentColor: typeof parsed["accentColor"] === "string" ? parsed["accentColor"] : null,
        paletteLabel: typeof parsed["paletteLabel"] === "string" ? parsed["paletteLabel"] : "",
    };

    const visualAnalysis: ImageVisualAnalysis = {
        sceneDescription: typeof parsed["sceneDescription"] === "string" ? parsed["sceneDescription"] : "",
        detectedObjects: strings(parsed["detectedObjects"], 20),
        detectedThemes: strings(parsed["detectedThemes"], 8),
        moodLabel: typeof parsed["moodLabel"] === "string" ? parsed["moodLabel"] : "unknown",
        moodScore: typeof parsed["moodScore"] === "number" ? parsed["moodScore"] : null,
        visualComplexity: safeComplexity(parsed["visualComplexity"]),
        compositionType: typeof parsed["compositionType"] === "string" ? parsed["compositionType"] : null,
    };

    const designSignals: ImageDesignSignals = {
        imageCategory: safeCategory(parsed["imageCategory"]),
        hasText: parsed["hasText"] === true,
        detectedTextSnippet: typeof parsed["detectedTextSnippet"] === "string"
            ? parsed["detectedTextSnippet"].slice(0, 500)
            : null,
        hasLogo: parsed["hasLogo"] === true,
        hasPeople: parsed["hasPeople"] === true,
        hasProduct: parsed["hasProduct"] === true,
        layoutStyle: typeof parsed["layoutStyle"] === "string" ? parsed["layoutStyle"] : null,
        aspectRatioLabel: null,
        suggestedWebUse: strings(parsed["suggestedWebUse"], 6),
        suggestedStyleRole: "inspiration",
    };

    return {
        colorPalette,
        visualAnalysis,
        designSignals,
        tokensUsed,
        usage: { promptTokens, completionTokens, totalTokens },
    };
}
