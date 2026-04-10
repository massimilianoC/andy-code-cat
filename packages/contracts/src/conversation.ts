import { z } from "zod";

// ── Request schemas ──────────────────────────────────────────────────────────

export const createConversationSchema = z.object({
    title: z.string().trim().max(120).optional(),
    firstMessage: z.object({
        content: z.string().min(1).max(10000),
        role: z.enum(["user", "system"]).default("user"),
    }).optional(),
});

export const addMessageSchema = z.object({
    role: z.enum(["user", "assistant", "system", "error"]),
    content: z.string().min(1).max(50000),
    metadata: z.object({
        tokenUsage: z.object({
            promptTokens: z.number().int().nonnegative(),
            completionTokens: z.number().int().nonnegative(),
            totalTokens: z.number().int().nonnegative(),
        }).optional(),
        costEstimate: z.object({
            currency: z.literal("EUR"),
            amount: z.number().nonnegative(),
            source: z.enum(["provider", "flat-rate"]).optional(),
            breakdown: z.object({
                tokenCost: z.number().nonnegative(),
                imageCost: z.number().nonnegative(),
                videoCost: z.number().nonnegative(),
            }),
            unitRates: z.object({
                textEurPer1kTokens: z.number().nonnegative(),
                imageEurPerAsset: z.number().nonnegative(),
                videoEurPerAsset: z.number().nonnegative(),
            }),
            providerCostUsd: z.number().nonnegative().optional(),
        }).optional(),
        model: z.string().optional(),
        executionTimeMs: z.number().nonnegative().optional(),
        provider: z.string().optional(),
        finishReason: z.string().optional(),
        rawResponse: z.string().optional(),
        structuredParseValid: z.boolean().optional(),
        promptingTrace: z.object({
            originalUserMessage: z.string(),
            /** MongoDB _id of the llm_prompt_configs document used to build the pipeline wrapper */
            promptConfigId: z.string().optional(),
            prePromptTemplate: z.string().optional(),
            effectiveSystemPrompt: z.string(),
            messagesSentToLlm: z.array(
                z.object({
                    role: z.enum(["system", "user", "assistant"]),
                    content: z.string(),
                })
            ),
        }).optional(),
        generatedArtifacts: z.object({
            html: z.string(),
            css: z.string(),
            js: z.string(),
        }).optional(),
        chatStructured: z.object({
            summary: z.string(),
            bullets: z.array(z.string()),
            nextActions: z.array(z.string()),
        }).optional(),
    }).optional(),
});

export const logBackgroundTaskSchema = z.object({
    type: z.string().min(1).max(80),
    pipelineProfile: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    status: z.enum(["pending", "running", "completed", "failed"]).default("pending"),
    error: z.string().optional(),
    tokenUsage: z.object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
    }).optional(),
    costEstimate: z.object({
        currency: z.literal("EUR"),
        amount: z.number().nonnegative(),
        source: z.enum(["provider", "flat-rate"]).optional(),
        breakdown: z.object({
            tokenCost: z.number().nonnegative(),
            imageCost: z.number().nonnegative(),
            videoCost: z.number().nonnegative(),
        }),
        unitRates: z.object({
            textEurPer1kTokens: z.number().nonnegative(),
            imageEurPerAsset: z.number().nonnegative(),
            videoEurPerAsset: z.number().nonnegative(),
        }),
        providerCostUsd: z.number().nonnegative().optional(),
    }).optional(),
});

export const updateBackgroundTaskSchema = z.object({
    status: z.enum(["pending", "running", "completed", "failed"]),
    output: z.unknown().optional(),
    error: z.string().optional(),
    tokenUsage: z.object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
    }).optional(),
    costEstimate: z.object({
        currency: z.literal("EUR"),
        amount: z.number().nonnegative(),
        source: z.enum(["provider", "flat-rate"]).optional(),
        breakdown: z.object({
            tokenCost: z.number().nonnegative(),
            imageCost: z.number().nonnegative(),
            videoCost: z.number().nonnegative(),
        }),
        unitRates: z.object({
            textEurPer1kTokens: z.number().nonnegative(),
            imageEurPerAsset: z.number().nonnegative(),
            videoEurPerAsset: z.number().nonnegative(),
        }),
        providerCostUsd: z.number().nonnegative().optional(),
    }).optional(),
});

// ── Inferred types ───────────────────────────────────────────────────────────

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type AddMessageInput = z.infer<typeof addMessageSchema>;
export type LogBackgroundTaskInput = z.infer<typeof logBackgroundTaskSchema>;
export type UpdateBackgroundTaskInput = z.infer<typeof updateBackgroundTaskSchema>;

// ── DTO types (API responses) ────────────────────────────────────────────────

export interface TokenUsageDto {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface BackgroundTaskDto {
    id: string;
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    pipelineProfile?: string;
    startedAt: string;
    completedAt?: string;
    error?: string;
    tokenUsage?: TokenUsageDto;
    costEstimate?: {
        currency: "EUR";
        amount: number;
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
        providerCostUsd?: number;
    };
}

export interface MessageDto {
    id: string;
    role: "user" | "assistant" | "system" | "error";
    content: string;
    timestamp: string;
    metadata?: {
        tokenUsage?: TokenUsageDto;
        costEstimate?: {
            currency: "EUR";
            amount: number;
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
            providerCostUsd?: number;
        };
        model?: string;
        executionTimeMs?: number;
        provider?: string;
        finishReason?: string;
        rawResponse?: string;
        structuredParseValid?: boolean;
        promptingTrace?: {
            originalUserMessage: string;
            prePromptTemplate?: string;
            effectiveSystemPrompt: string;
            messagesSentToLlm: Array<{
                role: "system" | "user" | "assistant";
                content: string;
            }>;
        };
        generatedArtifacts?: {
            html: string;
            css: string;
            js: string;
        };
    };
    backgroundTasks: BackgroundTaskDto[];
}

export interface ConversationSummaryDto {
    id: string;
    title: string;
    projectId: string;
    totalTokens: number;
    createdAt: string;
    updatedAt: string;
}

export interface ConversationDto extends ConversationSummaryDto {
    messages: MessageDto[];
}
