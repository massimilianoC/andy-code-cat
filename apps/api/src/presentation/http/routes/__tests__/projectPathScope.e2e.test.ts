/**
 * E2E: a route that names a project in its path acts on that project only when it is the project
 * x-project-id resolved to (double sandbox, AGENTS.md "Tenant Isolation Model").
 *
 * The caller owns the project in the header but puts another user's project in the path: every
 * such route must refuse with 403, never read or write the path's project.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { ObjectId } from "mongodb";
import type { Express } from "express";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.STORAGE_ADAPTER = "local";

let mongod: MongoMemoryServer;
let app: Express;

const alice = new ObjectId();
const bob = new ObjectId();
const aliceProject = new ObjectId().toHexString();
const bobProject = new ObjectId().toHexString();
const aliceSnapshot = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const tokenFor = (id: ObjectId) => jwt.sign({ sub: id.toHexString(), roles: ["user"] }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });
const headersFor = (id: ObjectId, projectId: string) => ({ Authorization: `Bearer ${tokenFor(id)}`, "x-project-id": projectId });

interface RouteEntry { method: string; path: string }

/** Every route of the app whose path contains `:projectId`, with its mount prefix. */
function projectRoutes(expressApp: Express): RouteEntry[] {
    type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: Layer[] }; regexp?: RegExp };
    const out: RouteEntry[] = [];
    const prefixOf = (layer: Layer): string => {
        if (!layer.regexp || layer.regexp.test("/")) return "";
        return ["/v1", "/p"].find((candidate) => layer.regexp!.test(candidate)) ?? "";
    };
    const walk = (stack: Layer[], prefix: string) => {
        for (const layer of stack) {
            if (layer.route) {
                if (!layer.route.path.includes(":projectId")) continue;
                for (const method of Object.keys(layer.route.methods)) out.push({ method, path: prefix + layer.route.path });
            } else if (layer.handle?.stack) {
                walk(layer.handle.stack, prefix + prefixOf(layer));
            }
        }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walk((expressApp as any)._router.stack, "");
    return out;
}

describe("project path scope", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        app = createApp();
        const db = await getDb();
        const now = new Date();
        await db.collection("users").insertMany([
            { _id: alice, email: "alice@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
            { _id: bob, email: "bob@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
        ]);
        await db.collection("projects").insertMany([
            { _id: new ObjectId(aliceProject), ownerUserId: alice, name: "Alice", presetId: "landing", createdAt: now },
            { _id: new ObjectId(bobProject), ownerUserId: bob, name: "Bob", presetId: "landing", createdAt: now },
        ]);
        await db.collection<Record<string, unknown> & { _id: string }>("didactic_qna").insertOne({
            _id: "qna-alice", projectId: aliceProject, userId: alice.toHexString(), snapshotId: aliceSnapshot,
            question: "private question", answer: "private answer", createdAt: now,
        });
    });

    afterAll(async () => {
        const { closeDb } = await import("../../../../infra/db/mongo");
        await closeDb();
        await mongod?.stop();
    });

    describe("didactic routes", () => {
        const routes: Array<{ name: string; send: (path: string, headers: Record<string, string>) => request.Test }> = [
            { name: "GET knowledge", send: (p, h) => request(app).get(`/v1/projects/${p}/didactic/knowledge?snapshotId=${aliceSnapshot}`).set(h) },
            { name: "POST knowledge/generate", send: (p, h) => request(app).post(`/v1/projects/${p}/didactic/knowledge/generate`).set(h).send({ snapshotId: aliceSnapshot }) },
            { name: "POST ask/stream", send: (p, h) => request(app).post(`/v1/projects/${p}/didactic/ask/stream`).set(h).send({ snapshotId: aliceSnapshot, question: "q?" }) },
            { name: "GET qna", send: (p, h) => request(app).get(`/v1/projects/${p}/didactic/qna`).set(h) },
        ];

        for (const route of routes) {
            it(`${route.name}: another user's project in the path → 403`, async () => {
                const res = await route.send(aliceProject, headersFor(bob, bobProject));
                expect(res.status).toBe(403);
                expect(res.body.code).toBe("PROJECT_SCOPE_MISMATCH");
                expect(JSON.stringify(res.body)).not.toContain("private");
            });
        }

        it("the owner still lists the project's Q&A", async () => {
            const res = await request(app).get(`/v1/projects/${aliceProject}/didactic/qna`).set(headersFor(alice, aliceProject));
            expect(res.status).toBe(200);
            expect(res.body.entries.map((e: { question: string }) => e.question)).toEqual(["private question"]);
        });

        it("bob's own project lists none of alice's Q&A", async () => {
            const res = await request(app).get(`/v1/projects/${bobProject}/didactic/qna`).set(headersFor(bob, bobProject));
            expect(res.status).toBe(200);
            expect(res.body.entries).toEqual([]);
        });
    });

    it("every route with :projectId refuses a path project that is not the header's", async () => {
        const routes = projectRoutes(app);
        expect(routes.length).toBeGreaterThan(40);
        const accepted: string[] = [];
        for (const route of routes) {
            const path = route.path
                .replace(":projectId", aliceProject)
                .replace(/:[A-Za-z]+/g, "64b0000000000000000000ff");
            const res = await request(app)[route.method as "get"](path).set(headersFor(bob, bobProject)).send({});
            if (res.status !== 403) accepted.push(`${route.method.toUpperCase()} ${route.path} → ${res.status}`);
        }
        expect(accepted).toEqual([]);
    });
});
