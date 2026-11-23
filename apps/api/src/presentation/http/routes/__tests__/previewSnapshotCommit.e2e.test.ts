/**
 * POST /v1/projects/:projectId/preview-snapshots — the version write path (AL-047).
 *
 * Characterises what the route does around `CreatePreviewSnapshot` (repair, stable ids, the
 * JavaScript guard, the form runtime, the AL-040/041 base check, the AL-045 no-op) so that moving
 * it into the `CommitArtifactVersion` use case — which the generation engine also calls
 * (BACKGROUND_RUNS.md §3.1) — can be shown to leave it unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";

const TEST_JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

const token = (userId: string) => jwt.sign({ sub: userId, roles: ["user"] }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });

let mongod: MongoMemoryServer;
let app: Express;
let userId: string;
let otherUserId: string;
let projectId: string;
let conversationId: string;
let messageId: string;

function post(body: Record<string, unknown>, asUser = userId) {
    return request(app)
        .post(`/v1/projects/${projectId}/preview-snapshots`)
        .set("Authorization", `Bearer ${token(asUser)}`)
        .set("x-project-id", projectId)
        .send(body);
}

function normalise(snapshot: Record<string, unknown>) {
    const { id, createdAt, updatedAt, activatedAt, projectId: _p, conversationId: _c, sourceMessageId: _s, parentSnapshotId, ...rest } = snapshot;
    expect(typeof id).toBe("string");
    // Stable ids are generated per write; the hash covers them, so neither is comparable across runs.
    const text = JSON.stringify(rest).replace(/data-pf-id=\\"[^"\\]*\\"/g, "data-pf-id=<id>").replace(/"contentHash":"[0-9a-f]{64}"/g, "\"contentHash\":\"<hash>\"");
    return { ...JSON.parse(text), hasParent: Boolean(parentSnapshotId), createdAt: typeof createdAt, updatedAt: typeof updatedAt, activatedAt: typeof activatedAt };
}

describe("POST /preview-snapshots — characterisation", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        app = createApp();
        const db = await getDb();
        const userOid = new ObjectId();
        const otherOid = new ObjectId();
        const projectOid = new ObjectId();
        await db.collection("users").insertMany([
            { _id: userOid, email: "snap-owner@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() },
            { _id: otherOid, email: "snap-other@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() },
        ]);
        await db.collection("projects").insertOne({ _id: projectOid, ownerUserId: userOid, name: "Snapshot project", presetId: "landing", createdAt: new Date() });
        userId = userOid.toHexString();
        otherUserId = otherOid.toHexString();
        projectId = projectOid.toHexString();

        const conv = await request(app)
            .post(`/v1/projects/${projectId}/conversations`)
            .set("Authorization", `Bearer ${token(userId)}`)
            .set("x-project-id", projectId)
            .send({ title: "Snap" });
        expect(conv.status).toBe(201);
        conversationId = conv.body.conversation.id;
        const msg = await request(app)
            .post(`/v1/projects/${projectId}/conversations/${conversationId}/messages`)
            .set("Authorization", `Bearer ${token(userId)}`)
            .set("x-project-id", projectId)
            .send({ role: "assistant", content: "Ecco la pagina.", metadata: { model: "m", provider: "p" } });
        expect(msg.status).toBe(201);
        messageId = msg.body.message.id;
    }, 60_000);

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    let first: { id: string; metadata: { contentHash: string } };

    it("403 on a project the caller does not own", async () => {
        const res = await post({ conversationId, artifacts: { html: "<p>x</p>", css: "", js: "" } }, otherUserId);
        expect(res.status).toBe(403);
    });

    it("404 when the conversation is not in the project", async () => {
        const res = await post({ conversationId: "missing", artifacts: { html: "<p>x</p>", css: "", js: "" } });
        expect(res.status).toBe(404);
    });

    it("201 creates, normalises, injects stable ids, activates and links the source message", async () => {
        const res = await post({
            conversationId,
            sourceMessageId: messageId,
            artifacts: { html: "<!-- note --><main><section><h1>Forno</h1></section></main>", css: "h1{color:red}", js: "" },
            metadata: { model: "m", provider: "p", structuredParseValid: true, finishReason: "stop" },
            activate: true,
        });
        expect(res.status).toBe(201);
        expect(res.body.created).toBe(true);
        const snapshot = res.body.snapshot;
        expect(snapshot.isActive).toBe(true);
        expect(snapshot.artifacts.html).toContain("data-pf-id");
        expect(snapshot.artifacts.html).not.toContain("<!-- note -->");
        expect(typeof snapshot.metadata.contentHash).toBe("string");
        expect(normalise(snapshot)).toMatchSnapshot();
        first = snapshot;

        const conv = await request(app)
            .get(`/v1/projects/${projectId}/conversations/${conversationId}`)
            .set("Authorization", `Bearer ${token(userId)}`)
            .set("x-project-id", projectId);
        const linked = conv.body.conversation.messages.find((m: { id: string }) => m.id === messageId);
        expect(linked.metadata.snapshotId).toBe(snapshot.id);
    });

    it("200 created:false for a write identical to its base (AL-045)", async () => {
        const stored = await request(app)
            .get(`/v1/projects/${projectId}/preview-snapshots/${first.id}`)
            .set("Authorization", `Bearer ${token(userId)}`)
            .set("x-project-id", projectId);
        const res = await post({
            conversationId,
            parentSnapshotId: first.id,
            baseContentHash: first.metadata.contentHash,
            artifacts: stored.body.snapshot.artifacts,
            activate: true,
        });
        expect(stored.status).toBe(200);
        expect(res.status).toBe(200);
        expect(res.body.created).toBe(false);
        expect(res.body.snapshot.id).toBe(first.id);
    });

    it("409 ARTIFACT_BASE_STALE when the declared hash does not match the base", async () => {
        const res = await post({
            conversationId,
            parentSnapshotId: first.id,
            baseContentHash: "0".repeat(64),
            artifacts: { html: "<main><h1>Altro</h1></main>", css: "", js: "" },
            activate: true,
        });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("ARTIFACT_BASE_STALE");
    });

    it("422 INVALID_GENERATED_JAVASCRIPT when an activated version's script does not parse", async () => {
        const res = await post({
            conversationId,
            artifacts: { html: "<main><h1>JS</h1></main>", css: "", js: "function (" },
            activate: true,
        });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe("INVALID_GENERATED_JAVASCRIPT");
    });

    it("201 a second version continues the chain from the active one", async () => {
        const res = await post({
            conversationId,
            artifacts: { html: "<main><h1>Versione due</h1></main>", css: "", js: "" },
            activate: true,
        });
        expect(res.status).toBe(201);
        expect(res.body.snapshot.parentSnapshotId).toBe(first.id);
        expect(normalise(res.body.snapshot)).toMatchSnapshot();
    });
});
