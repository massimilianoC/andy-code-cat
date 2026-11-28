import { describe, it, expect, vi } from "vitest";
import { DeleteProject, ProjectDeletionIncompleteError } from "../DeleteProject";
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
import type { DidacticQnaRepository } from "../../../domain/repositories/DidacticQnaRepository";
import type { BrandAssetRepository } from "../../../domain/repositories/BrandAssetRepository";
import type { LlmPromptConfigRepository } from "../../../domain/repositories/LlmPromptConfigRepository";
import type { BackgroundRunRepository } from "../../../domain/repositories/BackgroundRunRepository";
import type { ExportRepository } from "../../../domain/repositories/ExportRepository";
import { ProjectDataRegistry } from "../../projectData/ProjectDataRegistry";
import type { ProjectDataCapability } from "../../../domain/projectData/ProjectDataCapability";
import type { SiteDeployment } from "../../../domain/entities/SiteDeployment";
import type { Project } from "../../../domain/entities/Project";
import type { IFileStorage } from "../../../infra/storage/IFileStorage";

const PROJECT_ID = "p1";
const USER_ID = "u1";

function capability(id: string, removed: number, clear = vi.fn(async () => removed)) {
    return {
        id,
        label: id,
        groups: vi.fn(async () => []),
        list: vi.fn(async () => ({ items: [], total: 0 })),
        exportRecords: vi.fn(async () => []),
        deleteRecord: vi.fn(async () => false),
        clear,
    } satisfies ProjectDataCapability;
}

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
        deleteProjectFiles: vi.fn(async () => undefined),
        deleteUserFiles: vi.fn(async () => undefined),
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

const ZERO_COUNTS = {
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
    didacticQnaEntries: 0,
    projectAssets: 0,
    projectBrandAssets: 0,
    promptConfigs: 0,
    backgroundRuns: 0,
    exportRecords: 0,
    siteDeployments: 0,
    projectData: {},
};

const failing = () => vi.fn(async () => { throw new Error("mongo down"); });

describe("DeleteProject", () => {
    it("throws 404 and deletes nothing when the project is not owned by this user", async () => {
        const repo = projectRepo({ findByIdForUser: vi.fn(async () => null) });
        const moodboard = moodboardRepo();
        const storage = fileStorage();
        const deleteProject = new DeleteProject({ projects: repo, moodboards: moodboard, fileStorage: storage });

        await expect(deleteProject.execute(PROJECT_ID, USER_ID)).rejects.toMatchObject({ statusCode: 404 });

        expect(repo.deleteById).not.toHaveBeenCalled();
        expect(moodboard.deleteByProjectId).not.toHaveBeenCalled();
        expect(storage.deleteProjectFiles).not.toHaveBeenCalled();
    });

    it("deletes the project and returns all-zero counts when only the required repositories are wired", async () => {
        const repo = projectRepo();
        const deleteProject = new DeleteProject({ projects: repo, moodboards: moodboardRepo() });

        const result = await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(repo.deleteById).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        expect(result).toEqual(ZERO_COUNTS);
    });

    it("cascades to every wired collection, ownership-scoped, and reports what it removed", async () => {
        const repo = projectRepo();
        const moodboard = moodboardRepo();
        const journal = countingRepo(3) as unknown as PromptExecutionLogRepository;
        const cost = countingRepo(2) as unknown as ICostTransactionRepository;
        const conversations = countingRepo(1) as unknown as ConversationRepository;
        const workSessions = countingRepo(4) as unknown as WorkSessionRepository;
        const pipelineRuns = countingRepo(1) as unknown as PipelineRunRepository;
        const previewSnapshots = countingRepo(5) as unknown as PreviewSnapshotRepository;
        const mediaTraces = countingRepo(6) as unknown as MediaResolutionTraceRepository;
        const vibeIntakes = countingRepo(2) as unknown as VibeIntakeRepository;
        const publishHistory = countingRepo(3) as unknown as PublishHistoryRepository;
        const wysiwyg = countingRepo(1) as unknown as WysiwygEditSessionRepository;
        const zeroEffort = countingRepo(2) as unknown as ZeroEffortFormProposalRepository;
        const didactic = countingRepo(1) as unknown as DidacticArtifactKnowledgeRepository;
        const didacticQna = countingRepo(7) as unknown as DidacticQnaRepository;
        const projectAssets = countingRepo(2) as unknown as ProjectAssetRepository;
        const brandAssets = countingRepo(2) as unknown as BrandAssetRepository;
        const promptConfigs = { deleteByProjectId: vi.fn(async () => 1) } as unknown as LlmPromptConfigRepository;
        const backgroundRuns = countingRepo(3) as unknown as BackgroundRunRepository;
        const exports = countingRepo(4) as unknown as ExportRepository;
        const siteDeployments = {
            findByProjectId: vi.fn(async () => [deployment({ publishId: "pub-1", customSlug: "my-slug" })]),
            deleteByProject: vi.fn(async () => 1),
        } as unknown as SiteDeploymentRepository;

        const storage = fileStorage();
        const leaderboard = capability("leaderboard", 4);
        const forms = capability("forms", 1);

        const deleteProject = new DeleteProject({
            projects: repo,
            moodboards: moodboard,
            promptExecutionLogs: journal,
            conversations,
            workSessions,
            pipelineRuns,
            costTransactions: cost,
            previewSnapshots,
            mediaResolutionTraces: mediaTraces,
            vibeIntakes,
            publishHistory,
            wysiwygEditSessions: wysiwyg,
            zeroEffortFormProposals: zeroEffort,
            didacticKnowledge: didactic,
            didacticQna,
            projectAssets,
            brandAssets,
            promptConfigs,
            backgroundRuns,
            exports,
            siteDeployments,
            fileStorage: storage,
            projectData: new ProjectDataRegistry([leaderboard, forms]),
        });

        const result = await deleteProject.execute(PROJECT_ID, USER_ID);

        expect(leaderboard.clear).toHaveBeenCalledWith({ ownerUserId: USER_ID, projectId: PROJECT_ID });
        expect(forms.clear).toHaveBeenCalledWith({ ownerUserId: USER_ID, projectId: PROJECT_ID });
        expect(storage.deleteProjectFiles).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
        expect(moodboard.deleteByProjectId).toHaveBeenCalledWith(PROJECT_ID);

        for (const owned of [journal, cost, conversations, workSessions, pipelineRuns, vibeIntakes, zeroEffort, projectAssets, brandAssets, backgroundRuns, exports]) {
            expect((owned as unknown as { deleteByProject: ReturnType<typeof vi.fn> }).deleteByProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
        }
        for (const byProject of [previewSnapshots, mediaTraces, publishHistory, wysiwyg, didactic, didacticQna, siteDeployments]) {
            expect((byProject as unknown as { deleteByProject: ReturnType<typeof vi.fn> }).deleteByProject).toHaveBeenCalledWith(PROJECT_ID);
        }
        expect(promptConfigs.deleteByProjectId).toHaveBeenCalledWith(PROJECT_ID);
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
            didacticQnaEntries: 7,
            projectAssets: 2,
            projectBrandAssets: 2,
            promptConfigs: 1,
            backgroundRuns: 3,
            exportRecords: 4,
            siteDeployments: 1,
            projectData: { leaderboard: 4, forms: 1 },
        });
    });

    it("deletes a deployment's published files, including its custom-slug directory", async () => {
        const storage = fileStorage();
        const findByProjectId = vi.fn(async () => [
            deployment({ publishId: "pub-1", customSlug: "my-slug" }),
            deployment({ publishId: "pub-2", customSlug: undefined }),
        ]);
        const siteDeployments = { findByProjectId, deleteByProject: vi.fn(async () => 2) } as unknown as SiteDeploymentRepository;

        await new DeleteProject({ projects: projectRepo(), moodboards: moodboardRepo(), siteDeployments, fileStorage: storage })
            .execute(PROJECT_ID, USER_ID);

        expect(storage.deletePublishDir).toHaveBeenCalledWith("pub-1");
        expect(storage.deletePublishDir).toHaveBeenCalledWith("my-slug");
        expect(storage.deletePublishDir).toHaveBeenCalledWith("pub-2");
        expect(storage.deletePublishDir).not.toHaveBeenCalledWith(undefined);
    });

    it("keeps the project row when a record purge fails, runs the other purges, and names the failed step", async () => {
        const repo = projectRepo();
        const journal = { deleteByProject: failing() } as unknown as PromptExecutionLogRepository;
        const cost = countingRepo(2) as unknown as ICostTransactionRepository;
        const error = vi.spyOn(console, "error").mockImplementation(() => { });

        const deleteProject = new DeleteProject({ projects: repo, moodboards: moodboardRepo(), promptExecutionLogs: journal, costTransactions: cost });

        const failure = await deleteProject.execute(PROJECT_ID, USER_ID).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ProjectDeletionIncompleteError);
        expect(failure).toMatchObject({ statusCode: 500, code: "PROJECT_DELETE_INCOMPLETE", details: { failedSteps: ["journalRows"] } });
        expect(cost.deleteByProject).toHaveBeenCalled();
        expect(repo.deleteById).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.stringContaining("deletion incomplete"), expect.objectContaining({ projectId: PROJECT_ID }));
        error.mockRestore();
    });

    it("keeps the project row when the project data (visitor records) purge fails", async () => {
        const repo = projectRepo();
        const broken = capability("forms", 0, failing());
        const error = vi.spyOn(console, "error").mockImplementation(() => { });

        const deleteProject = new DeleteProject({ projects: repo, moodboards: moodboardRepo(), projectData: new ProjectDataRegistry([broken]) });

        await expect(deleteProject.execute(PROJECT_ID, USER_ID)).rejects.toMatchObject({ details: { failedSteps: ["projectData"] } });
        expect(repo.deleteById).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it("removes no record and keeps the project when file removal fails", async () => {
        const repo = projectRepo();
        const storage = fileStorage({ deleteProjectFiles: failing() });
        const journal = countingRepo(1) as unknown as PromptExecutionLogRepository;
        const error = vi.spyOn(console, "error").mockImplementation(() => { });

        const deleteProject = new DeleteProject({ projects: repo, moodboards: moodboardRepo(), promptExecutionLogs: journal, fileStorage: storage });

        await expect(deleteProject.execute(PROJECT_ID, USER_ID)).rejects.toMatchObject({ details: { failedSteps: ["project files"] } });
        expect(journal.deleteByProject).not.toHaveBeenCalled();
        expect(repo.deleteById).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it("removes files, then records, then the project row", async () => {
        const order: string[] = [];
        const repo = projectRepo({ deleteById: vi.fn(async () => { order.push("project"); return true; }) });
        const journal = { deleteByProject: vi.fn(async () => { order.push("journal"); return 1; }) } as unknown as PromptExecutionLogRepository;
        const storage = fileStorage({ deleteProjectFiles: vi.fn(async () => { order.push("files"); }) });

        await new DeleteProject({ projects: repo, moodboards: moodboardRepo(), promptExecutionLogs: journal, fileStorage: storage })
            .execute(PROJECT_ID, USER_ID);

        expect(order).toEqual(["files", "journal", "project"]);
    });
});
