import type { CostEstimate } from "./Conversation";
import type { PromptExecutionStatus, PromptExecutionMediaResolutionSummary } from "@andy-code-cat/contracts";

// Declarations moved to packages/contracts; the inspector renders these rows.
export type { PromptExecutionStatus, PromptExecutionMediaResolutionSummary };

/**
 * "pending" — I11 of the SSOT program: written and AWAITED before the provider call is dispatched,
 * so a durable record of intent exists even if the process crashes mid-call or the client never
 * receives a response. `complete()` transitions it to "succeeded" or "failed" once the call resolves.
 */
export interface PromptExecutionLog {
    id: string;
    taskKey: string;
    projectId: string;
    userId: string;
    conversationId?: string;
    sessionId?: string;
    /**
     * The `WorkSession` this call belongs to — the root that spans one user intent from the first
     * Vibe keystroke to the last edit, across however many generations it takes.
     *
     * Without it the journal is a pile of rows that cannot be walked: there was no path from a Vibe
     * request to the artifact it eventually produced, which is what made the pipeline a black box
     * even where individual rows were being written.
     */
    workSessionId?: string;
    /**
     * The `PipelineRun` this call was dispatched under, and which stage of it. A run is ONE
     * generation (`ResolvePipelineModelLock.dispatch():181-193` depends on that), so these two
     * place a call precisely: which generation, and which step inside it.
     */
    pipelineRunId?: string;
    pipelineStage?: string;
    /**
     * The URL actually POSTed to, e.g. "https://api.siliconflow.com/v1/chat/completions".
     *
     * Recorded so the history can answer a question it currently cannot: which endpoints are being
     * called, and whether any of them bypass the resolved catalog. A model id proves what we
     * intended; only the endpoint proves where the request went.
     */
    endpoint?: string;
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
    /**
     * The model's reply exactly as it arrived, BEFORE any parsing, extraction or repair.
     *
     * This is not a duplicate of the artifact — the artifact lives in `preview_snapshots`, and that
     * copy is the *repaired* one. The two answer different questions, and run f51ee098 is why the
     * difference matters: a reply truncated at the provider's output cap, made parseable by
     * `llmParser`'s repair chain, and journalled as `succeeded`. Only the raw reply can say whether
     * a repair fired and what the model had actually produced when it was cut off.
     */
    rawResponse?: string;
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
    /**
     * Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis) — the id of the
     * failed `PromptExecutionLog` row this generation resumed from, when the `inputPrompt` was
     * built by injecting that row's `rawResponse` and `reasoningTrace` into the original brief.
     *
     * A recovery is a project-mode generation with an injected prompt, not a new execution path —
     * this is the one field that distinguishes it in the journal. Enough to answer "why is there a
     * second generation here" when reading the history back later; nothing about dispatch, cost or
     * traceability depends on it.
     */
    resumedFromPromptExecutionId?: string;
    createdAt: Date;
}

/** Fields known before the provider call is dispatched — everything result-dependent is filled in later via `complete()`. */
export type NewPendingPromptExecution = Omit<
    PromptExecutionLog,
    "id" | "createdAt" | "status" | "durationMs" | "usage" | "mediaResolutionSummary" | "costEstimate" | "errorMessage"
    | "finishReason" | "reasoningTrace" | "rawResponse"
>;

/**
 * How long a journal row keeps its full prompt and reply text.
 *
 * 120 days, whole, deliberately: the point of the journal is that a run can be reconstructed, and a
 * row without its prompt reconstructs nothing. The intended direction beyond this window is a
 * compressed copy that lives indefinitely alongside an expanded copy that ages out and can be
 * rehydrated from it — recorded in docs/specs/WORK_SESSION_TRACING_SPEC.md §4.1 as a known open
 * item, not designed here.
 */
export const PROMPT_EXECUTION_FULL_TEXT_RETENTION_DAYS = 120;

export type PromptExecutionCompletion =
    | {
        status: "succeeded";
        durationMs: number;
        usage?: PromptExecutionLog["usage"];
        mediaResolutionSummary?: PromptExecutionMediaResolutionSummary;
        costEstimate?: CostEstimate;
        finishReason?: string;
        reasoningTrace?: string;
        rawResponse?: string;
    }
    | {
        status: "failed";
        durationMs: number;
        errorMessage: string;
        finishReason?: string;
        reasoningTrace?: string;
        rawResponse?: string;
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
