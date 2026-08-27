import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../../domain/entities/Conversation";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import { ActivatePreviewSnapshot } from "../ActivatePreviewSnapshot";
import { CreatePreviewSnapshot } from "../CreatePreviewSnapshot";
import { DeletePreviewSnapshot } from "../DeletePreviewSnapshot";

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
    deleteById = vi.fn(async (projectId: string, snapshotId: string) => {
        const index = this.snapshots.findIndex((snapshot) => snapshot.id === snapshotId && snapshot.projectId === projectId);
        if (index === -1) return false;
        this.snapshots.splice(index, 1);
        return true;
    });
    relinkChildren = vi.fn(async (projectId: string, fromParentId: string, toParentId?: string) => {
        let relinked = 0;
        for (const snapshot of this.snapshots) {
            if (snapshot.projectId === projectId && snapshot.parentSnapshotId === fromParentId) {
                snapshot.parentSnapshotId = toParentId;
                relinked++;
            }
        }
        return relinked;
    });
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

describe("CreatePreviewSnapshot — AL-026 promptExecutionId", () => {
    it("stores and returns metadata.promptExecutionId when the caller supplies it", async () => {
        const repository = new MemoryPreviewSnapshotRepository();
        const useCase = new CreatePreviewSnapshot(repository as any);

        const { snapshot } = await useCase.execute({
            projectId: "project-1",
            conversationId: "conversation-1",
            artifacts: { html: "<main></main>", css: "", js: "" },
            metadata: { promptExecutionId: "exec-123" },
            activate: true,
        });

        expect(snapshot.metadata?.promptExecutionId).toBe("exec-123");
    });

    it("leaves a snapshot created without promptExecutionId unaffected", async () => {
        const repository = new MemoryPreviewSnapshotRepository();
        const useCase = new CreatePreviewSnapshot(repository as any);

        const { snapshot } = await useCase.execute({
            projectId: "project-1",
            conversationId: "conversation-1",
            artifacts: { html: "<main></main>", css: "", js: "" },
            activate: true,
        });

        expect(snapshot.metadata?.promptExecutionId).toBeUndefined();
    });
});

describe("Preview snapshot media resolution guardrails", () => {
    it("attaches persisted media trace IDs after snapshot creation", async () => {
        const repository = new MemoryPreviewSnapshotRepository();
        const traceRepository = { attachSnapshot: vi.fn(async () => undefined), createMany: vi.fn() };
        const useCase = new CreatePreviewSnapshot(repository as any, traceRepository as any);

        const { snapshot } = await useCase.execute({
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

        const { snapshot } = await useCase.execute({
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

        const { snapshot: first } = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
        });
        // Manual editor saves (Monaco, WYSIWYG degraded mode) send no parentSnapshotId. Before
        // the server defaulted it, each one started a fresh root and the history collapsed to a
        // single visible version.
        const { snapshot: second } = await useCase.execute({
            // Distinct content: an identical save is deliberately suppressed by AL-045, which
            // is a different rule from the one under test here.
            projectId: "p1", conversationId: "c1", artifacts: { ...artifacts, html: "<p>hi again</p>" }, activate: true,
        });

        expect(first.parentSnapshotId).toBeUndefined();
        expect(second.parentSnapshotId).toBe(first.id);
        expect(repo.snapshots).toHaveLength(2);
    });

    it("keeps an explicit parent, so restoring an older version branches from THAT one", async () => {
        const { useCase } = makeUseCase();

        const { snapshot: root } = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
        });
        const { snapshot: branch } = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts: { ...artifacts, html: "<p>branched</p>" }, activate: true,
            parentSnapshotId: root.id,
        });

        expect(branch.parentSnapshotId).toBe(root.id);
    });

    it("does not invent a parent that no longer exists", async () => {
        const { useCase } = makeUseCase();

        const { snapshot: orphan } = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            parentSnapshotId: "deleted-snapshot",
        });

        expect(orphan.parentSnapshotId).toBeUndefined();
    });
});

describe("DeletePreviewSnapshot — AL-015 chain re-linking", () => {
    const artifacts = { html: "<p>hi</p>", css: "", js: "" };

    it("mid-chain delete re-parents children to the grandparent", async () => {
        const repo = new MemoryPreviewSnapshotRepository();
        const v1 = await repo.create({ projectId: "p1", conversationId: "c1", artifacts, activate: false });
        const v2 = await repo.create({ projectId: "p1", conversationId: "c1", artifacts, parentSnapshotId: v1.id, activate: false });
        const v3 = await repo.create({
            projectId: "p1", conversationId: "c1", artifacts, parentSnapshotId: v2.id, activate: true,
        });

        const useCase = new DeletePreviewSnapshot(repo as any);
        await useCase.execute("p1", v2.id);

        expect(repo.relinkChildren).toHaveBeenCalledWith("p1", v2.id, v1.id);
        expect(repo.snapshots.find((s) => s.id === v3.id)?.parentSnapshotId).toBe(v1.id);
        expect(repo.snapshots.some((s) => s.id === v2.id)).toBe(false);
    });

    it("deleting a root leaves its children as roots", async () => {
        const repo = new MemoryPreviewSnapshotRepository();
        const v1 = await repo.create({ projectId: "p1", conversationId: "c1", artifacts, activate: false });
        const v2 = await repo.create({
            projectId: "p1", conversationId: "c1", artifacts, parentSnapshotId: v1.id, activate: true,
        });

        const useCase = new DeletePreviewSnapshot(repo as any);
        await useCase.execute("p1", v1.id);

        expect(repo.relinkChildren).toHaveBeenCalledWith("p1", v1.id, undefined);
        expect(repo.snapshots.find((s) => s.id === v2.id)?.parentSnapshotId).toBeUndefined();
    });

    it("deleting a leaf changes nothing else in the chain", async () => {
        const repo = new MemoryPreviewSnapshotRepository();
        const v1 = await repo.create({ projectId: "p1", conversationId: "c1", artifacts, activate: true });
        const v2 = await repo.create({
            projectId: "p1", conversationId: "c1", artifacts, parentSnapshotId: v1.id, activate: false,
        });

        const useCase = new DeletePreviewSnapshot(repo as any);
        await useCase.execute("p1", v2.id);

        expect(await repo.relinkChildren.mock.results[0]?.value).toBe(0);
        expect(repo.snapshots).toHaveLength(1);
        expect(repo.snapshots[0]?.id).toBe(v1.id);
        expect(repo.snapshots[0]?.parentSnapshotId).toBeUndefined();
    });

    it("scopes the re-link to the deleted snapshot's own project", async () => {
        const repo = new MemoryPreviewSnapshotRepository();
        const v1 = await repo.create({ projectId: "p1", conversationId: "c1", artifacts, activate: false });
        const v2 = await repo.create({
            projectId: "p1", conversationId: "c1", artifacts, parentSnapshotId: v1.id, activate: true,
        });
        // A different project's snapshot that happens to carry the same id as its parent — must
        // never be touched by a delete happening in project "p1".
        const foreign = await repo.create({
            projectId: "p2", conversationId: "c2", artifacts, parentSnapshotId: v1.id, activate: true,
        });

        const useCase = new DeletePreviewSnapshot(repo as any);
        await useCase.execute("p1", v1.id);

        expect(repo.snapshots.find((s) => s.id === v2.id)?.parentSnapshotId).toBeUndefined();
        expect(repo.snapshots.find((s) => s.id === foreign.id)?.parentSnapshotId).toBe(v1.id);
    });
});

describe("CreatePreviewSnapshot — AL-039…AL-045 version certification", () => {
    function makeUseCase() {
        const repo = new MemoryPreviewSnapshotRepository();
        return { repo, useCase: new CreatePreviewSnapshot(repo as never) };
    }

    const artifacts = { html: "<p>base</p>", css: "", js: "" };
    const edited = { html: "<p>edited</p>", css: "", js: "" };

    it("AL-039 — stamps a server-computed contentHash on every version", async () => {
        const { useCase } = makeUseCase();

        const { snapshot } = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
        });

        expect(snapshot.metadata?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("AL-039 — the same artifacts hash the same, different artifacts do not", async () => {
        const { useCase } = makeUseCase();

        const a = await useCase.execute({ projectId: "p1", conversationId: "c1", artifacts, activate: false });
        const b = await useCase.execute({ projectId: "p2", conversationId: "c1", artifacts, activate: false });
        const c = await useCase.execute({ projectId: "p3", conversationId: "c1", artifacts: edited, activate: false });

        expect(b.snapshot.metadata?.contentHash).toBe(a.snapshot.metadata?.contentHash);
        expect(c.snapshot.metadata?.contentHash).not.toBe(a.snapshot.metadata?.contentHash);
    });

    it("AL-039 — the hash is computed, never taken from the request", async () => {
        const { useCase } = makeUseCase();
        const forged = "0".repeat(64);

        const { snapshot } = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            metadata: { contentHash: forged },
        });

        expect(snapshot.metadata?.contentHash).not.toBe(forged);
    });

    it("AL-041 — a write declaring the current base is accepted", async () => {
        const { useCase } = makeUseCase();

        const base = await useCase.execute({ projectId: "p1", conversationId: "c1", artifacts, activate: true });
        const child = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts: edited, activate: true,
            parentSnapshotId: base.snapshot.id,
            baseContentHash: base.snapshot.metadata!.contentHash!,
        });

        expect(child.created).toBe(true);
        expect(child.snapshot.parentSnapshotId).toBe(base.snapshot.id);
    });

    it("AL-041 — a write declaring a base that no longer hashes that way is refused", async () => {
        const { repo, useCase } = makeUseCase();

        const base = await useCase.execute({ projectId: "p1", conversationId: "c1", artifacts, activate: true });
        // Someone else advanced the version behind this editor's back.
        repo.snapshots[0]!.metadata = { contentHash: "b".repeat(64) };

        await expect(useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts: edited, activate: true,
            parentSnapshotId: base.snapshot.id,
            baseContentHash: "a".repeat(64),
        })).rejects.toMatchObject({
            statusCode: 409,
            code: "ARTIFACT_BASE_STALE",
            details: { currentSnapshotId: base.snapshot.id, currentContentHash: "b".repeat(64) },
        });
        expect(repo.snapshots).toHaveLength(1);
    });

    it("AL-041 — a write declaring a base that was deleted is refused, not re-rooted", async () => {
        const { repo, useCase } = makeUseCase();

        await expect(useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            parentSnapshotId: "deleted-version",
            baseContentHash: "a".repeat(64),
        })).rejects.toMatchObject({ statusCode: 409, code: "ARTIFACT_BASE_STALE" });
        expect(repo.snapshots).toHaveLength(0);
    });

    it("AL-041 — a base stored before AL-039 cannot be verified, so the write is accepted", async () => {
        const { repo, useCase } = makeUseCase();

        const legacy = await repo.create({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
        });
        expect(legacy.metadata?.contentHash).toBeUndefined();

        const { snapshot, created } = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts: edited, activate: true,
            parentSnapshotId: legacy.id,
            baseContentHash: "a".repeat(64),
        });

        expect(created).toBe(true);
        expect(snapshot.parentSnapshotId).toBe(legacy.id);
    });

    it("AL-041 — a write that declares nothing is accepted, as it was before the rule", async () => {
        const { useCase } = makeUseCase();

        const base = await useCase.execute({ projectId: "p1", conversationId: "c1", artifacts, activate: true });
        const child = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts: edited, activate: true,
        });

        expect(child.created).toBe(true);
        expect(child.snapshot.parentSnapshotId).toBe(base.snapshot.id);
    });

    it("AL-045 — an edit identical to its base creates no version and returns the base", async () => {
        const { repo, useCase } = makeUseCase();

        const base = await useCase.execute({ projectId: "p1", conversationId: "c1", artifacts, activate: true });
        const again = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            parentSnapshotId: base.snapshot.id,
            baseContentHash: base.snapshot.metadata!.contentHash!,
        });

        expect(again.created).toBe(false);
        expect(again.snapshot.id).toBe(base.snapshot.id);
        expect(repo.snapshots).toHaveLength(1);
    });

    it("AL-045 — suppression also covers a base stored before AL-039, whose hash is computed on the fly", async () => {
        const { repo, useCase } = makeUseCase();

        const legacy = await repo.create({ projectId: "p1", conversationId: "c1", artifacts, activate: true });

        const again = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            parentSnapshotId: legacy.id,
        });

        expect(again.created).toBe(false);
        expect(again.snapshot.id).toBe(legacy.id);
        expect(repo.snapshots).toHaveLength(1);
    });

    it("AL-045 — a suppressed write still activates the base when activation was asked for", async () => {
        const { repo, useCase } = makeUseCase();

        const inactive = await repo.create({ projectId: "p1", conversationId: "c1", artifacts, activate: false });

        const again = await useCase.execute({
            projectId: "p1", conversationId: "c1", artifacts, activate: true,
            parentSnapshotId: inactive.id,
        });

        expect(again.created).toBe(false);
        expect(repo.activateForProject).toHaveBeenCalledWith("p1", inactive.id);
    });
});
