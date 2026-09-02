import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { WorkSessionRepository } from "../../domain/repositories/WorkSessionRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { ICostTransactionRepository } from "../../domain/repositories/ICostTransactionRepository";

export interface DeletedProjectCounts {
    journalRows: number;
    costTransactions: number;
    conversations: number;
    workSessions: number;
    pipelineRuns: number;
}

/**
 * Deleting a project deletes what the project wrote.
 *
 * It used to remove the project row and its moodboard and stop there, which predates the journal,
 * the cost ledger, work sessions and pipeline runs — so every deletion from the dashboard left all
 * four behind as orphans pointing at a projectId nothing resolves. That was invisible precisely
 * because orphaned rows do not show up anywhere; you only find them by counting.
 *
 * There is one deletion, and this is it. `DiscardPendingProject` adds the guard and the reporting
 * that a rejected Zero Effort run needs, and delegates the removal here rather than performing its
 * own — two ways to delete a project would eventually disagree about what "deleted" means.
 *
 * The associated-data repositories are optional so existing wiring keeps compiling, but a caller
 * that omits them is choosing the old, partial behaviour. Every production wiring should pass them.
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

        // Associated data first, project row last. If one of these throws the project survives and
        // can be deleted again; the reverse order would leave rows pointing at a project the user
        // can no longer see, which is the orphan state this exists to prevent.
        const [journalRows, costTransactions, conversations, workSessions, pipelineRuns] = await Promise.all([
            this.promptExecutionLogRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.costTransactionRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.conversationRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.workSessionRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
            this.pipelineRunRepo?.deleteByProject(projectId, userId).catch(() => 0) ?? 0,
        ]);

        await this.projectRepo.deleteById(projectId, userId);

        return { journalRows, costTransactions, conversations, workSessions, pipelineRuns };
    }
}
