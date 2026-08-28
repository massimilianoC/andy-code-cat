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

/**
 * The follow-up counterpart of the template above. A revision instruction ("I only see images,
 * no text — add short copy with good contrast") is NOT a brief, and optimizing it with the brief
 * template regenerates the whole project description: the user's actual request disappears into
 * a restatement of what the project already is.
 *
 * The project context is not lost by leaving it out here — the chat history and the system
 * prompt layers re-inject it on every send. This step only has to make a terse instruction
 * unambiguous.
 */
export const DEFAULT_OPTIMIZE_FOLLOW_UP_SYSTEM_TEMPLATE = `You clarify a short revision instruction that a user typed while reviewing an artifact that already exists.

GOAL
- Restate the user's request as a clear, self-contained revision instruction.
- Resolve vague wording ("make it nicer", "add some text") into concrete, actionable changes.
- Keep it SHORT: a few sentences or a small bullet list. This is one turn in a conversation, not a brief.

ABSOLUTE BOUNDARIES
- Do NOT restate, summarize or reconstruct the project brief, its identity, audience, sections or goals.
- Do NOT add requirements the user did not ask for.
- Do NOT describe the artifact as if generating it from scratch — it already exists and is being revised.
- Do NOT mention HTML, CSS, JS, JSON, single-file output, or any implementation detail.

OUTPUT RULES
- Return only the clarified instruction text.
- Write in the same language as the user's input.
- If the instruction is already clear and specific, return it essentially unchanged.`;

const AUTHORITATIVE_BRIEF_PRESERVATION_CONTRACT = `AUTHORITATIVE BRIEF PRESERVATION
- Treat [SOURCE_REQUEST] as the highest-authority user content when present.
- Preserve every explicit fact, requested deliverable, template choice, named section/state, functional requirement, preference, constraint and prohibition.
- Enrichment is additive only. Never generalize a specific requirement into a weaker one, silently remove details, reverse a negative instruction, or replace the selected project type.
- Keep [MUST_AVOID] exclusions explicit in the optimized result.
- If contextual suggestions conflict with the source request, discard the conflicting suggestion.`;

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
    /** Pre-built Layer D block — injected verbatim to give the optimizer full document context. */
    layerDContext?: string;
    /** See `optimizeMode` in `optimizePromptSchema`. Defaults to "initial" (pre-existing behavior). */
    mode?: "initial" | "follow-up";
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

    if (input.mode === "follow-up") {
        // Deliberately ignores moodboard, style profile, assets and Layer D: see the template's
        // doc comment. The operator's `systemTemplate` override is skipped too — it is written
        // for brief enrichment, and applying it here reintroduces exactly the behavior this
        // branch exists to prevent. The brief-preservation contract is likewise irrelevant:
        // there is no [SOURCE_REQUEST] envelope in a chat turn.
        return {
            systemPrompt: DEFAULT_OPTIMIZE_FOLLOW_UP_SYSTEM_TEMPLATE,
            userPrompt: [
                "Clarify the following revision instruction. The project context is already established elsewhere in the conversation — do not restate it.",
                input.projectType ? `Artifact type being revised: ${input.projectType}` : "",
                `\nUser instruction\n${input.rawPrompt}`,
            ].filter(Boolean).join("\n\n"),
        };
    }

    const configuredSystemPrompt = (input.taskSettings?.systemTemplate || DEFAULT_OPTIMIZE_USER_PROMPT_SYSTEM_TEMPLATE).trim();
    // Operator overrides customize tone/depth but cannot remove the non-destructive
    // handoff contract protecting the user's Guided Mode brief.
    const systemPrompt = `${configuredSystemPrompt}\n\n${AUTHORITATIVE_BRIEF_PRESERVATION_CONTRACT}`;

    const userPrompt = [
        "Optimize the following user prompt for the active project context.",
        input.projectName ? `Project name: ${input.projectName}` : "",
        input.projectType ? `Project type: ${input.projectType}` : "",
        moodboardLines ? `\nProject context\n${moodboardLines}` : "",
        userProfileLines ? `\nUser style profile\n${userProfileLines}` : "",
        assetLines ? `\nRelevant assets\n${assetLines}` : "",
        input.layerDContext ? `\nDocument knowledge extracted from project files\n${input.layerDContext}` : "",
        `\nOriginal user prompt\n${input.rawPrompt}`,
        "\nRewrite it so it becomes richer, clearer, and more actionable while staying faithful to the original intent.",
    ].filter(Boolean).join("\n\n");

    return { systemPrompt, userPrompt };
}
