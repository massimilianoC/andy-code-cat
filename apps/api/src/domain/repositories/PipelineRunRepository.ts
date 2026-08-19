import type {
    CanonicalBriefEnvelope,
    ModelSelectionBlockCode,
    OptimizationPolicy,
    PipelineEntryMode,
    PipelineModelLock,
    PipelineRunStatus,
    PipelineStage,
    PipelineStageExecutionRef,
} from "@andy-code-cat/contracts";
import type { PipelineRun } from "../entities/PipelineRun";

/** Fields required to persist a brand-new draft PipelineRun. */
export interface NewPipelineRun {
    projectId: string;
    ownerUserId: string;
    conversationId?: string;
    entryMode: PipelineEntryMode;
    modelLock: PipelineModelLock;
    optimizationPolicy: OptimizationPolicy;
    canonicalBrief?: CanonicalBriefEnvelope;
}

/** The persisted PipelineRun document, as returned by the repository. */
export type PipelineRunRecord = PipelineRun;

export interface PipelineRunRepository {
    create(run: NewPipelineRun): Promise<PipelineRunRecord>;

    /**
     * Ownership-scoped finder (double sandbox) — mirrors ProjectRepository.findByIdForUser:
     * the `ownerUserId` filter is applied at the query level, not as an application-layer
     * afterthought. Returns null both when the run doesn't exist and when it exists but is
     * not owned by `userId` — callers must not be able to distinguish the two.
     */
    findByIdForUser(id: string, userId: string): Promise<PipelineRunRecord | null>;

    listByProject(projectId: string, userId: string): Promise<PipelineRunRecord[]>;

    appendStage(runId: string, stage: PipelineStageExecutionRef): Promise<PipelineRunRecord>;

    /**
     * `detail` is required whenever `status === "blocked"` — see
     * PipelineRun.ts's assertStatusTransition. Implementations must validate the transition
     * against the run's current status and throw a clear error on any illegal transition
     * rather than silently no-op-ing.
     */
    setStatus(
        runId: string,
        status: PipelineRunStatus,
        detail?: { code: ModelSelectionBlockCode; stage: PipelineStage },
    ): Promise<PipelineRunRecord>;

    attachCanonicalBrief(runId: string, brief: CanonicalBriefEnvelope): Promise<PipelineRunRecord>;
}
