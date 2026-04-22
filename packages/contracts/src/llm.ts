import { z } from "zod";

const optionalTrimmedString = (max: number) =>
    z.preprocess(
        (value) => {
            if (typeof value === "string") {
                return value.trim().slice(0, max);
            }
            return value == null ? undefined : value;
        },
        z.string().max(max).optional(),
    );

const requiredTrimmedString = (max: number) =>
    z.preprocess(
        (value) => (typeof value === "string" ? value.trim().slice(0, max) : value),
        z.string().min(1).max(max),
    );

const sanitizedStringArray = (maxItems: number, maxItemLength: number) =>
    z.preprocess(
        (value) =>
            Array.isArray(value)
                ? value
                    .filter((item): item is string => typeof item === "string")
                    .map((item) => item.trim().slice(0, maxItemLength))
                    .filter(Boolean)
                    .slice(0, maxItems)
                : value,
        z.array(z.string().max(maxItemLength)).max(maxItems),
    );

export const llmHistoryMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(50000), // backend truncates at LLM_HISTORY_MESSAGE_MAX_CHARS (default 2000)
});

export const llmFocusContextSchema = z.object({
    mode: z.enum(["project", "preview-element", "code-selection"]),
    targetType: z.enum(["html", "css", "js", "component", "section"]),
    userIntent: optionalTrimmedString(500),
    selectedElement: z.object({
        stableNodeId: requiredTrimmedString(120),
        selector: requiredTrimmedString(300),
        tag: requiredTrimmedString(64),
        classes: sanitizedStringArray(30, 100).optional().transform((value) => value ?? []),
        textSnippet: optionalTrimmedString(500),
        /** outerHTML of the element as serialized by the browser DOM — used as anchor hint.
         *  Silently truncated to 8000 chars server-side — never rejected. */
        outerHtml: optionalTrimmedString(8000),
        currentSrc: optionalTrimmedString(1500),
        currentAlt: optionalTrimmedString(300),
        backgroundImageUrl: optionalTrimmedString(1500),
        mediaMode: z.enum(["foreground", "background", "none"]).optional(),
    }).optional(),
    codeSelection: z.object({
        language: z.enum(["html", "css", "js"]),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
        selectedText: optionalTrimmedString(4000),
    }).optional(),
});

export const llmChatPreviewSchema = z.object({
    message: z.string().min(1).max(20000),
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(200).optional(),
    capability: z.enum(["chat", "vision", "image_generation", "video_generation", "tools", "embeddings"]).optional(),
    max_tokens: z.number().int().positive().max(32000).optional(),
    pipelineRole: z.enum([
        "coding",
        "coding_fast",
        "dialogue",
        "dialogue_fast",
        "vision",
        "vision_fast",
        "quality_check",
        "image_gen",
        "image_gen_fast",
        "embeddings"
    ]).default("dialogue"),
    temperature: z.number().min(0).max(2).optional(),
    /** Budget for reasoning/thinking tokens. Limits internal CoT for thinking models. */
    thinking_budget: z.number().int().min(0).max(100000).optional(),
    systemPrompt: z.string().max(4000).optional(),
    history: z.array(llmHistoryMessageSchema).max(100).optional(),
    currentArtifacts: z.object({
        html: z.string().max(80000).optional(),
        css: z.string().max(20000).optional(),
        js: z.string().max(20000).optional(),
    }).optional(),
    focusContext: llmFocusContextSchema.optional(),
    conversationId: z.string().min(1).max(120).optional(),
});

export const llmPromptConfigSchema = z.object({
    enabled: z.boolean().default(true),
    responseFormatVersion: z.string().min(1).max(32).default("v1"),
    prePromptTemplate: z.string().min(10).max(50000),
});

export const optimizePromptSchema = z.object({
    rawPrompt: z.string().min(1).max(20000),
    assetIds: z.array(z.string().min(1).max(120)).max(12).optional(),
    conversationId: z.string().min(1).max(120).optional(),
    sessionId: z.string().min(1).max(120).optional(),
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(200).optional(),
});

export type LlmChatPreviewInput = z.infer<typeof llmChatPreviewSchema>;
export type LlmPromptConfigInput = z.infer<typeof llmPromptConfigSchema>;
export type OptimizePromptInput = z.infer<typeof optimizePromptSchema>;

export interface LlmStructuredArtifacts {
    html: string;
    css: string;
    js: string;
}

export interface LlmStructuredChat {
    summary: string;
    bullets: string[];
    nextActions: string[];
}

/**
 * Returned by the LLM in focused-edit mode instead of the full artifact.
 * `anchor` is a verbatim substring of the original source that must be replaced.
 * Server applies the patch against `currentArtifacts` to produce the full output.
 *
 * When `selectedElement` is present in the request, the server derives the anchor
 * server-side from `selectedElement.outerHtml` and `anchor` may be omitted.
 */
export interface LlmFocusedPatch {
    targetType: "html" | "css" | "js";
    /** Verbatim substring from the original source to find and replace.
     *  Optional when selectedElement is provided — server will derive it. */
    anchor?: string;
    /** New content that replaces anchor in the source. */
    replacement: string;
}

export interface LlmStructuredResponse {
    chat: LlmStructuredChat;
    artifacts: LlmStructuredArtifacts;
    /** Present only when the LLM operated in focused-edit mode. */
    focusPatch?: LlmFocusedPatch;
}

export interface LlmPromptingTraceMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface LlmPromptingTrace {
    originalUserMessage: string;
    /** MongoDB _id of the llm_prompt_configs document active at the time of the call */
    promptConfigId?: string;
    prePromptTemplate?: string;
    effectiveSystemPrompt: string;
    messagesSentToLlm: LlmPromptingTraceMessage[];
    focusContext?: LlmFocusContext;
}

export interface LlmFocusContext {
    mode: "project" | "preview-element" | "code-selection";
    targetType: "html" | "css" | "js" | "component" | "section";
    userIntent?: string;
    selectedElement?: {
        stableNodeId: string;
        selector: string;
        tag: string;
        classes: string[];
        textSnippet?: string;
        /** outerHTML of the element as serialized by the browser DOM — used as anchor hint */
        outerHtml?: string;
        currentSrc?: string;
        currentAlt?: string;
        backgroundImageUrl?: string;
        mediaMode?: "foreground" | "background" | "none";
        originalWidth?: number;
        originalHeight?: number;
        aspectRatio?: number;
    };
    codeSelection?: {
        language: "html" | "css" | "js";
        startLine: number;
        endLine: number;
        selectedText?: string;
    };
}

export interface LlmPromptConfigDto {
    id: string;
    projectId: string;
    enabled: boolean;
    responseFormatVersion: string;
    prePromptTemplate: string;
    createdAt: string;
    updatedAt: string;
}

export interface OptimizePromptResult {
    taskKey: string;
    optimizedPrompt: string;
    provider: string;
    model: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    costEstimate?: {
        currency: "EUR";
        amount: number;
        breakdown: {
            tokenCost: number;
            imageCost: number;
            videoCost: number;
        };
        unitRates: {
            textEurPer1kTokens: number;
            imageEurPerAsset: number;
            videoEurPerAsset: number;
        };
        providerCostUsd?: number;
    };
    durationMs: number;
    skipped?: boolean;
    rawResponse?: string;
    finishReason?: string;
    promptingTrace?: LlmPromptingTrace;
}

export interface PromptUsageSummaryResult {
    totalCost: number;
    totalTokens: number;
    runs: number;
}

export interface LlmChatPreviewResult {
    reply: string;
    rawResponse?: string;
    structuredParseValid?: boolean;
    promptingTrace?: LlmPromptingTrace;
    structured?: LlmStructuredResponse;
    /** true when a focused-mode patch was successfully applied; false/undefined when merge failed or mode was not focused. */
    focusPatchApplied?: boolean;
    /** true when focused-mode was active but the LLM response could not be parsed at all (malformed JSON). */
    focusPatchParseError?: boolean;
    provider: string;
    model: string;
    finishReason?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    costEstimate?: {
        currency: "EUR";
        amount: number;
        /** How the amount was derived: "provider" = from provider-reported USD cost; "flat-rate" = token-based flat rate. */
        source?: "provider" | "flat-rate";
        breakdown: {
            tokenCost: number;
            imageCost: number;
            videoCost: number;
        };
        unitRates: {
            textEurPer1kTokens: number;
            imageEurPerAsset: number;
            videoEurPerAsset: number;
        };
        /** Actual cost in USD reported by the provider (e.g. OpenRouter). */
        providerCostUsd?: number;
    };
    durationMs: number;
    simulated: boolean;
}
