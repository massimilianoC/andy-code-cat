import { describe, it, expect, vi } from "vitest";
import { DeleteProject } from "../DeleteProject";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../../domain/repositories/ProjectMoodboardRepository";
import type { PromptExecutionLogRepository } from "../../../domain/repositories/PromptExecutionLogRepository";
import type { ConversationRepository } from "../../../domain/repositories/ConversationRepository";
import type { WorkSessionRepository } from "../../../domain/repositories/WorkSessionRepository";
import type { PipelineRunRepository } from "../../../domain/repositories/PipelineRunRepository";
import type { ICostTransactionRepository } from "../../../domain/repositories/ICostTransactionRepository";
import type { PreviewSnapshotRepository } from "../../../domain/repositories/PreviewSnapshotRepository";
import type { MediaResolutionTraceRepository } from "../../../domain/repositories/MediaResolutionTraceRepository";
import type { VibeIntakeRepository } from "../../../domain/repositories/VibeIntakeRepository";
import type { PublishHistoryRepository } from "../../../domain/repositories/PublishHistoryRepository";
import type { WysiwygEditSessionRepository } from "../../../domain/repositories/WysiwygEditSessionRepository";
import type { ZeroEffortFormProposalRepository } from "../../../domain/repositories/ZeroEffortFormProposalRepository";
import type { DidacticArtifactKnowledgeRepository } from "../../../domain/repositories/DidacticArtifactKnowledgeRepository";
import type { ProjectAssetRepository } from "../../../domain/repositories/ProjectAssetRepository";
import type { SiteDeploymentRepository } from "../../../domain/repositories/SiteDeploymentRepository";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { SiteDeployment } from "../../../domain/entities/SiteDeployment";
import type { Project } from "../../../domain/entities/Project";
import type { IFileStorage } from "../../../infra/storage/IFileStorage";

const PROJECT_ID = "p1";
const USER_ID = "u1";

function project(): Project {
    return {
        id: PROJECT_ID,
        ownerUserId: USER_ID,
        name: "Test project",
        createdAt: new Date(),
    };
}

function projectRepo(over: Partial<ProjectRepository> = {}): ProjectRepository {
    return {
        create: vi.fn(),
        listForUser: vi.fn(),
        findByIdForUser: vi.fn(async () => project()),
        findById: vi.fn(),
        deleteById: vi.fn(async () => true),
        rename: vi.fn(),
        update: vi.fn(),
        updateFormSettings: vi.fn(),
        listAllPaginated: vi.fn(),
        countAll: vi.fn(),
        adminDeleteById: vi.fn(),
        ...over,
    };
}

function moodboardRepo(over: Partial<ProjectMoodboardRepository> = {}): ProjectMoodboardRepository {
    return {
        findByProjectId: vi.fn(),
        upsert: vi.fn(),
        initForProject: vi.fn(),
        deleteByProjectId: vi.fn(async () => undefined),
        ...over,
    };
}

function asset(over: Partial<ProjectAsset> = {}): ProjectAsset {
    return {
        id: "a1",
        projectId: PROJECT_ID,
        userId: USER_ID,
        scope: "project",
        originalName: "logo.png",
        storedFilename: "a1-logo.png",
        mimeType: "image/png",
        fileSize: 100,
        source: "user_upload",
        createdAt: new Date(),
        ...over,
    } as ProjectAsset;
}

function deployment(over: Partial<SiteDeployment> = {}): SiteDeployment {
    return {
        id: "d1",
        publishId: "pub-1",
        projectId: PROJECT_ID,
        userId: USER_ID,
        snapshotId: "s1",
        status: "live",
        url: "https://example.test/pub-1",
        filesDeployed: ["index.html"],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
    };
}

function fileStorage(over: Partial<IFileStorage> = {}): IFileStorage {
    return {
        uploadDirPath: vi.fn(),
        uploadFilePath: vi.fn(),
        saveUpload: vi.fn(),
        deleteUpload: vi.fn(async () => undefined),
        createReadStream: vi.fn(),
        exportDirPath: vi.fn(),
        exportZipPath: vi.fn(),
        writeExportFile: vi.fn(),
        deleteExportDir: vi.fn(),
        publishDirPath: vi.fn(),
        writePublishFiles: vi.fn(),
        resolvePublishFile: vi.fn(),
        deletePublishDir: vi.fn(async () => undefined),
        copyPublishDir: vi.fn(),
        workspacePath: vi.fn(),
        workspaceInputPath: vi.fn(),
        workspaceInputAssetsPath: vi.fn(),
        workspaceInputLayer1Path: vi.fn(),
        workspaceOutputPath: vi.fn(),
        workspaceLogsPath: vi.fn(),
        writeWorkspaceFile: vi.fn(),
        deleteWorkspaceDir: vi.fn(),
        profileDirPath: vi.fn(),
        writeProfileData: vi.fn(),
        readProfileData: vi.fn(),
        deleteProfileData: vi.fn(),
        thumbnailFilePath: vi.fn(),
        saveThumbnailFile: vi.fn(),
        getThumbnailStream: vi.fn(),
        deleteThumbnailFile: vi.fn(),
        ensureDir: vi.fn(),
        fileExists: vi.fn(),
        fileSize: vi.fn(),
        ...over,
    };
}

/** Minimal fake for every repository that only needs a `deleteByProject` in these tests. */
function countingRepo(count = 0) {
    return { deleteByProject: vi.fn(async () => count) };
}

describe("DeleteProject", () => {
    it("throws 404 and deletes nothing when the project is not owned by this user", async () => {
        const repo = projectRepo({ findByIdForUser: vi.fn(async () => null) });
        const moodboard = moodboardRepo();
        const deleteProject = new DeleteProject(repo, moodboard);

        await expect(deleteProject.execute(PROJECT_ID, USER_ID)).rejects.toMatchObject({ statusCode: 404 });

        expect(repo.deleteById).not.toHaveBeenCalled();
        expect(moodboard.deleteByProjectId).not.toHaveBeenCalled();
    });

    it("deletes the project and returns all-zero counts when no associated-data repos are wired", async () => {
        // Backward-compat path: existing callers that only pass the first two args must keep compiling
        // and keep working — the old, partial behaviour, not a crash.
        const repo = projectRepo();
        const deleteProject = new DeleteProject(repo, moodboardRepo());

        const result = await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(repo.deleteById).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(result).toEqual({
            journalRows: 0,
            costTransactions: 0,
            conversations: 0,
            workSessions: 0,
            pipelineRuns: 0,
            previewSnapshots: 0,
            mediaResolutionTraces: 0,
            vibeIntakes: 0,
            publishHistoryEntries: 0,
            wysiwygEditSessions: 0,
            zeroEffortFormProposals: 0,
            didacticArtifactKnowledge: 0,
            projectAssets: 0,
            siteDeployments: 0,
        });
    });

    it("cascades to every wired collection, ownership-scoped, and reports what it removed", async () => {
        const repo = projectRepo();
        const moodboard = moodboardRepo();
        const journal = countingRepo(3) as unknown as PromptExecutionLogRepository;
        const cost = countingRepo(2) as unknown as ICostTransactionRepository;
        const conversations = countingRepo(1) as unknown as ConversationRepository;
        const workSessions = countingRepo(4) as unknown as WorkSessionRepository;
        const pipelineRuns = countingRepo(1) as unknown as PipelineRunRepository;
        const previewSnapshots = { ...countingRepo(5), findById: vi.fn(), listByProject: vi.fn() } as unknown as PreviewSnapshotRepository;
        const mediaTraces = countingRepo(6) as unknown as MediaResolutionTraceRepository;
        const vibeIntakes = countingRepo(2) as unknown as VibeIntakeRepository;
        const publishHistory = countingRepo(3) as unknown as PublishHistoryRepository;
        const wysiwyg = countingRepo(1) as unknown as WysiwygEditSessionRepository;
        const zeroEffort = countingRepo(2) as unknown as ZeroEffortFormProposalRepository;
        const didactic = countingRepo(1) as unknown as DidacticArtifactKnowledgeRepository;

        const projectAssetRepository: ProjectAssetRepository = {
            listOwnedByProject: vi.fn(async () => [asset({ id: "a1", storedFilename: "a1-logo.png" }), asset({ id: "a2", storedFilename: "a2-hero.png" })]),
            deleteByProject: vi.fn(async () => 2),
        } as unknown as ProjectAssetRepository;

        const siteDeploymentRepository: SiteDeploymentRepository = {
            findByProjectId: vi.fn(async () => [deployment({ publishId: "pub-1", customSlug: "my-slug" })]),
            deleteByProject: vi.fn(async () => 1),
        } as unknown as SiteDeploymentRepository;

        const storage = fileStorage();

        const deleteProject = new DeleteProject(
            repo,
            moodboard,
            journal,
            conversations,
            workSessions,
            pipelineRuns,
            cost,
            previewSnapshots,
            mediaTraces,
            vibeIntakes,
            publishHistory,
            wysiwyg,
            zeroEffort,
            didactic,
            projectAssetRepository,
            siteDeploymentRepository,
            storage,
        );

        const result = await deleteProject.execute(PROJECT_ID, USER_ID);

        // Every deleteByProject call is ownership-scoped exactly like the pre-existing five.
        expect(journal.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(cost.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(conversations.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(workSessions.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(pipelineRuns.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(vibeIntakes.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(zeroEffort.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(projectAssetRepository.deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);

        // Preview snapshots, media traces, publish history, WYSIWYG sessions, didactic knowledge and
        // site deployments have no owner field of their own — scoped by projectId, same as their
        // other finder methods.
        expect(previewSnapshots.deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
        expect(mediaTraces.deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
        expect(publishHistory.deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
        expect(wysiwyg.deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
        expect(didactic.deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
        expect(siteDeploymentRepository.deleteByProject).toHaveBeenCalledWith(PROJECT_ID);

        expect(repo.deleteById).toHaveBeenCalledWith(PROJECT_ID, USER_ID);

        expect(result).toEqual({
            journalRows: 3,
            costTransactions: 2,
            conversations: 1,
            workSessions: 4,
            pipelineRuns: 1,
            previewSnapshots: 5,
            mediaResolutionTraces: 6,
            vibeIntakes: 2,
            publishHistoryEntries: 3,
            wysiwygEditSessions: 1,
            zeroEffortFormProposals: 2,
            didacticArtifactKnowledge: 1,
            projectAssets: 2,
            siteDeployments: 1,
        });
    });

    it("deletes each project-owned asset's file before removing the asset rows", async () => {
        const storage = fileStorage();
        const listOwnedByProject = vi.fn(async () => [
            asset({ id: "a1", storedFilename: "a1-logo.png" }),
            asset({ id: "a2", storedFilename: "a2-hero.png" }),
        ]);
        const deleteByProject = vi.fn(async () => 2);
        const projectAssetRepository = { listOwnedByProject, deleteByProject } as unknown as ProjectAssetRepository;

        const deleteProject = new DeleteProject(
            projectRepo(),
            moodboardRepo(),
            undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            projectAssetRepository,
            undefined,
            storage,
        );

        await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(listOwnedByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(storage.deleteUpload).toHaveBeenCalledWith(USER_ID, PROJECT_ID, "a1-logo.png");
        expect(storage.deleteUpload).toHaveBeenCalledWith(USER_ID, PROJECT_ID, "a2-hero.png");
        expect(deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    });

    it("deletes a deployment's published files, including its custom-slug directory, before removing the rows", async () => {
        const storage = fileStorage();
        const findByProjectId = vi.fn(async () => [
            deployment({ publishId: "pub-1", customSlug: "my-slug" }),
            deployment({ publishId: "pub-2", customSlug: undefined }),
        ]);
        const deleteByProject = vi.fn(async () => 2);
        const siteDeploymentRepository = { findByProjectId, deleteByProject } as unknown as SiteDeploymentRepository;

        const deleteProject = new DeleteProject(
            projectRepo(),
            moodboardRepo(),
            undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            undefined,
            siteDeploymentRepository,
            storage,
        );

        await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(findByProjectId).toHaveBeenCalledWith(PROJECT_ID);
        expect(storage.deletePublishDir).toHaveBeenCalledWith("pub-1");
        expect(storage.deletePublishDir).toHaveBeenCalledWith("my-slug");
        expect(storage.deletePublishDir).toHaveBeenCalledWith("pub-2");
        expect(storage.deletePublishDir).not.toHaveBeenCalledWith(undefined);
        expect(deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
    });

    it("still deletes the project when one associated-data delete throws", async () => {
        // Rule from the original 5-collection cascade: a failure in one collection must not stop the
        // others, and must not stop the project row itself from being removed.
        const repo = projectRepo();
        const journal = { deleteByProject: vi.fn(async () => { throw new Error("mongo down"); }) } as unknown as PromptExecutionLogRepository;
        const cost = countingRepo(2) as unknown as ICostTransactionRepository;

        const deleteProject = new DeleteProject(repo, moodboardRepo(), journal, undefined, undefined, undefined, cost);

        const result = await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(result.journalRows).toBe(0);
        expect(result.costTransactions).toBe(2);
        expect(repo.deleteById).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    });

    it("still deletes the project when asset or deployment file cleanup throws", async () => {
        const repo = projectRepo();
        const projectAssetRepository = {
            listOwnedByProject: vi.fn(async () => { throw new Error("mongo down"); }),
            deleteByProject: vi.fn(async () => 0),
        } as unknown as ProjectAssetRepository;
        const siteDeploymentRepository = {
            findByProjectId: vi.fn(async () => { throw new Error("mongo down"); }),
            deleteByProject: vi.fn(async () => 0),
        } as unknown as SiteDeploymentRepository;

        const deleteProject = new DeleteProject(
            repo,
            moodboardRepo(),
            undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined,
            projectAssetRepository,
            siteDeploymentRepository,
            fileStorage(),
        );

        const result = await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(repo.deleteById).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(result.projectAssets).toBe(0);
        expect(result.siteDeployments).toBe(0);
    });

    it("deletes the project row only after the associated-data cascade completes", async () => {
        const order: string[] = [];
        const repo = projectRepo({
            deleteById: vi.fn(async () => {
                order.push("project");
                return true;
            }),
        });
        const journal = {
            deleteByProject: vi.fn(async () => {
                order.push("journal");
                return 1;
            }),
        } as unknown as PromptExecutionLogRepository;

        const deleteProject = new DeleteProject(repo, moodboardRepo(), journal);
        await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(order).toEqual(["journal", "project"]);
    });
});
