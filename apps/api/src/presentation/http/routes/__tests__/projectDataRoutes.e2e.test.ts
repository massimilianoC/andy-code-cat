/**
 * E2E: the owner's project data panel (docs/specs/PROJECT_DATA_PANEL.md). Real app, real MongoDB.
 * Every route is scoped to { owner, project } by the sandbox; the request never names an owner.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { ObjectId, type Db } from "mongodb";
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
let db: Db;

const owner = new ObjectId();
const stranger = new ObjectId();
const siteA = new ObjectId().toHexString();
const siteB = new ObjectId().toHexString();
const strangersSite = new ObjectId().toHexString();

const tokenFor = (id: ObjectId) => jwt.sign({ sub: id.toHexString(), roles: ["user"] }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });

function as(id: ObjectId, projectId: string) {
    const headers = { Authorization: `Bearer ${tokenFor(id)}`, "x-project-id": projectId };
    return {
        get: (path: string) => request(app).get(path).set(headers),
        post: (path: string, body: unknown) => request(app).post(path).set(headers).send(body as object),
        delete: (path: string) => request(app).delete(path).set(headers),
    };
}

const base = (projectId: string) => `/v1/projects/${projectId}/data`;

function score(ownerId: ObjectId, projectId: string, boardId: string, player: string, value: number, minute: number) {
    return {
        _id: new ObjectId().toHexString(),
        ownerUserId: ownerId.toHexString(),
        projectId,
        boardId,
        player,
        score: value,
        createdAt: new Date(Date.UTC(2026, 10, 25, 10, minute)),
    };
}

// Seeded directly: the panel shows whatever a capability stored, including text a visitor typed.
const siteAScores = [
    score(owner, siteA, "default", "ANA", 10, 1),
    score(owner, siteA, "default", "BOB", 20, 2),
    score(owner, siteA, "default", "A.B", 5, 3),
    score(owner, siteA, "default", "AXB", 6, 4),
    score(owner, siteA, "default", "=SUM(A1)", 7, 5),
    score(owner, siteA, "default", 'say "hi", ok', 8, 6),
    score(owner, siteA, "speedrun", "ZED", 1, 7),
    score(owner, siteA, "speedrun", "ZOE", 2, 8),
];
const newestFirst = ["ZOE", "ZED", 'say "hi", ok', "=SUM(A1)", "AXB", "A.B", "BOB", "ANA"];

describe("project data panel", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        app = createApp();
        db = await getDb();
        const now = new Date();
        await db.collection("users").insertMany([
            { _id: owner, email: "owner@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
            { _id: stranger, email: "stranger@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
        ]);
        await db.collection("projects").insertMany([
            { _id: new ObjectId(siteA), ownerUserId: owner, name: "Site A", presetId: "videogame", createdAt: now },
            { _id: new ObjectId(siteB), ownerUserId: owner, name: "Site B", presetId: "videogame", createdAt: now },
            { _id: new ObjectId(strangersSite), ownerUserId: stranger, name: "Not yours", presetId: "videogame", createdAt: now },
        ]);
        await db.collection("leaderboard_scores").insertMany([
            ...siteAScores,
            score(stranger, strangersSite, "default", "STRANGER", 99, 9),
            // Same project id, wrong owner: must never surface (scope is owner AND project).
            score(stranger, siteA, "default", "INTRUDER", 99, 10),
        ] as never[]);
    });

    afterAll(async () => {
        const { closeDb } = await import("../../../../infra/db/mongo");
        await closeDb();
        await mongod?.stop();
    });

    it("summarises every registered capability with per-group counts and last write", async () => {
        const res = await as(owner, siteA).get(base(siteA));
        expect(res.status).toBe(200);
        const leaderboard = res.body.capabilities.find((c: { id: string }) => c.id === "leaderboard");
        expect(leaderboard).toEqual({
            id: "leaderboard",
            label: "Leaderboards",
            records: 8,
            lastWriteAt: "2026-11-25T10:08:00.000Z",
            groups: [
                { id: "default", label: "default", records: 6, lastWriteAt: "2026-11-25T10:06:00.000Z" },
                { id: "speedrun", label: "speedrun", records: 2, lastWriteAt: "2026-11-25T10:08:00.000Z" },
            ],
        });

        // A project with no data still lists the capability, with zero records.
        const empty = await as(owner, siteB).get(base(siteB));
        expect(empty.status).toBe(200);
        expect(empty.body.capabilities).toContainEqual({ id: "leaderboard", label: "Leaderboards", records: 0, groups: [] });
    });

    it("lists records newest first, paged, filtered by group", async () => {
        const api = as(owner, siteA);
        const all = await api.get(`${base(siteA)}/leaderboard/records`);
        expect(all.status).toBe(200);
        expect(all.body.total).toBe(8);
        expect(all.body.page).toBe(1);
        expect(all.body.limit).toBe(50);
        expect(all.body.items.map((r: { data: { player: string } }) => r.data.player)).toEqual(newestFirst);
        expect(all.body.items[0]).toEqual({
            id: siteAScores[7]!._id,
            groupId: "speedrun",
            createdAt: "2026-11-25T10:08:00.000Z",
            data: { player: "ZOE", score: 2 },
        });

        const page2 = await api.get(`${base(siteA)}/leaderboard/records?page=2&limit=3`);
        expect(page2.body.total).toBe(8);
        expect(page2.body.items.map((r: { data: { player: string } }) => r.data.player)).toEqual(newestFirst.slice(3, 6));

        const speedrun = await api.get(`${base(siteA)}/leaderboard/records?groupId=speedrun`);
        expect(speedrun.body.total).toBe(2);
        expect(speedrun.body.items.map((r: { groupId: string }) => r.groupId)).toEqual(["speedrun", "speedrun"]);
    });

    it("searches player names as plain, case-insensitive text — never as a pattern", async () => {
        const api = as(owner, siteA);
        const names = async (search: string) => {
            const res = await api.get(`${base(siteA)}/leaderboard/records?search=${encodeURIComponent(search)}`);
            expect(res.status, search).toBe(200);
            return res.body.items.map((r: { data: { player: string } }) => r.data.player);
        };
        expect(await names("bo")).toEqual(["BOB"]);
        expect(await names("a.b")).toEqual(["A.B"]);
        expect(await names(".*")).toEqual([]);
        expect(await names("(")).toEqual(["=SUM(A1)"]);
        expect(await names("[")).toEqual([]);
        expect(await names("intruder")).toEqual([]);
    });

    it("validates the query with the contract", async () => {
        const api = as(owner, siteA);
        expect((await api.get(`${base(siteA)}/leaderboard/records?limit=0`)).status).toBe(400);
        expect((await api.get(`${base(siteA)}/leaderboard/records?limit=500`)).status).toBe(400);
        expect((await api.get(`${base(siteA)}/leaderboard/records?groupId=../etc`)).status).toBe(400);
        expect((await api.get(`${base(siteA)}/leaderboard/records?search=${"x".repeat(101)}`)).status).toBe(400);
        expect((await api.get(`${base(siteA)}/leaderboard/export?format=xml`)).status).toBe(400);
    });

    it("exports JSON as an attachment with every record of the selection", async () => {
        const res = await as(owner, siteA).get(`${base(siteA)}/leaderboard/export?format=json&groupId=speedrun`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/^application\/json/);
        expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="project-data-leaderboard-speedrun-\d{8}-\d{6}\.json"$/);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).toMatchObject({ capability: "leaderboard", label: "Leaderboards", groupId: "speedrun", total: 2, truncated: false });
        expect(res.body.records.map((r: { data: { player: string } }) => r.data.player)).toEqual(["ZOE", "ZED"]);
    });

    it("exports CSV with RFC 4180 quoting and formula-injection protection", async () => {
        const res = await as(owner, siteA).get(`${base(siteA)}/leaderboard/export?format=csv`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/^text\/csv/);
        expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="project-data-leaderboard-\d{8}-\d{6}\.csv"$/);
        const text = res.text.replace(/^﻿/, "");
        const rows = text.split("\r\n");
        expect(rows[0]).toBe("id,group,createdAt,player,score");
        expect(rows).toHaveLength(8 + 2); // header, 8 records, trailing empty line
        expect(rows).toContain(`${siteAScores[4]!._id},default,2026-11-25T10:05:00.000Z,'=SUM(A1),7`);
        expect(rows).toContain(`${siteAScores[5]!._id},default,2026-11-25T10:06:00.000Z,"say ""hi"", ok",8`);
        expect(text).not.toContain("INTRUDER");
        expect(text).not.toContain("STRANGER");
    });

    it("deletes one record of the project, and nothing across scopes", async () => {
        const target = siteAScores[0]!._id;
        // Owned project, but not the one holding the record.
        expect((await as(owner, siteB).delete(`${base(siteB)}/leaderboard/records/${target}`)).status).toBe(404);
        expect((await as(stranger, siteA).delete(`${base(siteA)}/leaderboard/records/${target}`)).status).toBe(403);
        expect((await as(owner, siteA).delete(`${base(siteA)}/nope/records/${target}`)).status).toBe(404);

        expect((await as(owner, siteA).delete(`${base(siteA)}/leaderboard/records/${target}`)).status).toBe(204);
        expect((await as(owner, siteA).delete(`${base(siteA)}/leaderboard/records/${target}`)).status).toBe(404);
        expect(await db.collection("leaderboard_scores").countDocuments({ _id: target as never })).toBe(0);
    });

    it("clears only with the typed confirmation, one group or every group", async () => {
        const scores = db.collection("leaderboard_scores");
        await scores.insertMany([
            score(owner, siteB, "default", "B1", 1, 20),
            score(owner, siteB, "default", "B2", 2, 21),
            score(owner, siteB, "daily", "B3", 3, 22),
        ] as never[]);
        const api = as(owner, siteB);
        const clear = `${base(siteB)}/leaderboard/clear`;

        expect((await api.post(clear, {})).status).toBe(400);
        expect((await api.post(clear, { confirm: "Leaderboard" })).status).toBe(400);
        expect((await api.post(clear, { confirm: "forms" })).status).toBe(400);
        expect((await api.post(clear, { confirm: "leaderboard", ownerUserId: stranger.toHexString() })).status).toBe(400);
        expect((await api.post(clear, { confirm: "leaderboard", groupId: "../x" })).status).toBe(400);
        expect((await api.post(`${base(siteB)}/nope/clear`, { confirm: "nope" })).status).toBe(404);
        expect(await scores.countDocuments({ projectId: siteB })).toBe(3);

        const board = await api.post(clear, { confirm: "leaderboard", groupId: "daily" });
        expect(board.status).toBe(200);
        expect(board.body).toEqual({ removed: 1 });
        expect(await scores.countDocuments({ projectId: siteB, boardId: "default" })).toBe(2);

        const siteABefore = await scores.countDocuments({ projectId: siteA });
        const all = await api.post(clear, { confirm: "leaderboard" });
        expect(all.body).toEqual({ removed: 2 });
        expect(await scores.countDocuments({ projectId: siteB })).toBe(0);
        // Other projects, and other owners, are untouched.
        expect(await scores.countDocuments({ projectId: siteA })).toBe(siteABefore);
        expect(await scores.countDocuments({ projectId: strangersSite })).toBe(1);
    });

    it("refuses another user's project, a path that differs from the sandboxed project, and no token", async () => {
        const routes = (projectId: string) => [
            ["get", base(projectId)],
            ["get", `${base(projectId)}/leaderboard/records`],
            ["get", `${base(projectId)}/leaderboard/export`],
            ["delete", `${base(projectId)}/leaderboard/records/x`],
            ["post", `${base(projectId)}/leaderboard/clear`],
        ] as const;
        const send = (client: ReturnType<typeof as>, method: "get" | "delete" | "post", path: string) =>
            method === "post" ? client.post(path, { confirm: "leaderboard" }) : client[method](path);

        for (const [method, path] of routes(siteA)) {
            expect((await send(as(stranger, siteA), method, path)).status, `${method} ${path} stranger`).toBe(403);
            // Header names a project the caller owns, path names someone else's — and the reverse.
            expect((await send(as(stranger, strangersSite), method, path)).status, `${method} ${path} header mismatch`).toBe(403);
            expect((await request(app)[method](path)).status, `${method} ${path} anonymous`).toBe(401);
        }
        for (const [method, path] of routes(strangersSite)) {
            expect((await send(as(owner, siteA), method, path)).status, `${method} ${path} path mismatch`).toBe(403);
        }
        expect(await db.collection("leaderboard_scores").countDocuments({ projectId: strangersSite })).toBe(1);
    });

    it("answers 404 for a capability that is not registered", async () => {
        const api = as(owner, siteA);
        expect((await api.get(`${base(siteA)}/nope/records`)).status).toBe(404);
        expect((await api.get(`${base(siteA)}/nope/export`)).status).toBe(404);
        expect((await api.get(`${base(siteA)}/__proto__/records`)).status).toBe(404);
        const res = await api.get(`${base(siteA)}/constructor/records`);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("PROJECT_DATA_CAPABILITY_NOT_FOUND");
    });
});
