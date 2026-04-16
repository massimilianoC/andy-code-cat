import type { ImagePromptContextPacket } from "./buildImagePromptContext";

export const DEFAULT_OPTIMIZE_IMAGE_PROMPT_SYSTEM_TEMPLATE = `You rewrite a user's raw image request into a compact, vivid, production-ready prompt for an image generation model.

GOAL
- Preserve the user's original intent.
- Strengthen the brief with visual direction, composition, palette, mood, and brand coherence.
- Produce a prompt that is directly usable for image generation.

IMPORTANT RULES
- Return only the final optimized prompt text in English.
- Do not use bullets, numbering, JSON, markdown, or explanations.
- Do not mention HTML, CSS, JavaScript, UI code, JSON schemas, or implementation details.
- Do not invent a completely different subject than the user requested.
- Keep it concise but rich, roughly 60 to 140 words.
- Add style and color guidance only when it helps the original request.
- Avoid text overlay, watermark, or logo instructions unless the user explicitly asked for them.`;

export function buildOptimizeImagePromptRequest(input: {
    rawPrompt: string;
    packet: ImagePromptContextPacket;
    systemTemplate?: string;
}): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = (input.systemTemplate || DEFAULT_OPTIMIZE_IMAGE_PROMPT_SYSTEM_TEMPLATE).trim();

    const userPrompt = [
        "Optimize this image-generation brief using the provided project context.",
        `Project name: ${input.packet.projectName}`,
        `Project type: ${input.packet.projectType}`,
        `Target mode: ${input.packet.targetMode}`,
        `Section role: ${input.packet.sectionRole}`,
        input.packet.aspectRatioHint ? `Aspect guidance: ${input.packet.aspectRatioHint}` : "",
        input.packet.paletteHints.length ? `Palette hints: ${input.packet.paletteHints.join(", ")}` : "",
        input.packet.styleHints.length ? `Style hints: ${input.packet.styleHints.join(", ")}` : "",
        input.packet.brandContextHints.length ? `Brand and business context: ${input.packet.brandContextHints.join(", ")}` : "",
        input.packet.compositionHints.length ? `Composition hints: ${input.packet.compositionHints.join(", ")}` : "",
        input.packet.assetHints.length ? `Reference cues: ${input.packet.assetHints.join(", ")}` : "",
        `Original user request: ${input.rawPrompt}`,
        "Return one final optimized prompt in English, ready for the image model.",
    ].filter(Boolean).join("\n\n");

    return { systemPrompt, userPrompt };
}
