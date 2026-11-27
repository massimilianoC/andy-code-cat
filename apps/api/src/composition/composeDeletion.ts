/**
 * The one wiring of project and account deletion. The dashboard, the Zero Effort discard, the
 * superadmin and account deletion all build `DeleteProject` from here, so a collection added to the
 * deletion is removed on every path at once.
 */
import { DeleteProject, type DeleteProjectDependencies } from "../application/use-cases/DeleteProject";
import { AdminDeleteProject } from "../application/use-cases/admin/AdminDeleteProject";
import { DeleteUser } from "../application/use-cases/admin/DeleteUser";
import { MongoUserRepository } from "../infra/repositories/MongoUserRepository";
import { MongoSessionRepository } from "../infra/repositories/MongoSessionRepository";
import { MongoUserTemplateRepository } from "../infra/repositories/MongoUserTemplateRepository";
import { MongoUserPreferencesRepository } from "../infra/repositories/MongoUserPreferencesRepository";
import { MongoUserStyleProfileRepository } from "../infra/repositories/MongoUserStyleProfileRepository";
import { MongoSystemNotificationRepository } from "../infra/repositories/MongoSystemNotificationRepository";
import { MongoServiceApiKeyRepository } from "../infra/repositories/MongoServiceApiKeyRepository";
import { composeProjectDataRegistry } from "./composeProjectData";
import { MongoProjectRepository } from "../infra/repositories/MongoProjectRepository";
import { MongoProjectMoodboardRepository } from "../infra/repositories/MongoProjectMoodboardRepository";
import { MongoPromptExecutionLogRepository } from "../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoConversationRepository } from "../infra/repositories/MongoConversationRepository";
import { MongoWorkSessionRepository } from "../infra/repositories/MongoWorkSessionRepository";
import { MongoPipelineRunRepository } from "../infra/repositories/MongoPipelineRunRepository";
import { MongoCostTransactionRepository } from "../infra/repositories/MongoCostTransactionRepository";
import { MongoPreviewSnapshotRepository } from "../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoMediaResolutionTraceRepository } from "../infra/repositories/MongoMediaResolutionTraceRepository";
import { MongoVibeIntakeRepository } from "../infra/repositories/MongoVibeIntakeRepository";
import { MongoPublishHistoryRepository } from "../infra/repositories/MongoPublishHistoryRepository";
import { MongoWysiwygEditSessionRepository } from "../infra/repositories/MongoWysiwygEditSessionRepository";
import { MongoZeroEffortFormProposalRepository } from "../infra/repositories/MongoZeroEffortFormProposalRepository";
import { MongoDidacticArtifactKnowledgeRepository } from "../infra/repositories/MongoDidacticArtifactKnowledgeRepository";
import { MongoDidacticQnaRepository } from "../infra/repositories/MongoDidacticQnaRepository";
import { MongoProjectAssetRepository } from "../infra/repositories/MongoProjectAssetRepository";
import { MongoBrandAssetRepository } from "../infra/repositories/MongoBrandAssetRepository";
import { MongoLlmPromptConfigRepository } from "../infra/repositories/MongoLlmPromptConfigRepository";
import { MongoBackgroundRunRepository } from "../infra/repositories/MongoBackgroundRunRepository";
import { MongoExportRepository } from "../infra/repositories/MongoExportRepository";
import { MongoSiteDeploymentRepository } from "../infra/repositories/MongoSiteDeploymentRepository";
import { getFileStorage } from "../infra/storage/StorageFactory";

/** Every dependency, none optional: a missing one here would silently skip a collection. */
export function deleteProjectDependencies(): Required<DeleteProjectDependencies> {
    return {
        projects: new MongoProjectRepository(),
        moodboards: new MongoProjectMoodboardRepository(),
        promptExecutionLogs: new MongoPromptExecutionLogRepository(),
        conversations: new MongoConversationRepository(),
        workSessions: new MongoWorkSessionRepository(),
        pipelineRuns: new MongoPipelineRunRepository(),
        costTransactions: new MongoCostTransactionRepository(),
        previewSnapshots: new MongoPreviewSnapshotRepository(),
        mediaResolutionTraces: new MongoMediaResolutionTraceRepository(),
        vibeIntakes: new MongoVibeIntakeRepository(),
        publishHistory: new MongoPublishHistoryRepository(),
        wysiwygEditSessions: new MongoWysiwygEditSessionRepository(),
        zeroEffortFormProposals: new MongoZeroEffortFormProposalRepository(),
        didacticKnowledge: new MongoDidacticArtifactKnowledgeRepository(),
        didacticQna: new MongoDidacticQnaRepository(),
        projectAssets: new MongoProjectAssetRepository(),
        brandAssets: new MongoBrandAssetRepository(),
        promptConfigs: new MongoLlmPromptConfigRepository(),
        backgroundRuns: new MongoBackgroundRunRepository(),
        exports: new MongoExportRepository(),
        siteDeployments: new MongoSiteDeploymentRepository(),
        fileStorage: getFileStorage(),
        projectData: composeProjectDataRegistry(),
    };
}

export function composeDeleteProject(): DeleteProject {
    return new DeleteProject(deleteProjectDependencies());
}

export function composeAdminDeleteProject(): AdminDeleteProject {
    return new AdminDeleteProject(new MongoProjectRepository(), new MongoSiteDeploymentRepository(), composeDeleteProject());
}

export function composeDeleteUser(): DeleteUser {
    return new DeleteUser({
        users: new MongoUserRepository(),
        projects: new MongoProjectRepository(),
        deleteProject: composeDeleteProject(),
        sessions: new MongoSessionRepository(),
        projectAssets: new MongoProjectAssetRepository(),
        brandAssets: new MongoBrandAssetRepository(),
        templates: new MongoUserTemplateRepository(),
        preferences: new MongoUserPreferencesRepository(),
        styleProfiles: new MongoUserStyleProfileRepository(),
        notifications: new MongoSystemNotificationRepository(),
        exports: new MongoExportRepository(),
        backgroundRuns: new MongoBackgroundRunRepository(),
        serviceApiKeys: new MongoServiceApiKeyRepository(),
        fileStorage: getFileStorage(),
    });
}
