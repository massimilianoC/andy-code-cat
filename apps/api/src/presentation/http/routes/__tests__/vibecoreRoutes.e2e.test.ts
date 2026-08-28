/**
 * E2E tests for POST /v1/vibecore/classify
 *
 * Runs against MongoMemoryServer — no Docker required.
 *
 * Strategy:
 *   1. Set ALL required env vars before any app module is loaded.
 *   2. Start MongoMemoryServer, override MONGODB_URI.
 *   3. Dynamically import `createApp` inside beforeAll() so config.ts evaluates
 *      with the correct env values.
 *   4. Seed a user + project directly in MongoDB.
 *   5. Sign JWTs locally using the test secret.
 *   6. VIBE_CLASSIFIER_ENABLED=false ensures no real LLM call is made —
 *      the use-case returns a fast skipped:true response.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// Test environment — must be set before any app module is evaluated
// ─────────────────────────────────────────────────────────────────────────────
const TEST_JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
const TEST_JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

// Disable real LLM calls — classifier returns skipped:true immediately
process.env.VIBE_CLASSIFIER_ENABLED = "false";

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
let userId: string;

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────
describe("VibeCore Routes — POST /v1/vibecore/classify", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");

        app = createApp();
        const db = await getDb();

        const userOid = new ObjectId();
        await db.collection("users").insertOne({
            _id: userOid,
            email: "vibetest@example.com",
            passwordHash: "$bcrypt-placeholder",
            emailVerified: true,
            isBlocked: false,
            roles: ["user"],
            createdAt: new Date(),
        });

        userId = userOid.toHexString();
    });

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    // ─── Auth guards ──────────────────────────────────────────────────────────

    it("401 without Bearer token", async () => {
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .send({ prompt: "una landing page" });
        expect(res.status).toBe(401);
    });

    it("401 with malformed Bearer token", async () => {
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", "Bearer not-a-valid-jwt")
            .send({ prompt: "una landing page" });
        expect(res.status).toBe(401);
    });

    // ─── Request validation ───────────────────────────────────────────────────

    it("400 when body is empty", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({});
        expect(res.status).toBe(400);
        expect(Array.isArray(res.body.details)).toBe(true);
    });

    it("400 when prompt is empty string", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "" });
        expect(res.status).toBe(400);
    });

    it("200 when prompt exceeds the old 2000-char cap (verbosity is welcome)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "x".repeat(2001) });
        expect(res.status).toBe(200);
    });

    it("400 when prompt exceeds the 12000-char ceiling", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "x".repeat(12001) });
        expect(res.status).toBe(400);
    });

    it("422 when attachmentMeta exceeds the default max-attachments-per-prompt policy (12)", async () => {
        const token = signToken(userId);
        const meta = Array.from({ length: 13 }, (_, i) => ({
            filename: `file${i}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 1024,
        }));
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "qualcosa", attachmentMeta: meta });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe("ATTACHMENT_LIMIT_EXCEEDED");
    });

    // ─── Happy path — classifier disabled (skipped:true fast-path) ────────────

    it("200 with valid prompt — returns VibeClassifyResponse (skipped=true when disabled)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "una landing page per un salone di bellezza" });

        expect(res.status).toBe(200);
        expect(typeof res.body.skipped).toBe("boolean");
        expect(res.body.skipped).toBe(true);
        expect(res.body.templateId).toBe(null);
        expect(res.body.formatHint).toBe(null);
        expect(typeof res.body.confidence).toBe("number");
        expect(typeof res.body.reasoning).toBe("string");
    });

    it("200 with prompt at the 12000-char ceiling", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "a".repeat(12000) });
        expect(res.status).toBe(200);
        expect(typeof res.body.skipped).toBe("boolean");
    });

    it("200 with prompt + valid attachmentMeta (1 item)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({
                prompt: "portfolio per fotografo",
                attachmentMeta: [
                    { filename: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 204800 },
                ],
            });
        expect(res.status).toBe(200);
        expect(typeof res.body.skipped).toBe("boolean");
    });

    it("200 with prompt + valid attachmentMeta (12 items, at the default policy limit)", async () => {
        const token = signToken(userId);
        const meta = Array.from({ length: 12 }, (_, i) => ({
            filename: `doc${i}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 32000,
        }));
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({
                prompt: "sito aziendale con dodici documenti",
                attachmentMeta: meta,
            });
        expect(res.status).toBe(200);
    });

    // ─── Response shape contract ──────────────────────────────────────────────

    it("response always includes all required VibeClassifyResponse fields", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "brochure per agenzia immobiliare" });

        expect(res.status).toBe(200);
        const body = res.body;
        expect("templateId" in body).toBe(true);
        expect("formatHint" in body).toBe(true);
        expect("confidence" in body).toBe(true);
        expect("reasoning" in body).toBe(true);
        expect("skipped" in body).toBe(true);
        expect(body.templateId === null || typeof body.templateId === "string").toBe(true);
        expect(body.formatHint === null || typeof body.formatHint === "string").toBe(true);
        expect(body.confidence >= 0 && body.confidence <= 1).toBe(true);
    });

    // ─── Route does NOT require x-project-id (pre-project endpoint) ───────────

    it("200 without x-project-id header (no sandbox required)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            // Deliberately NOT setting x-project-id
            .send({ prompt: "form di prenotazione ristorante" });
        expect(res.status).toBe(200);
    });

    // ─── Blocked user ─────────────────────────────────────────────────────────

    it("403 when user is blocked", async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        const blockedOid = new ObjectId();
        await db.collection("users").insertOne({
            _id: blockedOid,
            email: "blocked@example.com",
            passwordHash: "$bcrypt-placeholder",
            emailVerified: true,
            isBlocked: true,
            roles: ["user"],
            createdAt: new Date(),
        });
        const token = signToken(blockedOid.toHexString());

        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "qualcosa" });
        expect(res.status).toBe(403);
    });
});
