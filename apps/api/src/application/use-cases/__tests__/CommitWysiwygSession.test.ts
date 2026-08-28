import { describe, expect, it, vi } from "vitest";
import type { PreviewSnapshot } from "../../../domain/entities/PreviewSnapshot";
import type { WysiwygEditSession } from "../../../domain/entities/WysiwygEditSession";
import { CommitWysiwygSession } from "../CommitWysiwygSession";
import { CreatePreviewSnapshot } from "../CreatePreviewSnapshot";

/**
 * The WYSIWYG commit used to call the snapshot repository directly, which made it a second
 * save path for artifact versions (AL-031): its versions carried no contentHash, an edit that
 * changed nothing still produced a duplicate, and two metadata keys reached storage through an
 * `as` cast the artifact contract never declared. These tests pin it to the one write path.
 */

class MemorySnapshotRepository {
    snapshots: PreviewSnapshot[] = [];

    async create(input: {
        projectId: string;
        conversationId: string;
        parentSnapshotId?: string;
        artifacts: PreviewSnapshot["artifacts"];
        serviceManifest?: PreviewSnapshot["serviceManifest"];
        metadata?: PreviewSnapshot["metadata"];
        activate: boolean;
    }): Promise<PreviewSnapshot> {
        const snapshot: PreviewSnapshot = {
            id: `snapshot-${this.snapshots.length + 1}`,
            projectId: input.projectId,
            conversationId: input.conversationId,
            parentSnapshotId: input.parentSnapshotId,
            isActive: input.activate,
            artifacts: input.artifacts,
            serviceManifest: input.serviceManifest,
            metadata: input.metadata,
            createdAt: new Date("2026-08-27T00:00:00.000Z"),
        };
        this.snapshots.push(snapshot);
        return snapshot;
    }

    findById = vi.fn(async (_projectId: string, snapshotId: string) =>
        this.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null);
    getActiveForProject = vi.fn(async () =>
        this.snapshots.find((snapshot) => snapshot.isActive) ?? null);
    activateForProject = vi.fn(async (_projectId: string, snapshotId: string) =>
        this.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null);
}

function makeSession(overrides: Partial<WysiwygEditSession> = {}): WysiwygEditSession {
    return {
        id: "session-1",
        projectId: "p1",
        userId: "u1",
        conversationId: "c1",
        originSnapshotId: "snapshot-1",
        currentHtml: "<p>edited</p>",
        currentCss: "",
        currentJs: "",
        operationCount: 3,
        status: "active",
        createdAt: new Date("2026-08-27T00:00:00.000Z"),
        updatedAt: new Date("2026-08-27T00:00:00.000Z"),
        ...overrides,
    } as WysiwygEditSession;
}

function harness(session: WysiwygEditSession) {
    const repo = new MemorySnapshotRepository();
    const wysiwygRepo = {
        findById: vi.fn(async () => session),
        commit: vi.fn(async () => ({ ...session, status: "committed" as const })),
        create: vi.fn(),
        saveState: vi.fn(),
        findActive: vi.fn(),
    };
    const useCase = new CommitWysiwygSession(
        wysiwygRepo as never,
        new CreatePreviewSnapshot(repo as never),
    );
    return { repo, wysiwygRepo, useCase };
}

describe("CommitWysiwygSession — one write path for artifact versions", () => {
    it("AL-039 — the committed version carries a server-computed contentHash", async () => {
        const session = makeSession();
        const { repo, useCase } = harness(session);
        await repo.create({
            projectId: "p1", conversationId: "c1",
            artifacts: { html: "<p>origin</p>", css: "", js: "" }, activate: true,
        });

        const result = await useCase.execute({ sessionId: "session-1", projectId: "p1" });

        expect(result?.created).toBe(true);
        expect(result?.snapshot.metadata?.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result?.snapshot.parentSnapshotId).toBe("snapshot-1");
        expect(result?.snapshot.metadata?.wysiwygSessionId).toBe("session-1");
    });

    it("AL-045 — an edit session that changed nothing commits against the origin", async () => {
        const session = makeSession({ currentHtml: "<p>origin</p>" });
        const { repo, useCase } = harness(session);
        const origin = await repo.create({
            projectId: "p1", conversationId: "c1",
            artifacts: { html: "<p>origin</p>", css: "", js: "" }, activate: true,
        });

        const result = await useCase.execute({ sessionId: "session-1", projectId: "p1" });

        expect(result?.created).toBe(false);
        expect(result?.snapshot.id).toBe(origin.id);
        expect(repo.snapshots).toHaveLength(1);
    });

    it("AL-041 — a commit declaring a stale base is refused", async () => {
        const session = makeSession();
        const { repo, useCase } = harness(session);
        await repo.create({
            projectId: "p1", conversationId: "c1",
            artifacts: { html: "<p>origin</p>", css: "", js: "" },
            metadata: { contentHash: "b".repeat(64) },
            activate: true,
        });

        await expect(useCase.execute({
            sessionId: "session-1",
            projectId: "p1",
            baseContentHash: "a".repeat(64),
        })).rejects.toMatchObject({ statusCode: 409, code: "ARTIFACT_BASE_STALE" });
        expect(repo.snapshots).toHaveLength(1);
    });

    it("inherits the origin's service manifest instead of silently dropping forms", async () => {
        const session = makeSession();
        const { repo, useCase } = harness(session);
        const manifest = { version: "service-manifest-v1", forms: [] } as unknown as PreviewSnapshot["serviceManifest"];
        await repo.create({
            projectId: "p1", conversationId: "c1",
            artifacts: { html: "<p>origin</p>", css: "", js: "" },
            serviceManifest: manifest,
            activate: true,
        });

        const result = await useCase.execute({ sessionId: "session-1", projectId: "p1" });

        expect(result?.snapshot.serviceManifest).toEqual(manifest);
    });

    it("returns null for a session that is not active, without touching history", async () => {
        const session = makeSession({ status: "committed" });
        const { repo, useCase } = harness(session);

        const result = await useCase.execute({ sessionId: "session-1", projectId: "p1" });

        expect(result).toBeNull();
        expect(repo.snapshots).toHaveLength(0);
    });
});
