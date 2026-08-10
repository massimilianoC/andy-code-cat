/**
 * Integration test for the "active artifact version" exclusivity invariant —
 * docs/guides/TEST_COVERAGE_ROADMAP.md §3.2 item 2.
 *
 * Exactly one PreviewSnapshot per project (or per conversation) must be
 * isActive:true at any time — this is the version Inspector, Focus Patch, and
 * the editor's watch/sync mechanisms target and mutate. The exclusivity is
 * implemented in MongoPreviewSnapshotRepository as two separate writes
 * (updateMany to clear, then updateOne to set) with no transaction — a
 * use-case-level fake repository (see
 * apps/api/src/application/use-cases/__tests__/ActivatePreviewSnapshot.test.ts)
 * cannot prove this holds against real Mongo query semantics. This test can.
 *
 * Runs against MongoMemoryServer — no Docker required.
 * Run from repo root:
 *   npx tsx --test tests/api/previewSnapshot-activation.test.ts
 */

import { describe, before, after, it } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { MongoPreviewSnapshotRepository as MongoPreviewSnapshotRepositoryType } from "../../apps/api/src/infra/repositories/MongoPreviewSnapshotRepository";
import type { PreviewSnapshot } from "../../apps/api/src/domain/entities/PreviewSnapshot";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let repository: MongoPreviewSnapshotRepositoryType;

const BLANK_ARTIFACTS: PreviewSnapshot["artifacts"] = { html: "<main></main>", css: "", js: "" };

function countActive(snapshots: PreviewSnapshot[]): number {
    return snapshots.filter((s) => s.isActive).length;
}

describe("PreviewSnapshot active-version exclusivity (real Mongo)", () => {
    before(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { MongoPreviewSnapshotRepository } = await import("../../apps/api/src/infra/repositories/MongoPreviewSnapshotRepository");
        repository = new MongoPreviewSnapshotRepository();
    });

    after(async () => {
        const { getDb } = await import("../../apps/api/src/infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    it("conversation-scoped activate(): exactly one isActive across repeated activations", async () => {
        const projectId = "project-conv-exclusivity";
        const conversationId = "conversation-1";

        const snap1 = await repository.create({ projectId, conversationId, artifacts: BLANK_ARTIFACTS, activate: true });
        const snap2 = await repository.create({ projectId, conversationId, artifacts: BLANK_ARTIFACTS, activate: false });
        const snap3 = await repository.create({ projectId, conversationId, artifacts: BLANK_ARTIFACTS, activate: false });

        assert.equal(countActive([snap1, snap2, snap3]), 1, "creation with activate:true should not double-activate");

        await repository.activate(projectId, conversationId, snap2.id);
        let all = await repository.listByConversation(projectId, conversationId);
        assert.equal(countActive(all), 1, "exactly one active after first re-activation");
        assert.equal(all.find((s) => s.isActive)?.id, snap2.id);

        await repository.activate(projectId, conversationId, snap3.id);
        all = await repository.listByConversation(projectId, conversationId);
        assert.equal(countActive(all), 1, "exactly one active after second re-activation");
        assert.equal(all.find((s) => s.isActive)?.id, snap3.id);

        await repository.activate(projectId, conversationId, snap1.id);
        all = await repository.listByConversation(projectId, conversationId);
        assert.equal(countActive(all), 1, "exactly one active after reverting to the first snapshot");
        assert.equal(all.find((s) => s.isActive)?.id, snap1.id);

        const active = await repository.getActive(projectId, conversationId);
        assert.equal(active?.id, snap1.id, "getActive() must agree with the exclusivity check above");
    });

    it("project-scoped activateForProject(): exclusivity holds ACROSS conversations in the same project", async () => {
        const projectId = "project-cross-conv-exclusivity";

        const convA1 = await repository.create({ projectId, conversationId: "conv-a", artifacts: BLANK_ARTIFACTS, activate: true });
        const convB1 = await repository.create({ projectId, conversationId: "conv-b", artifacts: BLANK_ARTIFACTS, activate: false });

        // Both conversations report a locally-active snapshot; only one is the
        // project-wide active version once activateForProject is used.
        await repository.activateForProject(projectId, convB1.id);

        const all = await repository.listByProject(projectId);
        assert.equal(countActive(all), 1, "activateForProject must deactivate snapshots from OTHER conversations too");
        assert.equal(all.find((s) => s.isActive)?.id, convB1.id);

        const activeForProject = await repository.getActiveForProject(projectId);
        assert.equal(activeForProject?.id, convB1.id);

        // Re-activating the first conversation's snapshot must clear conv-b's snapshot as well.
        await repository.activateForProject(projectId, convA1.id);
        const allAfter = await repository.listByProject(projectId);
        assert.equal(countActive(allAfter), 1);
        assert.equal(allAfter.find((s) => s.isActive)?.id, convA1.id);
    });

    it("activation exclusivity is scoped per project — a second project is unaffected", async () => {
        const projectA = "project-isolation-a";
        const projectB = "project-isolation-b";

        const snapA = await repository.create({ projectId: projectA, conversationId: "conv-1", artifacts: BLANK_ARTIFACTS, activate: true });
        const snapB = await repository.create({ projectId: projectB, conversationId: "conv-1", artifacts: BLANK_ARTIFACTS, activate: true });

        await repository.activateForProject(projectA, snapA.id);

        const activeA = await repository.getActiveForProject(projectA);
        const activeB = await repository.getActiveForProject(projectB);
        assert.equal(activeA?.id, snapA.id);
        assert.equal(activeB?.id, snapB.id, "activating project A must not touch project B's active snapshot");
    });
});
