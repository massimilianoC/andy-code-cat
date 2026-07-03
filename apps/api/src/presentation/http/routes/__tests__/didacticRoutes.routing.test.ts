import { beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

let createDidacticRoutes: typeof import("../didacticRoutes").createDidacticRoutes;

function mountApp(): Express {
    const app = express();
    app.use("/v1", createDidacticRoutes());
    app.get("/v1/admin/stats", (_req, res) => {
        res.status(200).json({ ok: true });
    });
    return app;
}

describe("didactic route scoping", () => {
    beforeAll(async () => {
        process.env.NODE_ENV ||= "test";
        process.env.MONGODB_URI ||= "mongodb://localhost:27017/test";
        process.env.JWT_ACCESS_SECRET ||= "test-access-secret-0123456789";
        process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-0123456789";
        ({ createDidacticRoutes } = await import("../didacticRoutes"));
    });

    it("does not intercept unrelated admin routes mounted after it", async () => {
        const res = await request(mountApp()).get("/v1/admin/stats");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    it("still protects didactic routes under the project namespace", async () => {
        const res = await request(mountApp()).get("/v1/projects/project-1/didactic/knowledge?snapshotId=snapshot-1");
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ error: "Missing bearer token" });
    });
});