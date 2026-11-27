/**
 * E2E: authentication routes are rate limited in the API itself (security review M2).
 * Real app (createApp) and MongoMemoryServer; each case uses its own app so counters start at zero,
 * and per-address cases send a fixed X-Forwarded-For (the app trusts one proxy hop) so the
 * address does not depend on how the test client connects.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { ObjectId } from "mongodb";
import type { Express } from "express";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.STORAGE_ADAPTER = "local";

let mongod: MongoMemoryServer;
let createApp: () => Express;
let limits: typeof import("../authRoutes").AUTH_RATE_LIMITS;

describe("auth rate limiting", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        ({ createApp } = await import("../../../../app"));
        ({ AUTH_RATE_LIMITS: limits } = await import("../authRoutes"));
        const { getDb } = await import("../../../../infra/db/mongo");
        const { hashPassword } = await import("../../../../infra/security/password");
        const db = await getDb();
        await db.collection("users").insertOne({
            _id: new ObjectId(), email: "known@example.test", passwordHash: await hashPassword("Str0ng!Passw0rd-xyz"),
            passwordPolicyVersion: 2, emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date(),
        });
    });

    afterAll(async () => {
        const { closeDb } = await import("../../../../infra/db/mongo");
        await closeDb();
        await mongod?.stop();
    });

    it("refuses further login attempts for an email after repeated failures, whatever the case of the email", async () => {
        const app = createApp();
        for (let i = 0; i < limits.loginFailuresPerEmail; i++) {
            const res = await request(app).post("/v1/auth/login").send({ email: i % 2 ? "KNOWN@example.test" : "known@example.test", password: "Wrong!Passw0rd-1" });
            expect(res.status).not.toBe(429);
        }
        const blocked = await request(app).post("/v1/auth/login").send({ email: "known@example.test", password: "Str0ng!Passw0rd-xyz" });
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe("AUTH_RATE_LIMITED");

        // Another email is not affected by the first one's failures.
        const other = await request(app).post("/v1/auth/login").send({ email: "someone@example.test", password: "Wrong!Passw0rd-1" });
        expect(other.status).not.toBe(429);
    });

    it("does not count successful logins", async () => {
        const app = createApp();
        for (let i = 0; i < limits.loginFailuresPerEmail + 2; i++) {
            const res = await request(app).post("/v1/auth/login").send({ email: "known@example.test", password: "Str0ng!Passw0rd-xyz" });
            expect(res.status).toBe(200);
        }
    });

    it("limits registrations per address", async () => {
        const app = createApp();
        const register = () => request(app).post("/v1/auth/register").set("X-Forwarded-For", "203.0.113.10").send({ email: "not-an-email", password: "x" });
        for (let i = 0; i < limits.registrationsPerIp; i++) {
            expect((await register()).status).not.toBe(429);
        }
        expect((await register()).status).toBe(429);
    });

    it("limits refresh attempts per address", async () => {
        const app = createApp();
        const refresh = () => request(app).post("/v1/auth/refresh").set("X-Forwarded-For", "203.0.113.20").send({});
        for (let i = 0; i < limits.refreshesPerIp; i++) {
            expect((await refresh()).status).not.toBe(429);
        }
        expect((await refresh()).status).toBe(429);
        // Another address keeps its own budget.
        expect((await request(app).post("/v1/auth/refresh").set("X-Forwarded-For", "203.0.113.21").send({})).status).toBe(400);
    });
});
