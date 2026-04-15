import type { CostEstimate } from "./Conversation";

export type PromptExecutionStatus = "succeeded" | "failed";

export interface PromptExecutionLog {
    id: string;
    taskKey: string;
    projectId: string;
    userId: string;
    conversationId?: string;
    sessionId?: string;
    provider: string;
    model: string;
    inputPrompt: string;
    optimizedPrompt?: string;
    renderedSystemPrompt?: string;
    renderedUserPrompt?: string;
    contextMeta: {
        projectPresetId?: string;
        projectType?: string;
        detectedDomain?: string[];
        assetIds?: string[];
        usedMoodboard: boolean;
        usedUserProfile: boolean;
    };
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    costEstimate?: CostEstimate;
    status: PromptExecutionStatus;
    errorMessage?: string;
    durationMs: number;
    createdAt: Date;
}

export interface PromptExecutionUsageSummary {
    totalCost: number;
    totalTokens: number;
    runs: number;
}
