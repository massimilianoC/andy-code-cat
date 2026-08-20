/**
 * E2E test proving launch-workspace is also gated by the PIPELINE_RUN_ENABLED master rollback
 * lever when left at its shipped default (false/unset) — it persists a PipelineRun, so it
 * shares the same rollback lever as pipelineRunRoutes.ts (see pipelineRoutes.ts's I12 comment).
 * Runs against MongoMemoryServer — no Docker required.
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
process.env.PIPELINE_RUN_ENABLED = "false";

function signToken(userId: string, roles: string[] = ["user"]): string {
    return jwt.sign({ sub: userId, roles }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });
}

let mongod: MongoMemoryServer;
let app: Express;
let ownerUserId: string;
let projectId: string;

describe("Pipeline launch-workspace E2E — PIPELINE_RUN_ENABLED=false (shipped default)", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");

        app = createApp();
        const db = await getDb();

        const ownerOid = new ObjectId();
        const projectOid = new ObjectId();

        await db.collection("users").insertOne({
            _id: ownerOid,
            email: "workspace-disabled@example.com",
            passwordHash: "$bcrypt-placeholder",
            emailVerified: true,
            isBlocked: false,
            roles: ["user"],
            createdAt: new Date(),
        });

        await db.collection("projects").insertOne({
            _id: projectOid,
            ownerUserId: ownerOid,
            name: "Workspace Launch Disabled Test Project",
            createdAt: new Date(),
        });

        ownerUserId = ownerOid.toHexString();
        projectId = projectOid.toHexString();
    });

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    it("404s when the flag is disabled — and, crucially, the pre-existing /pipelines/zero-effort route is unaffected", async () => {
        const token = signToken(ownerUserId);

        const workspaceRes = await request(app)
            .post(`/v1/projects/${projectId}/pipeline/launch-workspace`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({
                businessName: "Runner Lab",
                primaryGoal: "Un runner arcade completo per studenti.",
                audience: "Studenti e giocatori casual.",
            });
        expect(workspaceRes.status).toBe(404);

        const zeroEffortRes = await request(app)
            .post(`/v1/projects/${projectId}/pipelines/zero-effort`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({
                businessName: "Runner Lab",
                primaryGoal: "Un runner arcade completo per studenti.",
                audience: "Studenti e giocatori casual.",
            });
        expect(zeroEffortRes.status).toBe(201);
    });
});
