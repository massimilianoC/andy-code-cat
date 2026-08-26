import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../../domain/entities/Conversation";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import { ActivatePreviewSnapshot } from "../ActivatePreviewSnapshot";
import { CreatePreviewSnapshot } from "../CreatePreviewSnapshot";

class MemoryPreviewSnapshotRepository {
    snapshots: PreviewSnapshot[] = [];
    activate = vi.fn(async (_projectId: string, conversationId: string, snapshotId: string) => {
        return this.snapshots.find((snapshot) => snapshot.id === snapshotId && snapshot.conversationId === conversationId) ?? null;
    });
    activateForProject = vi.fn(async (_projectId: string, snapshotId: string) => {
        return this.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
    });

    async create(input: {
        projectId: string;
        conversationId: string;
        sourceMessageId?: string;
        parentSnapshotId?: string;
        artifacts: PreviewSnapshot["artifacts"];
        focusContext?: PreviewSnapshot["focusContext"];
        metadata?: PreviewSnapshot["metadata"];
        activate: boolean;
    }): Promise<PreviewSnapshot> {
        const snapshot: PreviewSnapshot = {
            id: `snapshot-${this.snapshots.length + 1}`,
            projectId: input.projectId,
            conversationId: input.conversationId,
            sourceMessageId: input.sourceMessageId,
            parentSnapshotId: input.parentSnapshotId,
            isActive: input.activate,
            artifacts: input.artifacts,
            focusContext: input.focusContext,
            metadata: input.metadata,
            createdAt: new Date("2026-05-29T00:00:00.000Z"),
            activatedAt: input.activate ? new Date("2026-05-29T00:00:00.000Z") : undefined,
        };
        this.snapshots.push(snapshot);
        return snapshot;
    }

    listByConversation = vi.fn();
    listByProject = vi.fn();
    findById = vi.fn(async (_projectId: string, snapshotId: string) => {
        return this.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
    });
    getActive = vi.fn();
    getActiveForProject = vi.fn(async (_projectId: string) => {
        return this.snapshots.find((snapshot) => snapshot.isActive) ?? null;
    });
    deleteById = vi.fn();
    updateThumbnailPath = vi.fn();
    getActiveForProjects = vi.fn();
}

class MemoryConversationRepository {
    conversations: Conversation[] = [{
        id: "conversation-1",
        projectId: "project-1",
        userId: "user-1",
        title: "Test",
        totalTokens: 0,
        totalCost: 0,
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        updatedAt: new Date("2026-05-29T00:00:00.000Z"),
        messages: [{
            id: "message-1",
            role: "assistant",
            content: "Generated preview",
            timestamp: new Date("2026-05-29T00:00:00.000Z"),
            metadata: {
                provider: "siliconflow",
                model: "MiniMaxAI/MiniMax-M3",
            },
            backgroundTasks: [],
        }],
    }];

    findById = vi.fn(async (conversationId: string, projectId: string) => {
        return this.conversations.find((conversation) => conversation.id === conversationId && conversation.projectId === projectId) ?? null;
    });

    updateMessageMetadata = vi.fn(async (conversationId: string, projectId: string, messageId: string, metadata: Record<string, unknown>) => {
        const conversation = this.conversations.find((entry) => entry.id === conversationId && entry.projectId === projectId);
        const message = conversation?.messages.find((entry) => entry.id === messageId);
        if (!message) return null;
        message.metadata = {
            ...(message.metadata ?? {}),
            ...metadata,
        };
        return message;
    });

    create = vi.fn();
    listForProject = vi.fn();
    findForProject = vi.fn();
    addMessage = vi.fn();
    addBackgroundTask = vi.fn();
    updateBackgroundTask = vi.fn();
}

describe("Preview snapshot media resolution guardrails", () => {
    it("attaches persisted media trace IDs after snapshot creation", async () => {
        const repository = new MemoryPreviewSnapshotRepository();
        const traceRepository = { attachSnapshot: vi.fn(async () => undefined), createMany: vi.fn() };
        const useCase = new CreatePreviewSnapshot(repository as any, traceRepository as any);

        const snapshot = await useCase.execute({
            projectId: "project-1",
            conversationId: "conversation-1",
            artifacts: { html: "<main></main>", css: "", js: "" },
            metadata: {
                mediaResolution: {
                    version: "media-resolution-v1",
                    traceIds: ["trace-1"],
                    assetIds: ["asset-1"],
                    mediaKeys: ["hero-main"],
                    degraded: false,
                },
            },
            activate: true,
        });

        expect(snapshot.id).toBe("snapshot-1");
        expect(traceRepository.attachSnapshot).toHaveBeenCalledWith("project-1", ["trace-1"], "snapshot-1");
    });

    it("links the assistant message to the created snapshot and persisted media summary", async () => {
        const previewRepository = new MemoryPreviewSnapshotRepository();
        const traceRepository = { attachSnapshot: vi.fn(async () => undefined), createMany: vi.fn() };
        const conversationRepository = new MemoryConversationRepository();
        const useCase = new CreatePreviewSnapshot(
            previewRepository as any,
            traceRepository as any,
            conversationRepository as any,
        );

        const snapshot = await useCase.execute({
            projectId: "project-1",
            conversationId: "conversation-1",
            sourceMessageId: "message-1",
            artifacts: { html: "<main></main>", css: "", js: "" },
            metadata: {
                mediaResolution: {
                    version: "media-resolution-v1",
                    traceIds: ["trace-1"],
                    assetIds: ["asset-1"],
                    mediaKeys: ["hero-main"],
                    degraded: false,
                    directives: [{
                        key: "hero-main",
                        status: "resolved",
                        provider: "pexels",
                        assetId: "asset-1",
                    }],
                },
            },
            activate: true,
        });

        expect(snapshot.id).toBe("snapshot-1");
        expect(conversationRepository.updateMessageMetadata).toHaveBeenCalledWith(
            "conversation-1",
            "project-1",
            "message-1",
            expect.objectContaining({
                snapshotId: "snapshot-1",
                mediaResolution: expect.objectContaining({
                    mediaKeys: ["hero-main"],
                    traceIds: ["trace-1"],
                }),
            }),
        );
    });

    it("rejects active snapshot creation with unresolved media placeholders", async () => {
        const useCase = new CreatePreviewSnapshot(new MemoryPreviewSnapshotRepository() as any);

        await expect(useCase.execute({
            projectId: "project-1",
            conversationId: "conversation-1",
            artifacts: {
                html: '<img src="asset://media/hero-main" alt="Hero">',
                css: "",
                js: "",
            },
            activate: true,
        })).rejects.toThrow("Cannot activate preview snapshot with unresolved media placeholders");
    });

    it("rejects snapshot creation when the provided source message does not belong to the conversation", async () => {
        const useCase = new CreatePreviewSnapshot(
            new MemoryPreviewSnapshotRepository() as any,
            undefined,
            new MemoryConversationRepository() as any,
        );

        await expect(useCase.execute({
            projectId: "project-1",
            conversationId: "conversation-1",
            sourceMessageId: "missing-message",
            artifacts: { html: "<main></main>", css: "", js: "" },
            activate: true,
        })).rejects.toThrow('Source message "missing-message" not found');
    });

    it("rejects activating existing snapshots with unresolved media placeholders", async () => {
        const repository = new MemoryPreviewSnapshotRepository();
        await repository.create({
            projectId: "project-1",
            conversationId: "conversation-1",
            artifacts: {
                html: "<section></section>",
                css: '.hero{background-image:url("asset://media/hero-main")}',
                js: "",
            },
            activate: false,
        });
        const useCase = new ActivatePreviewSnapshot(repository as any);

        await expect(useCase.execute({
            projectId: "project-1",
            conversationId: "conversation-1",
            snapshotId: "snapshot-1",
        })).rejects.toThrow("Cannot activate preview snapshot with unresolved media placeholders");
        expect(repository.activate).not.toHaveBeenCalled();
    });
});

describe("CreatePreviewSnapshot — version chain", () => {
    function makeUseCase() {
        const repo = new MemoryPreviewSnapshotRepository();
        return { repo, useCase: new CreatePreviewSnapshot(repo as never) };
    }

    const artifacts = { html: "<p>hi</p>", css: "", js: "" };

    it("continues from the active snapshot when the caller omits a parent", async () => {
        const { repo, useCase } = makeUseCase();

        const first = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
        });
        // Manual editor saves (Monaco, WYSIWYG degraded mode) send no parentSnapshotId. Before
        // the server defaulted it, each one started a fresh root and the history collapsed to a
        // single visible version.
        const second = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
        });

        expect(first.parentSnapshotId).toBeUndefined();
        expect(second.parentSnapshotId).toBe(first.id);
        expect(repo.snapshots).toHaveLength(2);
    });

    it("keeps an explicit parent, so restoring an older version branches from THAT one", async () => {
        const { useCase } = makeUseCase();

        const root = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
        });
        const branch = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            parentSnapshotId: root.id,
        });

        expect(branch.parentSnapshotId).toBe(root.id);
    });

    it("does not invent a parent that no longer exists", async () => {
        const { useCase } = makeUseCase();

        const orphan = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            parentSnapshotId: "deleted-snapshot",
        });

        expect(orphan.parentSnapshotId).toBeUndefined();
    });
});
