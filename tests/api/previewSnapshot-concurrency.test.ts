/**
 * Integration test for the optimistic-concurrency guard on preview-snapshot activation —
 * docs/specs/PREVIEW_SNAPSHOT_CONCURRENCY_GUARD_PLAN.md §9.2.
 *
 * Reproduces the two-tab bug this guard fixes: two clients read the same "active"
 * snapshot, both attempt to activate a new version, and — without a precondition check —
 * the second write silently clobbers the first with no error and no warning. This test
 * exercises the real MongoPreviewSnapshotRepository together with the real
 * CreatePreviewSnapshot use-case (not a fake), since the exclusivity write
 * (updateMany + updateOne, no transaction) can only be proven against real Mongo query
 * semantics — see tests/api/previewSnapshot-activation.test.ts for the same rationale.
 *
 * Runs against MongoMemoryServer — no Docker required.
 * Run from repo root:
 *   npx tsx --test tests/api/previewSnapshot-concurrency.test.ts
 */

import { describe, before, after, it } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { MongoPreviewSnapshotRepository as MongoPreviewSnapshotRepositoryType } from "../../apps/api/src/infra/repositories/MongoPreviewSnapshotRepository";
import type { CreatePreviewSnapshot as CreatePreviewSnapshotType } from "../../apps/api/src/application/use-cases/CreatePreviewSnapshot";
import type { PreviewSnapshot } from "../../apps/api/src/domain/entities/PreviewSnapshot";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let repository: MongoPreviewSnapshotRepositoryType;
let createSnapshot: CreatePreviewSnapshotType;

const BLANK_ARTIFACTS: PreviewSnapshot["artifacts"] = { html: "<main></main>", css: "", js: "" };

async function conflictCode(promise: Promise<unknown>): Promise<string | undefined> {
    try {
        await promise;
        return undefined;
    } catch (error) {
        return (error as { code?: string }).code;
    }
}

describe("PreviewSnapshot optimistic concurrency guard (real Mongo)", () => {
    before(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { MongoPreviewSnapshotRepository } = await import("../../apps/api/src/infra/repositories/MongoPreviewSnapshotRepository");
        const { CreatePreviewSnapshot } = await import("../../apps/api/src/application/use-cases/CreatePreviewSnapshot");
        repository = new MongoPreviewSnapshotRepository();
        createSnapshot = new CreatePreviewSnapshot(repository);
    });

    after(async () => {
        const { getDb } = await import("../../apps/api/src/infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    it("reproduces and rejects the two-tab clobbering race, then allows a resynced retry", async () => {
        const projectId = "project-two-tab-race";
        const conversationId = "conv-1";

        // Tab A and Tab B both read the same state: active = v1.
        const v1 = await repository.create({ projectId, conversationId, artifacts: BLANK_ARTIFACTS, activate: true });

        // Tab B creates v2, believing v1 is still active — succeeds.
        const v2 = await createSnapshot.execute({
            projectId,
            conversationId,
            artifacts: BLANK_ARTIFACTS,
            activate: true,
            expectedActiveSnapshotId: v1.id,
        });
        assert.equal((await repository.getActiveForProject(projectId))?.id, v2.id);

        // Tab A is stale — still believes v1 is active — its create must be rejected.
        const code = await conflictCode(createSnapshot.execute({
            projectId,
            conversationId,
            artifacts: BLANK_ARTIFACTS,
            activate: true,
            expectedActiveSnapshotId: v1.id,
        }));
        assert.equal(code, "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT");

        // The rejected write must not have touched persistence at all.
        const afterConflict = await repository.listByProject(projectId);
        assert.equal(afterConflict.length, 2, "no v3 should have been inserted");
        assert.equal(afterConflict.filter((s) => s.isActive).length, 1, "exactly one active snapshot");
        assert.equal((await repository.getActiveForProject(projectId))?.id, v2.id, "v2 must still be active");

        // Tab A resyncs (reads the real active snapshot) and retries — now succeeds.
        const resyncedActive = await repository.getActiveForProject(projectId);
        const v3 = await createSnapshot.execute({
            projectId,
            conversationId,
            artifacts: BLANK_ARTIFACTS,
            activate: true,
            expectedActiveSnapshotId: resyncedActive!.id,
        });

        const finalList = await repository.listByProject(projectId);
        assert.equal(finalList.length, 3);
        assert.equal(finalList.filter((s) => s.isActive).length, 1, "exactly one active snapshot after resynced retry");
        assert.equal((await repository.getActiveForProject(projectId))?.id, v3.id);
    });

    it("rejects cross-conversation clobbering — project scope catches what conversation scope would miss", async () => {
        const projectId = "project-cross-conv-clobber";

        const convAActive = await repository.create({ projectId, conversationId: "conv-a", artifacts: BLANK_ARTIFACTS, activate: true });

        // conv-b's client is stale relative to the PROJECT's active snapshot (conv-a's),
        // even though it never touched conv-a directly. A conversation-scoped getActive()
        // would not have caught this — only project-wide getActiveForProject() does.
        const code = await conflictCode(createSnapshot.execute({
            projectId,
            conversationId: "conv-b",
            artifacts: BLANK_ARTIFACTS,
            activate: true,
            expectedActiveSnapshotId: "some-other-stale-id",
        }));
        assert.equal(code, "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT");

        assert.equal((await repository.getActiveForProject(projectId))?.id, convAActive.id, "conv-a's snapshot must remain active");
        assert.equal((await repository.listByProject(projectId)).length, 1, "conv-b's rejected create must not have inserted anything");
    });

    it("allows the first creation in an empty project with expectedActiveSnapshotId: null", async () => {
        const projectId = "project-empty-first-creation";

        const snapshot = await createSnapshot.execute({
            projectId,
            conversationId: "conv-1",
            artifacts: BLANK_ARTIFACTS,
            activate: true,
            expectedActiveSnapshotId: null,
        });

        assert.equal(snapshot.isActive, true);
        assert.equal((await repository.getActiveForProject(projectId))?.id, snapshot.id);
    });

    it("allows creation without a precondition even when a different snapshot is active — legacy/server-side callers remain valid", async () => {
        const projectId = "project-no-precondition";
        const conversationId = "conv-1";

        const v1 = await repository.create({ projectId, conversationId, artifacts: BLANK_ARTIFACTS, activate: true });

        const v2 = await createSnapshot.execute({
            projectId,
            conversationId,
            artifacts: BLANK_ARTIFACTS,
            activate: true,
            // expectedActiveSnapshotId intentionally omitted
        });

        assert.notEqual(v2.id, v1.id);
        assert.equal((await repository.getActiveForProject(projectId))?.id, v2.id);
    });
});
