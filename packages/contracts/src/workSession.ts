import type { GuidedLaunchInput } from "./pipeline";
import type { ModelSelectionDecision } from "./modelRouting";
import type {
    CanonicalBriefEnvelope,
    PipelineEntryMode,
    PipelineModelLock,
    PipelineRunStatus,
    PipelineStage,
} from "./pipelineRun";

/**
 * The wire shapes of the session inspector (docs/specs/SESSION_INSPECTOR_SPEC.md).
 *
 * These live here rather than beside the use cases that build them because both the API and the web
 * client need them, and a type declared twice is a type that will disagree with itself. The value
 * types below (`WorkSessionStatus`, `CostUnits`, …) previously existed only in the API's domain
 * entities; the entities now import them from here, so there is exactly one declaration of each and
 * the domain and the wire cannot drift apart.
 */

// ── Value types, shared with the API domain entities ─────────────────────────

export type WorkSessionStatus = "open" | "completed" | "failed" | "abandoned";

/**
 * Configuration true of the session as a whole, as opposed to one tool invocation.
 *
 * Deliberately near-empty. Anything that varies per call — the model, the prompt, the attachments —
 * is not session-scoped and does not belong here, however tempting the convenience.
 */
export interface WorkSessionConfig {
    /** BCP-47, as the client reported it when the session opened. */
    uiLanguage?: string;
    /**
     * Settings that do not exist yet: reasoning-report toggles, default budgets, whatever a later
     * feature adds. A new session-scoped option should be a value here, not a migration of every
     * historical session. Anything that graduates into a first-class concern is promoted out.
     */
    options?: Record<string, unknown>;
}

export interface VibeAttachmentRef {
    /**
     * Pointer, not copy — the asset keeps living in its own collection and its own storage.
     *
     * Optional because at Vibe intake time it frequently does not exist yet: the classifier receives
     * `AttachmentMeta` (filename, mime type, size) describing files the user selected, and those
     * become `ProjectAsset` rows only later in the flow. Recording the metadata without an id still
     * answers what the user attached; demanding one here would mean inventing it or dropping the
     * attachment from the record.
     */
    assetId?: string;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
}

export type PromptExecutionStatus = "pending" | "succeeded" | "failed";

export interface PromptExecutionMediaResolutionSummary {
    version: string;
    resolvedCount: number;
    failedCount: number;
    degraded: boolean;
    mediaKeys?: string[];
    traceIds?: string[];
}

export interface CostUnits {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    imageCount?: number;
    videoSeconds?: number;
    computeMs?: number;
    storageBytes?: number;
}

export interface CostRatesSnapshot {
    usdToEurRate: number;
    platformMarkupPct: number;
    infraCostPct: number;
    /** Fixed fee in EUR applied for this specific transaction (0 when none). */
    fixedFeeEur?: number;
    textEurPer1kTokens: number;
    imageEurPerAsset: number;
    videoEurPerAsset: number;
}

export interface CostSourceRef {
    conversationId?: string;
    messageId?: string;
    backgroundTaskId?: string;
    promptExecutionLogId?: string;
    assetId?: string;
    enrichmentTraceId?: string;
    backgroundJobId?: string;
    exportId?: string;
    sessionId?: string;
    /**
     * The WorkSession this cost belongs to. Distinct from `sessionId` above, which predates work
     * sessions and names other session notions — overloading it would make the one field meant to
     * make costs reconstructible mean two things depending on who wrote the row.
     */
    workSessionId?: string;
}

// ── List view ────────────────────────────────────────────────────────────────

/**
 * Deliberately carries NO prompt bodies. A single session's rows hold ~50,000 characters of system
 * prompt each, and this is what renders the collapsed list before any block is expanded — including
 * them would make opening the page download megabytes.
 */
export interface WorkSessionSummaryDto {
    id: string;
    entryMode: PipelineEntryMode;
    status: WorkSessionStatus;
    createdAt: string;
    /** Unique pipeline stages this session's runs dispatched, first-seen order. */
    stages: PipelineStage[];
    totalCostEur: number;
    totalDurationMs: number;
    /** True when any journal row in this session has `finishReason: "length"`. */
    truncated: boolean;
}

// ── Detail view ──────────────────────────────────────────────────────────────

export interface VibeIntakeDetailDto {
    id: string;
    userId: string;
    projectId?: string;
    prompt: string;
    attachments: VibeAttachmentRef[];
    requestedProvider?: string;
    requestedModel?: string;
    generationMode?: string;
    options?: Record<string, unknown>;
    promptExecutionLogIds: string[];
    createdAt: string;
}

export interface ZeroEffortFormProposalDetailDto {
    id: string;
    prefilled: GuidedLaunchInput;
    editedFields: string[];
    prefillPromptExecutionLogId?: string;
    briefContentHash?: string;
    createdAt: string;
}

export interface PipelineRunDetailDto {
    id: string;
    projectId: string;
    entryMode: PipelineEntryMode;
    modelLock: PipelineModelLock;
    status: PipelineRunStatus;
    stages: Array<{
        stage: PipelineStage;
        taskKey: string;
        promptExecutionId?: string;
        decision: ModelSelectionDecision;
        status: string;
        startedAt: string;
        completedAt?: string;
    }>;
    /** The certificate that this text is what was sent. */
    canonicalBrief?: CanonicalBriefEnvelope;
    createdAt: string;
    updatedAt: string;
}

export interface PromptExecutionLogDetailDto {
    id: string;
    taskKey: string;
    pipelineRunId?: string;
    pipelineStage?: string;
    endpoint?: string;
    provider: string;
    model: string;
    inputPrompt: string;
    optimizedPrompt?: string;
    renderedSystemPrompt?: string;
    renderedUserPrompt?: string;
    rawResponse?: string;
    reasoningTrace?: string;
    finishReason?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    mediaResolutionSummary?: PromptExecutionMediaResolutionSummary;
    /** Sourced from `PromptExecutionLog.contextMeta.assetIds` — the documents that shaped this call. */
    contextAssetIds?: string[];
    status: PromptExecutionStatus;
    durationMs: number;
    errorMessage?: string;
    createdAt: string;
}

export interface CostTransactionDetailDto {
    id: string;
    txId: string;
    resourceType: string;
    resourceSubtype?: string;
    totalEur: number;
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    ratesSnapshot: CostRatesSnapshot;
    units: CostUnits;
    sourceRef: CostSourceRef;
    status: "settled" | "voided";
    createdAt: string;
}

export interface WorkSessionDetailDto {
    id: string;
    projectId?: string;
    entryMode: PipelineEntryMode;
    status: WorkSessionStatus;
    config: WorkSessionConfig;
    failureReason?: string;
    createdAt: string;
    updatedAt: string;
    vibeIntakes: VibeIntakeDetailDto[];
    zeroEffortFormProposals: ZeroEffortFormProposalDetailDto[];
    pipelineRuns: PipelineRunDetailDto[];
    promptExecutionLogs: PromptExecutionLogDetailDto[];
    costTransactions: CostTransactionDetailDto[];
}

export interface WorkSessionSummaryListResponse {
    sessions: WorkSessionSummaryDto[];
}

export interface WorkSessionDetailResponse {
    session: WorkSessionDetailDto;
}
