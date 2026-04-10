export type MessageRole = 'user' | 'assistant' | 'system' | 'error';

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface CostEstimate {
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
    /** Actual cost in USD as reported by the provider (e.g. OpenRouter usage.cost). undefined if provider does not supply it. */
    providerCostUsd?: number;
}

export interface BackgroundTask {
    id: string;
    /** Typed label: 'analysis' | 'synthesis' | 'query' | 'pipeline' | custom */
    type: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    /** Identifier of the pipeline configuration that executed this task */
    pipelineProfile?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    startedAt: Date;
    completedAt?: Date;
    tokenUsage?: TokenUsage;
    costEstimate?: CostEstimate;
}

export interface MessageMetadata {
    tokenUsage?: TokenUsage;
    costEstimate?: CostEstimate;
    model?: string;
    executionTimeMs?: number;
    provider?: string;
    finishReason?: string;
    rawResponse?: string;
    structuredParseValid?: boolean;
    promptingTrace?: {
        originalUserMessage: string;
        /** MongoDB _id of the llm_prompt_configs document active at generation time */
        promptConfigId?: string;
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
}

export interface Message {
    id: string;
    role: MessageRole;
    content: string;
    timestamp: Date;
    metadata?: MessageMetadata;
    /** All background elaborations triggered by this message */
    backgroundTasks: BackgroundTask[];
}

export interface Conversation {
    id: string;
    projectId: string;
    userId: string;
    /** Auto-generated from first message content (first 60 chars) */
    title: string;
    messages: Message[];
    /** Running total of tokens across all messages */
    totalTokens: number;
    /** Running total of policy-estimated cost in EUR across all assistant messages */
    totalCost: number;
    createdAt: Date;
    updatedAt: Date;
}
