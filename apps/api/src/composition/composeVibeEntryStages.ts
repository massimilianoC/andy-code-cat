/**
 * The one wiring of the three Vibe entry stages (classify, prefill, workspace launch) and of the
 * publish use case.
 *
 * The API builds them here for /vibecore/classify, /vibecore/prefill, /pipeline/launch-workspace
 * and /publish; the background worker builds them here for a run's steps. One composition, so
 * the interactive flow and a background run cannot differ by wiring (AGENTS.md Rule Zero,
 * BACKGROUND_RUNS.md §1).
 */
import { PublishProject } from "../application/use-cases/PublishProject";
import { LaunchGuidedProject } from "../application/use-cases/LaunchGuidedProject";
import { LaunchWorkspacePipeline } from "../application/use-cases/LaunchWorkspacePipeline";
import { OpenWorkSession } from "../application/use-cases/OpenWorkSession";
import { PrepareGenerationWorkspace } from "../application/use-cases/PrepareGenerationWorkspace";
import { ResolveBrandDocumentContext } from "../application/use-cases/ResolveBrandDocumentContext";
import { ResolvePipelineModelLock } from "../application/use-cases/ResolvePipelineModelLock";
import { VibeClassify } from "../application/use-cases/VibeClassify";
import { VibePrefill } from "../application/use-cases/VibePrefill";
import { VibeClassifyStage, VibePrefillStage, WorkspaceLaunchStage } from "../application/vibe/VibeEntryStages";
import type { GetLlmCatalog } from "../application/use-cases/GetLlmCatalog";
import { MongoBrandAssetRepository } from "../infra/repositories/MongoBrandAssetRepository";
import { MongoConversationRepository } from "../infra/repositories/MongoConversationRepository";
import { MongoPipelineRunRepository } from "../infra/repositories/MongoPipelineRunRepository";
import { MongoPlatformConfigRepository } from "../infra/repositories/MongoPlatformConfigRepository";
import { MongoPreviewSnapshotRepository } from "../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoProjectAssetRepository } from "../infra/repositories/MongoProjectAssetRepository";
import { MongoProjectMoodboardRepository } from "../infra/repositories/MongoProjectMoodboardRepository";
import { MongoProjectRepository } from "../infra/repositories/MongoProjectRepository";
import { MongoPromptExecutionLogRepository } from "../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoPublishHistoryRepository } from "../infra/repositories/MongoPublishHistoryRepository";
import { MongoSiteDeploymentRepository } from "../infra/repositories/MongoSiteDeploymentRepository";
import { MongoVibeIntakeRepository } from "../infra/repositories/MongoVibeIntakeRepository";
import { MongoWorkSessionRepository } from "../infra/repositories/MongoWorkSessionRepository";
import { MongoZeroEffortFormProposalRepository } from "../infra/repositories/MongoZeroEffortFormProposalRepository";
import { localFileStorage } from "../infra/storage/LocalFileStorage";
import { getFileStorage } from "../infra/storage/StorageFactory";
import { composeGetLlmCatalog } from "./composeGenerationEngine";

export function composeVibeClassifyStage(getLlmCatalog: GetLlmCatalog = composeGetLlmCatalog()): VibeClassifyStage {
    return new VibeClassifyStage(
        new VibeClassify(new MongoPlatformConfigRepository(), getLlmCatalog, new MongoPromptExecutionLogRepository()),
        new OpenWorkSession(new MongoWorkSessionRepository()),
        new MongoVibeIntakeRepository(),
        new MongoProjectRepository(),
    );
}

export function composeVibePrefillStage(getLlmCatalog: GetLlmCatalog = composeGetLlmCatalog()): VibePrefillStage {
    return new VibePrefillStage(
        new VibePrefill(new MongoPlatformConfigRepository(), getLlmCatalog, new MongoPromptExecutionLogRepository()),
        new OpenWorkSession(new MongoWorkSessionRepository()),
        new MongoProjectAssetRepository(),
        getFileStorage(),
        new ResolveBrandDocumentContext(new MongoBrandAssetRepository()),
        new MongoZeroEffortFormProposalRepository(),
    );
}

export function composeWorkspaceLaunchStage(getLlmCatalog: GetLlmCatalog = composeGetLlmCatalog()): WorkspaceLaunchStage {
    const conversationRepository = new MongoConversationRepository();
    const pipelineRunRepository = new MongoPipelineRunRepository();
    const launchGuidedProject = new LaunchGuidedProject(
        new MongoProjectMoodboardRepository(),
        conversationRepository,
        new PrepareGenerationWorkspace(
            new MongoProjectAssetRepository(),
            new MongoPreviewSnapshotRepository(),
            conversationRepository,
            localFileStorage,
        ),
    );
    return new WorkspaceLaunchStage(
        new MongoProjectRepository(),
        new OpenWorkSession(new MongoWorkSessionRepository()),
        new LaunchWorkspacePipeline(
            launchGuidedProject,
            new ResolvePipelineModelLock(pipelineRunRepository, getLlmCatalog),
            pipelineRunRepository,
        ),
        new MongoZeroEffortFormProposalRepository(),
    );
}

export function composePublishProject(): PublishProject {
    return new PublishProject(
        new MongoSiteDeploymentRepository(),
        new MongoPreviewSnapshotRepository(),
        localFileStorage,
        new MongoProjectAssetRepository(),
        new MongoPublishHistoryRepository(),
        new MongoPlatformConfigRepository(),
    );
}
