import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Reproduces the production defect: several /v1 routers call router.use(authMiddleware),
// and Express runs that for every /v1 request reaching them in mount order. The public
// check-slug route therefore MUST be mounted before those routers, or it gets a 401.
// A reserved slug ("admin") is classified before any DB access, so these tests need no Mongo.
//
// createPublishRoutes pulls in authMiddleware -> jwt -> config, which validates env at import
// time and process.exit(1)s if required vars are missing. We set them, then import dynamically.

let createPublishRoutes: typeof import("../publishRoutes").createPublishRoutes;

function globalAuthRouter() {
    const r = express.Router();
    r.use((_req, res) => {
        res.status(401).json({ error: "Missing bearer token" });
    });
    return r;
}

function mountApp(order: "public-first" | "auth-first"): Express {
    const { publicRouter } = createPublishRoutes();
    const app = express();
    if (order === "public-first") {
        app.use("/v1", publicRouter);
        app.use("/v1", globalAuthRouter());
    } else {
        app.use("/v1", globalAuthRouter());
        app.use("/v1", publicRouter);
    }
    return app;
}

describe("publish check-slug public routing", () => {
    beforeAll(async () => {
        process.env.MONGODB_URI ||= "mongodb://localhost:27017/test";
        process.env.JWT_ACCESS_SECRET ||= "test-access-secret-0123456789";
        process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-0123456789";
        ({ createPublishRoutes } = await import("../publishRoutes"));
    });

    it("is reachable without a token when the public router is mounted before auth routers", async () => {
        const res = await request(mountApp("public-first")).get("/v1/publish/check-slug?slug=admin");
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ available: false, reason: "reserved", slug: "admin" });
    });

    it("is shadowed by a 401 if a global-auth router is mounted before it (the original bug)", async () => {
        const res = await request(mountApp("auth-first")).get("/v1/publish/check-slug?slug=admin");
        expect(res.status).toBe(401);
    });
});
