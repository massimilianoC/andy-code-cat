/**
 * E2E: project leaderboards (docs/specs/ARCADE_MODE_MVP.md). Real app, real MongoDB.
 * The scope { owner, project, board } is enforced on every read, write and delete.
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

const owner = new ObjectId();
const stranger = new ObjectId();
const gameA = new ObjectId().toHexString();
const gameB = new ObjectId().toHexString();
const strangersGame = new ObjectId().toHexString();

const tokenFor = (id: ObjectId) => jwt.sign({ sub: id.toHexString(), roles: ["user"] }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });

function as(id: ObjectId, projectId: string) {
    const headers = { Authorization: `Bearer ${tokenFor(id)}`, "x-project-id": projectId };
    return {
        get: (path: string) => request(app).get(path).set(headers),
        post: (path: string, body: unknown) => request(app).post(path).set(headers).send(body as object),
        delete: (path: string) => request(app).delete(path).set(headers),
    };
}

describe("project leaderboard", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        app = createApp();
        const db = await getDb();
        const now = new Date();
        await db.collection("users").insertMany([
            { _id: owner, email: "owner@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
            { _id: stranger, email: "stranger@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
        ]);
        await db.collection("projects").insertMany([
            { _id: new ObjectId(gameA), ownerUserId: owner, name: "Game A", presetId: "videogame", createdAt: now },
            { _id: new ObjectId(gameB), ownerUserId: owner, name: "Game B", presetId: "freerunner", createdAt: now },
            { _id: new ObjectId(strangersGame), ownerUserId: stranger, name: "Not yours", presetId: "videogame", createdAt: now },
        ]);
    });

    afterAll(async () => {
        const { closeDb } = await import("../../../../infra/db/mongo");
        await closeDb();
        await mongod?.stop();
    });

    it("stores scores and returns them highest first, ties to the earliest, with the new entry's rank", async () => {
        const api = as(owner, gameA);
        expect((await api.post(`/v1/projects/${gameA}/leaderboard`, { player: "ANA", score: 120 })).status).toBe(201);
        expect((await api.post(`/v1/projects/${gameA}/leaderboard`, { player: "BOB", score: 300 })).status).toBe(201);
        const tie = await api.post(`/v1/projects/${gameA}/leaderboard`, { player: "CY", score: 120 });
        expect(tie.status).toBe(201);
        expect(tie.body.rank).toBe(3);

        const list = await api.get(`/v1/projects/${gameA}/leaderboard`);
        expect(list.status).toBe(200);
        expect(list.body.entries.map((e: { player: string }) => e.player)).toEqual(["BOB", "ANA", "CY"]);
    });

    it("keeps boards and projects apart", async () => {
        const api = as(owner, gameA);
        await api.post(`/v1/projects/${gameA}/leaderboard`, { boardId: "speedrun", player: "ZED", score: 5 });
        const main = await api.get(`/v1/projects/${gameA}/leaderboard`);
        expect(main.body.entries.some((e: { player: string }) => e.player === "ZED")).toBe(false);
        const speedrun = await api.get(`/v1/projects/${gameA}/leaderboard?boardId=speedrun`);
        expect(speedrun.body.entries.map((e: { player: string }) => e.player)).toEqual(["ZED"]);

        const other = await as(owner, gameB).get(`/v1/projects/${gameB}/leaderboard`);
        expect(other.body.entries).toEqual([]);
    });

    it("refuses another user's project, and a path that does not match the sandboxed project", async () => {
        expect((await as(stranger, gameA).get(`/v1/projects/${gameA}/leaderboard`)).status).toBe(403);
        expect((await as(stranger, gameA).post(`/v1/projects/${gameA}/leaderboard`, { player: "X", score: 1 })).status).toBe(403);
        // Header names a project the caller owns, path names someone else's.
        expect((await as(stranger, strangersGame).get(`/v1/projects/${gameA}/leaderboard`)).status).toBe(403);
        expect((await as(owner, gameA).get(`/v1/projects/${strangersGame}/leaderboard`)).status).toBe(403);
        expect((await request(app).get(`/v1/projects/${gameA}/leaderboard`)).status).toBe(401);
    });

    it("refuses a malformed project id with 403 and keeps serving (it used to be an unhandled rejection)", async () => {
        expect((await as(owner, "not-an-object-id").get(`/v1/projects/not-an-object-id/leaderboard`)).status).toBe(403);
        expect((await as(owner, gameA).get(`/v1/projects/${gameA}/leaderboard`)).status).toBe(200);
    });

    it("validates player names, scores and unknown fields", async () => {
        const api = as(owner, gameA);
        for (const body of [
            { player: "", score: 1 },
            { player: "<script>", score: 1 },
            { player: "THIS NAME IS TOO LONG", score: 1 },
            { player: "OK", score: -1 },
            { player: "OK", score: 1.5 },
            { player: "OK", score: 2_000_000_000 },
            { player: "OK", score: 1, ownerUserId: stranger.toHexString() },
            { player: "OK", score: 1, boardId: "../etc" },
        ]) {
            expect((await api.post(`/v1/projects/${gameA}/leaderboard`, body)).status, JSON.stringify(body)).toBe(400);
        }
    });

    it("lets the owner delete an entry, and nobody delete across scopes", async () => {
        const api = as(owner, gameA);
        const created = await api.post(`/v1/projects/${gameA}/leaderboard`, { player: "DEL", score: 7 });
        const id = created.body.entry.id as string;

        expect((await as(owner, gameB).delete(`/v1/projects/${gameB}/leaderboard/${id}`)).status).toBe(404);
        expect((await api.delete(`/v1/projects/${gameA}/leaderboard/${id}?boardId=speedrun`)).status).toBe(404);
        expect((await as(stranger, gameA).delete(`/v1/projects/${gameA}/leaderboard/${id}`)).status).toBe(403);
        expect((await api.delete(`/v1/projects/${gameA}/leaderboard/${id}`)).status).toBe(204);
        expect((await api.delete(`/v1/projects/${gameA}/leaderboard/${id}`)).status).toBe(404);
    });
    it("deletes every board of a project together with the project, and nothing else", async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const scores = (await getDb()).collection("leaderboard_scores");
        const api = as(owner, gameB);
        await api.post(`/v1/projects/${gameB}/leaderboard`, { player: "B1", score: 1 });
        await api.post(`/v1/projects/${gameB}/leaderboard`, { boardId: "daily", player: "B2", score: 2 });
        const gameABefore = await scores.countDocuments({ projectId: gameA });
        expect(await scores.countDocuments({ projectId: gameB })).toBe(2);

        expect((await api.delete(`/v1/projects/${gameB}`)).status).toBeLessThan(300);

        expect(await scores.countDocuments({ projectId: gameB })).toBe(0);
        expect(await scores.countDocuments({ projectId: gameA })).toBe(gameABefore);
    });
});
