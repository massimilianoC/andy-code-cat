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
import type { DidacticQnaRepository } from "../../domain/repositories/DidacticQnaRepository";
import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { LlmPromptConfigRepository } from "../../domain/repositories/LlmPromptConfigRepository";
import type { BackgroundRunRepository } from "../../domain/repositories/BackgroundRunRepository";
import type { ExportRepository } from "../../domain/repositories/ExportRepository";
import type { ProjectDataRegistry } from "../projectData/ProjectDataRegistry";
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
    didacticQnaEntries: number;
    projectAssets: number;
    projectBrandAssets: number;
    promptConfigs: number;
    backgroundRuns: number;
    exportRecords: number;
    siteDeployments: number;
    /** Records removed per project data capability (docs/specs/PROJECT_DATA_PANEL.md), by capability id. */
    projectData: Record<string, number>;
}

/**
 * Everything a project deletion touches. Only the project and moodboard repositories are required
 * so a test can wire the part it is about; the one production wiring is
 * composition/composeDeleteProject.ts, which passes every dependency.
 */
export interface DeleteProjectDependencies {
    projects: ProjectRepository;
    moodboards: ProjectMoodboardRepository;
    promptExecutionLogs?: PromptExecutionLogRepository;
    conversations?: ConversationRepository;
    workSessions?: WorkSessionRepository;
    pipelineRuns?: PipelineRunRepository;
    costTransactions?: ICostTransactionRepository;
    previewSnapshots?: PreviewSnapshotRepository;
    mediaResolutionTraces?: MediaResolutionTraceRepository;
    vibeIntakes?: VibeIntakeRepository;
    publishHistory?: PublishHistoryRepository;
    wysiwygEditSessions?: WysiwygEditSessionRepository;
    zeroEffortFormProposals?: ZeroEffortFormProposalRepository;
    didacticKnowledge?: DidacticArtifactKnowledgeRepository;
    didacticQna?: DidacticQnaRepository;
    projectAssets?: ProjectAssetRepository;
    brandAssets?: BrandAssetRepository;
    promptConfigs?: LlmPromptConfigRepository;
    backgroundRuns?: BackgroundRunRepository;
    exports?: ExportRepository;
    siteDeployments?: SiteDeploymentRepository;
    fileStorage?: IFileStorage;
    projectData?: ProjectDataRegistry;
}

/** A deletion step that failed: the project is kept and the caller is told which steps. */
export class ProjectDeletionIncompleteError extends Error {
    readonly statusCode = 500;
    readonly code = "PROJECT_DELETE_INCOMPLETE";
    readonly userMessage = "La cancellazione del progetto non è stata completata. Il progetto è stato conservato: riprova.";
    readonly details: { projectId: string; failedSteps: string[] };

    constructor(projectId: string, failedSteps: string[]) {
        super(`Project deletion incomplete; failed steps: ${failedSteps.join(", ")}`);
        this.name = "ProjectDeletionIncompleteError";
        this.details = { projectId, failedSteps };
    }
}

type Step<T> = readonly [name: string, run: () => Promise<T>];

/**
 * Deleting a project deletes what the project wrote: every project-scoped collection, its stored
 * files and its published directories, then the project row.
 *
 * The rule is all-or-nothing as far as the project row is concerned. Each step runs; if any of
 * them fails, the project row is kept, the failure is logged with the step names, and the caller
 * receives `ProjectDeletionIncompleteError`. The deletion can then be repeated: every step is
 * idempotent. Keeping the row matters because it is the only handle an owner or an operator has
 * on the data that was not removed — a project that disappears while its visitor data, files or
 * published site survive is the orphan state this use case exists to prevent.
 *
 * Order: files first (published directories, then every stored file of the project), records
 * after, project row last. A failed file step stops before any record is removed, so the records
 * that point at the files are still there.
 *
 * Deliberately not removed:
 *
 * - `sessions` (auth sessions) are user-scoped; the `projectId` on a session is only the project
 *   selected at login. Account deletion removes them.
 * - `execution_logs` is a 90-day TTL audit trail (docs/specs/EXECUTION_LOG_SPEC.md) that exists to
 *   survive the actions taken on a project, deletion included. It is a different collection from
 *   `prompt_execution_logs` (`journalRows`), which is removed.
 *
 * Records stored by platform capabilities (form submissions, arcade leaderboards, any capability
 * added later) are purged through the `ProjectDataRegistry` (composition/composeProjectData.ts),
 * the same registry the owner's data panel reads.
 *
 * There is one deletion, and this is it: the dashboard, the Zero Effort discard, the superadmin
 * and account deletion all run it (composition/composeDeleteProject.ts).
 */
export class DeleteProject {
    constructor(private readonly deps: DeleteProjectDependencies) { }

    async execute(projectId: string, userId: string): Promise<DeletedProjectCounts> {
        const d = this.deps;
        const project = await d.projects.findByIdForUser(projectId, userId);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { statusCode: 404 });
        }

        await this.runAll(projectId, [
            ["published directories", async () => {
                const deployments = await d.siteDeployments?.findByProjectId(projectId) ?? [];
                await Promise.all(deployments.flatMap((deployment) => [
                    d.fileStorage?.deletePublishDir(deployment.publishId),
                    deployment.customSlug ? d.fileStorage?.deletePublishDir(deployment.customSlug) : undefined,
                ]));
            }],
            ["project files", async () => { await d.fileStorage?.deleteProjectFiles(userId, projectId); }],
        ]);

        const zero = async () => 0;
        const counts = await this.runAll<unknown>(projectId, [
            ["moodboard", async () => { await d.moodboards.deleteByProjectId(projectId); return 0; }],
            ["journalRows", () => d.promptExecutionLogs?.deleteByProject(projectId, userId) ?? zero()],
            ["costTransactions", () => d.costTransactions?.deleteByProject(projectId, userId) ?? zero()],
            ["conversations", () => d.conversations?.deleteByProject(projectId, userId) ?? zero()],
            ["workSessions", () => d.workSessions?.deleteByProject(projectId, userId) ?? zero()],
            ["pipelineRuns", () => d.pipelineRuns?.deleteByProject(projectId, userId) ?? zero()],
            ["previewSnapshots", () => d.previewSnapshots?.deleteByProject(projectId) ?? zero()],
            ["mediaResolutionTraces", () => d.mediaResolutionTraces?.deleteByProject(projectId) ?? zero()],
            ["vibeIntakes", () => d.vibeIntakes?.deleteByProject(projectId, userId) ?? zero()],
            ["publishHistoryEntries", () => d.publishHistory?.deleteByProject(projectId) ?? zero()],
            ["wysiwygEditSessions", () => d.wysiwygEditSessions?.deleteByProject(projectId) ?? zero()],
            ["zeroEffortFormProposals", () => d.zeroEffortFormProposals?.deleteByProject(projectId, userId) ?? zero()],
            ["didacticArtifactKnowledge", () => d.didacticKnowledge?.deleteByProject(projectId) ?? zero()],
            ["didacticQnaEntries", () => d.didacticQna?.deleteByProject(projectId) ?? zero()],
            ["projectAssets", () => d.projectAssets?.deleteByProject(projectId, userId) ?? zero()],
            ["projectBrandAssets", () => d.brandAssets?.deleteByProject(projectId, userId) ?? zero()],
            ["promptConfigs", () => d.promptConfigs?.deleteByProjectId(projectId) ?? zero()],
            ["backgroundRuns", () => d.backgroundRuns?.deleteByProject(projectId, userId) ?? zero()],
            ["exportRecords", () => d.exports?.deleteByProject(projectId, userId) ?? zero()],
            ["siteDeployments", () => d.siteDeployments?.deleteByProject(projectId) ?? zero()],
            ["projectData", () => d.projectData?.purgeProject({ ownerUserId: userId, projectId }) ?? Promise.resolve({})],
        ]);

        await d.projects.deleteById(projectId, userId);

        const [, journalRows, costTransactions, conversations, workSessions, pipelineRuns, previewSnapshots,
            mediaResolutionTraces, vibeIntakes, publishHistoryEntries, wysiwygEditSessions, zeroEffortFormProposals,
            didacticArtifactKnowledge, didacticQnaEntries, projectAssets, projectBrandAssets, promptConfigs,
            backgroundRuns, exportRecords, siteDeployments] = counts as number[];
        const projectData = counts[counts.length - 1] as Record<string, number>;
        return {
            journalRows: journalRows!,
            costTransactions: costTransactions!,
            conversations: conversations!,
            workSessions: workSessions!,
            pipelineRuns: pipelineRuns!,
            previewSnapshots: previewSnapshots!,
            mediaResolutionTraces: mediaResolutionTraces!,
            vibeIntakes: vibeIntakes!,
            publishHistoryEntries: publishHistoryEntries!,
            wysiwygEditSessions: wysiwygEditSessions!,
            zeroEffortFormProposals: zeroEffortFormProposals!,
            didacticArtifactKnowledge: didacticArtifactKnowledge!,
            didacticQnaEntries: didacticQnaEntries!,
            projectAssets: projectAssets!,
            projectBrandAssets: projectBrandAssets!,
            promptConfigs: promptConfigs!,
            backgroundRuns: backgroundRuns!,
            exportRecords: exportRecords!,
            siteDeployments: siteDeployments!,
            projectData,
        };
    }

    /** Runs every step; when one or more fail, logs them and throws with their names. */
    private async runAll<T>(projectId: string, steps: ReadonlyArray<Step<T>>): Promise<T[]> {
        const results = await Promise.allSettled(steps.map(([, run]) => run()));
        const failed = results.flatMap((result, index) => result.status === "rejected" ? [steps[index]![0]] : []);
        if (failed.length > 0) {
            console.error("[DeleteProject] deletion incomplete; project kept", {
                projectId,
                failedSteps: failed,
                errors: results.flatMap((result) => result.status === "rejected"
                    ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
                    : []),
            });
            throw new ProjectDeletionIncompleteError(projectId, failed);
        }
        return results.map((result) => (result as PromiseFulfilledResult<T>).value);
    }
}
