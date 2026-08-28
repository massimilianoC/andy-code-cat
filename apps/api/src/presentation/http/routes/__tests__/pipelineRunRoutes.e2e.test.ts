/**
 * E2E tests for /v1/projects/:projectId/pipeline-runs (I7 of the SSOT program). Runs against
 * MongoMemoryServer — no Docker required. Same
 * strategy as costRoutes.e2e.test.ts / vibecoreRoutes.e2e.test.ts.
 *
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

function signToken(userId: string, roles: string[] = ["user"]): string {
    return jwt.sign({ sub: userId, roles }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });
}

let mongod: MongoMemoryServer;
let app: Express;
let ownerUserId: string;
let otherUserId: string;
let projectId: string;

describe("Pipeline Run Routes E2E", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");

        app = createApp();
        const db = await getDb();

        const usersCol = db.collection("users");
        const projectsCol = db.collection("projects");

        const ownerOid = new ObjectId();
        const otherOid = new ObjectId();
        const projectOid = new ObjectId();

        await usersCol.insertMany([
            {
                _id: ownerOid,
                email: "pipelinerun-owner@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
            {
                _id: otherOid,
                email: "pipelinerun-other@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
        ]);

        await projectsCol.insertOne({
            _id: projectOid,
            ownerUserId: ownerOid,
            name: "Pipeline Run Test Project",
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
        const res = await request(app).post(`/v1/projects/${projectId}/pipeline-runs`).send({ entryMode: "vibe" });
        expect(res.status).toBe(401);
    });

    it("403 when x-project-id does not belong to the caller", async () => {
        const token = signToken(otherUserId);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/pipeline-runs`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({ entryMode: "vibe" });
        expect(res.status).toBe(403);
    });

    it("400 on an invalid entryMode", async () => {
        const token = signToken(ownerUserId);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/pipeline-runs`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({ entryMode: "not-a-real-mode" });
        expect(res.status).toBe(400);
    });

    it("201 creates a run with a frozen modelLock, then it is listable and gettable", async () => {
        const token = signToken(ownerUserId);

        const createRes = await request(app)
            .post(`/v1/projects/${projectId}/pipeline-runs`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({ entryMode: "vibe" });

        expect(createRes.status).toBe(201);
        expect(createRes.body.run.id).toBeTruthy();
        expect(createRes.body.run.status).toBe("draft");
        expect(createRes.body.run.projectId).toBe(projectId);
        expect(createRes.body.run.modelLock.policy).toBe("legacy");
        expect(typeof createRes.body.run.modelLock.effective.providerId).toBe("string");
        expect(typeof createRes.body.run.modelLock.effective.modelId).toBe("string");

        const runId = createRes.body.run.id;

        const listRes = await request(app)
            .get(`/v1/projects/${projectId}/pipeline-runs`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(listRes.status).toBe(200);
        expect(listRes.body.runs.some((r: { id: string }) => r.id === runId)).toBe(true);

        const getRes = await request(app)
            .get(`/v1/projects/${projectId}/pipeline-runs/${runId}`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(getRes.status).toBe(200);
        expect(getRes.body.run.id).toBe(runId);
    });

    it("403 when a non-owner tries to read a run in someone else's project (blocked by sandboxMiddleware before run-ownership is ever checked)", async () => {
        const ownerToken = signToken(ownerUserId);
        const createRes = await request(app)
            .post(`/v1/projects/${projectId}/pipeline-runs`)
            .set("Authorization", `Bearer ${ownerToken}`)
            .set("x-project-id", projectId)
            .send({ entryMode: "zero-effort" });
        const runId = createRes.body.run.id;

        const otherToken = signToken(otherUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/pipeline-runs/${runId}`)
            .set("Authorization", `Bearer ${otherToken}`)
            .set("x-project-id", projectId);
        expect(res.status).toBe(403);
    });
});
