import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { WorkSessionRepository } from "../../domain/repositories/WorkSessionRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { ICostTransactionRepository } from "../../domain/repositories/ICostTransactionRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { MediaResolutionTraceRepository } from "../../domain/repositories/MediaResolutionTraceRepository";
import type { VibeIntakeRepository } from "../../domain/repositories/VibeIntakeRepository";
import type { PublishHistoryRepository } from "../../domain/repositories/PublishHistoryRepository";
import type { WysiwygEditSessionRepository } from "../../domain/repositories/WysiwygEditSessionRepository";
import type { ZeroEffortFormProposalRepository } from "../../domain/repositories/ZeroEffortFormProposalRepository";
import type { DidacticArtifactKnowledgeRepository } from "../../domain/repositories/DidacticArtifactKnowledgeRepository";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";

export interface DeletedProjectCounts {
    journalRows: number;
    costTransactions: number;
    conversations: number;
    workSessions: number;
    pipelineRuns: number;
    previewSnapshots: number;
    mediaResolutionTraces: number;
    vibeIntakes: number;
    publishHistoryEntries: number;
    wysiwygEditSessions: number;
    zeroEffortFormProposals: number;
    didacticArtifactKnowledge: number;
    projectAssets: number;
    siteDeployments: number;
}

/**
 * Deleting a project deletes what the project wrote.
 *
 * It used to remove the project row and its moodboard and stop there, which predates the journal,
 * the cost ledger, work sessions and pipeline runs — so every deletion from the dashboard left all
 * four behind as orphans pointing at a projectId nothing resolves. That was invisible precisely
 * because orphaned rows do not show up anywhere; you only find them by counting.
 *
 * A second audit (2026-09-07), measured the same way, found nine more project-scoped collections
 * the first pass missed: preview snapshots, media-resolution traces, vibe intakes, publish history,
 * site deployments, WYSIWYG edit sessions, zero-effort form proposals, didactic artifact knowledge
 * and project assets. All nine are now included below.
 *
 * Two collections were deliberately left out:
 *
 * - `sessions` (auth refresh-token sessions, `MongoSessionRepository`) are user-scoped, not
 *   project-scoped — the `projectId` field on a session record is only "the project selected at
 *   login," not an ownership boundary. Deleting a project must not invalidate a user's login just
 *   because the project they happened to be on when they last logged in is gone. There is already a
 *   dedicated user-scoped cleanup (`deleteAllByUserId`) for the case that actually matters.
 * - `execution_logs` (`MongoExecutionLogRepository`, see docs/specs/EXECUTION_LOG_SPEC.md) is
 *   explicitly documented as a 90-day TTL-indexed audit trail ("per-project, per-domain audit trail
 *   of key application events"). It already self-expires and exists specifically to survive the
 *   actions taken on a project, including its deletion — deleting it early would defeat the one
 *   purpose the collection has. Note this is a DIFFERENT collection from `prompt_execution_logs`
 *   (`journalRows` below), which has always been in scope.
 *
 * `project_assets` and `site_deployments` reference files (on local disk or in MinIO), not just DB
 * rows. Deleting only the row would leak the file — worse than leaving both behind, since a
 * matching DB row is the only thing that lets an operator find an orphaned file later. So for these
 * two, the files are removed first (via `IFileStorage.deleteUpload` / `deletePublishDir` — the same
 * calls `DeleteProjectAsset` and `UnpublishProject` make for a single item; one file-deletion path,
 * reused rather than duplicated) and the DB rows only after, via the bulk `deleteByProject` calls
 * below. `preview_snapshots` also has a thumbnail file, but neither this repository's `deleteById`
 * nor `DeletePreviewSnapshot` has ever cleaned that up — treating it as project-scoped DB-only data
 * here matches that existing, unrelated gap rather than making the file side worse.
 *
 * There is one deletion, and this is it. `DiscardPendingProject` adds the guard and the reporting
 * that a rejected Zero Effort run needs, and delegates the removal here rather than performing its
 * own — two ways to delete a project would eventually disagree about what "deleted" means.
 *
 * Every associated-data repository is optional so existing wiring keeps compiling, but a caller
 * that omits one is choosing the old, partial behaviour for that collection. Every production
 * wiring should pass them all.
 */
export class DeleteProject {
    constructor(
        private readonly projectRepo: ProjectRepository,
        private readonly moodboardRepo: ProjectMoodboardRepository,
        private readonly promptExecutionLogRepo?: PromptExecutionLogRepository,
        private readonly conversationRepo?: ConversationRepository,
        private readonly workSessionRepo?: WorkSessionRepository,
        private readonly pipelineRunRepo?: PipelineRunRepository,
        private readonly costTransactionRepo?: ICostTransactionRepository,
        private readonly previewSnapshotRepo?: PreviewSnapshotRepository,
        private readonly mediaResolutionTraceRepo?: MediaResolutionTraceRepository,
        private readonly vibeIntakeRepo?: VibeIntakeRepository,
        private readonly publishHistoryRepo?: PublishHistoryRepository,
        private readonly wysiwygEditSessionRepo?: WysiwygEditSessionRepository,
        private readonly zeroEffortFormProposalRepo?: ZeroEffortFormProposalRepository,
        private readonly didacticArtifactKnowledgeRepo?: DidacticArtifactKnowledgeRepository,
        private readonly projectAssetRepo?: ProjectAssetRepository,
        private readonly siteDeploymentRepo?: SiteDeploymentRepository,
        private readonly fileStorage?: IFileStorage,
    ) { }

    async execute(projectId: string, userId: string): Promise<DeletedProjectCounts> {
        // Verify ownership before doing anything
        const project = await this.projectRepo.findByIdForUser(projectId, userId);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }

        // Clean up moodboard (best effort — don't fail if missing)
        try {
            await this.moodboardRepo.deleteByProjectId(projectId);
        } catch {
            // best effort
        }

        // Files first, same order DeleteProjectAsset and UnpublishProject each use for a single
        // item: if the DB delete below fails the file is already gone, and an orphaned row pointing
        // at a missing file is far easier to spot and clean up later than a file with no row at
        // all. Best-effort — a storage failure here must not stop the project row (and everything
        // else) from being removed.
        try {
            const ownedAssets = await this.projectAssetRepo?.listOwnedByProject(projectId, userId) ?? [];
            await Promise.all(
                ownedAssets.map((asset) =>
                    this.fileStorage?.deleteUpload(userId, projectId, asset.storedFilename).catch(() => { })
                ),
            );
        } catch {
            // best effort
        }
        try {
            const deployments = await this.siteDeploymentRepo?.findByProjectId(projectId) ?? [];
            await Promise.all(
                deployments.flatMap((deployment) => [
                    this.fileStorage?.deletePublishDir(deployment.publishId).catch(() => { }),
                    deployment.customSlug
                        ? this.fileStorage?.deletePublishDir(deployment.customSlug).catch(() => { })
                        : undefined,
                ]),
            );
        } catch {
            // best effort
        }

        // Associated data first, project row last. If one of these throws the project survives and
        // can be deleted again; the reverse order would leave rows pointing at a project the user
        // can no longer see, which is the orphan state this exists to prevent.
        const [
            journalRows,
            costTransactions,
            conversations,
            workSessions,
            pipelineRuns,
            previewSnapshots,
            mediaResolutionTraces,
            vibeIntakes,
            publishHistoryEntries,
            wysiwygEditSessions,
            zeroEffortFormProposals,
            didacticArtifactKnowledge,
            projectAssets,
            siteDeployments,
        ] = await Promise.all([
            this.promptExecutionLogRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.costTransactionRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.conversationRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.workSessionRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.pipelineRunRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.previewSnapshotRepo?.deleteByProject(projectId).catch(() => 0) ?? 0,
            this.mediaResolutionTraceRepo?.deleteByProject(projectId).catch(() => 0) ?? 0,
            this.vibeIntakeRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.publishHistoryRepo?.deleteByProject(projectId).catch(() => 0) ?? 0,
            this.wysiwygEditSessionRepo?.deleteByProject(projectId).catch(() => 0) ?? 0,
            this.zeroEffortFormProposalRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.didacticArtifactKnowledgeRepo?.deleteByProject(projectId).catch(() => 0) ?? 0,
            this.projectAssetRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.siteDeploymentRepo?.deleteByProject(projectId).catch(() => 0) ?? 0,
        ]);

        await this.projectRepo.deleteById(projectId, userId);

        return {
            journalRows,
            costTransactions,
            conversations,
            workSessions,
            pipelineRuns,
            previewSnapshots,
            mediaResolutionTraces,
            vibeIntakes,
            publishHistoryEntries,
            wysiwygEditSessions,
            zeroEffortFormProposals,
            didacticArtifactKnowledge,
            projectAssets,
            siteDeployments,
        };
    }
}
