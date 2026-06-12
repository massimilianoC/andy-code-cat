import { z } from "zod";

export const DIDACTIC_CATEGORIES = [
    "html_structure",
    "css_technique",
    "js_function",
    "responsiveness",
    "accessibility",
    "design_choice",
    "prompt_layer",
] as const;
export type DidacticCategory = (typeof DIDACTIC_CATEGORIES)[number];

export const DidacticDifficulty = ["base", "intermediate", "advanced"] as const;
export type DidacticDifficulty = (typeof DidacticDifficulty)[number];

export const didacticAnchorSchema = z.object({
    kind: z.enum(["preview", "html", "css", "js", "prompt"]),
    pfId: z.string().optional(),
    lineRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
});

export const didacticTopicSchema = z.object({
    id: z.string().min(1),
    category: z.enum(DIDACTIC_CATEGORIES),
    difficulty: z.enum(DidacticDifficulty),
    title: z.string().max(80),
    summary: z.string().max(500),
    anchors: z.array(didacticAnchorSchema).max(10),
});

export const didacticQuizSchema = z.object({
    id: z.string().min(1),
    difficulty: z.enum(DidacticDifficulty),
    question: z.string().max(500),
    options: z.array(z.string().max(300)).length(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().max(1000),
    anchors: z.array(didacticAnchorSchema).max(10),
});

export const didacticArtifactKnowledgeSchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    snapshotId: z.string().min(1),
    userId: z.string().min(1),
    overview: z.string().max(2000),
    topics: z.array(didacticTopicSchema).min(1).max(15),
    quizzes: z.array(didacticQuizSchema).min(1).max(10),
    groundingHash: z.string().min(1),
    model: z.string().optional(),
    provider: z.string().optional(),
    generatedAt: z.string().datetime().or(z.date()),
});

export const didacticQnaFocusSchema = z.object({
    kind: z.enum(["preview", "html", "css", "js"]),
    pfId: z.string().optional(),
    outerHtml: z.string().max(5000).optional(),
    lineRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
    selectedText: z.string().max(5000).optional(),
});

export const didacticQnaEntrySchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    userId: z.string().min(1),
    snapshotId: z.string().min(1),
    focus: didacticQnaFocusSchema.optional(),
    question: z.string().max(2000),
    answer: z.string().max(50000),
    model: z.string().optional(),
    provider: z.string().optional(),
    usage: z.object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
    }).optional(),
    createdAt: z.string().datetime().or(z.date()),
});

export const generateDidacticKnowledgeSchema = z.object({
    snapshotId: z.string().min(1),
    uiLanguage: z.enum(["it", "en"]).default("it"),
});

export const askDidacticQuestionSchema = z.object({
    snapshotId: z.string().min(1),
    question: z.string().min(1).max(2000),
    focus: didacticQnaFocusSchema.optional(),
    uiLanguage: z.enum(["it", "en"]).default("it"),
});

export type DidacticAnchor = z.infer<typeof didacticAnchorSchema>;
export type DidacticTopic = z.infer<typeof didacticTopicSchema>;
export type DidacticQuiz = z.infer<typeof didacticQuizSchema>;
export type DidacticArtifactKnowledge = z.infer<typeof didacticArtifactKnowledgeSchema>;
export type DidacticQnaFocus = z.infer<typeof didacticQnaFocusSchema>;
export type DidacticQnaEntry = z.infer<typeof didacticQnaEntrySchema>;
export type GenerateDidacticKnowledgeInput = z.infer<typeof generateDidacticKnowledgeSchema>;
export type AskDidacticQuestionInput = z.infer<typeof askDidacticQuestionSchema>;

export interface DidacticKnowledgeStatusDto {
    status: "ready" | "stale" | "absent";
    knowledge?: DidacticArtifactKnowledge;
}

export interface DidacticKnowledgeResponseDto {
    knowledge: DidacticArtifactKnowledge;
    costEstimate?: {
        providerCostEur: number;
        totalEur: number;
    };
}
