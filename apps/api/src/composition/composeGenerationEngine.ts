/**
 * The one wiring of the generation engine (GenerateArtifact and the prompt resolver it uses).
 *
 * Both processes build it here — the API for /llm/chat-preview[/stream] and /llm/prompt-preview,
 * the background worker for a run's generation step — so the two cannot be composed differently
 * (a different repository, catalog source or storage would be a second pipeline by wiring).
 */
import { env } from "../config";
import { ResolveArtifactMedia } from "../application/media/ResolveArtifactMedia";
import { AddMessage } from "../application/use-cases/AddMessage";
import { CommitArtifactVersion } from "../application/use-cases/CommitArtifactVersion";
import { CreatePreviewSnapshot } from "../application/use-cases/CreatePreviewSnapshot";
import { GenerateArtifact } from "../application/use-cases/GenerateArtifact";
import { GetLlmCatalog } from "../application/use-cases/GetLlmCatalog";
import { GetLlmPromptConfig } from "../application/use-cases/GetLlmPromptConfig";
import { OpenWorkSession } from "../application/use-cases/OpenWorkSession";
import { ResolveBrandContext } from "../application/use-cases/ResolveBrandContext";
import { ResolveBrandDocumentContext } from "../application/use-cases/ResolveBrandDocumentContext";
import { ResolvePipelineModelLock } from "../application/use-cases/ResolvePipelineModelLock";
import { ResolvePromptExecution } from "../application/use-cases/ResolvePromptExecution";
import { MongoBrandAssetRepository } from "../infra/repositories/MongoBrandAssetRepository";
import { MongoConversationRepository } from "../infra/repositories/MongoConversationRepository";
import { MongoLlmCatalogRepository } from "../infra/repositories/MongoLlmCatalogRepository";
import { MongoLlmPromptConfigRepository } from "../infra/repositories/MongoLlmPromptConfigRepository";
import { MongoMediaResolutionTraceRepository } from "../infra/repositories/MongoMediaResolutionTraceRepository";
import { MongoPipelineRunRepository } from "../infra/repositories/MongoPipelineRunRepository";
import { MongoPlatformConfigRepository } from "../infra/repositories/MongoPlatformConfigRepository";
import { MongoPreviewSnapshotRepository } from "../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoProjectAssetRepository } from "../infra/repositories/MongoProjectAssetRepository";
import { MongoProjectMoodboardRepository } from "../infra/repositories/MongoProjectMoodboardRepository";
import { MongoProjectPresetRepository } from "../infra/repositories/MongoProjectPresetRepository";
import { MongoProjectRepository } from "../infra/repositories/MongoProjectRepository";
import { MongoPromptExecutionLogRepository } from "../infra/repositories/MongoPromptExecutionLogRepository";
import { MongoServiceApiKeyRepository } from "../infra/repositories/MongoServiceApiKeyRepository";
import { MongoUserRepository } from "../infra/repositories/MongoUserRepository";
import { MongoUserStyleProfileRepository } from "../infra/repositories/MongoUserStyleProfileRepository";
import { MongoWorkSessionRepository } from "../infra/repositories/MongoWorkSessionRepository";
import { getFileStorage } from "../infra/storage/StorageFactory";

export function composeGetLlmCatalog(): GetLlmCatalog {
    return new GetLlmCatalog(
        env.LLM_CATALOG_SOURCE,
        env.SILICONFLOW_BASE_URL,
        env.LMSTUDIO_BASE_URL,
        env.OPENROUTER_BASE_URL,
        new MongoLlmCatalogRepository(),
        env.hasOpenRouterApiKey,
        env.providerApiKeys,
        env.LLM_DEFAULT_PROVIDER,
    );
}

export function composeGenerationEngine(getLlmCatalog: GetLlmCatalog = composeGetLlmCatalog()) {
    const projectRepository = new MongoProjectRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();
    const conversationRepository = new MongoConversationRepository();
    const mediaResolutionTraceRepository = new MongoMediaResolutionTraceRepository();
    const platformConfigRepo = new MongoPlatformConfigRepository();
    const assetRepository = new MongoProjectAssetRepository();
    const brandAssetRepository = new MongoBrandAssetRepository();
    const storage = getFileStorage();

    const resolvePipelineModelLock = new ResolvePipelineModelLock(new MongoPipelineRunRepository(), getLlmCatalog);
    const resolvePromptExecution = new ResolvePromptExecution(
        getLlmCatalog,
        new GetLlmPromptConfig(new MongoLlmPromptConfigRepository()),
        new MongoProjectMoodboardRepository(),
        new MongoUserStyleProfileRepository(),
        projectRepository,
        platformConfigRepo,
        assetRepository,
        new MongoProjectPresetRepository(),
        new ResolveBrandDocumentContext(brandAssetRepository),
        new ResolveBrandContext(brandAssetRepository),
        resolvePipelineModelLock,
        storage,
    );
    const resolveArtifactMedia = new ResolveArtifactMedia(
        assetRepository,
        storage,
        new MongoServiceApiKeyRepository(),
        undefined,
        undefined,
        platformConfigRepo,
        mediaResolutionTraceRepository,
    );
    const commitArtifactVersion = new CommitArtifactVersion(
        conversationRepository,
        projectRepository,
        snapshotRepository,
        new CreatePreviewSnapshot(snapshotRepository, mediaResolutionTraceRepository, conversationRepository),
    );
    const generateArtifact = new GenerateArtifact(
        resolvePromptExecution,
        new MongoPromptExecutionLogRepository(),
        new OpenWorkSession(new MongoWorkSessionRepository()),
        snapshotRepository,
        resolveArtifactMedia,
        new MongoUserRepository(),
        {
            conversationRepository,
            addMessage: new AddMessage(conversationRepository),
            commitArtifactVersion,
        },
    );
    return { resolvePromptExecution, resolvePipelineModelLock, generateArtifact };
}
