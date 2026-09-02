import type { DiscardPendingProjectResult } from "@andy-code-cat/contracts";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { WorkSessionRepository } from "../../domain/repositories/WorkSessionRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { ICostTransactionRepository } from "../../domain/repositories/ICostTransactionRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { DeleteProject } from "./DeleteProject";

/**
 * Interrupted-run recovery (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3bis / §4) — Feature A,
 * "discard".
 *
 * The third offer on a broken Zero Effort run, alongside the two retries: delete the project
 * outright so a failure does not leave a dead entry in the dashboard (98 of 156 projects
 * measured carried no snapshot at all — this is the cleanup path for that).
 *
 * It does NOT delete anything itself. `DeleteProject` used to remove only the project row and its
 * moodboard, leaving the journal, the costs, the sessions and the runs orphaned; that was a defect
 * in `DeleteProject` rather than a reason for a second deletion, and it has been fixed there. This
 * use case adds only what a REJECTED run needs on top: the guard, and the counts the caller states
 * back (docs/specs/INTERRUPTED_RUN_RECOVERY.md §4: "it must say what it removes").
 *
 * Two ways to delete a project would eventually disagree about what "deleted" means.
 *
 * Guarded against discarding a project that actually has something: if an artifact already
 * exists, this refuses — discard is for a run the user is rejecting, not a way to lose real
 * work (§4: "discard must be genuinely safe").
 */
export class DiscardPendingProject {
    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly snapshotRepository: PreviewSnapshotRepository,
        private readonly deleteProject: DeleteProject,
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

        // The one deletion. Everything above this line is the guard; everything the removal does
        // belongs to DeleteProject, so a project discarded here and a project deleted from the
        // dashboard leave the database in the same state.
        const removed = await this.deleteProject.execute(input.projectId, input.userId);

        return { deleted: true, removed };
    }
}
