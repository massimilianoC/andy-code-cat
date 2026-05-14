/**
 * E2E tests for POST /v1/vibecore/classify
 *
 * Runs against MongoMemoryServer — no Docker required.
 * Run from repo root:
 *   npx tsx --test tests/api/vibecore-routes.test.ts
 *
 * Strategy:
 *   1. Set ALL required env vars before any app module is loaded.
 *   2. Start MongoMemoryServer, override MONGODB_URI.
 *   3. Dynamically import `createApp` inside before() so config.ts evaluates
 *      with the correct env values.
 *   4. Seed a user + project directly in MongoDB.
 *   5. Sign JWTs locally using the test secret.
 *   6. VIBE_CLASSIFIER_ENABLED=false ensures no real LLM call is made —
 *      the use-case returns a fast skipped:true response.
 */

import { describe, before, after, it } from "node:test";
import assert from "node:assert/strict";
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
process.env.VIBE_OPTIMIZER_ENABLED = "false";

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
    before(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../apps/api/src/app");
        const { getDb } = await import("../../apps/api/src/infra/db/mongo");

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

    after(async () => {
        const { getDb } = await import("../../apps/api/src/infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    // ─── Auth guards ──────────────────────────────────────────────────────────

    it("401 without Bearer token", async () => {
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .send({ prompt: "una landing page" });
        assert.equal(res.status, 401);
    });

    it("401 with malformed Bearer token", async () => {
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", "Bearer not-a-valid-jwt")
            .send({ prompt: "una landing page" });
        assert.equal(res.status, 401);
    });

    // ─── Request validation ───────────────────────────────────────────────────

    it("400 when body is empty", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({});
        assert.equal(res.status, 400);
        assert.ok(Array.isArray(res.body.details), "should include zod issues");
    });

    it("400 when prompt is empty string", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "" });
        assert.equal(res.status, 400);
    });

    it("400 when prompt exceeds 2000 chars", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "x".repeat(2001) });
        assert.equal(res.status, 400);
    });

    it("400 when attachmentMeta exceeds 3 items", async () => {
        const token = signToken(userId);
        const meta = Array.from({ length: 4 }, (_, i) => ({
            filename: `file${i}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 1024,
        }));
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "qualcosa", attachmentMeta: meta });
        assert.equal(res.status, 400);
    });

    // ─── Happy path — classifier disabled (skipped:true fast-path) ────────────

    it("200 with valid prompt — returns VibeClassifyResponse (skipped=true when disabled)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "una landing page per un salone di bellezza" });

        assert.equal(res.status, 200);
        assert.equal(typeof res.body.skipped, "boolean");
        assert.equal(res.body.skipped, true, "classifier disabled → should skip");
        assert.equal(res.body.templateId, null);
        assert.equal(res.body.formatHint, null);
        assert.equal(typeof res.body.confidence, "number");
        assert.equal(typeof res.body.reasoning, "string");
    });

    it("200 with prompt at max length (2000 chars)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "una landing page ".repeat(118).trim() }); // ~2006 chars, will be trimmed to 2000 server-side
        // Actually Zod max(2000) is enforced on incoming request
        // Let's use exactly 2000 chars
        const res2 = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "a".repeat(2000) });
        assert.equal(res2.status, 200);
        assert.ok(typeof res2.body.skipped === "boolean");
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
        assert.equal(res.status, 200);
        assert.equal(typeof res.body.skipped, "boolean");
    });

    it("200 with prompt + valid attachmentMeta (3 items, at limit)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({
                prompt: "sito aziendale con tre documenti",
                attachmentMeta: [
                    { filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 512000 },
                    { filename: "logo.png", mimeType: "image/png", sizeBytes: 48000 },
                    { filename: "spec.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 32000 },
                ],
            });
        assert.equal(res.status, 200);
    });

    // ─── Response shape contract ──────────────────────────────────────────────

    it("response always includes all required VibeClassifyResponse fields", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            .send({ prompt: "brochure per agenzia immobiliare" });

        assert.equal(res.status, 200);
        const body = res.body;
        assert.ok("templateId" in body, "must have templateId");
        assert.ok("formatHint" in body, "must have formatHint");
        assert.ok("confidence" in body, "must have confidence");
        assert.ok("reasoning" in body, "must have reasoning");
        assert.ok("skipped" in body, "must have skipped");
        assert.ok(
            body.templateId === null || typeof body.templateId === "string",
            "templateId must be null or string",
        );
        assert.ok(
            body.formatHint === null || typeof body.formatHint === "string",
            "formatHint must be null or string",
        );
        assert.ok(
            body.confidence >= 0 && body.confidence <= 1,
            "confidence must be 0–1",
        );
    });

    // ─── Route does NOT require x-project-id (pre-project endpoint) ───────────

    it("200 without x-project-id header (no sandbox required)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post("/v1/vibecore/classify")
            .set("Authorization", `Bearer ${token}`)
            // Deliberately NOT setting x-project-id
            .send({ prompt: "form di prenotazione ristorante" });
        assert.equal(res.status, 200, "classify must work without x-project-id");
    });

    // ─── Blocked user ─────────────────────────────────────────────────────────

    it("403 when user is blocked", async () => {
        const { getDb } = await import("../../apps/api/src/infra/db/mongo");
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
        assert.equal(res.status, 403);
    });
});
