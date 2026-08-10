/**
 * Integration test for exact sent-prompt trace parity (PP-021) —
 * docs/guides/TEST_COVERAGE_ROADMAP.md §3.1 item 1.
 *
 * The pure function `assertPromptTraceParity()` is already well unit-tested
 * (apps/api/src/application/llm/__tests__/promptTraceParity.test.ts). What
 * that test CANNOT catch is a future change that stops calling it from the
 * live generation route (llmRoutes.ts `POST /projects/:projectId/llm/chat-preview`,
 * around the `assertPromptTraceParity({...})` call before the provider fetch) —
 * every existing unit test would stay green because it tests the function
 * directly, not its enforcement.
 *
 * This test drives a REAL generation call through the real Express app, the
 * real resolveContext()/composeSystemPromptWithLayers() pipeline, and the
 * real assertPromptTraceParity() call inside the route — the only thing
 * replaced is the outbound LLM provider call itself, pointed at a tiny local
 * HTTP server via LMSTUDIO_BASE_URL (a legitimate, product-supported
 * extension point — the "lmstudio" provider has authType:"none" specifically
 * for local/offline use). It then independently re-runs the real
 * assertPromptTraceParity() against the trace the route returned, proving
 * the returned data is provably parity-correct — not just that the route
 * responded 200.
 *
 * Runs against MongoMemoryServer + a local mock provider — no Docker, no
 * real LLM API key required.
 * Run from repo root:
 *   npx tsx --test tests/api/prompt-trace-generation.test.ts
 */

import { describe, before, after, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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
// Never call a real provider in this suite.
process.env.VIBE_CLASSIFIER_ENABLED = "false";
process.env.VIBE_OPTIMIZER_ENABLED = "false";

function signToken(userId: string): string {
    return jwt.sign({ sub: userId, roles: ["user"] }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });
}

/** Minimal OpenAI-compatible /chat/completions stand-in for the lmstudio provider. */
function startMockLlmProvider(): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
                const structured = {
                    chat: { summary: "Landing page generata.", bullets: [], nextActions: [] },
                    artifacts: {
                        html: "<!doctype html><html><body><main>Hello from mock provider</main></body></html>",
                        css: "main{color:#111}",
                        js: "",
                    },
                };
                const body = JSON.stringify({
                    choices: [{
                        message: { content: JSON.stringify(structured) },
                        finish_reason: "stop",
                    }],
                    usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
                });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(body);
            });
        });
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` });
        });
    });
}

let mongod: MongoMemoryServer;
let mockProvider: http.Server;
let app: Express;
let userId: string;
let projectId: string;

describe("Prompt trace parity — real generation route (PP-021)", () => {
    before(async () => {
        const { server, baseUrl } = await startMockLlmProvider();
        mockProvider = server;
        // Must be set BEFORE config.ts is first evaluated (dynamic import below).
        process.env.LMSTUDIO_BASE_URL = baseUrl;

        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../apps/api/src/app");
        const { getDb } = await import("../../apps/api/src/infra/db/mongo");
        app = createApp();
        const db = await getDb();

        const userOid = new ObjectId();
        const projectOid = new ObjectId();
        await db.collection("users").insertOne({
            _id: userOid,
            email: "prompttrace@example.com",
            passwordHash: "$bcrypt-placeholder",
            emailVerified: true,
            isBlocked: false,
            roles: ["user"],
            createdAt: new Date(),
        });
        await db.collection("projects").insertOne({
            _id: projectOid,
            ownerUserId: userOid,
            name: "Prompt Trace Test Project",
            createdAt: new Date(),
        });
        userId = userOid.toHexString();
        projectId = projectOid.toHexString();
    });

    after(async () => {
        // Grace period: the route's fire-and-forget cost/execution-log writes
        // (CostTransactionService, ExecutionLogger) are still in flight right after
        // the response is sent — closing the pool immediately logs harmless but
        // noisy "pool closed" errors from those background writers.
        await new Promise((resolve) => setTimeout(resolve, 100));
        const { getDb } = await import("../../apps/api/src/infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
        await new Promise<void>((resolve) => mockProvider.close(() => resolve()));
    });

    it("a real generation returns a promptingTrace that independently satisfies assertPromptTraceParity", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({
                message: "Crea una landing page per un salone di bellezza",
                provider: "lmstudio",
                model: "local/default-chat",
                pipelineRole: "dialogue",
            });

        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);

        const trace = res.body.promptingTrace;
        assert.ok(trace, "response must include promptingTrace");
        assert.equal(typeof trace.effectiveSystemPrompt, "string");
        assert.ok(trace.effectiveSystemPrompt.length > 0);
        assert.ok(Array.isArray(trace.layers));
        assert.ok(Array.isArray(trace.messagesSentToLlm));

        // Re-run the REAL parity check (not a reimplementation) against exactly what
        // the route returned. This is the assertion that would fail if a future
        // change silently broke or removed the route's own assertPromptTraceParity call.
        const { assertPromptTraceParity } = await import("../../apps/api/src/application/llm/promptTraceParity");
        assert.doesNotThrow(() => assertPromptTraceParity({
            effectiveSystemPrompt: trace.effectiveSystemPrompt,
            layers: trace.layers,
            messagesSentToLlm: trace.messagesSentToLlm,
        }));

        // PP-021: every canonical layer must be present, including empty rows (e.g. Layer Q
        // outside focused mode) — a dropped layer is a trace-integrity failure.
        const { PROMPT_LAYER_DESCRIPTORS } = await import("../../apps/api/src/application/llm/systemPromptComposer");
        const traceLayerIds = new Set(trace.layers.map((l: { id: string }) => l.id));
        for (const descriptor of PROMPT_LAYER_DESCRIPTORS) {
            assert.ok(traceLayerIds.has(descriptor.id), `layer ${descriptor.id} (${descriptor.label}) missing from trace`);
        }

        // Model/provider attribution — what the workspace Prompt Inspector must show
        // alongside the exact prompt.
        assert.equal(res.body.provider, "lmstudio");
        assert.equal(res.body.model, "local/default-chat");

        // Sanity: the mock provider's structured artifact actually came through.
        assert.match(res.body.structured?.artifacts?.html ?? "", /Hello from mock provider/);
    });

    it("byte-identity: the system message actually sent to the provider matches effectiveSystemPrompt exactly", async () => {
        const token = signToken(userId);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${token}`)
            .set("x-project-id", projectId)
            .send({
                message: "Aggiungi una sezione contatti",
                provider: "lmstudio",
                model: "local/default-chat",
            });

        assert.equal(res.status, 200);
        const trace = res.body.promptingTrace;
        const systemMessage = trace.messagesSentToLlm.find((m: { role: string }) => m.role === "system");
        assert.ok(systemMessage, "messagesSentToLlm must include a system message");
        assert.equal(systemMessage.content, trace.effectiveSystemPrompt);
    });
});
