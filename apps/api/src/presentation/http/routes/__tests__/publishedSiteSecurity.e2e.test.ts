/**
 * E2E regressions for the 2026-11-23 security review of published sites and user files.
 * Real app (createApp), MongoMemoryServer, real files in a temporary DATA_DIR.
 *
 *  1. /p/media never lets a user upload execute: script-capable types are downloads with a
 *     sandbox CSP; only passive types are inline; external references redirect to http(s) only.
 *  2. A slug can never be a publishId (shared directory namespace) and is unique among live
 *     deployments — enforced by a MongoDB unique index, not by a check-then-write.
 *  3. /p/{x} serves only a live deployment's publishId — never a slug copy or an orphan directory,
 *     so a suspended site is not reachable through another address.
 *  4. With a sites origin configured, site content is served on that host only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";
import type { Express } from "express";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "andy-sec-"));

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.DATA_DIR = DATA_DIR;
process.env.STORAGE_ADAPTER = "local";
process.env.CORS_ORIGIN = "https://app.example.test";

let mongod: MongoMemoryServer;
let app: Express;
let ownerId = "";
let blockedOwnerId = "";

function writeFile(rel: string, content: string) {
    const target = path.join(DATA_DIR, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function writeSite(dir: string, title: string) {
    writeFile(`www/${dir}/index.html`, `<html><body>${title}</body></html>`);
    writeFile(`www/${dir}/style.css`, "body{}");
}

describe("published sites and user files — security regressions", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        const { MongoSiteDeploymentRepository } = await import("../../../../infra/repositories/MongoSiteDeploymentRepository");
        app = createApp();
        const db = await getDb();
        await new MongoSiteDeploymentRepository().ensureIndexes();

        const owner = new ObjectId();
        const blocked = new ObjectId();
        ownerId = owner.toHexString();
        blockedOwnerId = blocked.toHexString();
        await db.collection("users").insertMany([
            { _id: owner, email: "o@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date() },
            { _id: blocked, email: "b@example.com", passwordHash: "x", emailVerified: true, isBlocked: true, roles: ["user"], createdAt: new Date() },
        ]);

        const now = new Date();
        const base = { snapshotId: "s", filesDeployed: ["index.html"], createdAt: now, updatedAt: now, status: "live" };
        await db.collection<Record<string, unknown> & { _id: string }>("site_deployments").insertMany([
            { _id: "orph", ...base, projectId: "p4", userId: new ObjectId().toHexString(), publishId: "ab12ab12", customSlug: "orfano", url: "/p/ab12ab12" },
            { _id: "live", ...base, projectId: "p1", userId: ownerId, publishId: "aa11bb22", customSlug: "my-site", url: "/p/aa11bb22" },
            { _id: "susp", ...base, projectId: "p2", userId: ownerId, publishId: "cc33dd44", customSlug: "sospesa", url: "/p/cc33dd44", isAdminBlocked: true },
            { _id: "ownb", ...base, projectId: "p3", userId: blockedOwnerId, publishId: "ee55ff66", customSlug: "bloccato", url: "/p/ee55ff66" },
        ]);
        writeSite("aa11bb22", "My site live");
        writeSite("cc33dd44", "Suspended");
        writeSite("ee55ff66", "Owner blocked");
        writeSite("ab12ab12", "Orphan owner");
        // Slug copies (subdomain mode) and an orphan directory: never reachable through /p/.
        writeSite("my-site", "My site slug copy");
        writeSite("sospesa", "Suspended slug copy");
        writeSite("orphan01", "Orphan");

        const project = "507f1f77bcf86cd799439011";
        const asset = (id: string, mimeType: string, file: string, extra: Record<string, unknown> = {}) => ({
            _id: id, projectId: project, userId: ownerId, originalName: file, storedFilename: file,
            mimeType, fileSize: 10, source: "upload", scope: "project", createdAt: now, ...extra,
        });
        await db.collection<Record<string, unknown> & { _id: string }>("project_assets").insertMany([
            asset("11111111-1111-4111-8111-111111111111", "text/html", "evil.html"),
            asset("22222222-2222-4222-8222-222222222222", "text/javascript", "evil.js"),
            asset("33333333-3333-4333-8333-333333333333", "image/svg+xml", "logo.svg"),
            asset("44444444-4444-4444-8444-444444444444", "image/png", "photo.png"),
            asset("55555555-5555-4555-8555-555555555555", "image/png", "ref.png", { externalUrl: "javascript:alert(1)" }),
            asset("66666666-6666-4666-8666-666666666666", "image/png", "ref2.png", { externalUrl: "https://images.example.com/a.png" }),
        ]);
        for (const [file, content] of [["evil.html", "<script>alert(1)</script>"], ["evil.js", "alert(1)"], ["logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"], ["photo.png", "PNGDATA"]]) {
            writeFile(`uploads/${ownerId}/${project}/${file}`, content!);
        }
    });

    afterAll(async () => {
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    describe("1. /p/media", () => {
        it("serves an uploaded text/html as an inert download", async () => {
            const res = await request(app).get("/p/media/11111111-1111-4111-8111-111111111111");
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toContain("application/octet-stream");
            expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
            expect(res.headers["x-content-type-options"]).toBe("nosniff");
            expect(res.headers["content-security-policy"]).toMatch(/^sandbox;/);
        });

        it("never serves an uploaded script with a script MIME type", async () => {
            const res = await request(app).get("/p/media/22222222-2222-4222-8222-222222222222");
            expect(res.headers["content-type"]).toContain("application/octet-stream");
            expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
        });

        it("keeps SVG usable in <img> but downloads it on navigation, sandboxed", async () => {
            const res = await request(app).get("/p/media/33333333-3333-4333-8333-333333333333");
            expect(res.headers["content-type"]).toContain("image/svg+xml");
            expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
            expect(res.headers["content-security-policy"]).toMatch(/^sandbox;/);
        });

        it("shows passive images inline", async () => {
            const res = await request(app).get("/p/media/44444444-4444-4444-8444-444444444444");
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toContain("image/png");
            expect(res.headers["content-disposition"]).toMatch(/^inline;/);
        });

        it("redirects external references to http(s) only", async () => {
            expect((await request(app).get("/p/media/55555555-5555-4555-8555-555555555555")).status).toBe(404);
            const ok = await request(app).get("/p/media/66666666-6666-4666-8666-666666666666");
            expect(ok.status).toBe(302);
            expect(ok.headers.location).toBe("https://images.example.com/a.png");
        });
    });

    describe("2. slug namespace and lock", () => {
        it("reserves slugs shaped like a publishId", async () => {
            const res = await request(app).get("/v1/publish/check-slug?slug=deadbeef");
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ available: false, reason: "reserved" });
        });

        it("lets MongoDB refuse a second live deployment with the same slug (409), but not a failed one", async () => {
            const { MongoSiteDeploymentRepository } = await import("../../../../infra/repositories/MongoSiteDeploymentRepository");
            const repo = new MongoSiteDeploymentRepository();
            const input = { publishId: "abab1212", customSlug: "my-site", projectId: "px", userId: ownerId, snapshotId: "s", url: "/p/abab1212", filesDeployed: [] };
            await expect(repo.create(input)).rejects.toMatchObject({ statusCode: 409 });

            const { getDb } = await import("../../../../infra/db/mongo");
            const db = await getDb();
            await expect(db.collection<Record<string, unknown> & { _id: string }>("site_deployments").insertOne({
                _id: "failed-dup", ...input, publishId: "cdcd3434", status: "failed", createdAt: new Date(), updatedAt: new Date(),
            })).resolves.toBeTruthy();

            const free = await repo.create({ ...input, publishId: "efef5656", customSlug: "libero" });
            await expect(repo.updateCustomSlug(free.id, "my-site")).rejects.toMatchObject({ statusCode: 409 });
        });
    });

    describe("3. only live deployments, with suspension, on every address", () => {
        it("does not serve a slug copy or an orphan directory through /p/", async () => {
            expect((await request(app).get("/p/my-site/")).status).toBe(404);
            expect((await request(app).get("/p/sospesa/")).status).toBe(404);
            expect((await request(app).get("/p/orphan01/")).status).toBe(404);
        });

        it("still serves the live site at /p/{publishId}/ and /{slug}/", async () => {
            const byId = await request(app).get("/p/aa11bb22/");
            expect(byId.status).toBe(200);
            expect(byId.text).toContain("My site live");
            const bySlug = await request(app).get("/my-site/");
            expect(bySlug.status).toBe(200);
            expect(bySlug.text).toContain("My site live"); // the publishId directory, not the slug copy
        });

        it("does not serve a site whose owner account no longer exists, on either address", async () => {
            for (const p of ["/orfano/", "/p/ab12ab12/", "/p/ab12ab12/style.css"]) {
                const res = await request(app).get(p);
                expect(res.status, p).toBe(410);
                expect(res.text, p).not.toContain("Orphan owner");
            }
        });

        it("keeps a suspended site and a blocked owner's site unreachable on both addresses", async () => {
            for (const p of ["/p/cc33dd44/", "/sospesa/", "/p/cc33dd44/style.css", "/sospesa/style.css", "/p/ee55ff66/", "/bloccato/"]) {
                expect((await request(app).get(p)).status, p).toBe(403);
            }
        });
    });

    describe("4. a configured sites origin is the only host that serves sites", () => {
        it("redirects any other host to the sites origin", async () => {
            const { MongoPlatformConfigRepository } = await import("../../../../infra/repositories/MongoPlatformConfigRepository");
            const repo = new MongoPlatformConfigRepository();
            await repo.upsert({ publicSites: { urlMode: "path", publicDomain: "", sitesOrigin: "https://sites.example.test:8443" } });
            try {
                // A host that is neither the app (CORS_ORIGIN) nor the sites host — e.g. one missing from CORS_ORIGIN.
                const other = await request(app).get("/my-site/style.css").set("X-Forwarded-Host", "forgotten-app-alias.example.test");
                expect(other.status).toBe(301);
                expect(other.headers.location).toBe("https://sites.example.test:8443/my-site/style.css");

                const served = await request(app).get("/my-site/").set("X-Forwarded-Host", "sites.example.test");
                expect(served.status).toBe(200);
            } finally {
                await repo.upsert({ publicSites: { urlMode: "path", publicDomain: "", sitesOrigin: "" } });
            }
        });
    });
});
