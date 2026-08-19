/**
 * E2E tests for POST /v1/projects/:projectId/pipeline/launch-godmode with
 * PIPELINE_RUN_ENABLED=true (I12 of the SSOT program). Runs against MongoMemoryServer — no
 * Docker required, same strategy as pipelineRunRoutes.e2e.test.ts.
 *
 * The disabled-flag (default) behavior is covered separately in
 * pipelineRoutes.launchGodmode.disabled.e2e.test.ts — a single test file cannot flip
 * PIPELINE_RUN_ENABLED mid-run because config.ts reads process.env once at import time.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";

const TEST_JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
const TEST_JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.PIPELINE_RUN_ENABLED = "true";

function signToken(userId: string, roles: string[] = ["user"]): string {
    return jwt.sign({ sub: userId, roles }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });
}

function godmodePayload(overrides?: Record<string, unknown>) {
    return {
        businessName: "Runner Lab",
        primaryGoal: "Un runner arcade completo per studenti.",
        audience: "Studenti e giocatori casual.",
        ...overrides,
    };
}

let mongod: MongoMemoryServer;
let app: Express;
let ownerUserId: string;
let otherUserId: string;
let projectId: string;

describe("Pipeline launch-godmode E2E — PIPELINE_RUN_ENABLED=true", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");

        app = createApp();
        const db = await getDb();

        const ownerOid = new ObjectId();
        const otherOid = new ObjectId();
        const projectOid = new ObjectId();

        await db.collection("users").insertMany([
            {
                _id: ownerOid,
                email: "godmode-owner@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
            {
                _id: otherOid,
                email: "godmode-other@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
        ]);

        await db.collection("projects").insertOne({
            _id: projectOid,
            ownerUserId: ownerOid,
            name: "Godmode Launch Test Project",
            createdAt: new Date(),
        });

        ownerUserId = ownerOid.toHexString();
        otherUserId = otherOid.toHexString();
        projectId = projectOid.toHexString();
    });

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    it("401 without a token", async () => {
        const res = await request(app)
            .post(`/v1/projects/${projectId}/pipeline/launch-godmode`)
            .send(godmodePayload());
        expect(res.status).toBe(401);
    });

    it("403 when x-project-id does not belong to the caller", async () => {
        const token = signToken(otherUserId);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/pipeline/launch-godmode`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send(godmodePayload());
        expect(res.status).toBe(403);
    });

    it("400 on a missing required field", async () => {
        const token = signToken(ownerUserId);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/pipeline/launch-godmode`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({ businessName: "Runner Lab" });
        expect(res.status).toBe(400);
    });

    it("201 launches a godmode pipeline: conversation, workspace, and a frozen modelLock with an attached canonical brief", async () => {
        const token = signToken(ownerUserId);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/pipeline/launch-godmode`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send(godmodePayload({ sourceRequest: "Crea un runner senza acquisti in-app." }));

        expect(res.status).toBe(201);
        expect(res.body.mode).toBe("godmode");
        expect(res.body.status).toBe("prepared");
        expect(res.body.projectId).toBe(projectId);
        expect(res.body.pipelineRunId).toBeTruthy();
        expect(res.body.conversationId).toBeTruthy();
        expect(res.body.jobId).toBeTruthy();
        expect(res.body.normalizedBrief).toContain("Runner Lab");
        expect(typeof res.body.modelLock.effective.providerId).toBe("string");
        expect(typeof res.body.modelLock.effective.modelId).toBe("string");
        expect(Array.isArray(res.body.suggestedNextActions)).toBe(true);
        expect(res.body.workspace.jobId).toBe(res.body.jobId);

        // the run this endpoint created is real and readable via the I7 pipeline-runs route,
        // with the canonical brief attached (I12's whole point — nothing wrote one until now)
        const getRes = await request(app)
            .get(`/v1/projects/${projectId}/pipeline-runs/${res.body.pipelineRunId}`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(getRes.status).toBe(200);
        expect(getRes.body.run.entryMode).toBe("godmode");
        expect(getRes.body.run.conversationId).toBe(res.body.conversationId);
        expect(getRes.body.run.canonicalBrief.content).toContain("Runner Lab");
        expect(getRes.body.run.canonicalBrief.contentHash).toBeTruthy();
    });
});
