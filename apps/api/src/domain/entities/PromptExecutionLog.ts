import type { CostEstimate } from "./Conversation";

/**
 * "pending" — I11 of the SSOT program (see docs/SSOT_REFACTOR_PROGRESS.md): written and AWAITED
 * before the provider call is dispatched, so a durable record of intent exists even if the
 * process crashes mid-call or the client never receives a response. `complete()` transitions a
 * pending record to "succeeded" or "failed" once the provider call resolves.
 */
export type PromptExecutionStatus = "pending" | "succeeded" | "failed";

export interface PromptExecutionMediaResolutionSummary {
    version: string;
    resolvedCount: number;
    failedCount: number;
    degraded: boolean;
    mediaKeys?: string[];
    traceIds?: string[];
}

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
    mediaResolutionSummary?: PromptExecutionMediaResolutionSummary;
    costEstimate?: CostEstimate;
    status: PromptExecutionStatus;
    errorMessage?: string;
    durationMs: number;
    /**
     * Client-supplied key (I11) stable across retries of the SAME logical request. When a
     * "succeeded" record already exists for a given (projectId, userId, idempotencyKey), the
     * route replays that stored result instead of dispatching a second provider call — protects
     * against duplicate billing on client-side retries/network blips. Optional: callers that
     * don't send one simply get no idempotency protection, same as before I11.
     */
    idempotencyKey?: string;
    createdAt: Date;
}

/** Fields known before the provider call is dispatched — everything result-dependent is filled in later via `complete()`. */
export type NewPendingPromptExecution = Omit<
    PromptExecutionLog,
    "id" | "createdAt" | "status" | "durationMs" | "usage" | "mediaResolutionSummary" | "costEstimate" | "errorMessage"
>;

export type PromptExecutionCompletion =
    | {
        status: "succeeded";
        durationMs: number;
        usage?: PromptExecutionLog["usage"];
        mediaResolutionSummary?: PromptExecutionMediaResolutionSummary;
        costEstimate?: CostEstimate;
    }
    | {
        status: "failed";
        durationMs: number;
        errorMessage: string;
    };

export interface PromptExecutionModelSummary {
    provider: string;
    model: string;
    runs: number;
    totalCost: number;
    totalTokens: number;
}

export interface PromptExecutionUsageSummary {
    totalCost: number;
    totalTokens: number;
    runs: number;
    topModels?: PromptExecutionModelSummary[];
}
