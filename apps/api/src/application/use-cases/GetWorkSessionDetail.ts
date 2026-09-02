import type {
    CanonicalBriefEnvelope,
    GuidedLaunchInput,
    ModelSelectionDecision,
    PipelineEntryMode,
    PipelineModelLock,
    PipelineRunStatus,
    PipelineStage,
} from "@andy-code-cat/contracts";
import type { WorkSessionRepository } from "../../domain/repositories/WorkSessionRepository";
import type { VibeIntakeRepository } from "../../domain/repositories/VibeIntakeRepository";
import type { ZeroEffortFormProposalRepository } from "../../domain/repositories/ZeroEffortFormProposalRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { ICostTransactionRepository } from "../../domain/repositories/ICostTransactionRepository";
import type { WorkSessionStatus, WorkSessionConfig } from "../../domain/entities/WorkSession";
import type { VibeAttachmentRef } from "../../domain/entities/VibeIntake";
import type { PromptExecutionStatus, PromptExecutionMediaResolutionSummary } from "../../domain/entities/PromptExecutionLog";
import type { CostRatesSnapshot, CostSourceRef, CostUnits } from "../../domain/entities/CostTransaction";

/**
 * The full, one-session shape for the Session Inspector's detail view
 * (docs/specs/SESSION_INSPECTOR_SPEC.md §2). Unlike ListWorkSessionSummaries, this DOES carry
 * prompt bodies — the client only fetches this once a block is expanded (spec §5.5).
 *
 * One fact, one owner (spec §5.2): the brief comes from `pipelineRuns[].canonicalBrief`, never
 * copied out of a generate-stage prompt that happens to contain the same text.
 */

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
    /** The certificate that this text is what was sent — spec §3 "Zero Effort". */
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
    /** Sourced from PromptExecutionLog.contextMeta.assetIds — see the entity for why it lives there. */
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

export class GetWorkSessionDetail {
    constructor(
        private readonly workSessionRepository: WorkSessionRepository,
        private readonly vibeIntakeRepository: VibeIntakeRepository,
        private readonly zeroEffortFormProposalRepository: ZeroEffortFormProposalRepository,
        private readonly pipelineRunRepository: PipelineRunRepository,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly costTransactionRepository: ICostTransactionRepository,
    ) {}

    /**
     * Returns null when the session does not exist, belongs to another user, or belongs to a
     * project other than `projectId` — all three resolve the same way (404), so a caller probing
     * someone else's session id cannot tell "not found" from "not yours" (spec constraint: double
     * sandbox / ownership-scoped everywhere).
     */
    async execute(projectId: string, workSessionId: string, userId: string): Promise<WorkSessionDetailDto | null> {
        const session = await this.workSessionRepository.findByIdForUser(workSessionId, userId);
        if (!session || session.projectId !== projectId) return null;

        const [vibeIntakes, zeroEffortFormProposals, allRuns, promptExecutionLogs, costTxs] = await Promise.all([
            this.vibeIntakeRepository.listByWorkSession(workSessionId, userId),
            this.zeroEffortFormProposalRepository.listByWorkSession(workSessionId, userId),
            this.pipelineRunRepository.listByProject(projectId, userId),
            this.promptExecutionLogRepository.listByWorkSession(workSessionId, userId),
            this.costTransactionRepository.findBySourceRef({ workSessionId }),
        ]);

        const pipelineRuns = allRuns.filter((run) => run.workSessionId === workSessionId);

        return {
            id: session.id,
            projectId: session.projectId,
            entryMode: session.entryMode,
            status: session.status,
            config: session.config,
            failureReason: session.failureReason,
            createdAt: session.createdAt.toISOString(),
            updatedAt: session.updatedAt.toISOString(),
            vibeIntakes: vibeIntakes.map((intake) => ({
                id: intake.id,
                userId: intake.userId,
                projectId: intake.projectId,
                prompt: intake.prompt,
                attachments: intake.attachments,
                requestedProvider: intake.requestedProvider,
                requestedModel: intake.requestedModel,
                generationMode: intake.generationMode,
                options: intake.options,
                promptExecutionLogIds: intake.promptExecutionLogIds,
                createdAt: intake.createdAt.toISOString(),
            })),
            zeroEffortFormProposals: zeroEffortFormProposals.map((proposal) => ({
                id: proposal.id,
                prefilled: proposal.prefilled,
                editedFields: proposal.editedFields,
                prefillPromptExecutionLogId: proposal.prefillPromptExecutionLogId,
                briefContentHash: proposal.briefContentHash,
                createdAt: proposal.createdAt.toISOString(),
            })),
            pipelineRuns: pipelineRuns.map((run) => ({
                id: run.id,
                projectId: run.projectId,
                entryMode: run.entryMode,
                modelLock: run.modelLock,
                status: run.status,
                stages: run.stages,
                canonicalBrief: run.canonicalBrief,
                createdAt: run.createdAt.toISOString(),
                updatedAt: run.updatedAt.toISOString(),
            })),
            promptExecutionLogs: promptExecutionLogs.map((log) => ({
                id: log.id,
                taskKey: log.taskKey,
                pipelineRunId: log.pipelineRunId,
                pipelineStage: log.pipelineStage,
                endpoint: log.endpoint,
                provider: log.provider,
                model: log.model,
                inputPrompt: log.inputPrompt,
                optimizedPrompt: log.optimizedPrompt,
                renderedSystemPrompt: log.renderedSystemPrompt,
                renderedUserPrompt: log.renderedUserPrompt,
                rawResponse: log.rawResponse,
                reasoningTrace: log.reasoningTrace,
                finishReason: log.finishReason,
                usage: log.usage,
                mediaResolutionSummary: log.mediaResolutionSummary,
                contextAssetIds: log.contextMeta?.assetIds,
                status: log.status,
                durationMs: log.durationMs,
                errorMessage: log.errorMessage,
                createdAt: log.createdAt.toISOString(),
            })),
            costTransactions: costTxs.map((tx) => ({
                id: tx.id,
                txId: tx.txId,
                resourceType: tx.resourceType,
                resourceSubtype: tx.resourceSubtype,
                totalEur: tx.totalEur,
                providerCostEur: tx.providerCostEur,
                infraCostEur: tx.infraCostEur,
                platformMarkupEur: tx.platformMarkupEur,
                ratesSnapshot: tx.ratesSnapshot,
                units: tx.units,
                sourceRef: tx.sourceRef,
                status: tx.status,
                createdAt: tx.createdAt.toISOString(),
            })),
        };
    }
}
