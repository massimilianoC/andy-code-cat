import type { DiscardPendingProjectResult } from "@andy-code-cat/contracts";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { WorkSessionRepository } from "../../domain/repositories/WorkSessionRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { ICostTransactionRepository } from "../../domain/repositories/ICostTransactionRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

/**
 * Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis / §4) — Feature A,
 * "discard".
 *
 * The third offer on a broken Zero Effort run, alongside the two retries: delete the project
 * outright so a failure does not leave a dead entry in the dashboard (98 of 156 projects
 * measured carried no snapshot at all — this is the cleanup path for that).
 *
 * `DeleteProject` (the existing use-case) only removes the project row and its moodboard — it
 * predates the journal, the cost ledger, work sessions and pipeline runs, and leaves all four
 * behind as orphans. This use case is the thorough version discard needs: it removes the
 * project AND everything a Zero Effort attempt wrote for it, and reports counts back so the
 * caller can state exactly what was removed rather than a vague "done"
 * (docs/specs/INTERRUPTED_RUN_RECOVERY.md §4: "it must say what it removes").
 *
 * Guarded against discarding a project that actually has something: if an artifact already
 * exists, this refuses — discard is for a run the user is rejecting, not a way to lose real
 * work (§4: "discard must be genuinely safe").
 */
export class DiscardPendingProject {
    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly moodboardRepository: ProjectMoodboardRepository,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly conversationRepository: ConversationRepository,
        private readonly workSessionRepository: WorkSessionRepository,
        private readonly pipelineRunRepository: PipelineRunRepository,
        private readonly costTransactionRepository: ICostTransactionRepository,
        private readonly snapshotRepository: PreviewSnapshotRepository,
    ) { }

    async execute(input: { projectId: string; userId: string }): Promise<DiscardPendingProjectResult> {
        const project = await this.projectRepository.findByIdForUser(input.projectId, input.userId);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }

        const activeSnapshot = await this.snapshotRepository.getActiveForProject(input.projectId).catch(() => null);
        if (activeSnapshot) {
            throw Object.assign(
                new Error("Cannot discard a project that already has published content"),
                { statusCode: 409, code: "PROJECT_HAS_CONTENT" },
            );
        }

        const [journalRows, costTransactions, conversations, workSessions, pipelineRuns] = await Promise.all([
            this.promptExecutionLogRepository.deleteByProject(input.projectId, input.userId),
            this.costTransactionRepository.deleteByProject(input.projectId, input.userId),
            this.conversationRepository.deleteByProject(input.projectId, input.userId),
            this.workSessionRepository.deleteByProject(input.projectId, input.userId),
            this.pipelineRunRepository.deleteByProject(input.projectId, input.userId),
        ]);

        // Best effort, matching DeleteProject — a missing moodboard must not block the discard.
        try {
            await this.moodboardRepository.deleteByProjectId(input.projectId);
        } catch {
            // best effort
        }

        const deleted = await this.projectRepository.deleteById(input.projectId, input.userId);

        return {
            deleted,
            removed: { journalRows, costTransactions, conversations, workSessions, pipelineRuns },
        };
    }
}
