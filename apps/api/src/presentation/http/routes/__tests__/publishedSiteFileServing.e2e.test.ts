/**
 * E2E: published-site file serving answers every request without taking the process down.
 * Real app (createApp), MongoMemoryServer, real files in a temporary DATA_DIR.
 *
 *  1. Only regular files are served: a directory name (the site's data/ folder, or the site root
 *     reached through an encoded dot) is a 404 on both address forms, and the app keeps serving.
 *  2. resolvePublishFile never returns the publish directory itself or a path outside it.
 *  3. A failure inside a public handler reaches the error middleware instead of escaping it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";
import type { Express } from "express";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "andy-site-files-"));

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.DATA_DIR = DATA_DIR;
process.env.STORAGE_ADAPTER = "local";
process.env.CORS_ORIGIN = "https://app.example.test";

const PUBLISH_ID = "fa11fa11";
const SLUG = "file-site";

let mongod: MongoMemoryServer;
let app: Express;

/**
 * GET with the path sent byte for byte. supertest goes through the WHATWG URL parser, which folds
 * an encoded dot segment ("%2E") away before the request leaves; a raw client does not, and nor
 * does a reverse proxy that forwards the original URI.
 */
async function rawGet(rawPath: string): Promise<number> {
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    try {
        return await new Promise<number>((resolve, reject) => {
            const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => {
                res.resume();
                res.on("end", () => resolve(res.statusCode ?? 0));
            });
            req.on("error", reject);
            req.end();
        });
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

function writeFile(rel: string, content: string) {
    const target = path.join(DATA_DIR, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

describe("published sites — file serving", () => {
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
        await db.collection("users").insertOne({
            _id: owner, email: "files@example.com", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: new Date(),
        });
        const now = new Date();
        await db.collection<Record<string, unknown> & { _id: string }>("site_deployments").insertOne({
            _id: "files", projectId: "p-files", userId: owner.toHexString(), snapshotId: "s", filesDeployed: ["index.html"],
            createdAt: now, updatedAt: now, status: "live", publishId: PUBLISH_ID, customSlug: SLUG, url: `/p/${PUBLISH_ID}`,
        });
        for (const dir of [PUBLISH_ID, SLUG]) {
            writeFile(`www/${dir}/index.html`, "<html><body>File site</body></html>");
            writeFile(`www/${dir}/style.css`, "body{}");
            writeFile(`www/${dir}/data/items.json`, "[1,2,3]");
            // A directory sitting where an asset name would be.
            fs.mkdirSync(path.join(DATA_DIR, `www/${dir}/fonts`), { recursive: true });
        }
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        const { getDb } = await import("../../../../infra/db/mongo");
        const db = await getDb();
        await db.client.close(true);
        await mongod.stop();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    describe("1. only regular files are served", () => {
        for (const prefix of [`/p/${PUBLISH_ID}`, `/${SLUG}`]) {
            for (const tail of ["/data", "/fonts", "/%2E", "/%2e", "/data/%2E", "/missing.css", "/data/missing.json", "/.hidden"]) {
                it(`GET ${prefix}${tail} → 404`, async () => {
                    expect(await rawGet(`${prefix}${tail}`)).toBe(404);
                });
            }
        }

        it("keeps serving the site after those requests", async () => {
            const index = await request(app).get(`/p/${PUBLISH_ID}/`);
            expect(index.status).toBe(200);
            expect(index.text).toContain("File site");
            const css = await request(app).get(`/p/${PUBLISH_ID}/style.css`);
            expect(css.status).toBe(200);
            const data = await request(app).get(`/${SLUG}/data/items.json`);
            expect(data.status).toBe(200);
            expect(data.text).toBe("[1,2,3]");
        });
    });

    describe("2. resolvePublishFile stays strictly inside the publish directory", () => {
        it("refuses the directory itself and any path outside it", async () => {
            const { localFileStorage } = await import("../../../../infra/storage/LocalFileStorage");
            const root = path.resolve(localFileStorage.publishDirPath(PUBLISH_ID));
            expect(localFileStorage.resolvePublishFile(PUBLISH_ID, ".")).toBeNull();
            expect(localFileStorage.resolvePublishFile(PUBLISH_ID, "")).toBeNull();
            expect(localFileStorage.resolvePublishFile(PUBLISH_ID, "data/..")).toBeNull();
            expect(localFileStorage.resolvePublishFile(PUBLISH_ID, `../${PUBLISH_ID}x/index.html`)).toBeNull();
            expect(localFileStorage.resolvePublishFile(PUBLISH_ID, "../other/index.html")).toBeNull();
            expect(localFileStorage.resolvePublishFile(PUBLISH_ID, "style.css")).toBe(path.join(root, "style.css"));
            expect(localFileStorage.resolvePublishFile(PUBLISH_ID, "data/items.json")).toBe(path.join(root, "data", "items.json"));
        });
    });

    describe("3. a failing lookup reaches the error middleware", () => {
        it("answers 500 when the deployment lookup rejects, and the next request is served", async () => {
            const { MongoSiteDeploymentRepository } = await import("../../../../infra/repositories/MongoSiteDeploymentRepository");
            const spy = vi.spyOn(MongoSiteDeploymentRepository.prototype, "findByPublishId")
                .mockRejectedValueOnce(new Error("simulated database failure"));
            const failed = await request(app).get(`/p/${PUBLISH_ID}/`);
            expect(failed.status).toBe(500);
            expect(failed.body.status).toBe(500);
            spy.mockRestore();

            const ok = await request(app).get(`/p/${PUBLISH_ID}/`);
            expect(ok.status).toBe(200);
        });

        it("answers 500 when the slug lookup rejects", async () => {
            const { MongoSiteDeploymentRepository } = await import("../../../../infra/repositories/MongoSiteDeploymentRepository");
            const spy = vi.spyOn(MongoSiteDeploymentRepository.prototype, "findLiveByCustomSlug")
                .mockRejectedValueOnce(new Error("simulated database failure"));
            const failed = await request(app).get(`/${SLUG}/style.css`);
            expect(failed.status).toBe(500);
            spy.mockRestore();
        });
    });
});
