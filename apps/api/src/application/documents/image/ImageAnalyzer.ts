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
}

const VISION_PROMPT = `You are an asset classification specialist for a web design platform.
Analyze this image and return a JSON object with exactly the following fields.
Do not include any text before or after the JSON object.

{
  "sceneDescription": "<1-3 sentence plain description>",
  "detectedObjects": ["<object>"],
  "detectedThemes": ["<theme>"],
  "moodLabel": "<single word or short phrase>",
  "visualComplexity": "minimal|moderate|complex",
  "compositionType": "<null or composition style>",
  "imageCategory": "photograph|illustration|logo|icon|screenshot|diagram|infographic|texture_pattern|typographic|abstract|unknown",
  "hasText": true,
  "detectedTextSnippet": "<null or up to 300 chars>",
  "hasLogo": false,
  "hasPeople": false,
  "hasProduct": false,
  "layoutStyle": "<null or layout label>",
  "suggestedWebUse": ["<use>"],
  "dominantHex": ["#rrggbb"],
  "dominantNames": ["<color name>"],
  "backgroundTone": "light|dark|mixed",
  "accentColor": "<null or #rrggbb>",
  "paletteLabel": "<short palette description>",
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
        max_tokens: 1024,
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
        usage?: { total_tokens?: number };
    };

    const raw = json.choices?.[0]?.message?.content ?? "";
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
        detectedObjects: strings(parsed["detectedObjects"], 10),
        detectedThemes: strings(parsed["detectedThemes"], 6),
        moodLabel: typeof parsed["moodLabel"] === "string" ? parsed["moodLabel"] : "unknown",
        moodScore: typeof parsed["moodScore"] === "number" ? parsed["moodScore"] : null,
        visualComplexity: safeComplexity(parsed["visualComplexity"]),
        compositionType: typeof parsed["compositionType"] === "string" ? parsed["compositionType"] : null,
    };

    const designSignals: ImageDesignSignals = {
        imageCategory: safeCategory(parsed["imageCategory"]),
        hasText: parsed["hasText"] === true,
        detectedTextSnippet: typeof parsed["detectedTextSnippet"] === "string"
            ? parsed["detectedTextSnippet"].slice(0, 300)
            : null,
        hasLogo: parsed["hasLogo"] === true,
        hasPeople: parsed["hasPeople"] === true,
        hasProduct: parsed["hasProduct"] === true,
        layoutStyle: typeof parsed["layoutStyle"] === "string" ? parsed["layoutStyle"] : null,
        aspectRatioLabel: null,
        suggestedWebUse: strings(parsed["suggestedWebUse"], 3),
        suggestedStyleRole: "inspiration",
    };

    return { colorPalette, visualAnalysis, designSignals, tokensUsed };
}
