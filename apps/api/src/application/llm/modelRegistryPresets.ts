import type { LlmModel, PipelineModelRole } from "../../domain/entities/LlmCatalog";

const ROLE_DESCRIPTIONS: Record<PipelineModelRole, string> = {
    coding: "Optimized for code generation, refactoring, and technical implementation.",
    coding_fast: "Fast coding assistant for lightweight fixes and scaffolding.",
    dialogue: "Balanced conversational model for general product and content requests.",
    dialogue_fast: "Low-latency chat model for everyday drafting and iteration.",
    vision: "Multimodal model for reading screenshots, layouts, and visual context.",
    vision_fast: "Faster multimodal model for quick visual checks and guidance.",
    quality_check: "Review-oriented model for QA, consistency, and validation tasks.",
    image_gen: "Image generation model for visuals and creative assets.",
    image_gen_fast: "Fast image generation model for rapid exploration.",
    embeddings: "Embedding model for retrieval, matching, and semantic indexing.",
};

const ROLE_PROMPT_TEMPLATES: Record<PipelineModelRole, string> = {
    coding: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Prefer precise implementation steps, maintain clean architecture boundaries, and return production-ready code with minimal noise.",
    ].join("\n"),
    coding_fast: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Optimize for fast, concise implementation output. Keep edits small, deterministic, and easy to review.",
    ].join("\n"),
    dialogue: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Prioritize clarity, structured reasoning, and user-facing usefulness. Ask only when ambiguity blocks the next step.",
    ].join("\n"),
    dialogue_fast: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Keep responses compact, practical, and iteration-friendly.",
    ].join("\n"),
    vision: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Use any visual context carefully, describe design implications explicitly, and align suggestions with the requested UX goal.",
    ].join("\n"),
    vision_fast: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Focus on quick visual validation and short corrective suggestions.",
    ].join("\n"),
    quality_check: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Act as a strict reviewer. Surface inconsistencies, risks, and missing constraints before proposing changes.",
    ].join("\n"),
    image_gen: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Generate visually coherent assets that stay faithful to the brand and brief.",
    ].join("\n"),
    image_gen_fast: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Favor rapid, simple visual exploration with clear subject emphasis.",
    ].join("\n"),
    embeddings: [
        "## MODEL-SPECIFIC GUIDANCE",
        "Optimize for semantic similarity, recall quality, and consistent vector representation.",
    ].join("\n"),
};

const ROLE_FOCUSED_PROMPTS: Partial<Record<PipelineModelRole, string>> = {
    coding: "When editing existing code, preserve the surrounding structure and change only what is necessary.",
    coding_fast: "Make the smallest safe patch that satisfies the request.",
    quality_check: "Check for regressions, invalid assumptions, and broken contracts before finalizing the patch.",
    vision: "Keep visual edits localized to the selected section and preserve layout stability.",
    vision_fast: "Prefer minimal visual deltas that are easy to validate.",
};

export function humanizeModelId(modelId: string): string {
    const tail = modelId.split("/").pop() ?? modelId;
    return tail
        .replace(/[:_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
        .trim();
}

export function decorateSeedModel(model: LlmModel): LlmModel {
    return {
        ...model,
        displayName: model.displayName ?? humanizeModelId(model.id),
        description: model.description ?? ROLE_DESCRIPTIONS[model.role],
        promptTemplate: model.promptTemplate ?? ROLE_PROMPT_TEMPLATES[model.role],
        focusPromptTemplate: model.focusPromptTemplate ?? ROLE_FOCUSED_PROMPTS[model.role] ?? "",
    };
}
