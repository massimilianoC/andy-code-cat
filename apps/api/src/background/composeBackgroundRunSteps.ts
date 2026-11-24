/**
 * Composition root of the background-run steps (like app.ts for the HTTP routes): the only place
 * that wires concrete repositories into what the worker executes. The stages, the generation
 * engine and the publish use case come from the same composition functions the API uses.
 */
import { env } from "../config";
import type { BackgroundRunSteps } from "../application/background/BackgroundRunEngine";
import { notifyBackgroundRunFinished } from "../application/background/backgroundRunNotifications";
import { VibeBackgroundRunSteps } from "../application/background/VibeBackgroundRunSteps";
import { resolvePublicSitesConfig, resolvePublicSiteUrl } from "../application/publish/publicSiteAddress";
import { AddMessage } from "../application/use-cases/AddMessage";
import { ManageProject } from "../application/use-cases/ManageProject";
import { composeGenerationEngine, composeGetLlmCatalog } from "../composition/composeGenerationEngine";
import {
    composePublishProject,
    composeVibeClassifyStage,
    composeVibePrefillStage,
    composeWorkspaceLaunchStage,
} from "../composition/composeVibeEntryStages";
import { resolveDocumentContextPolicyFromConfig } from "../domain/entities/PlatformConfig";
import type { BackgroundRunRepository } from "../domain/repositories/BackgroundRunRepository";
import { MongoConversationRepository } from "../infra/repositories/MongoConversationRepository";
import { MongoPipelineRunRepository } from "../infra/repositories/MongoPipelineRunRepository";
import { MongoPlatformConfigRepository } from "../infra/repositories/MongoPlatformConfigRepository";
import { MongoPreviewSnapshotRepository } from "../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoProjectMoodboardRepository } from "../infra/repositories/MongoProjectMoodboardRepository";
import { MongoProjectPresetRepository } from "../infra/repositories/MongoProjectPresetRepository";
import { MongoProjectRepository } from "../infra/repositories/MongoProjectRepository";
import { MongoPromptExecutionLogRepository } from "../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoSiteDeploymentRepository } from "../infra/repositories/MongoSiteDeploymentRepository";
import { MongoUserRepository } from "../infra/repositories/MongoUserRepository";

export function composeBackgroundRunSteps(runs: BackgroundRunRepository): BackgroundRunSteps {
    const getLlmCatalog = composeGetLlmCatalog();
    const projects = new MongoProjectRepository();
    const conversations = new MongoConversationRepository();
    const platformConfig = new MongoPlatformConfigRepository();
    const { generateArtifact } = composeGenerationEngine(getLlmCatalog);

    return new VibeBackgroundRunSteps({
        runs,
        users: new MongoUserRepository(),
        projects,
        manageProject: new ManageProject(projects, new MongoProjectPresetRepository(), new MongoProjectMoodboardRepository()),
        documentContextPolicy: async (presetId) =>
            resolveDocumentContextPolicyFromConfig(await platformConfig.get().catch(() => null), presetId ?? "default"),
        classify: composeVibeClassifyStage(getLlmCatalog),
        prefill: composeVibePrefillStage(getLlmCatalog),
        launch: composeWorkspaceLaunchStage(getLlmCatalog),
        pipelineRuns: new MongoPipelineRunRepository(),
        conversations,
        addMessage: new AddMessage(conversations),
        generateArtifact,
        snapshots: new MongoPreviewSnapshotRepository(),
        journal: new MongoPromptExecutionLogRepository(),
        publishProject: composePublishProject(),
        deployments: new MongoSiteDeploymentRepository(),
        publicUrlOf: async (deployment) =>
            resolvePublicSiteUrl(deployment, resolvePublicSitesConfig(await platformConfig.get().catch(() => null))),
        notifyFinished: notifyBackgroundRunFinished,
        generationTimeoutMs: env.BACKGROUND_RUN_GENERATION_TIMEOUT_MS,
    });
}
