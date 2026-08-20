/**
 * E2E "golden" characterization test for GET /projects/:projectId/llm/prompt-preview
 * (I10 of the SSOT program — see docs/SSOT_REFACTOR_PROGRESS.md).
 *
 * prompt-preview is a dry-run of the EXACT same resolver/composer
 * (`ResolvePromptExecution`, extracted from `llmRoutes.ts`'s former `resolveContext()`) that
 * `/llm/chat-preview` and `/llm/chat-preview/stream` use for 100% of real generation traffic,
 * without making a provider call. That makes it the ideal target for a golden-payload
 * characterization test: it exercises the real composer chain (catalog → preset → moodboard →
 * brand → template skills → layer composition) through the real route and real DI wiring, with
 * no LLM calls involved.
 *
 * `effectiveSystemPrompt` is pinned via `toMatchSnapshot()` for a fixed, minimal project fixture
 * (no moodboard, no assets, no platform config overrides, no brand documents) — this is the
 * "golden hash" the I10 plan called for. Any future increment that touches
 * `ResolvePromptExecution` or the layer composer and unintentionally changes the composed output
 * for this fixture will fail this test.
 *
 * Runs against MongoMemoryServer — no Docker required. Same strategy as costRoutes.e2e.test.ts.
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
let userId: string;
let otherUserId: string;
let projectId: string;

describe("GET /projects/:projectId/llm/prompt-preview", () => {
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
            {
                _id: userOid,
                email: "prompt-preview-owner@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
            {
                _id: otherOid,
                email: "prompt-preview-other@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
        ]);

        // Minimal, fixed fixture: no moodboard, no assets, no platform config overrides, no
        // brand documents. presetId "landing" is a real entry in PRESET_MAP.
        await db.collection("projects").insertOne({
            _id: projectOid,
            ownerUserId: userOid,
            name: "Prompt Preview Golden Test Project",
            presetId: "landing",
            createdAt: new Date(),
        });

        userId = userOid.toHexString();
        otherUserId = otherOid.toHexString();
        projectId = projectOid.toHexString();
    }, 30_000);

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    it("401 without a token", async () => {
        const res = await request(app).get(`/v1/projects/${projectId}/llm/prompt-preview`);
        expect(res.status).toBe(401);
    });

    it("403 when the project does not belong to the caller", async () => {
        const token = signToken(otherUserId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/llm/prompt-preview`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);
        expect(res.status).toBe(403);
    });

    it("200 — dry-run resolves a provider/model and composes a system prompt (golden snapshot)", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/llm/prompt-preview`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);

        expect(res.status).toBe(200);
        expect(res.body.dryRun).toBe(true);
        expect(typeof res.body.provider).toBe("string");
        expect(typeof res.body.model).toBe("string");
        expect(typeof res.body.effectiveSystemPrompt).toBe("string");
        expect(res.body.effectiveSystemPrompt.length).toBeGreaterThan(0);
        expect(Array.isArray(res.body.layers)).toBe(true);
        expect(typeof res.body.tokenEstimate).toBe("number");

        // Golden characterization: pins the exact composed text for this fixed fixture. A
        // change here means either (a) an intentional layer-composition change — update the
        // snapshot deliberately in the same PR that made the change — or (b) an accidental
        // regression in ResolvePromptExecution / composeSystemPromptWithLayers.
        expect(res.body.effectiveSystemPrompt).toMatchSnapshot();
        expect(res.body.layers).toMatchSnapshot();
    }, 30_000);

    it("200 — pipelineRole/provider/model/capability query params are honored without throwing", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .get(`/v1/projects/${projectId}/llm/prompt-preview`)
            .query({ pipelineRole: "dialogue", uiLanguage: "it" })
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId);

        expect(res.status).toBe(200);
        // Layer L (output language) should reflect the request-provided UI language when the
        // project itself has no persisted outputLanguage.
        const layerL = res.body.layers.find((layer: { id: string }) => layer.id === "L");
        expect(layerL?.source).toBe("request-ui-language");
    }, 30_000);
});
