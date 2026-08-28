/**
 * Integration tests for the I11 (SSOT program) additions to MongoPromptExecutionLogRepository:
 * createPending() / complete() / findActiveByIdempotencyKey(). Runs against MongoMemoryServer —
 * no Docker required.
 *
 * These exercise the actual new durable-journal + idempotency logic in isolation from the HTTP
 * route layer (llmRoutes.ts wires createPending()/complete() around the provider fetch call —
 * that wiring is plain sequential glue verified by tsc + the full regression suite; the
 * meaningful new behavior lives entirely in this repository).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let repo: import("../MongoPromptExecutionLogRepository").MongoPromptExecutionLogRepository;

function basePending(overrides?: Partial<Record<string, unknown>>) {
    return {
        taskKey: "chat",
        projectId: "project-1",
        userId: "user-1",
        conversationId: "conv-1",
        provider: "siliconflow",
        model: "MiniMaxAI/MiniMax-M3",
        inputPrompt: "hello",
        renderedSystemPrompt: "system",
        renderedUserPrompt: "hello",
        contextMeta: { usedMoodboard: false, usedUserProfile: false },
        ...overrides,
    };
}

describe("MongoPromptExecutionLogRepository — I11 journal + idempotency", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { MongoPromptExecutionLogRepository } = await import("../MongoPromptExecutionLogRepository");
        repo = new MongoPromptExecutionLogRepository();
    });

    afterAll(async () => {
        const { getDb } = await import("../../db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    it("createPending() writes a status=pending record with durationMs=0 and no result fields", async () => {
        const pending = await repo.createPending(basePending({ idempotencyKey: "key-createpending" }));

        expect(pending.id).toBeTruthy();
        expect(pending.status).toBe("pending");
        expect(pending.durationMs).toBe(0);
        expect(pending.usage).toBeUndefined();
        expect(pending.costEstimate).toBeUndefined();
        expect(pending.idempotencyKey).toBe("key-createpending");
    });

    it("complete() transitions a pending record to succeeded and fills in result fields", async () => {
        const pending = await repo.createPending(basePending({ idempotencyKey: "key-complete-success" }));

        const completed = await repo.complete(pending.id, {
            status: "succeeded",
            durationMs: 1234,
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            costEstimate: {
                currency: "EUR",
                amount: 0.05,
                breakdown: { tokenCost: 0.05, imageCost: 0, videoCost: 0 },
                unitRates: { textEurPer1kTokens: 0.005, imageEurPerAsset: 0.1, videoEurPerAsset: 0.2 },
            },
        });

        expect(completed.status).toBe("succeeded");
        expect(completed.durationMs).toBe(1234);
        expect(completed.usage?.totalTokens).toBe(30);
        expect(completed.costEstimate?.amount).toBe(0.05);
    });

    it("complete() transitions a pending record to failed with an errorMessage", async () => {
        const pending = await repo.createPending(basePending({ idempotencyKey: "key-complete-failed" }));

        const completed = await repo.complete(pending.id, {
            status: "failed",
            durationMs: 500,
            errorMessage: "Provider timeout",
        });

        expect(completed.status).toBe("failed");
        expect(completed.errorMessage).toBe("Provider timeout");
    });

    it("complete() throws when the record does not exist", async () => {
        await expect(
            repo.complete("does-not-exist", { status: "failed", durationMs: 0, errorMessage: "x" }),
        ).rejects.toThrow(/not found/i);
    });

    it("findActiveByIdempotencyKey() finds a succeeded record", async () => {
        const pending = await repo.createPending(basePending({ idempotencyKey: "key-find-succeeded" }));
        await repo.complete(pending.id, { status: "succeeded", durationMs: 100 });

        const found = await repo.findActiveByIdempotencyKey("project-1", "user-1", "key-find-succeeded", 5 * 60_000);
        expect(found?.id).toBe(pending.id);
        expect(found?.status).toBe("succeeded");
    });

    it("findActiveByIdempotencyKey() finds a fresh pending record (protects an in-flight duplicate)", async () => {
        const pending = await repo.createPending(basePending({ idempotencyKey: "key-find-pending-fresh" }));

        const found = await repo.findActiveByIdempotencyKey("project-1", "user-1", "key-find-pending-fresh", 5 * 60_000);
        expect(found?.id).toBe(pending.id);
        expect(found?.status).toBe("pending");
    });

    it("findActiveByIdempotencyKey() ignores a stale pending record (staleAfterMs=0 → any pending is stale)", async () => {
        await repo.createPending(basePending({ idempotencyKey: "key-find-pending-stale" }));

        // staleAfterMs=0 means the threshold is "now" — a record created microseconds ago is
        // already older than the threshold, simulating an abandoned pending write.
        const found = await repo.findActiveByIdempotencyKey("project-1", "user-1", "key-find-pending-stale", 0);
        expect(found).toBeNull();
    });

    it("findActiveByIdempotencyKey() does not leak across users or projects", async () => {
        await repo.createPending(basePending({ idempotencyKey: "key-scoped", userId: "user-1", projectId: "project-1" }));

        const wrongUser = await repo.findActiveByIdempotencyKey("project-1", "user-2", "key-scoped", 5 * 60_000);
        const wrongProject = await repo.findActiveByIdempotencyKey("project-2", "user-1", "key-scoped", 5 * 60_000);
        expect(wrongUser).toBeNull();
        expect(wrongProject).toBeNull();
    });

    it("findActiveByIdempotencyKey() returns null for a failed record (a failed attempt should not block a retry)", async () => {
        const pending = await repo.createPending(basePending({ idempotencyKey: "key-find-failed" }));
        await repo.complete(pending.id, { status: "failed", durationMs: 10, errorMessage: "x" });

        const found = await repo.findActiveByIdempotencyKey("project-1", "user-1", "key-find-failed", 5 * 60_000);
        expect(found).toBeNull();
    });

    it("create() (pre-I11 API) is completely unaffected — existing callers keep working as-is", async () => {
        const log = await repo.create({
            ...basePending(),
            status: "succeeded",
            durationMs: 42,
        } as Parameters<typeof repo.create>[0]);
        expect(log.status).toBe("succeeded");
        expect(log.durationMs).toBe(42);
    });
});
