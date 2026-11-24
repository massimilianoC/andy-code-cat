/**
 * A background run end to end (BACKGROUND_RUNS.md Phase 2–3): the real app and the real worker
 * composition against MongoMemoryServer, with only the LLM provider stubbed at `fetch`.
 *
 * POST /v1/background-runs → the worker runs classify, prefill, launch, generation, version and
 * publish through the same stages the interactive flow uses → the run is done, the site is live,
 * the notice is in the inbox. Also: an id of someone else's run gives nothing, the per-user limit,
 * and a resumed generation step that finds its turn already persisted does not pay again.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import type { Express } from "express";
import type { BackgroundRunDto } from "@andy-code-cat/contracts";

const TEST_JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "andy-bgrun-"));
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = TEST_JWT_ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.SILICONFLOW_API_KEY = "test-siliconflow-key";
process.env.DATA_DIR = DATA_DIR;
process.env.STORAGE_ADAPTER = "local";
process.env.VIBE_CLASSIFIER_ENABLED = "true";
process.env.BACKGROUND_RUN_MAX_PER_USER = "2";

const token = (userId: string) => jwt.sign({ sub: userId, roles: ["user"] }, TEST_JWT_ACCESS_SECRET, { expiresIn: "1h" });

// One reply for both non-streamed Vibe calls: classify reads templateId/confidence, prefill the brief fields.
const PREFILL_REPLY = JSON.stringify({
    templateId: "landing",
    formatHint: null,
    confidence: 0.9,
    reasoning: "Una landing di presentazione.",
    businessName: "Forno Rossi",
    presetId: "landing",
    primaryGoal: "Far conoscere il forno di quartiere e portare clienti in negozio",
    audience: "Famiglie del quartiere",
    tone: "caldo",
    primaryCta: "Vieni a trovarci",
    outputLanguage: "it",
});
const GENERATION_REPLY = JSON.stringify({
    chat: { summary: "Landing pronta.", bullets: ["Hero"], nextActions: [] },
    artifacts: { html: "<main><section><h1>Forno Rossi</h1></section></main>", css: "h1{color:#a00}", js: "" },
});

let mongod: MongoMemoryServer;
let app: Express;
let owner: string;
let stranger: string;
let realFetch: typeof fetch;
const calls = { vibe: 0, generation: 0 };

function stubProvider() {
    return vi.spyOn(global, "fetch").mockImplementation(async (input: unknown, init?: unknown) => {
        const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
        if (!url.endsWith("/chat/completions")) return realFetch(input as never, init as never);
        const isStream = JSON.parse(String((init as RequestInit)?.body ?? "{}")).stream === true;
        if (!isStream) {
            calls.vibe += 1;
            return new Response(JSON.stringify({
                choices: [{ message: { content: PREFILL_REPLY }, finish_reason: "stop" }],
                usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            }), { status: 200 });
        }
        calls.generation += 1;
        const encoder = new TextEncoder();
        return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: GENERATION_REPLY }, finish_reason: "stop" }] })}\n\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}\n\n`));
                controller.close();
            },
        }), { status: 200 });
    });
}

async function getDb() {
    const mod = await import("../../../infra/db/mongo");
    return mod.getDb();
}

async function runWorkerOnce() {
    const { MongoBackgroundRunRepository } = await import("../../../infra/repositories/MongoBackgroundRunRepository");
    const { BackgroundRunEngine } = await import("../BackgroundRunEngine");
    const { BackgroundRunWorker } = await import("../BackgroundRunWorker");
    const { composeBackgroundRunSteps } = await import("../../../background/composeBackgroundRunSteps");
    const repository = new MongoBackgroundRunRepository();
    const engine = new BackgroundRunEngine(repository, composeBackgroundRunSteps(repository), { maxCostEur: 5, maxAttempts: 5 });
    const worker = new BackgroundRunWorker(repository, engine, { workerId: "test-worker", poolSize: 2, leaseMs: 30_000, pollMs: 1_000 });
    await worker.tick();
    await worker.drain();
}

async function getRun(id: string, userId = owner) {
    return request(app).get(`/v1/background-runs/${id}`).set("Authorization", `Bearer ${token(userId)}`);
}

describe("background run — the Vibe flow carried by the worker", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../app");
        app = createApp();
        const db = await getDb();
        const ownerOid = new ObjectId();
        const strangerOid = new ObjectId();
        await db.collection("users").insertMany([
            { _id: ownerOid, email: "owner@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() },
            { _id: strangerOid, email: "stranger@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() },
        ]);
        owner = ownerOid.toHexString();
        stranger = strangerOid.toHexString();
        realFetch = global.fetch;
    }, 60_000);

    afterEach(() => vi.restoreAllMocks());

    afterAll(async () => {
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    let runId: string;
    let projectId: string;

    it("start: creates the run's own project and queues the run, returning at once", async () => {
        const res = await request(app)
            .post("/v1/background-runs")
            .set("Authorization", `Bearer ${token(owner)}`)
            .send({ prompt: "Una landing per il Forno Rossi, pane e dolci di quartiere", uiLanguage: "it" });
        expect(res.status).toBe(201);
        const run = res.body.run as BackgroundRunDto;
        expect(run.status).toBe("queued");
        expect(run.estimate.totalMs).toBeGreaterThan(0);
        expect(run.estimate.steps.generating.basis).toBe("default");
        runId = run.id;
        projectId = run.projectId;

        const project = await request(app).get(`/v1/projects/${projectId}`)
            .set("Authorization", `Bearer ${token(owner)}`).set("x-project-id", projectId);
        expect(project.status).toBe(200);
    });

    it("an id is not a credential: another user cannot read, list or cancel the run", async () => {
        expect((await getRun(runId, stranger)).status).toBe(404);
        const cancel = await request(app).post(`/v1/background-runs/${runId}/cancel`).set("Authorization", `Bearer ${token(stranger)}`);
        expect(cancel.status).toBe(404);
        const list = await request(app).get("/v1/background-runs").set("Authorization", `Bearer ${token(stranger)}`);
        expect(list.body.runs).toEqual([]);
        expect((await getRun(runId)).body.run.cancelRequested).toBe(false);
        expect((await request(app).get(`/v1/background-runs/${runId}`)).status).toBe(401);
    });

    it("the worker carries the whole flow: brief, launch, generation, active version, live site, notice", async () => {
        stubProvider();
        await runWorkerOnce();

        const run = (await getRun(runId)).body.run as BackgroundRunDto;
        expect(run.error).toBeUndefined();
        expect(run.status).toBe("done");
        expect(run.projectName).toBe("Forno Rossi");
        expect(run.conversationId).toBeTruthy();
        expect(run.site?.publicUrl).toContain(run.site!.publishId);
        expect(run.site?.proposedSlug).toBe("forno-rossi");
        expect(run.transitions.filter((t) => t.phase === "completed").map((t) => t.status)).toEqual([
            "queued", "classifying", "briefing", "launching", "generating", "snapshotting", "publishing",
        ]);
        expect(calls.generation).toBe(1);
        expect(calls.vibe).toBe(2); // classify + prefill

        const db = await getDb();
        const stored = await db.collection("background_runs").findOne({ _id: runId as never });
        // The run launched through the one launch path, with the brief the prefill drafted.
        // Classification applied the preset it picked, as the home does.
        const project = await db.collection("projects").findOne({ _id: new ObjectId(projectId) });
        expect(project?.presetId).toBe("landing");
        const pipelineRun = await db.collection("pipeline_runs").findOne({ projectId });
        expect(pipelineRun?.optimizationPolicy).toBe("skip");
        expect(pipelineRun?.canonicalBrief?.content).toContain("Famiglie del quartiere");
        // The generation is the workspace auto-send: the brief as the user message, journalled
        // under the run's idempotency key, its version active and live.
        const journal = await db.collection("prompt_execution_logs").findOne({ projectId, taskKey: "chat" });
        expect(journal?.idempotencyKey).toBe(`bgrun-${runId}-generate`);
        expect(journal?.pipelineRunId).toBe(String(pipelineRun?._id));
        const snapshot = await db.collection("preview_snapshots").findOne({ projectId, isActive: true });
        expect(snapshot?._id ? String(snapshot._id) : snapshot?.id).toBe(stored?.outputs?.snapshot?.snapshotId);
        const deployment = await db.collection("site_deployments").findOne({ projectId, status: "live" });
        expect(deployment?.publishId).toBe(run.site?.publishId);

        const notices = await request(app).get("/v1/notifications").set("Authorization", `Bearer ${token(owner)}`);
        const notice = notices.body.notifications.find((n: { sourceEventType: string }) => n.sourceEventType === "background_run_done");
        expect(notice?.metadata.backgroundRunId).toBe(runId);
        expect(notice?.metadata.workspacePath).toBe(`/workspace/${projectId}?conv=${run.conversationId}`);
        expect(notice?.metadata.publicUrl).toBe(run.site?.publicUrl);
    });

    it("a resumed generation step that finds its turn persisted does not call the provider again", async () => {
        const db = await getDb();
        await db.collection("background_runs").updateOne(
            { _id: runId as never },
            { $set: { status: "generating", lease: null, finishedAt: null }, $unset: { "outputs.snapshot": "", "outputs.publish": "" } },
        );
        stubProvider();
        const before = calls.generation;
        await runWorkerOnce();
        expect(calls.generation).toBe(before);
        expect((await getRun(runId)).body.run.status).toBe("done");
    });

    it("refuses a start beyond the per-user limit of active runs", async () => {
        const start = () => request(app)
            .post("/v1/background-runs")
            .set("Authorization", `Bearer ${token(owner)}`)
            .send({ prompt: "Un sito per una palestra di quartiere a Bologna" });
        expect((await start()).status).toBe(201);
        expect((await start()).status).toBe(201);
        const third = await start();
        expect(third.status).toBe(429);
        expect(third.body.code).toBe("BACKGROUND_RUN_LIMIT_REACHED");
    });
});
