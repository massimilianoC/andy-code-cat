/**
 * E2E: privileges come from the account record, not from the token (security review M1).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

const admin = new ObjectId();
const target = new ObjectId();
const token = (id: ObjectId, roles: string[]) => jwt.sign({ sub: id.toHexString(), roles }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });

describe("roles from the account record", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        app = createApp();
        db = await getDb();
        const now = new Date();
        await db.collection("users").insertMany([
            { _id: admin, email: "admin@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["superadmin"], createdAt: now },
            { _id: target, email: "target@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["superadmin"], createdAt: now },
        ]);
        await db.collection("sessions").insertOne({ userId: target, tokenId: "target-session", refreshTokenHash: "x", createdAt: now, expiresAt: new Date(Date.now() + 86_400_000) });
    });

    afterAll(async () => {
        const { closeDb } = await import("../../../../infra/db/mongo");
        await closeDb();
        await mongod?.stop();
    });

    it("refuses superadmin routes to a token claiming a role the account does not hold", async () => {
        const forged = new ObjectId();
        await db.collection("users").insertOne({ _id: forged, email: "plain@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() });
        const res = await request(app).get("/v1/admin/users").set("Authorization", `Bearer ${token(forged, ["superadmin"])}`);
        expect(res.status).toBe(403);
    });

    it("a demotion takes effect on the next request, with the token issued before it, and revokes the sessions", async () => {
        const targetToken = token(target, ["superadmin"]);
        expect((await request(app).get("/v1/admin/users").set("Authorization", `Bearer ${targetToken}`)).status).toBe(200);

        const demote = await request(app).patch(`/v1/admin/users/${target.toHexString()}/roles`)
            .set("Authorization", `Bearer ${token(admin, ["superadmin"])}`).send({ roles: ["user"] });
        expect(demote.status, JSON.stringify(demote.body)).toBe(200);

        expect((await request(app).get("/v1/admin/users").set("Authorization", `Bearer ${targetToken}`)).status).toBe(403);
        expect(await db.collection("sessions").countDocuments({ userId: target })).toBe(0);
    });

    it("resolves the account once per request although several routers mount the middleware", async () => {
        const { MongoUserRepository } = await import("../../../../infra/repositories/MongoUserRepository");
        const spy = vi.spyOn(MongoUserRepository.prototype, "findById");
        const res = await request(app).get("/v1/projects").set("Authorization", `Bearer ${token(admin, ["superadmin"])}`);
        expect(res.status).toBe(200);
        expect(spy.mock.calls.filter(([id]) => id === admin.toHexString())).toHaveLength(1);
        spy.mockRestore();
    });
});
