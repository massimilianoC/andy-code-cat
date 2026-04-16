import type { ImagePromptContextPacket } from "./buildImagePromptContext";

export const DEFAULT_SUGGEST_IMAGE_IDEA_SYSTEM_TEMPLATE = `You are a visual art-direction assistant inside a website builder.

Your task is to suggest what kind of image would fit the currently selected page element.

Return exactly one valid JSON object and nothing else:
{
  "suggestion": "a short, user-facing idea in plain language, max 180 chars",
  "prompt": "a concise image-generation prompt in English, ready to use"
}

RULES
- The suggestion must be easy to read and helpful for a non-technical user.
- The suggestion should describe what would look good in the slot, not how to code it.
- The prompt must be coherent with the project style, palette, and page context.
- Do not mention HTML, CSS, JS, layout code, JSON, or technical implementation.
- Do not add text overlays or logos unless explicitly requested.
- If the user prompt is empty or vague, infer a tasteful default from the provided context.`;

export function buildSuggestImageIdeaRequest(input: {
    rawPrompt?: string;
    packet: ImagePromptContextPacket;
    systemTemplate?: string;
}): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = (input.systemTemplate || DEFAULT_SUGGEST_IMAGE_IDEA_SYSTEM_TEMPLATE).trim();

    const userPrompt = [
        "Suggest one image direction for the current page element.",
        `Project name: ${input.packet.projectName}`,
        `Project type: ${input.packet.projectType}`,
        `Target mode: ${input.packet.targetMode}`,
        `Section role: ${input.packet.sectionRole}`,
        input.packet.aspectRatioHint ? `Aspect guidance: ${input.packet.aspectRatioHint}` : "",
        input.packet.paletteHints.length ? `Palette hints: ${input.packet.paletteHints.join(", ")}` : "",
        input.packet.styleHints.length ? `Style hints: ${input.packet.styleHints.join(", ")}` : "",
        input.packet.brandContextHints.length ? `Brand context: ${input.packet.brandContextHints.join(", ")}` : "",
        input.packet.compositionHints.length ? `Composition hints: ${input.packet.compositionHints.join(", ")}` : "",
        input.packet.assetHints.length ? `Reference cues: ${input.packet.assetHints.join(", ")}` : "",
        input.rawPrompt?.trim() ? `Optional user hint: ${input.rawPrompt.trim()}` : "",
        "Return the short suggestion plus a ready-to-use image prompt.",
    ].filter(Boolean).join("\n\n");

    return { systemPrompt, userPrompt };
}
