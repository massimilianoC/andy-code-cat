import type { ProjectMoodboard } from "../../domain/entities/ProjectMoodboard";
import type { UserStyleProfile } from "../../domain/entities/UserStyleProfile";
import type { ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { PromptTaskSetting } from "../../domain/entities/PlatformConfig";

export const DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE = `You rewrite a user's raw creative brief into a stronger, richer, production-ready content prompt for the current project.

GOAL
- Preserve the user's original intent, meaning, domain, and explicit preferences.
- Enrich the brief so the platform can generate a better result with less effort from the user.
- Expand the brief coherently with stronger guidance about message, audience, tone, content priorities, visual mood, and calls to action.

STYLE POLICY
- Keep the result modern, fresh, vivid, and professional.
- Respect the script, style, sector, and preferences already expressed by the user.
- If the user already provided a detailed brief, refine it lightly instead of rewriting aggressively.

IMPORTANT BOUNDARIES
- Do NOT mention technical output architecture.
- Do NOT mention HTML, CSS, JS, JSON, single-file output, embedding, implementation details, or code constraints.
- Focus only on business intent, content direction, storytelling quality, brand feel, and creative guidance.

OUTPUT RULES
- Return only the optimized prompt text.
- Write in the same language as the user's input.
- Make it directly usable as the next user prompt in a generation workflow.`;

function formatTagLine(label: string, values: string[] | undefined): string {
    if (!values || values.length === 0) return "";
    return `${label}: ${values.join(", ")}`;
}

export function buildOptimizeUserPromptRequest(input: {
    rawPrompt: string;
    projectName?: string;
    projectType?: string;
    moodboard?: ProjectMoodboard | null;
    userProfile?: UserStyleProfile | null;
    assets?: ProjectAsset[];
    taskSettings?: PromptTaskSetting;
}): { systemPrompt: string; userPrompt: string } {
    const moodboardLines = [
        formatTagLine("Project tone tags", input.moodboard?.toneTags),
        formatTagLine("Audience tags", input.moodboard?.audienceTags),
        formatTagLine("Feature tags", input.moodboard?.featureTags),
        formatTagLine("Sector tags", input.moodboard?.sectorTags),
        input.moodboard?.projectBrief ? `Project brief: ${input.moodboard.projectBrief}` : "",
        input.moodboard?.targetBusiness ? `Target business: ${input.moodboard.targetBusiness}` : "",
        input.moodboard?.styleNotes ? `Style notes: ${input.moodboard.styleNotes}` : "",
    ].filter(Boolean).join("\n");

    const userProfileLines = [
        formatTagLine("Identity tags", input.userProfile?.identityTags),
        formatTagLine("User sectors", input.userProfile?.sectorTags),
        formatTagLine("User audiences", input.userProfile?.audienceTags),
        formatTagLine("Preferred palette tags", input.userProfile?.paletteTags),
        formatTagLine("Preferred typography tags", input.userProfile?.typographyTags),
        formatTagLine("Preferred layout tags", input.userProfile?.layoutTags),
        formatTagLine("Preferred visual tags", input.userProfile?.visualTags),
        formatTagLine("Preferred tone tags", input.userProfile?.toneTags),
        input.userProfile?.brandBio ? `Brand bio: ${input.userProfile.brandBio}` : "",
        input.userProfile?.preferredColorText ? `Free color preference: ${input.userProfile.preferredColorText}` : "",
    ].filter(Boolean).join("\n");

    const assetLines = (input.assets ?? []).slice(0, 8).map((asset) => {
        const hints = [asset.mimeType, asset.styleRole, asset.descriptionText].filter(Boolean).join(" · ");
        return `- ${asset.originalName}${hints ? ` — ${hints}` : ""}`;
    }).join("\n");

    const systemPrompt = (input.taskSettings?.systemTemplate || DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE).trim();

    const userPrompt = [
        "Optimize the following user prompt for the active project context.",
        input.projectName ? `Project name: ${input.projectName}` : "",
        input.projectType ? `Project type: ${input.projectType}` : "",
        moodboardLines ? `\nProject context\n${moodboardLines}` : "",
        userProfileLines ? `\nUser style profile\n${userProfileLines}` : "",
        assetLines ? `\nRelevant assets\n${assetLines}` : "",
        `\nOriginal user prompt\n${input.rawPrompt}`,
        "\nRewrite it so it becomes richer, clearer, and more actionable while staying faithful to the original intent.",
    ].filter(Boolean).join("\n\n");

    return { systemPrompt, userPrompt };
}
