import { call } from "./call";

export interface BackgroundTaskDto {
    id: string;
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    pipelineProfile?: string;
    startedAt: string;
    completedAt?: string;
    error?: string;
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
    };
}

export interface MessageDto {
    id: string;
    role: "user" | "assistant" | "system" | "error";
    content: string;
    timestamp: string;
    metadata?: {
        tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
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
        model?: string;
        executionTimeMs?: number;
        provider?: string;
        finishReason?: string;
        rawResponse?: string;
        structuredParseValid?: boolean;
        promptingTrace?: {
            originalUserMessage: string;
            /** MongoDB _id of the llm_prompt_configs document used to build the pipeline wrapper */
            promptConfigId?: string;
            prePromptTemplate?: string;
            effectiveSystemPrompt: string;
            messagesSentToLlm: Array<{
                role: "system" | "user";
                content: string;
            }>;
        };
        generatedArtifacts?: {
            html: string;
            css: string;
            js: string;
        };
        chatStructured?: {
            summary: string;
            bullets: string[];
            nextActions: string[];
        };
    };
    backgroundTasks: BackgroundTaskDto[];
}

export interface ConversationSummary {
    id: string;
    title: string;
    projectId: string;
    totalTokens: number;
    /** Running total of policy-estimated cost (EUR) across all assistant messages. */
    totalCost?: number;
    createdAt: string;
    updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
    messages: MessageDto[];
}

export function listConversations(token: string, projectId: string) {
    return call<{ conversations: ConversationSummary[] }>(
        "GET",
        `/v1/projects/${projectId}/conversations`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

/**
 * Get or create the single project conversation.
 * This is the primary entry-point for the workspace UI (1 project = 1 chat stream).
 */
export function getOrCreateProjectConversation(token: string, projectId: string) {
    return call<{ conversation: ConversationDetail; created: boolean }>(
        "GET",
        `/v1/projects/${projectId}/conversation`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function createConversation(
    token: string,
    projectId: string,
    data: { title?: string; firstMessage?: { content: string; role?: "user" | "system" } }
) {
    return call<{ conversation: ConversationDetail }>(
        "POST",
        `/v1/projects/${projectId}/conversations`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function getConversation(token: string, projectId: string, conversationId: string) {
    return call<{ conversation: ConversationDetail }>(
        "GET",
        `/v1/projects/${projectId}/conversations/${conversationId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function addMessage(
    token: string,
    projectId: string,
    conversationId: string,
    message: { role: MessageDto["role"]; content: string; metadata?: MessageDto["metadata"] }
) {
    return call<{ message: MessageDto }>(
        "POST",
        `/v1/projects/${projectId}/conversations/${conversationId}/messages`,
        message,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function logBackgroundTask(
    token: string,
    projectId: string,
    conversationId: string,
    messageId: string,
    task: {
        type: string;
        pipelineProfile?: string;
        input?: unknown;
        output?: unknown;
        error?: string;
        status?: string;
        tokenUsage?: {
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
        };
    }
) {
    return call<{ task: BackgroundTaskDto }>(
        "POST",
        `/v1/projects/${projectId}/conversations/${conversationId}/messages/${messageId}/tasks`,
        task,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}
