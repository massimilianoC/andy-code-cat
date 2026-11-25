/**
 * E2E: a published site answers at /{slug}/ as well as /p/{publishId}/ — the same files, the same
 * suspension rules — and the slug router never shadows a platform route.
 *
 * Real app (createApp), real MongoDB (MongoMemoryServer), real files in a temporary DATA_DIR.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";
import type { Express } from "express";
import jwt from "jsonwebtoken";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "andy-slug-sites-"));

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.DATA_DIR = DATA_DIR;
process.env.STORAGE_ADAPTER = "local";
// The app's own origin: site content must never run there (requests below without Host use 127.0.0.1).
process.env.CORS_ORIGIN = "https://app.example.test";

let mongod: MongoMemoryServer;
let app: Express;
let superadminToken = "";

const LIVE = { publishId: "ab12cd34", slug: "my-site" };
const BLOCKED = { publishId: "ef56gh78", slug: "sospeso" };

function writeSite(publishId: string, title: string) {
    const dir = path.join(DATA_DIR, "www", publishId);
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), `<html><head><link rel="stylesheet" href="style.css"></head><body>${title}</body></html>`);
    fs.writeFileSync(path.join(dir, "style.css"), "body{color:red}");
    fs.writeFileSync(path.join(dir, "data", "rows.json"), "[1,2,3]");
}

describe("published site by slug — /{slug}/", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();

        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        app = createApp();
        const db = await getDb();

        const owner = new ObjectId();
        await db.collection("users").insertOne({
            _id: owner, email: "owner@example.com", passwordHash: "x", emailVerified: true,
            isBlocked: false, roles: ["user"], createdAt: new Date(),
        });

        const admin = new ObjectId();
        await db.collection("users").insertOne({
            _id: admin, email: "root@example.com", passwordHash: "x", emailVerified: true,
            isBlocked: false, roles: ["superadmin"], createdAt: new Date(),
        });
        superadminToken = jwt.sign({ sub: admin.toHexString(), roles: ["superadmin"] }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });

        const now = new Date();
        const base = { projectId: "p1", userId: owner.toHexString(), snapshotId: "s1", filesDeployed: ["index.html"], createdAt: now, updatedAt: now };
        await db.collection<Record<string, unknown> & { _id: string }>("site_deployments").insertMany([
            { _id: "d1", ...base, publishId: LIVE.publishId, customSlug: LIVE.slug, status: "live", url: `/p/${LIVE.publishId}` },
            { _id: "d2", ...base, projectId: "p2", publishId: BLOCKED.publishId, customSlug: BLOCKED.slug, status: "live", url: `/p/${BLOCKED.publishId}`, isAdminBlocked: true },
        ]);
        writeSite(LIVE.publishId, "My site live");
        writeSite(BLOCKED.publishId, "Blocked");
    });

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    it("redirects /{slug} to /{slug}/ so the site's relative assets resolve inside it", async () => {
        const res = await request(app).get(`/${LIVE.slug}`);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe(`/${LIVE.slug}/`);
    });

    it("serves index.html at /{slug}/ with the published-page CSP and no-cache", async () => {
        const res = await request(app).get(`/${LIVE.slug}/`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("My site live");
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.headers["cache-control"]).toBe("no-cache");
        expect(res.headers["content-security-policy"]).toContain("script-src 'self' https:");
    });

    it("serves the same files as /p/{publishId}/", async () => {
        const bySlug = await request(app).get(`/${LIVE.slug}/style.css`);
        const byId = await request(app).get(`/p/${LIVE.publishId}/style.css`);
        expect(bySlug.status).toBe(200);
        expect(bySlug.text).toBe("body{color:red}");
        expect(bySlug.text).toBe(byId.text);
        expect(bySlug.headers["cache-control"]).toBe(byId.headers["cache-control"]);

        const data = await request(app).get(`/${LIVE.slug}/data/rows.json`);
        expect(data.status).toBe(200);
        expect(data.text).toBe("[1,2,3]");
    });

    it("keeps answering the stored /p/{publishId}/ address", async () => {
        const res = await request(app).get(`/p/${LIVE.publishId}/`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("My site live");
    });

    it("applies the same suspension rule on both addresses", async () => {
        expect((await request(app).get(`/${BLOCKED.slug}/`)).status).toBe(403);
        expect((await request(app).get(`/p/${BLOCKED.publishId}/`)).status).toBe(403);
    });

    it("404s a slug-shaped path that no live site owns", async () => {
        const res = await request(app).get("/nessun-sito/");
        expect(res.status).toBe(404);
    });

    it("never shadows platform routes or reserved root segments", async () => {
        const health = await request(app).get("/health");
        expect(health.status).toBe(200);
        expect(health.body.status).toBe("ok");

        const version = await request(app).get("/version");
        expect(version.status).toBe(200);
        expect(version.body.service).toBe("api");

        // A reserved segment is not looked up as a slug: it falls through to the default 404.
        const login = await request(app).get("/login/");
        expect(login.status).toBe(404);
        expect(login.text).not.toContain("My site");

        const v1 = await request(app).get("/v1/does-not-exist");
        expect(v1.status).not.toBe(200);
    });

    it("rejects traversal in the file segment", async () => {
        const res = await request(app).get(`/${LIVE.slug}/..%2Fetc%2Fpasswd`);
        expect([400, 404]).toContain(res.status);
        expect(res.text).not.toContain("root:");
    });

    it("superadmin config: defaults to path mode and saves subdomain mode only with a valid domain", async () => {
        const auth = { Authorization: `Bearer ${superadminToken}` };

        const initial = await request(app).get("/v1/admin/config").set(auth);
        expect(initial.status).toBe(200);
        expect(initial.body.publicSites).toEqual({ urlMode: "path", publicDomain: "", sitesOrigin: "" });

        const rejected = await request(app).patch("/v1/admin/config").set(auth)
            .send({ publicSites: { urlMode: "subdomain", publicDomain: "app.example.test:8443" } });
        expect(rejected.status).toBe(400);

        const saved = await request(app).patch("/v1/admin/config").set(auth)
            .send({ publicSites: { urlMode: "subdomain", publicDomain: "Example.com" } });
        expect(saved.status).toBe(200);
        expect(saved.body.publicSites).toEqual({ urlMode: "subdomain", publicDomain: "example.com", sitesOrigin: "" });

        // Serving does not depend on the mode: /{slug}/ still answers in subdomain mode.
        expect((await request(app).get(`/${LIVE.slug}/`)).status).toBe(200);

        const back = await request(app).patch("/v1/admin/config").set(auth)
            .send({ publicSites: { urlMode: "path", publicDomain: "" } });
        expect(back.body.publicSites).toEqual({ urlMode: "path", publicDomain: "", sitesOrigin: "" });
    });

    it("never runs a site on the app origin: refused without a sites origin, redirected with one", async () => {
        const auth = { Authorization: `Bearer ${superadminToken}` };
        const onAppHost = () => request(app).get(`/${LIVE.slug}/style.css?v=1`).set("X-Forwarded-Host", "app.example.test");

        // No separate address configured: nothing to redirect to, so it is not served here.
        expect((await onAppHost()).status).toBe(404);
        expect((await request(app).get(`/p/${LIVE.publishId}/`).set("X-Forwarded-Host", "app.example.test")).status).toBe(404);

        await request(app).patch("/v1/admin/config").set(auth)
            .send({ publicSites: { urlMode: "path", publicDomain: "", sitesOrigin: "https://sites.example.test:8443" } });

        const redirected = await onAppHost();
        expect(redirected.status).toBe(301);
        expect(redirected.headers.location).toBe(`https://sites.example.test:8443/${LIVE.slug}/style.css?v=1`);

        const byId = await request(app).get(`/p/${LIVE.publishId}/`).set("X-Forwarded-Host", "app.example.test");
        expect(byId.status).toBe(301);
        expect(byId.headers.location).toBe(`https://sites.example.test:8443/${LIVE.slug}/`);

        // On the sites host itself it is served.
        const served = await request(app).get(`/${LIVE.slug}/`).set("X-Forwarded-Host", "sites.example.test");
        expect(served.status).toBe(200);
        expect(served.text).toContain("My site live");

        await request(app).patch("/v1/admin/config").set(auth).send({ publicSites: { urlMode: "path", publicDomain: "" } });
    });
});
