/**
 * The generation engine persists the turn itself (BACKGROUND_RUNS.md §3.1, Phase 0): with a
 * `conversationId` the assistant message and the version are written server-side through the
 * same AddMessage / CommitArtifactVersion the workspace used to call, so the interactive
 * workspace and the background worker cannot diverge on what a finished turn leaves behind.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";

const TEST_JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.SILICONFLOW_API_KEY = "test-siliconflow-key";

const token = (userId: string) => jwt.sign({ sub: userId, roles: ["user"] }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });

const REPLY = JSON.stringify({
    chat: { summary: "Pagina pronta.", bullets: ["Hero"], nextActions: [] },
    artifacts: { html: "<main><section><h1>Forno Rossi</h1></section></main>", css: "h1{color:#a00}", js: "" },
});

let mongod: MongoMemoryServer;
let app: Express;
let userId: string;
let projectId: string;
let otherProjectConversationId: string;
let conversationId: string;
let realFetch: typeof fetch;

function stubProvider(content: string) {
    return vi.spyOn(global, "fetch").mockImplementation(async (input: unknown, init?: unknown) => {
        const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
        if (url.endsWith("/chat/completions")) {
            const isStream = JSON.parse(String((init as RequestInit)?.body ?? "{}")).stream === true;
            if (!isStream) {
                return new Response(JSON.stringify({
                    choices: [{ message: { content }, finish_reason: "stop" }],
                    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
                }), { status: 200 });
            }
            const encoder = new TextEncoder();
            return new Response(new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\n`));
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}\n\n`));
                    controller.close();
                },
            }), { status: 200 });
        }
        return realFetch(input as never, init as never);
    });
}

async function streamTurn(body: Record<string, unknown>) {
    const res = await request(app)
        .post(`/v1/projects/${projectId}/llm/chat-preview/stream`)
        .set("Authorization", `Bearer ${token(userId)}`)
        .set("x-project-id", projectId)
        .send(body)
        .buffer(true)
        .parse((response, callback) => {
            let data = "";
            response.on("data", (chunk: Buffer) => { data += chunk.toString(); });
            response.on("end", () => callback(null, data));
        });
    const events = String(res.body).split("\n\n").map((b) => b.trim()).filter((b) => b.startsWith("data:"))
        .map((b) => JSON.parse(b.slice(5).trim()) as { type: string; result?: Record<string, unknown> });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions walk the untyped JSON payload
    return { res, done: events.find((event) => event.type === "done")?.result as Record<string, any> | undefined };
}

async function getDb() {
    const mod = await import("../../../../infra/db/mongo");
    return mod.getDb();
}

describe("generation persists its turn", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        app = createApp();
        const db = await getDb();
        const userOid = new ObjectId();
        const projectOid = new ObjectId();
        const otherProjectOid = new ObjectId();
        await db.collection("users").insertOne({ _id: userOid, email: "turn@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() });
        await db.collection("projects").insertMany([
            { _id: projectOid, ownerUserId: userOid, name: "Turn project", presetId: "landing", createdAt: new Date() },
            { _id: otherProjectOid, ownerUserId: userOid, name: "Another project", presetId: "landing", createdAt: new Date() },
        ]);
        userId = userOid.toHexString();
        projectId = projectOid.toHexString();
        const createConv = async (pid: string) => (await request(app)
            .post(`/v1/projects/${pid}/conversations`)
            .set("Authorization", `Bearer ${token(userId)}`)
            .set("x-project-id", pid)
            .send({ title: "t" })).body.conversation.id as string;
        conversationId = await createConv(projectId);
        otherProjectConversationId = await createConv(otherProjectOid.toHexString());
        realFetch = global.fetch;
    }, 60_000);

    afterEach(() => vi.restoreAllMocks());

    afterAll(async () => {
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
    });

    let firstSnapshot: { id: string; metadata: { contentHash: string } };

    it("stream: writes the assistant message and an active version linked to it and to the journal row", async () => {
        stubProvider(REPLY);
        const { res, done } = await streamTurn({ message: "Una landing per un forno", conversationId });
        expect(res.status).toBe(200);
        const persisted = done!.persisted;
        expect(persisted.assistantMessage.role).toBe("assistant");
        expect(persisted.assistantMessage.content).toContain("Pagina pronta.");
        expect(persisted.snapshotCreated).toBe(true);
        expect(persisted.snapshot.isActive).toBe(true);
        expect(persisted.snapshot.artifacts.html).toContain("data-pf-id");
        expect(persisted.snapshot.sourceMessageId).toBe(persisted.assistantMessage.id);
        expect(persisted.snapshot.metadata.promptExecutionId).toBe(done!.promptExecutionId);
        expect(persisted.assistantMessage.metadata.snapshotId).toBe(persisted.snapshot.id);
        firstSnapshot = persisted.snapshot;

        const db = await getDb();
        const conv = await db.collection("conversations").findOne({ _id: conversationId as never });
        const stored = (conv!.messages as Array<{ id: string; role: string; metadata?: { snapshotId?: string; chatStructured?: unknown } }>)
            .find((m) => m.id === persisted.assistantMessage.id);
        expect(stored?.role).toBe("assistant");
        expect(stored?.metadata?.snapshotId).toBe(persisted.snapshot.id);
        expect(stored?.metadata?.chatStructured).toBeTruthy();
        const row = await db.collection("prompt_execution_logs").findOne({ conversationId, status: "succeeded" });
        expect(String(row?._id)).toBe(done!.promptExecutionId);
    });

    it("stream: a stale declared base is reported, the message still saved, nothing activated", async () => {
        stubProvider(REPLY.replace("Forno Rossi", "Forno Bianchi"));
        const { done } = await streamTurn({
            message: "Cambia il titolo",
            conversationId,
            artifactBase: { parentSnapshotId: firstSnapshot.id, baseContentHash: "0".repeat(64) },
        });
        const persisted = done!.persisted;
        expect(persisted.snapshot).toBeUndefined();
        expect(persisted.snapshotError.status).toBe(409);
        expect(persisted.snapshotError.code).toBe("ARTIFACT_BASE_STALE");
        expect(persisted.assistantMessage.role).toBe("assistant");
        const db = await getDb();
        const active = await db.collection("preview_snapshots").findOne({ projectId, isActive: true });
        expect(active?._id).toBe(firstSnapshot.id);
    });

    it("stream: the certified base is accepted and the new version continues the chain", async () => {
        stubProvider(REPLY.replace("Forno Rossi", "Forno Verdi"));
        const { done } = await streamTurn({
            message: "Cambia il titolo",
            conversationId,
            artifactBase: { parentSnapshotId: firstSnapshot.id, baseContentHash: firstSnapshot.metadata.contentHash },
        });
        expect(done!.persisted.snapshot.parentSnapshotId).toBe(firstSnapshot.id);
        expect(done!.persisted.snapshotCreated).toBe(true);
    });

    it("single: an unparseable generation is saved as an error message and produces no version", async () => {
        stubProvider("Non riesco a generare la pagina.");
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${token(userId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing", conversationId });
        expect(res.status).toBe(200);
        expect(res.body.generationParseError).toBe(true);
        expect(res.body.persisted.assistantMessage.role).toBe("error");
        expect(res.body.persisted.snapshot).toBeUndefined();
        expect(res.body.persisted.snapshotError).toBeUndefined();
    });

    it("refuses a conversation of another project before calling the provider", async () => {
        const spy = stubProvider(REPLY);
        const res = await request(app)
            .post(`/v1/projects/${projectId}/llm/chat-preview`)
            .set("Authorization", `Bearer ${token(userId)}`)
            .set("x-project-id", projectId)
            .send({ message: "Una landing", conversationId: otherProjectConversationId });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("CONVERSATION_NOT_FOUND");
        const providerCalls = spy.mock.calls.filter(([input]) => String((input as { url?: string })?.url ?? input).endsWith("/chat/completions"));
        expect(providerCalls).toHaveLength(0);
    });
});
