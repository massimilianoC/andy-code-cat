import type { ProjectPreset } from "../../domain/entities/ProjectPreset";
import type { PromptTaskSetting } from "../../domain/entities/PlatformConfig";

export const DEFAULT_DRAFT_TEMPLATE_MODEL_SYSTEM_TEMPLATE = `You help a superadmin create reusable project-type template models for an AI generation platform.

GOAL
- Transform a short admin instruction into a strong template-model draft.
- Focus on project type, UX intent, layout direction, content structure, and prompt guidance.
- Produce output that can be edited and saved in an admin registry.

IMPORTANT BOUNDARIES
- Do not explain your reasoning.
- Do not output markdown prose before or after the result.
- Return JSON only.
- Keep descriptions concise and useful.
- The systemPromptModule must be practical, high-signal, and ready to inject into the optimized preprompt layer.

Return ONLY valid JSON with this shape:
{
  "label": "",
  "labelIt": "",
  "labelEn": "",
  "hint": "",
  "category": "",
  "categoryLabel": "",
  "categoryHint": "",
  "tags": [""],
  "briefTemplate": "",
  "styleTemplate": "",
  "briefGuideQuestions": ["", "", ""],
  "outputSpec": {
    "pageModel": "single_page|multi_page|slide_deck|print_a4",
    "sectionModel": "scroll|paginated|masonry|stepped_form",
    "recommendedPageCount": 1,
    "aspectRatio": "16:9|4:3|A4_portrait|A4_landscape|free",
    "printReady": false,
    "cssConstraints": "",
    "systemPromptModule": ""
  }
}`;

type TemplateDraftContext = {
    label?: string;
    hint?: string;
    category?: string;
    tags?: string[];
    briefTemplate?: string;
    styleTemplate?: string;
    outputSpec?: Partial<ProjectPreset["outputSpec"]>;
};

export function buildDraftProjectTemplateRequest(input: {
    instructions: string;
    category?: string;
    labelHint?: string;
    existingDraft?: TemplateDraftContext | null;
    taskSettings?: PromptTaskSetting;
}): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = (input.taskSettings?.systemTemplate || DEFAULT_DRAFT_TEMPLATE_MODEL_SYSTEM_TEMPLATE).trim();

    const existingContext = input.existingDraft
        ? [
            input.existingDraft.label ? `Current label: ${input.existingDraft.label}` : "",
            input.existingDraft.hint ? `Current hint: ${input.existingDraft.hint}` : "",
            input.existingDraft.category ? `Current category: ${input.existingDraft.category}` : "",
            input.existingDraft.tags?.length ? `Current tags: ${input.existingDraft.tags.join(", ")}` : "",
            input.existingDraft.briefTemplate ? `Current brief template: ${input.existingDraft.briefTemplate}` : "",
            input.existingDraft.styleTemplate ? `Current style template: ${input.existingDraft.styleTemplate}` : "",
            input.existingDraft.outputSpec?.systemPromptModule ? `Current prompt module: ${input.existingDraft.outputSpec.systemPromptModule}` : "",
        ].filter(Boolean).join("\n")
        : "";

    const userPrompt = [
        "Draft or refine a project-type template model for the admin catalog.",
        input.labelHint ? `Template idea: ${input.labelHint}` : "",
        input.category ? `Preferred category: ${input.category}` : "",
        existingContext ? `\nExisting draft context\n${existingContext}` : "",
        `\nAdmin instructions\n${input.instructions}`,
        "\nGenerate a concise but complete reusable template draft suitable for the superadmin dashboard.",
    ].filter(Boolean).join("\n\n");

    return { systemPrompt, userPrompt };
}
