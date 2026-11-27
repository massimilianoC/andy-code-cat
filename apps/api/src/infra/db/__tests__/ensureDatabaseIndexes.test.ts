/**
 * The boot index step (security review M3): the database enforces one account per email and one
 * session per refresh-token id, expires sessions, and never stops the boot over existing data.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId, type Db } from "mongodb";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let db: Db;
let ensureDatabaseIndexes: typeof import("../ensureDatabaseIndexes").ensureDatabaseIndexes;

describe("ensureDatabaseIndexes", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        ({ ensureDatabaseIndexes } = await import("../ensureDatabaseIndexes"));
        const { getDb } = await import("../mongo");
        db = await getDb();
    });

    afterAll(async () => {
        const { closeDb } = await import("../mongo");
        await closeDb();
        await mongod?.stop();
    });

    beforeEach(async () => {
        await db.dropDatabase();
    });

    it("lets exactly one of several concurrent registrations with the same email succeed", async () => {
        const reports = await ensureDatabaseIndexes(db);
        expect(reports.filter((r) => r.status !== "ensured")).toEqual([]);

        const { RegisterUser } = await import("../../../application/use-cases/RegisterUser");
        const { MongoUserRepository } = await import("../../repositories/MongoUserRepository");
        const register = new RegisterUser(new MongoUserRepository());
        const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
            register.execute({ email: i % 2 ? "Race@Example.test" : "race@example.test", password: "Str0ng!Passw0rd-xyz" })));

        expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
        for (const failed of attempts.filter((a): a is PromiseRejectedResult => a.status === "rejected")) {
            expect(failed.reason).toMatchObject({ statusCode: 409, message: "Email already in use" });
        }
        expect(await db.collection("users").countDocuments({ email: "race@example.test" })).toBe(1);
    });

    it("makes session token ids unique (legacy rows without one allowed) and expires sessions by TTL", async () => {
        await db.collection("sessions").insertMany([
            { userId: new ObjectId(), refreshTokenHash: "x", createdAt: new Date(), expiresAt: new Date() },
            { userId: new ObjectId(), refreshTokenHash: "y", createdAt: new Date(), expiresAt: new Date() },
        ]);
        await ensureDatabaseIndexes(db);

        const indexes = await db.collection("sessions").indexes();
        expect(indexes.find((i) => i.name === "sessions_tokenId_unique")).toMatchObject({ unique: true });
        expect(indexes.find((i) => i.name === "sessions_expiresAt_ttl")).toMatchObject({ expireAfterSeconds: 0 });

        await db.collection("sessions").insertOne({ userId: new ObjectId(), tokenId: "t1", refreshTokenHash: "x", createdAt: new Date(), expiresAt: new Date() });
        await expect(db.collection("sessions").insertOne({ userId: new ObjectId(), tokenId: "t1", refreshTokenHash: "y", createdAt: new Date(), expiresAt: new Date() }))
            .rejects.toMatchObject({ code: 11000 });
    });

    it("reports existing duplicate emails instead of failing, and still ensures the other indexes", async () => {
        const first = new ObjectId();
        const second = new ObjectId();
        await db.collection("users").insertMany([
            { _id: first, email: "dup@example.test", createdAt: new Date() },
            { _id: second, email: "DUP@example.test", createdAt: new Date() },
            { _id: new ObjectId(), email: "single@example.test", createdAt: new Date() },
        ]);
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const reports = await ensureDatabaseIndexes(db);

        const email = reports.find((r) => r.name === "users_email_unique");
        expect(email).toMatchObject({ status: "skipped_duplicates", duplicateValues: 1 });
        expect(email?.duplicateDocumentIds?.sort()).toEqual([first.toHexString(), second.toHexString()].sort());
        expect(reports.find((r) => r.name === "sessions_tokenId_unique")?.status).toBe("ensured");
        expect((await db.collection("users").indexes()).some((i) => i.name === "users_email_unique")).toBe(false);
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("users_email_unique NOT created"), expect.anything());
        errorLog.mockRestore();
    });
});
