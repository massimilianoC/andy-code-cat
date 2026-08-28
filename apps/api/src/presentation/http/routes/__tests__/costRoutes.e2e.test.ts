/**
 * E2E tests for cost API routes.
 *
 * Runs against MongoMemoryServer — no Docker required.
 *
 * Strategy:
 *   1. Set ALL required env vars before any app module is loaded.
 *   2. Start MongoMemoryServer, override MONGODB_URI.
 *   3. Dynamically import `createApp` inside beforeAll() so config.ts evaluates
 *      with the correct env values.
 *   4. Seed users + project directly in MongoDB (bypasses business-logic layers).
 *   5. Sign JWTs locally using the test secret.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Test secrets — MUST be set before any `import` of app code is evaluated
// (dynamic imports in beforeAll() run after these top-level assignments).
// ─────────────────────────────────────────────────────────────────────────────
const TEST_JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
const TEST_JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
// MONGODB_URI is set inside beforeAll() once MongoMemoryServer is ready.
// dotenv (called in config.ts) only sets vars NOT already in process.env,
// so any value we put here before config.ts loads wins.
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function signToken(userId: string, roles: string[] = ["user"]): string {
    return jwt.sign({ sub: userId, roles }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test state
// ─────────────────────────────────────────────────────────────────────────────
let mongod: MongoMemoryServer;
let app: Express;
let normalUserId: string;
let adminUserId: string;
let projectId: string;

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────
describe("Cost Routes E2E", () => {
    beforeAll(async () => {
        // 1. Start in-memory MongoDB and override the URI env var so that when
        //    config.ts is evaluated (on first dynamic import below) it reads the
        //    correct URI from process.env (dotenv skips already-set vars).
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        // 2. Dynamically import app AFTER env is fully configured.
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");

        app = createApp();
        const db = await getDb();

        // 3. Seed test data directly into MongoDB collections.
        const usersCol = db.collection("users");
        const projectsCol = db.collection("projects");

        const normalOid = new ObjectId();
        const adminOid = new ObjectId();
        const projectOid = new ObjectId();

        await usersCol.insertMany([
            {
                _id: normalOid,
                email: "testuser@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
            {
                _id: adminOid,
                email: "admin@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user", "superadmin"],
                createdAt: new Date(),
            },
        ]);

        await projectsCol.insertOne({
            _id: projectOid,
            ownerUserId: normalOid,
            name: "Test Project",
            createdAt: new Date(),
        });

        normalUserId = normalOid.toHexString();
        adminUserId = adminOid.toHexString();
        projectId = projectOid.toHexString();
    });

    afterAll(async () => {
        // Close the MongoDB client connection before stopping the server.
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    // ─── 401 / auth guards ────────────────────────────────────────────────────

    it("GET /v1/users/me/cost — 401 without token", async () => {
        const res = await request(app).get("/v1/users/me/cost");
        expect(res.status).toBe(401);
    });

    it("GET /v1/projects/:id/cost — 401 without token", async () => {
        const res = await request(app).get(`/v1/projects/${projectId}/cost`);
        expect(res.status).toBe(401);
    });

    it("GET /v1/projects/:id/cost — 400 when x-project-id header is missing", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/cost`)
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(400);
    });

    it("GET /v1/projects/:id/cost — 403 for project not owned by the requesting user", async () => {
        const foreignProjectId = new ObjectId().toHexString();
        const token = signToken(normalUserId);
        const res = await request(app)
            .get(`/v1/projects/${foreignProjectId}/cost`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", foreignProjectId);
        expect(res.status).toBe(403);
    });

    // ─── Happy paths — empty database ────────────────────────────────────────

    it("GET /v1/users/me/cost — 200 with valid token (empty summary)", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get("/v1/users/me/cost")
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.summary).not.toBeUndefined();
        expect(Array.isArray(res.body.breakdown)).toBe(true);
        expect(Array.isArray(res.body.trend)).toBe(true);
        expect(Array.isArray(res.body.topProjects)).toBe(true);
    });

    it("GET /v1/projects/:id/cost — 200 with valid token + correct project (empty summary)", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/cost`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(res.status).toBe(200);
        expect(res.body.summary).not.toBeUndefined();
        expect(Array.isArray(res.body.breakdown)).toBe(true);
        expect(Array.isArray(res.body.trend)).toBe(true);
    });

    it("GET /v1/projects/:id/cost/transactions — 200 returns empty paginated list", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/cost/transactions`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items.length).toBe(0);
        expect(res.body.total).toBe(0);
    });

    // ─── Admin role guards ────────────────────────────────────────────────────

    it("GET /v1/admin/cost/dashboard — 403 for regular user", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get("/v1/admin/cost/dashboard")
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(403);
    });

    it("GET /v1/admin/cost/dashboard — 200 for superadmin", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .get("/v1/admin/cost/dashboard")
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.summary).not.toBeUndefined();
        expect(Array.isArray(res.body.breakdown)).toBe(true);
        expect(Array.isArray(res.body.trend)).toBe(true);
        expect(Array.isArray(res.body.topProjects)).toBe(true);
    });

    it("GET /v1/admin/cost/transactions — 200 for superadmin", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .get("/v1/admin/cost/transactions")
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
    });

    // ─── PATCH /v1/admin/cost/rates ───────────────────────────────────────────

    it("PATCH /v1/admin/cost/rates — 403 for regular user", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .patch("/v1/admin/cost/rates")
            .set("Authorization", `Bearer ${token}`)
            .send({ usdToEurRate: 0.9 });
        expect(res.status).toBe(403);
    });

    it("PATCH /v1/admin/cost/rates — 400 when body is empty", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .patch("/v1/admin/cost/rates")
            .set("Authorization", `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBeTruthy();
    });

    it("PATCH /v1/admin/cost/rates — 400 when all provided fields are non-numeric", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .patch("/v1/admin/cost/rates")
            .set("Authorization", `Bearer ${token}`)
            .send({ usdToEurRate: "not-a-number", textEurPer1kTokens: null });
        expect(res.status).toBe(400);
    });

    it("PATCH /v1/admin/cost/rates — 200 with valid numeric rates", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .patch("/v1/admin/cost/rates")
            .set("Authorization", `Bearer ${token}`)
            .send({ usdToEurRate: 0.95, textEurPer1kTokens: 0.006 });
        expect(res.status).toBe(200);
        expect(res.body.costRates).toBeTruthy();
        expect(res.body.costRates.usdToEurRate).toBe(0.95);
        expect(res.body.costRates.textEurPer1kTokens).toBe(0.006);
        expect(res.body.costRates.updatedByUserId).toBeTruthy();
        expect(res.body.costRates.updatedByUserId).toBe(adminUserId);
    });

    it("GET /v1/admin/cost/dashboard — currentRates reflects PATCH'd values", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .get("/v1/admin/cost/dashboard")
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.currentRates?.usdToEurRate).toBe(0.95);
    });

    // ─── Write + read back ────────────────────────────────────────────────────

    it("After CostTransactionService.recordAsync(), project cost summary is non-zero", async () => {
        const { CostTransactionService } = await import("../../../../application/cost/CostTransactionService");
        const { ResourceType } = await import("../../../../domain/entities/CostTransaction");

        await CostTransactionService.instance.recordAsync({
            userId: normalUserId,
            projectId,
            resourceType: ResourceType.LLM_CHAT,
            resourceSubtype: "test-model",
            providerCostUsd: 0.01,
            units: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            sourceRef: { conversationId: "conv-test-001" },
        });

        const token = signToken(normalUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/cost`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalEur).toBeGreaterThan(0);
        expect(res.body.summary.txCount).toBe(1);
    });

    it("Project transactions list returns the recorded transaction", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/cost/transactions`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBe(1);
        expect(res.body.items[0].resourceType).toBe("llm.chat");
        expect(res.body.items[0].totalEur).toBeGreaterThan(0);
        expect(res.body.items[0].units?.totalTokens).toBe(150);
    });

    it("User cost summary reflects the recorded transaction", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get("/v1/users/me/cost")
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalEur).toBeGreaterThan(0);
        expect(res.body.summary.txCount).toBe(1);
        expect(res.body.breakdown.length).toBe(1);
        expect(res.body.breakdown[0].resourceType).toBe("llm.chat");
    });

    it("Admin cost dashboard reflects the recorded transaction", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .get("/v1/admin/cost/dashboard")
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.summary.totalEur).toBeGreaterThan(0);
        expect(res.body.summary.txCount).toBe(1);
    });

    // ─── Pagination parameters ────────────────────────────────────────────────

    it("GET /v1/projects/:id/cost/transactions — respects page and limit query params", async () => {
        const token = signToken(normalUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/cost/transactions?page=1&limit=10`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(res.status).toBe(200);
        expect(res.body.page).not.toBeUndefined();
        expect(res.body.limit).not.toBeUndefined();
    });

    it("GET /v1/admin/cost/transactions — filterable by userId", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const res = await request(app)
            .get(`/v1/admin/cost/transactions?userId=${normalUserId}`)
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBe(1);
    });

    it("GET /v1/admin/cost/transactions — returns empty when filtering by unknown userId", async () => {
        const token = signToken(adminUserId, ["user", "superadmin"]);
        const unknownId = new ObjectId().toHexString();
        const res = await request(app)
            .get(`/v1/admin/cost/transactions?userId=${unknownId}`)
            .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBe(0);
    });
});
