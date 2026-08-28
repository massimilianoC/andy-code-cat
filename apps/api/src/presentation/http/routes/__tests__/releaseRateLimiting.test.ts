import { beforeAll, describe, expect, it } from "vitest";
import express, { type Express, type Router } from "express";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-jwt-access-secret-min-32-chars";
process.env.JWT_REFRESH_SECRET = "test-jwt-refresh-secret-min-32-chars";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/rate-limit-test";

let createPipelineRoutes: () => Router;
let createPipelineRunRoutes: () => Router;
let createFormServiceRoutes: () => Router;

beforeAll(async () => {
    ({ createPipelineRoutes } = await import("../pipelineRoutes"));
    ({ createPipelineRunRoutes } = await import("../pipelineRunRoutes"));
    ({ createFormServiceRoutes } = await import("../formServiceRoutes"));
});

function mount(router: Router): Express {
    const app = express();
    app.use(express.json());
    app.use("/v1", router);
    return app;
}

async function exhaustUnauthenticatedRequests(
    perform: () => PromiseLike<{ status: number }>,
    limit: number,
): Promise<void> {
    for (let index = 0; index < limit; index += 1) {
        expect((await perform()).status).toBe(401);
    }
    expect((await perform()).status).toBe(429);
}

describe("release route rate limiting", () => {
    it("limits pipeline writes before repeated authorization work", async () => {
        const app = mount(createPipelineRoutes());
        await exhaustUnauthenticatedRequests(
            () => request(app).post("/v1/projects/project-1/pipeline/brief-preview").send({}),
            30,
        );
    });

    it("limits PipelineRun access before repeated authorization work", async () => {
        const app = mount(createPipelineRunRoutes());
        await exhaustUnauthenticatedRequests(
            () => request(app).get("/v1/projects/project-1/pipeline-runs"),
            60,
        );
    });

    it("limits form-service access before repeated authorization work", async () => {
        const app = mount(createFormServiceRoutes());
        await exhaustUnauthenticatedRequests(
            () => request(app).get("/v1/projects/project-1/services/forms"),
            60,
        );
    });
});
