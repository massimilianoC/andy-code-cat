/**
 * E2E tests for the Session Inspector's two read endpoints
 * (docs/specs/SESSION_INSPECTOR_SPEC.md §2):
 *   GET /v1/projects/:projectId/work-sessions
 *   GET /v1/projects/:projectId/work-sessions/:workSessionId
 *
 * Runs against MongoMemoryServer — no Docker required. Same strategy as
 * pipelineRunRoutes.e2e.test.ts / costRoutes.e2e.test.ts: seed collections directly, sign JWTs
 * locally, exercise the real Express app.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";
import type { Db } from "mongodb";
import { randomUUID } from "crypto";

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

// A stand-in for the ~50,000-char system prompt the spec warns about — long enough that
// accidentally including it in the list response would be obvious, and distinctive enough to
// grep for.
const HUGE_SYSTEM_PROMPT = "SYSTEM_PROMPT_MARKER_" + "x".repeat(200);
const RAW_RESPONSE_MARKER = "RAW_RESPONSE_MARKER_abc123";

let mongod: MongoMemoryServer;
let app: Express;
let db: Db;
let ownerUserId: string;
let otherUserId: string;
let projectId: string;
let sessionAId: string; // owner's session — completed, truncated call, has vibe intake + proposal
let sessionBId: string; // owner's session — no pipeline runs / logs at all (still-open vibe session)
let otherUserSessionId: string; // otherUser's session, same projectId — must never surface to owner

describe("Work Session Routes E2E (Session Inspector backend)", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");

        app = createApp();
        db = await getDb();

        const usersCol = db.collection("users");
        const projectsCol = db.collection("projects");

        const ownerOid = new ObjectId();
        const otherOid = new ObjectId();
        const projectOid = new ObjectId();

        await usersCol.insertMany([
            {
                _id: ownerOid,
                email: "worksession-owner@example.com",
                passwordHash: "$bcrypt-placeholder",
                emailVerified: true,
                isBlocked: false,
                roles: ["user"],
                createdAt: new Date(),
            },
            {
                _id: otherOid,
                email: "worksession-other@example.com",
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
            name: "Work Session Test Project",
            createdAt: new Date(),
        });

        ownerUserId = ownerOid.toHexString();
        otherUserId = otherOid.toHexString();
        projectId = projectOid.toHexString();

        sessionAId = randomUUID();
        sessionBId = randomUUID();
        otherUserSessionId = randomUUID();

        const now = new Date();
        const earlier = new Date(now.getTime() - 60_000);

        // These collections store string (UUID) _ids in production (see MongoWorkSessionRepository
        // et al.) rather than the driver's default ObjectId — `as any` sidesteps the mismatch
        // between the default `Collection<Document>` typing (which infers `_id: ObjectId`) and the
        // real, string-keyed documents these repositories write.
        await db.collection<any>("work_sessions").insertMany([
            {
                _id: sessionAId,
                userId: ownerUserId,
                projectId,
                entryMode: "vibe",
                config: {},
                status: "completed",
                createdAt: earlier,
                updatedAt: earlier,
            },
            {
                _id: sessionBId,
                userId: ownerUserId,
                projectId,
                entryMode: "workspace",
                config: {},
                status: "open",
                createdAt: now,
                updatedAt: now,
            },
            {
                _id: otherUserSessionId,
                userId: otherUserId,
                projectId,
                entryMode: "vibe",
                config: {},
                status: "completed",
                createdAt: now,
                updatedAt: now,
            },
        ]);

        await db.collection<any>("vibe_intakes").insertOne({
            _id: randomUUID(),
            workSessionId: sessionAId,
            userId: ownerUserId,
            projectId,
            prompt: "make me a bakery site with a warm, hand-drawn feel",
            attachments: [{ filename: "moodboard.png", mimeType: "image/png", sizeBytes: 12345 }],
            requestedProvider: undefined,
            requestedModel: undefined,
            promptExecutionLogIds: [],
            createdAt: earlier,
        });

        await db.collection<any>("zero_effort_form_proposals").insertOne({
            _id: randomUUID(),
            workSessionId: sessionAId,
            userId: ownerUserId,
            projectId,
            prefilled: { businessName: "Proposed Bakery" },
            editedFields: ["businessName"],
            briefContentHash: "hash-abc123",
            createdAt: earlier,
        });

        const pipelineRunId = randomUUID();
        await db.collection<any>("pipeline_runs").insertOne({
            _id: pipelineRunId,
            projectId,
            ownerUserId,
            entryMode: "vibe",
            workSessionId: sessionAId,
            modelLock: {
                policy: "legacy",
                requested: { providerId: "siliconflow", modelId: "test-model", catalogRevision: "rev1" },
                effective: { providerId: "siliconflow", modelId: "test-model" },
                selectedAt: earlier.toISOString(),
                selectedBy: "user",
            },
            optimizationPolicy: "skip",
            canonicalBrief: {
                schemaVersion: "canonical-brief-v1",
                content: "Bake fresh bread daily. " + HUGE_SYSTEM_PROMPT,
                contentHash: "brief-hash-xyz",
                provenance: ["vibe"],
                sourceFields: { businessName: "Confirmed Bakery" },
                builtAt: earlier.toISOString(),
            },
            status: "completed",
            stages: [
                {
                    stage: "generate",
                    taskKey: "task-1",
                    decision: { version: "model-selection-v1", policy: "legacy", requested: { source: "default", catalogRevision: "rev1" }, outcome: "resolved", trail: [], decidedAt: earlier.toISOString() },
                    status: "completed",
                    startedAt: earlier.toISOString(),
                    completedAt: earlier.toISOString(),
                },
            ],
            createdAt: earlier,
            updatedAt: earlier,
        });

        await db.collection<any>("prompt_execution_logs").insertOne({
            _id: randomUUID(),
            taskKey: "task-1",
            projectId,
            userId: ownerUserId,
            workSessionId: sessionAId,
            pipelineRunId,
            pipelineStage: "generate",
            endpoint: "https://api.siliconflow.com/v1/chat/completions",
            provider: "siliconflow",
            model: "test-model",
            inputPrompt: "user input",
            renderedSystemPrompt: HUGE_SYSTEM_PROMPT,
            renderedUserPrompt: "rendered user prompt",
            contextMeta: { usedMoodboard: false, usedUserProfile: false, assetIds: ["asset-1", "asset-2"] },
            usage: { promptTokens: 100, completionTokens: 32768, totalTokens: 32868 },
            costEstimate: { amount: 0.42, currency: "EUR" },
            status: "succeeded",
            finishReason: "length",
            reasoningTrace: "thinking about bread...",
            rawResponse: RAW_RESPONSE_MARKER,
            durationMs: 4321,
            createdAt: earlier,
        });

        await db.collection<any>("cost_transactions").insertOne({
            _id: randomUUID(),
            txId: "TX-20260101-AAAAAAAA",
            userId: ownerUserId,
            projectId,
            resourceType: "llm.chat",
            providerCostUsd: 0.4,
            providerCostEur: 0.37,
            infraCostEur: 0.02,
            platformMarkupEur: 0.03,
            totalEur: 0.42,
            ratesSnapshot: {
                usdToEurRate: 0.92,
                platformMarkupPct: 0.1,
                infraCostPct: 0.05,
                textEurPer1kTokens: 0.001,
                imageEurPerAsset: 0,
                videoEurPerAsset: 0,
            },
            units: { promptTokens: 100, completionTokens: 32768, totalTokens: 32868 },
            sourceRef: { workSessionId: sessionAId },
            meta: {},
            status: "settled",
            createdAt: earlier,
        });
    });

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const dbHandle = await getDb();
        await dbHandle.client.close(true);
        await mongod.stop();
    });

    describe("GET /v1/projects/:projectId/work-sessions", () => {
        it("401 without a token", async () => {
            const res = await request(app).get(`/v1/projects/${projectId}/work-sessions`);
            expect(res.status).toBe(401);
        });

        it("403 when x-project-id does not belong to the caller", async () => {
            const token = signToken(otherUserId);
            const res = await request(app)
                .get(`/v1/projects/${projectId}/work-sessions`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-project-id", projectId);
            // otherUser does not own this project, so sandboxMiddleware rejects before any
            // work-session ownership check runs.
            expect(res.status).toBe(403);
        });

        it("200: lists the project's sessions, newest first, WITHOUT any prompt bodies", async () => {
            const token = signToken(ownerUserId);
            const res = await request(app)
                .get(`/v1/projects/${projectId}/work-sessions`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-project-id", projectId);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.sessions)).toBe(true);

            // Only the owner's two sessions — otherUser's session (same projectId) must not appear.
            const ids = res.body.sessions.map((s: { id: string }) => s.id);
            expect(ids).toContain(sessionAId);
            expect(ids).toContain(sessionBId);
            expect(ids).not.toContain(otherUserSessionId);

            // Newest first: sessionB was created after sessionA.
            expect(ids[0]).toBe(sessionBId);
            expect(ids[1]).toBe(sessionAId);

            const summaryA = res.body.sessions.find((s: { id: string }) => s.id === sessionAId);
            expect(summaryA.entryMode).toBe("vibe");
            expect(summaryA.status).toBe("completed");
            expect(typeof summaryA.createdAt).toBe("string");
            expect(summaryA.stages).toEqual(["generate"]);
            expect(summaryA.totalCostEur).toBeCloseTo(0.42, 5);
            expect(summaryA.totalDurationMs).toBe(4321);
            expect(summaryA.truncated).toBe(true); // finishReason: "length"

            const summaryB = res.body.sessions.find((s: { id: string }) => s.id === sessionBId);
            expect(summaryB.stages).toEqual([]);
            expect(summaryB.totalCostEur).toBe(0);
            expect(summaryB.totalDurationMs).toBe(0);
            expect(summaryB.truncated).toBe(false);

            // The whole point of the list endpoint: no prompt bodies anywhere in the payload.
            const raw = JSON.stringify(res.body);
            expect(raw).not.toContain(HUGE_SYSTEM_PROMPT);
            expect(raw).not.toContain(RAW_RESPONSE_MARKER);
            expect(raw.includes("renderedSystemPrompt")).toBe(false);
            expect(raw.includes("rawResponse")).toBe(false);
            expect(raw.includes("canonicalBrief")).toBe(false);
        });
    });

    describe("GET /v1/projects/:projectId/work-sessions/:workSessionId", () => {
        it("401 without a token", async () => {
            const res = await request(app).get(`/v1/projects/${projectId}/work-sessions/${sessionAId}`);
            expect(res.status).toBe(401);
        });

        it("404 for a session belonging to another user (not 403 — indistinguishable from not-found)", async () => {
            const token = signToken(ownerUserId);
            const res = await request(app)
                .get(`/v1/projects/${projectId}/work-sessions/${otherUserSessionId}`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-project-id", projectId);
            expect(res.status).toBe(404);
        });

        it("404 for a session id that does not exist at all", async () => {
            const token = signToken(ownerUserId);
            const res = await request(app)
                .get(`/v1/projects/${projectId}/work-sessions/${randomUUID()}`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-project-id", projectId);
            expect(res.status).toBe(404);
        });

        it("200: returns the full session, INCLUDING prompt bodies, brief, and cost rows", async () => {
            const token = signToken(ownerUserId);
            const res = await request(app)
                .get(`/v1/projects/${projectId}/work-sessions/${sessionAId}`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-project-id", projectId);

            expect(res.status).toBe(200);
            const session = res.body.session;
            expect(session.id).toBe(sessionAId);
            expect(session.entryMode).toBe("vibe");

            // Vibe intake — byte-identical prompt.
            expect(session.vibeIntakes).toHaveLength(1);
            expect(session.vibeIntakes[0].prompt).toBe("make me a bakery site with a warm, hand-drawn feel");
            expect(session.vibeIntakes[0].attachments[0].filename).toBe("moodboard.png");

            // Zero Effort proposal — prefilled vs edited fields.
            expect(session.zeroEffortFormProposals).toHaveLength(1);
            expect(session.zeroEffortFormProposals[0].editedFields).toEqual(["businessName"]);
            expect(session.zeroEffortFormProposals[0].prefilled.businessName).toBe("Proposed Bakery");

            // Pipeline run — canonicalBrief is the one true owner of the brief text.
            expect(session.pipelineRuns).toHaveLength(1);
            expect(session.pipelineRuns[0].canonicalBrief.content).toContain(HUGE_SYSTEM_PROMPT);
            expect(session.pipelineRuns[0].canonicalBrief.contentHash).toBe("brief-hash-xyz");
            expect(session.pipelineRuns[0].canonicalBrief.sourceFields.businessName).toBe("Confirmed Bakery");

            // Journal row — full prompt bodies, finishReason, endpoint, usage, contextAssetIds.
            expect(session.promptExecutionLogs).toHaveLength(1);
            const log = session.promptExecutionLogs[0];
            expect(log.renderedSystemPrompt).toBe(HUGE_SYSTEM_PROMPT);
            expect(log.rawResponse).toBe(RAW_RESPONSE_MARKER);
            expect(log.reasoningTrace).toBe("thinking about bread...");
            expect(log.finishReason).toBe("length");
            expect(log.endpoint).toBe("https://api.siliconflow.com/v1/chat/completions");
            expect(log.usage.totalTokens).toBe(32868);
            expect(log.contextAssetIds).toEqual(["asset-1", "asset-2"]);

            // Cost rows.
            expect(session.costTransactions).toHaveLength(1);
            expect(session.costTransactions[0].totalEur).toBeCloseTo(0.42, 5);
        });

        it("200: a session with no pipeline activity yet returns empty arrays, not errors", async () => {
            const token = signToken(ownerUserId);
            const res = await request(app)
                .get(`/v1/projects/${projectId}/work-sessions/${sessionBId}`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-project-id", projectId);

            expect(res.status).toBe(200);
            expect(res.body.session.vibeIntakes).toEqual([]);
            expect(res.body.session.zeroEffortFormProposals).toEqual([]);
            expect(res.body.session.pipelineRuns).toEqual([]);
            expect(res.body.session.promptExecutionLogs).toEqual([]);
            expect(res.body.session.costTransactions).toEqual([]);
        });
    });
});
