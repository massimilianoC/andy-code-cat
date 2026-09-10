import { describe, it, expect, vi } from "vitest";
import { OpenWorkSession } from "../OpenWorkSession";
import type { WorkSessionRepository, WorkSessionRecord } from "../../../domain/repositories/WorkSessionRepository";

function record(over: Partial<WorkSessionRecord> = {}): WorkSessionRecord {
    return {
        id: "ws-1",
        userId: "u1",
        entryMode: "vibe",
        config: {},
        status: "open",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
    };
}

function repo(over: Partial<WorkSessionRepository> = {}): WorkSessionRepository {
    return {
        open: vi.fn(async () => record()),
        findByIdForUser: vi.fn(async () => null),
        findOpenByProject: vi.fn(async () => null),
        listByProject: vi.fn(async () => []),
        listByUser: vi.fn(async () => []),
        attachProject: vi.fn(async () => record()),
        setStatus: vi.fn(async () => record()),
        deleteByProject: vi.fn(async () => 0),
        ...over,
    };
}

const input = { userId: "u1", entryMode: "vibe" as const };

describe("OpenWorkSession", () => {
    it("opens a session with no project, because Vibe starts before one exists", async () => {
        const repository = repo();

        await new OpenWorkSession(repository).execute(input);

        expect(repository.open).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1", entryMode: "vibe", config: {} }),
        );
    });

    it("continues the same session when the user resubmits", async () => {
        // A user who edits their prompt and sends it again is still in one session; opening a second
        // would split a single intent into two unrelated histories.
        const existing = record({ id: "ws-existing" });
        const repository = repo({ findByIdForUser: vi.fn(async () => existing) });

        const result = await new OpenWorkSession(repository).reuseOrOpen("ws-existing", input);

        expect(result!.id).toBe("ws-existing");
        expect(repository.open).not.toHaveBeenCalled();
    });

    it("opens a fresh session rather than reusing a closed one", async () => {
        const repository = repo({ findByIdForUser: vi.fn(async () => record({ status: "completed" })) });

        await new OpenWorkSession(repository).reuseOrOpen("ws-done", input);

        expect(repository.open).toHaveBeenCalled();
    });

    it("opens a fresh session when the id belongs to someone else", async () => {
        // findByIdForUser is ownership-scoped, so a foreign id resolves to null and must not be
        // adopted — one user's calls journalled into another user's history would be worse than
        // no history at all.
        const repository = repo({ findByIdForUser: vi.fn(async () => null) });

        await new OpenWorkSession(repository).reuseOrOpen("ws-someone-else", input);

        expect(repository.open).toHaveBeenCalled();
    });

    it("joins the session already open on this project when the client sends no id", async () => {
        // Without this, one intent opens three sessions — classify, prefill and launch each start
        // their own — and the certificate's binding condition (eight answers from ONE id) fails.
        const openOnProject = record({ id: "ws-open-on-project" });
        const repository = repo({ findOpenByProject: vi.fn(async () => openOnProject) });

        const result = await new OpenWorkSession(repository).reuseOrOpen(undefined, { ...input, projectId: "p1" });

        expect(result!.id).toBe("ws-open-on-project");
        expect(repository.open).not.toHaveBeenCalled();
    });

    it("opens a new session when the project has none open", async () => {
        const repository = repo();

        await new OpenWorkSession(repository).reuseOrOpen(undefined, { ...input, projectId: "p1" });

        expect(repository.open).toHaveBeenCalled();
    });

    it("returns null instead of throwing when the store is unavailable", async () => {
        // Rule 4 of the execution plan: tracing must never fail a generation.
        const repository = repo({ open: vi.fn(async () => { throw new Error("mongo down"); }) });

        const result = await new OpenWorkSession(repository).reuseOrOpen(undefined, input);

        expect(result).toBeNull();
    });
});
