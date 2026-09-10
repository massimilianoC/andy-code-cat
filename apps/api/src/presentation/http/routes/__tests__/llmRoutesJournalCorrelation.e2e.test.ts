/**
 * E2E test for WP4c of docs/specs/SESSION_TRACING_EXECUTION_PLAN.md.
 *
 * The `generate` stage (`POST /projects/:projectId/llm/chat-preview`) already writes a full
 * `PromptExecutionLog` "pending" row (I11) before the provider call is dispatched, but until this
 * change it never stamped `workSessionId`, `pipelineRunId`, `pipelineStage`, or `endpoint` on that
 * row — all four values were already available in-hand (the request body, `req.workSession`, and
 * the URL the route itself builds for `fetch`) and simply weren't written. Without them a journal
 * row exists but nothing correlates it back to the Vibe request or work session that produced it.
 *
 * This test creates a REAL `PipelineRun` (via the same `/pipeline/launch-workspace` endpoint the
 * app already exposes, so `ResolvePipelineModelLock` itself is exercised, not mocked) and a real
 * `WorkSession` document, then drives `/llm/chat-preview` with both attached. Only the provider's
 * own `/chat/completions` call is stubbed (to a deliberate failure, so the test does not need to
 * fabricate a full structured-artifact reply) — every other network call (catalog
 * discovery/pricing probes) is left to behave exactly as it does in the unmocked
 * llmPromptPreview.e2e.test.ts, so this test isn't hiding behind a blanket fetch mock.
 *
 * The provider call is expected to fail — that's irrelevant to what's being tested here. I11
 * writes the pending row and awaits it BEFORE the provider fetch, so the row (and the four
 * correlation fields on it) exists regardless of what the provider says afterward.
 *
 * Runs against MongoMemoryServer — no Docker required, same strategy as
 * llmPromptPreview.e2e.test.ts and pipelineRoutes.launchWorkspace.e2e.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
// So resolveAuthHeader() finds a key for the (siliconflow) default provider and the route
// proceeds past its "missing API key" guard to the actual pending-journal write + fetch.
process.env.SILICONFLOW_API_KEY = "test-siliconflow-key";

function signToken(userId: string, roles: string[] = ["user"]): string {
    return jwt.sign({ sub: userId, roles }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });
}

const WORK_SESSION_ID = "wp4c-work-session-1";

let mongod: MongoMemoryServer;
let app: Express;
let ownerUserId: string;
let projectId: string;
let realFetch: typeof fetch;

describe("POST /projects/:projectId/llm/chat-preview — journal correlation (WP4c)", () => {
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
            email: "wp4c-owner@example.com",
            passwordHash: "$bcrypt-placeholder",
            emailVerified: true,
            isBlocked: false,
            roles: ["user"],
            createdAt: new Date(),
        });

        await db.collection("projects").insertOne({
            _id: projectOid,
            ownerUserId: ownerOid,
            name: "WP4c Journal Correlation Test Project",
            presetId: "landing",
            createdAt: new Date(),
        });

        ownerUserId = ownerOid.toHexString();
        projectId = projectOid.toHexString();

        // A real, open WorkSession — the exact shape workSessionMiddleware resolves
        // `x-work-session-id` against (apps/api/src/presentation/http/middlewares/workSessionMiddleware.ts).
        await db.collection<{
            _id: string;
            userId: string;
            entryMode: string;
            config: Record<string, unknown>;
            status: string;
            createdAt: Date;
            updatedAt: Date;
        }>("work_sessions").insertOne({
            _id: WORK_SESSION_ID,
            userId: ownerUserId,
            entryMode: "vibe",
            config: {},
            status: "open",
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        realFetch = global.fetch;
    }, 30_000);

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    it("stamps workSessionId, pipelineRunId, pipelineStage, and the real endpoint on the generate journal row", async () => {
        const token = signToken(ownerUserId);

        // A genuine PipelineRun with a frozen modelLock, created the same way Vibe's
        // launch-workspace flow creates one — gives chat-preview's
        // ResolvePipelineModelLock.dispatch() a real run to certify. ResolvePipelineModelLock
        // itself is untouched; this only exercises it as a black box.
        const launchRes = await request(app)
            .post(`/v1/projects/${projectId}/pipeline/launch-workspace`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({
                businessName: "WP4c Test Co",
                primaryGoal: "Verify journal correlation fields.",
                audience: "Engineers writing tracing tests.",
            });
        expect(launchRes.status).toBe(201);
        const pipelineRunId = launchRes.body.pipelineRunId as string;
        expect(pipelineRunId).toBeTruthy();

        // Intercept only the provider call the route itself makes; every other fetch (catalog
        // discovery/pricing probes) passes through to the real implementation, exactly as it
        // behaves in the unmocked llmPromptPreview.e2e.test.ts.
        const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input: unknown, init?: unknown) => {
            const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
            if (url.endsWith("/chat/completions")) {
                return new Response(JSON.stringify({ error: "stubbed provider failure" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                });
            }
            return realFetch(input as never, init as never);
        });

        try {
            const res = await request(app)
                .post(`/v1/projects/${projectId}/llm/chat-preview`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-project-id", projectId)
                .set("x-work-session-id", WORK_SESSION_ID)
                .send({ message: "Generate a simple landing page.", pipelineRunId });

            // The stubbed provider call fails by design (a 500 needs no fabricated structured
            // reply) — irrelevant to this test, which only cares about the pending row I11
            // already writes and awaits BEFORE this fetch is dispatched.
            expect(res.status).toBe(502);
        } finally {
            fetchSpy.mockRestore();
        }

        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        const rows = await db.collection("prompt_execution_logs").find({ pipelineRunId }).toArray();
        expect(rows).toHaveLength(1);
        const row = rows[0]!;

        // These four assertions are the whole point of WP4c: on main (before the fix) all four
        // fields are absent from the write, so this fails there and passes with it.
        expect(row.pipelineStage).toBe("generate");
        expect(row.workSessionId).toBe(WORK_SESSION_ID);
        expect(row.pipelineRunId).toBe(pipelineRunId);
        expect(typeof row.endpoint).toBe("string");
        expect(row.endpoint as string).toMatch(/\/chat\/completions$/);
    }, 30_000);
});
