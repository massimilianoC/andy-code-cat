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
    /**
     * The provider's `finish_reason` for this call, verbatim ("stop", "length", "content_filter", …).
     *
     * Recorded because `status: "succeeded"` alone is a lie about truncation: run f51ee098
     * (2026-09-01) stopped at exactly 32,768 completion tokens — the provider's output cap — and was
     * journalled as succeeded, while the deck it produced was visibly incomplete. The value was
     * already parsed in flight and thrown away. `"length"` means the model was cut off, not that it
     * finished, and no repair pass downstream can restore what was never emitted.
     */
    finishReason?: string;
    /**
     * The model's own reasoning trace, when the provider streams one (`reasoning_content` /
     * `reasoning` / `thinking`). Reasoning is charged against the same completion budget as the
     * answer, so on a truncated call this is often the only record of work already paid for — it is
     * kept so a retry can resume from it instead of starting the thinking over.
     */
    reasoningTrace?: string;
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
    | "finishReason" | "reasoningTrace"
>;

export type PromptExecutionCompletion =
    | {
        status: "succeeded";
        durationMs: number;
        usage?: PromptExecutionLog["usage"];
        mediaResolutionSummary?: PromptExecutionMediaResolutionSummary;
        costEstimate?: CostEstimate;
        finishReason?: string;
        reasoningTrace?: string;
    }
    | {
        status: "failed";
        durationMs: number;
        errorMessage: string;
        finishReason?: string;
        reasoningTrace?: string;
    };

/**
 * True when the provider stopped because it ran out of output budget rather than because the model
 * was done. The only honest reading of a `"length"` finish: the artifact is incomplete by
 * construction, regardless of whether a repair pass managed to make it parse.
 */
export function wasTruncated(log: Pick<PromptExecutionLog, "finishReason">): boolean {
    return log.finishReason === "length";
}

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
