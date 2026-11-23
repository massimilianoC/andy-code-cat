/**
 * Characterisation tests for the generation core of
 *   POST /v1/projects/:projectId/llm/chat-preview
 *   POST /v1/projects/:projectId/llm/chat-preview/stream
 *
 * Written BEFORE the core was extracted into the `GenerateArtifact` use case
 * (docs/specs/BACKGROUND_RUNS.md §3.1, Phase 0) so the extraction can be proven to change nothing
 * the client or the journal can observe: the response body, the SSE event sequence, the journal
 * row, the cost ledger entry, the interrupted path and the error codes.
 *
 * Only the provider's own `/chat/completions` call is stubbed; every other fetch (catalog
 * discovery) passes through, as in llmRoutesJournalCorrelation.e2e.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

const TEST_JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
const TEST_JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = TEST_JWT_REFRESH_SECRET;
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.SILICONFLOW_API_KEY = "test-siliconflow-key";

function signToken(userId: string, roles: string[] = ["user"]): string {
    return jwt.sign({ sub: userId, roles }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });
}

const STRUCTURED_REPLY = {
    chat: {
        summary: "Ho creato una landing page per il forno.",
        bullets: ["Hero con call to action", "Sezione prodotti"],
        nextActions: ["Aggiungi le foto"],
    },
    artifacts: {
        html: "<main><section class=\"hero\"><h1>Forno Rossi</h1><p>Pane fresco ogni mattina.</p></section></main>",
        css: ".hero { padding: 2rem; }",
        js: "",
    },
};
const STRUCTURED_TEXT = JSON.stringify(STRUCTURED_REPLY);

let mongod: MongoMemoryServer;
let app: Express;
let ownerUserId: string;
let otherUserId: string;
let projectId: string;
let realFetch: typeof fetch;

function urlOf(input: unknown): string {
    return typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
}

function stubProvider(handler: (init: RequestInit | undefined) => Response | Promise<Response>) {
    return vi.spyOn(global, "fetch").mockImplementation(async (input: unknown, init?: unknown) => {
        if (urlOf(input).endsWith("/chat/completions")) {
            return handler(init as RequestInit | undefined);
        }
        return realFetch(input as never, init as never);
    });
}

function jsonProviderReply(content: string, finishReason = "stop") {
    return new Response(JSON.stringify({
        choices: [{ message: { content }, finish_reason: finishReason }],
        usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function sseProviderReply(content: string, thinking = "Penso alla struttura.") {
    const encoder = new TextEncoder();
    const chunks = [
        { choices: [{ delta: { reasoning_content: thinking } }] },
        { choices: [{ delta: { content: content.slice(0, 40) } }] },
        { choices: [{ delta: { content: content.slice(40) }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 } },
    ];
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
        },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function parseSse(text: string): Array<Record<string, unknown>> {
    return text
        .split("\n\n")
        .map((block) => block.trim())
        .filter((block) => block.startsWith("data:"))
        .map((block) => JSON.parse(block.slice(5).trim()) as Record<string, unknown>);
}

/** Strip the values that legitimately differ between two runs of the same request. */
function stable(result: Record<string, unknown>) {
    const { durationMs, promptExecutionId, ...rest } = result;
    expect(typeof durationMs).toBe("number");
    expect(typeof promptExecutionId).toBe("string");
    // The project id is generated per run and appears inside promptConfigId.
    return JSON.parse(JSON.stringify(rest).split(projectId).join("<projectId>")) as Record<string, unknown>;
}

async function db() {
    const { getDb } = await import("../../../../infra/db/mongo");
    return getDb();
}

describe("chat-preview generation core — characterisation", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        app = createApp();
        const database = await db();

        const ownerOid = new ObjectId();
        const otherOid = new ObjectId();
        const projectOid = new ObjectId();
        await database.collection("users").insertMany([
            { _id: ownerOid, email: "char-owner@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() },
            { _id: otherOid, email: "char-other@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() },
        ]);
        await database.collection("projects").insertOne({
            _id: projectOid,
            ownerUserId: ownerOid,
            name: "Characterisation project",
            presetId: "landing",
            createdAt: new Date(),
        });
        ownerUserId = ownerOid.toHexString();
        otherUserId = otherOid.toHexString();
        projectId = projectOid.toHexString();
        realFetch = global.fetch;
    }, 60_000);

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        const database = await db();
        await database.client.close(true);
        await mongod.stop();
    });

    it("403 for a project the caller does not own, before any provider call", async () => {
        const spy = stubProvider(() => jsonProviderReply(STRUCTURED_TEXT));
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${signToken(otherUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing" });
        expect(res.status).toBe(403);
        expect(spy.mock.calls.filter(([input]) => urlOf(input).endsWith("/chat/completions"))).toHaveLength(0);
    });

    it("400 for an invalid body", async () => {
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "" });
        expect(res.status).toBe(400);
    });

    it("non-stream: result, journal row, cost ledger and execution log", async () => {
        let providerBody: Record<string, unknown> | undefined;
        stubProvider((init) => {
            providerBody = JSON.parse(String(init?.body ?? "{}"));
            return jsonProviderReply(STRUCTURED_TEXT);
        });
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing per un forno", idempotencyKey: "char-single-1", temperature: 0.4 });

        expect(res.status).toBe(200);
        expect(providerBody?.stream).toBeUndefined();
        expect(providerBody?.temperature).toBe(0.4);
        expect(Array.isArray(providerBody?.messages)).toBe(true);

        const body = res.body as Record<string, unknown>;
        expect(body.structuredParseValid).toBe(true);
        expect(body.finishReason).toBe("stop");
        expect(body.usage).toEqual({ promptTokens: 1200, completionTokens: 300, totalTokens: 1500 });
        expect((body.structured as { artifacts: { html: string } }).artifacts.html).toContain("Forno Rossi");
        expect(stable(body)).toMatchSnapshot();

        const database = await db();
        const row = await database.collection("prompt_execution_logs").findOne({ idempotencyKey: "char-single-1" });
        expect(row?.status).toBe("succeeded");
        expect(row?.taskKey).toBe("chat");
        expect(row?.pipelineStage).toBe("generate");
        expect(row?.rawResponse).toBe(STRUCTURED_TEXT);
        expect(row?.reasoningTrace).toBeUndefined();
        expect(String(row?._id)).toBe(body.promptExecutionId);

        // The ledger write is fire-and-forget: give it a moment.
        await vi.waitFor(async () => {
            const tx = await database.collection("cost_transactions").findOne({ projectId, "meta.streaming": { $exists: false } });
            expect(tx?.resourceType).toBe("llm.chat");
        });
    });

    it("non-stream: a duplicate idempotency key is refused with 409 and no second provider call", async () => {
        const spy = stubProvider(() => jsonProviderReply(STRUCTURED_TEXT));
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing per un forno", idempotencyKey: "char-single-1" });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("DUPLICATE_REQUEST");
        expect(spy.mock.calls.filter(([input]) => urlOf(input).endsWith("/chat/completions"))).toHaveLength(0);
    });

    it("non-stream: provider failure is 502 LLM_PROVIDER_REQUEST_FAILED and the journal row is failed", async () => {
        stubProvider(() => new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } }));
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing", idempotencyKey: "char-single-fail" });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe("LLM_PROVIDER_REQUEST_FAILED");
        const database = await db();
        await vi.waitFor(async () => {
            const row = await database.collection("prompt_execution_logs").findOne({ idempotencyKey: "char-single-fail" });
            expect(row?.status).toBe("failed");
        });
    });

    it("non-stream: an empty provider reply is 502 LLM_PROVIDER_EMPTY_RESPONSE", async () => {
        stubProvider(() => jsonProviderReply(""));
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing" });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe("LLM_PROVIDER_EMPTY_RESPONSE");
    });

    it("non-stream: an unparseable reply is a parse failure, not an artifact", async () => {
        stubProvider(() => jsonProviderReply("Mi dispiace, non posso."));
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing" });
        expect(res.status).toBe(200);
        expect(res.body.structuredParseValid).toBe(false);
        expect(res.body.generationParseError).toBe(true);
        expect(stable(res.body)).toMatchSnapshot();
    });

    it("stream: SSE sequence thinking → answer → done, same result as the single call", async () => {
        let providerBody: Record<string, unknown> | undefined;
        stubProvider((init) => {
            providerBody = JSON.parse(String(init?.body ?? "{}"));
            return sseProviderReply(STRUCTURED_TEXT);
        });
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview/stream`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing per un forno", idempotencyKey: "char-stream-1", temperature: 0.4 })
            .buffer(true)
            .parse((response, callback) => {
                let data = "";
                response.on("data", (chunk: Buffer) => { data += chunk.toString(); });
                response.on("end", () => callback(null, data));
            });

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(providerBody?.stream).toBe(true);
        const events = parseSse(res.body as string);
        expect(events.map((event) => event.type)).toEqual(["thinking", "answer", "answer", "media_progress", "done"]);
        expect(events[0]).toEqual({ type: "thinking", content: "Penso alla struttura." });
        expect(events.slice(1, 3).map((event) => event.content).join("")).toBe(STRUCTURED_TEXT);

        expect(events[3]).toMatchSnapshot();
        const result = events[4]!.result as Record<string, unknown>;
        expect(result.structuredParseValid).toBe(true);
        expect(result.usage).toEqual({ promptTokens: 1200, completionTokens: 300, totalTokens: 1500 });
        expect(stable(result)).toMatchSnapshot();

        const database = await db();
        const row = await database.collection("prompt_execution_logs").findOne({ idempotencyKey: "char-stream-1" });
        expect(row?.status).toBe("succeeded");
        expect(row?.rawResponse).toBe(STRUCTURED_TEXT);
        expect(row?.reasoningTrace).toBeNull();
        await vi.waitFor(async () => {
            const tx = await database.collection("cost_transactions").findOne({ projectId, "meta.streaming": true });
            expect(tx?.resourceType).toBe("llm.chat");
        });
    });

    it("stream: a provider 429 before the stream starts is a plain HTTP 429", async () => {
        stubProvider(() => new Response("rate limited", { status: 429 }));
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview/stream`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing", idempotencyKey: "char-stream-429" });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe("LLM_PROVIDER_RATE_LIMIT");
        const database = await db();
        await vi.waitFor(async () => {
            const row = await database.collection("prompt_execution_logs").findOne({ idempotencyKey: "char-stream-429" });
            expect(row?.status).toBe("failed");
        });
    });

    it("stream: a truncated call keeps the reasoning trace", async () => {
        stubProvider(() => {
            const encoder = new TextEncoder();
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Ragiono a lungo." } }] })}\n\n`));
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: STRUCTURED_TEXT }, finish_reason: "length" }] })}\n\n`));
                    controller.close();
                },
            });
            return new Response(body, { status: 200 });
        });
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview/stream`)
            .set("Authorization", `Bearer ${signToken(ownerUserId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing", idempotencyKey: "char-stream-length" })
            .buffer(true)
            .parse((response, callback) => {
                let data = "";
                response.on("data", (chunk: Buffer) => { data += chunk.toString(); });
                response.on("end", () => callback(null, data));
            });
        const events = parseSse(res.body as string);
        expect(events.at(-1)?.type).toBe("done");
        const database = await db();
        const row = await database.collection("prompt_execution_logs").findOne({ idempotencyKey: "char-stream-length" });
        expect(row?.finishReason).toBe("length");
        expect(row?.reasoningTrace).toBe("Ragiono a lungo.");
    });

    it("stream: a client that disconnects mid-stream aborts the provider call and leaves an interrupted row", async () => {
        let providerSignal: AbortSignal | undefined;
        stubProvider((init) => {
            providerSignal = init?.signal ?? undefined;
            const encoder = new TextEncoder();
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Inizio." } }] })}\n\n`));
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "{\"chat\":" } }] })}\n\n`));
                    // never closes: only an abort ends this body
                    providerSignal?.addEventListener("abort", () => {
                        controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
                    });
                },
            });
            return new Response(body, { status: 200 });
        });

        const server: Server = app.listen(0);
        try {
            const port = (server.address() as AddressInfo).port;
            const client = new AbortController();
            const response = await realFetch(`http://127.0.0.1:${port}/v1/projects/${projectId}/llm/chat-preview/stream`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${signToken(ownerUserId)}`,
                    "x-project-id": projectId,
                },
                body: JSON.stringify({ message: "Una landing", idempotencyKey: "char-stream-abort" }),
                signal: client.signal,
            });
            expect(response.status).toBe(200);
            const reader = response.body!.getReader();
            await reader.read();
            client.abort();
            await reader.cancel().catch(() => undefined);

            await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true), { timeout: 5000 });
            const database = await db();
            await vi.waitFor(async () => {
                const row = await database.collection("prompt_execution_logs").findOne({ idempotencyKey: "char-stream-abort" });
                expect(row?.status).toBe("failed");
                expect(row?.finishReason).toBe("interrupted");
                expect(row?.rawResponse).toBe("{\"chat\":");
                expect(row?.reasoningTrace).toBe("Inizio.");
            }, { timeout: 5000 });
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
