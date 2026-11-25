/**
 * E2E: saved form submissions ("forms capture", docs/specs/FORMS_CAPTURE.md).
 * Real app (createApp), MongoMemoryServer, real published files in a temporary DATA_DIR.
 *
 * The owner configures capture and publishes through the API; visitors submit to the same-origin
 * path /p/{publishId}/_pf/forms/{formId}/submit. Everything that decides acceptance is resolved
 * server-side from the live deployment; the scope { owner, project, form } is never crossed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import type { ServiceManifestV1 } from "@andy-code-cat/contracts";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "andy-forms-"));

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

const ownerA = new ObjectId();
const ownerB = new ObjectId();
const blockedOwner = new ObjectId();
const goneOwner = new ObjectId();
const projA = new ObjectId().toHexString();
const projB = new ObjectId().toHexString();
const projMailto = new ObjectId().toHexString();
const projBlocked = new ObjectId().toHexString();
const projSuspended = new ObjectId().toHexString();
const projGone = new ObjectId().toHexString();
const projFailed = new ObjectId().toHexString();

let publishA = "";
let publishB = "";
let publishMailto = "";

const privacyNotice = { version: "2026-11-01", url: "https://example.com/privacy", controllerName: "Example SRL", contactEmail: "privacy@example.com" };
const captureSettings = { enabled: true, mode: "capture", privacyNotice };

const manifest: ServiceManifestV1 = {
    version: "service-manifest-v1",
    forms: [{
        id: "contact",
        kind: "contact",
        title: "Contact us",
        purposeKey: "contact-request",
        submitLabel: "Send",
        successMessage: "Thanks",
        privacyNoticeRef: "project-default",
        steps: [{
            id: "one",
            title: "One",
            fields: [
                { id: "email", type: "email", label: "Email", required: true, dataCategory: "contact" },
                { id: "message", type: "textarea", label: "Message", required: true, maxLength: 200, dataCategory: "request" },
                { id: "people", type: "number", label: "People", required: false, min: 1, max: 9, dataCategory: "request" },
            ],
        }],
    }],
};

const tokenFor = (id: ObjectId) => jwt.sign({ sub: id.toHexString(), roles: ["user"] }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });

function as(id: ObjectId, projectId: string) {
    const headers = { Authorization: `Bearer ${tokenFor(id)}`, "x-project-id": projectId };
    return {
        put: (p: string, body: unknown) => request(app).put(p).set(headers).send(body as object),
        post: (p: string, body: unknown) => request(app).post(p).set(headers).send(body as object),
    };
}

let ipCounter = 10;
/** Each test submits from its own documentation-range IP so the per-IP limit stays per test. */
const nextIp = () => `198.51.100.${ipCounter++}`;

function submit(publishId: string, body: unknown, options: { formId?: string; ip?: string; headers?: Record<string, string> } = {}) {
    let req = request(app)
        .post(`/p/${publishId}/_pf/forms/${options.formId ?? "contact"}/submit`)
        .set("X-Forwarded-For", options.ip ?? nextIp())
        .set("Content-Type", "application/json");
    for (const [name, value] of Object.entries(options.headers ?? {})) req = req.set(name, value);
    return req.send(typeof body === "string" ? body : JSON.stringify(body));
}

const validBody = { fields: { email: "visitor@example.com", message: "Hello there" } };

async function db() {
    const { getDb } = await import("../../../../infra/db/mongo");
    return getDb();
}

async function submissionCount(filter: Record<string, unknown> = {}) {
    return (await db()).collection("form_submissions").countDocuments(filter);
}

async function seedSnapshot(projectId: string): Promise<string> {
    const id = randomUUID();
    await (await db()).collection<Record<string, unknown> & { _id: string }>("preview_snapshots").insertOne({
        _id: id,
        projectId,
        conversationId: "conv",
        isActive: true,
        artifacts: { html: "<main><h1>Site</h1><div data-pf-form-id='contact'></div></main>", css: "main{}", js: "window.generated = true;" },
        serviceManifest: manifest,
        createdAt: new Date(),
    });
    return id;
}

async function publishThroughApi(owner: ObjectId, projectId: string, settings: unknown): Promise<string> {
    const snapshotId = await seedSnapshot(projectId);
    const put = await as(owner, projectId).put(`/v1/projects/${projectId}/services/forms`, settings);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const published = await as(owner, projectId).post(`/v1/projects/${projectId}/publish`, { snapshotId });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    return published.body.publishId as string;
}

async function seedDeployment(projectId: string, userId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const snapshotId = await seedSnapshot(projectId);
    const publishId = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
    const now = new Date();
    await (await db()).collection<Record<string, unknown> & { _id: string }>("site_deployments").insertOne({
        _id: randomUUID(), projectId, userId, publishId, snapshotId, url: `/p/${publishId}`,
        filesDeployed: ["index.html"], status: "live", createdAt: now, updatedAt: now, ...extra,
    });
    return publishId;
}

describe("forms capture — public submit and project data", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { MongoSiteDeploymentRepository } = await import("../../../../infra/repositories/MongoSiteDeploymentRepository");
        app = createApp();
        await new MongoSiteDeploymentRepository().ensureIndexes();
        const database = await db();
        const now = new Date();
        await database.collection("users").insertMany([
            { _id: ownerA, email: "a@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
            { _id: ownerB, email: "b@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now },
            { _id: blockedOwner, email: "blocked@example.test", passwordHash: "x", emailVerified: true, isBlocked: true, roles: ["user"], createdAt: now },
        ]);
        const project = (id: string, owner: ObjectId, forms?: unknown) => ({
            _id: new ObjectId(id), ownerUserId: owner, name: id, createdAt: now, ...(forms ? { serviceConfig: { forms } } : {}),
        });
        await database.collection("projects").insertMany([
            project(projA, ownerA),
            project(projB, ownerB),
            project(projMailto, ownerA),
            project(projBlocked, blockedOwner, captureSettings),
            project(projSuspended, ownerA, captureSettings),
            project(projGone, goneOwner, captureSettings),
            project(projFailed, ownerA, captureSettings),
        ]);

        publishA = await publishThroughApi(ownerA, projA, captureSettings);
        publishB = await publishThroughApi(ownerB, projB, captureSettings);
        publishMailto = await publishThroughApi(ownerA, projMailto, { enabled: true, mode: "mailto", recipientEmail: "owner@example.com", privacyNotice });
    });

    afterAll(async () => {
        const { closeDb } = await import("../../../../infra/db/mongo");
        await closeDb();
        await mongod?.stop();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    it("publishes a capture form whose runtime config carries the same-origin submit path", async () => {
        const config = fs.readFileSync(path.join(DATA_DIR, "www", publishA, "pf-runtime-config.v1.js"), "utf8");
        expect(config).toContain(`"submitUrls":{"contact":"/p/${publishA}/_pf/forms/contact/submit"}`);
        expect(fs.existsSync(path.join(DATA_DIR, "www", publishA, "pf-forms-capture.v1.js"))).toBe(true);
        expect(fs.existsSync(path.join(DATA_DIR, "www", publishA, "pf-forms-mailto.v1.js"))).toBe(false);
        expect(fs.readFileSync(path.join(DATA_DIR, "www", publishA, "script.js"), "utf8")).toContain("window.generated = true;");

        const page = await request(app).get(`/p/${publishA}/`);
        expect(page.status).toBe(200);
        expect(page.text).toContain("data-pf-form-id='contact'");
        expect(page.text).toContain("pf-forms-capture.v1.js");
    });

    it("stores a valid submission for the live deployment, scoped and without the raw IP", async () => {
        const ip = nextIp();
        const res = await submit(publishA, { fields: { email: "visitor@example.com", message: "Hello there", people: "3" } }, { ip });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ ok: true });

        const docs = await (await db()).collection("form_submissions").find({ projectId: projA }).toArray();
        expect(docs).toHaveLength(1);
        const [doc] = docs;
        expect(doc).toMatchObject({
            ownerUserId: ownerA.toHexString(),
            projectId: projA,
            formId: "contact",
            publishId: publishA,
            fields: { email: "visitor@example.com", message: "Hello there", people: 3 },
            privacyNoticeVersion: "2026-11-01",
        });
        expect(doc!.snapshotId).toEqual(expect.any(String));
        expect(doc!.ipHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(doc)).not.toContain(ip);
    });

    it("refuses when capture is disabled or the project uses mailto (409)", async () => {
        const mailto = await submit(publishMailto, validBody);
        expect(mailto.status).toBe(409);
        expect(mailto.body.code).toBe("FORM_CAPTURE_DISABLED");

        await as(ownerA, projA).put(`/v1/projects/${projA}/services/forms`, { ...captureSettings, enabled: false });
        try {
            const disabled = await submit(publishA, validBody);
            expect(disabled.status).toBe(409);
        } finally {
            await as(ownerA, projA).put(`/v1/projects/${projA}/services/forms`, captureSettings);
        }
        expect(await submissionCount({ projectId: projMailto })).toBe(0);
    });

    it("refuses a form the deployed manifest does not declare (404)", async () => {
        const res = await submit(publishA, validBody, { formId: "newsletter" });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("FORM_NOT_FOUND");
        expect((await submit(publishA, validBody, { formId: "Bad_Id" })).status).toBe(404);
    });

    it("refuses unknown fields, wrong types and over-long values (400) without echoing them", async () => {
        const before = await submissionCount();
        const secret = "PRIVATE-VALUE-9f3a";
        const unknown = await submit(publishA, { fields: { ...validBody.fields, [secret]: secret } });
        expect(unknown.status).toBe(400);
        expect(unknown.body).toMatchObject({ ok: false, code: "FORM_SUBMISSION_INVALID", issues: [{ field: null, reason: "unknown_field" }] });
        expect(JSON.stringify(unknown.body)).not.toContain(secret);

        const wrongType = await submit(publishA, { fields: { email: secret, message: 42 } });
        expect(wrongType.status).toBe(400);
        expect(wrongType.body.issues).toEqual([
            { field: "email", reason: "invalid_format" },
            { field: "message", reason: "invalid_type" },
        ]);
        expect(JSON.stringify(wrongType.body)).not.toContain(secret);

        const tooLong = await submit(publishA, { fields: { email: "visitor@example.com", message: "x".repeat(201) } });
        expect(tooLong.status).toBe(400);
        expect(tooLong.body.issues).toEqual([{ field: "message", reason: "too_long" }]);

        const envelope = await submit(publishA, { fields: validBody.fields, projectId: projB });
        expect(envelope.status).toBe(400);
        const malformed = await submit(publishA, `{"fields": ${secret}`);
        expect(malformed.status).toBe(400);
        expect(JSON.stringify(malformed.body)).not.toContain(secret);

        expect(await submissionCount()).toBe(before);
    });

    it("refuses a site that is not live, admin-blocked, or whose owner is blocked or gone", async () => {
        const failed = await seedDeployment(projFailed, ownerA.toHexString(), { status: "failed" });
        const suspended = await seedDeployment(projSuspended, ownerA.toHexString(), { isAdminBlocked: true });
        const blocked = await seedDeployment(projBlocked, blockedOwner.toHexString());
        const gone = await seedDeployment(projGone, goneOwner.toHexString());

        expect((await submit(failed, validBody)).status).toBe(404);
        expect((await submit("zz99zz99", validBody)).status).toBe(404);
        const s = await submit(suspended, validBody);
        expect(s.status).toBe(403);
        expect(s.body.code).toBe("FORM_SITE_SUSPENDED");
        expect((await submit(blocked, validBody)).status).toBe(403);
        expect((await submit(gone, validBody)).status).toBe(403);
        expect(await submissionCount({ projectId: { $in: [projFailed, projSuspended, projBlocked, projGone] } })).toBe(0);
    });

    it("answers a filled honeypot with 202 and stores nothing", async () => {
        const before = await submissionCount();
        const res = await submit(publishA, { ...validBody, hp: "https://spam.example.com" });
        expect(res.status).toBe(202);
        expect(await submissionCount()).toBe(before);
    });

    it("refuses a payload over 16 KB (413) and a non-JSON body (415)", async () => {
        const before = await submissionCount();
        const big = await submit(publishA, { fields: { email: "visitor@example.com", message: "x".repeat(17 * 1024) } });
        expect(big.status).toBe(413);
        expect(big.body.code).toBe("FORM_SUBMISSION_TOO_LARGE");
        const text = await request(app).post(`/p/${publishA}/_pf/forms/contact/submit`).set("X-Forwarded-For", nextIp())
            .set("Content-Type", "text/plain").send("email=visitor@example.com");
        expect(text.status).toBe(415);
        expect(await submissionCount()).toBe(before);
    });

    it("refuses a POST on an app host instead of redirecting it, and a foreign Origin", async () => {
        const before = await submissionCount();
        const onApp = await submit(publishA, validBody, { headers: { "X-Forwarded-Host": "app.example.test" } });
        expect(onApp.status).toBe(403);
        expect(onApp.body.code).toBe("FORM_SITE_HOST_REFUSED");
        expect(onApp.headers.location).toBeUndefined();

        const foreign = await submit(publishA, validBody, { headers: { "X-Forwarded-Host": "sites.example.test", Origin: "https://evil.example.test" } });
        expect(foreign.status).toBe(403);
        expect(foreign.body.code).toBe("FORM_ORIGIN_REFUSED");
        const foreignReferer = await submit(publishA, validBody, { headers: { "X-Forwarded-Host": "sites.example.test", Referer: "https://evil.example.test/page" } });
        expect(foreignReferer.status).toBe(403);
        const opaque = await submit(publishA, validBody, { headers: { Origin: "null" } });
        expect(opaque.status).toBe(403);
        expect(await submissionCount()).toBe(before);

        const sameOrigin = await submit(publishA, validBody, { headers: { "X-Forwarded-Host": "sites.example.test", Origin: "https://sites.example.test" } });
        expect(sameOrigin.status).toBe(201);
    });

    it("with a sites origin configured, refuses (never redirects) a POST on any other host", async () => {
        const { MongoPlatformConfigRepository } = await import("../../../../infra/repositories/MongoPlatformConfigRepository");
        const repo = new MongoPlatformConfigRepository();
        await repo.upsert({ publicSites: { urlMode: "path", publicDomain: "", sitesOrigin: "https://sites.example.test" } });
        try {
            const other = await submit(publishA, validBody, { headers: { "X-Forwarded-Host": "api.example.test" } });
            expect(other.status).toBe(403);
            expect(other.headers.location).toBeUndefined();
            const onSites = await submit(publishA, validBody, { headers: { "X-Forwarded-Host": "sites.example.test" } });
            expect(onSites.status).toBe(201);
        } finally {
            await repo.upsert({ publicSites: { urlMode: "path", publicDomain: "", sitesOrigin: "" } });
        }
    });

    it("rate-limits one IP (429)", async () => {
        const ip = nextIp();
        const statuses: number[] = [];
        for (let i = 0; i < 21; i += 1) statuses.push((await submit(publishA, validBody, { ip, formId: "nope" })).status);
        expect(statuses.slice(0, 20).every((status) => status === 404)).toBe(true);
        expect(statuses[20]).toBe(429);
        // Another IP is not affected.
        expect((await submit(publishA, validBody, { formId: "nope" })).status).toBe(404);
    });

    it("rate-limits one site across IPs (429)", async () => {
        const { createPublishedFormSubmitRouter } = await import("../publishedFormSubmitRoutes");
        const small = express();
        small.set("trust proxy", 1);
        small.use("/p", createPublishedFormSubmitRouter({
            submitForm: { execute: async () => ({ outcome: "refused", status: 404, code: "FORM_NOT_FOUND" }) },
            isSiteHost: async () => true,
            limits: { perIp: 100, perSite: 2, windowMs: 60_000 },
        }));
        const hit = (ip: string) => request(small).post(`/p/${publishA}/_pf/forms/contact/submit`)
            .set("X-Forwarded-For", ip).set("Content-Type", "application/json").send(JSON.stringify(validBody));
        expect((await hit("203.0.113.1")).status).toBe(404);
        expect((await hit("203.0.113.2")).status).toBe(404);
        expect((await hit("203.0.113.3")).status).toBe(429);
        expect((await request(small).post("/p/ab12ab12/_pf/forms/contact/submit").set("X-Forwarded-For", "203.0.113.4")
            .set("Content-Type", "application/json").send(JSON.stringify(validBody))).status).toBe(404);
    });

    it("never logs a submitted value", async () => {
        const secret = "LOGGED-SECRET-7c1d";
        const spies = (["log", "info", "warn", "error"] as const).map((method) => vi.spyOn(console, method));
        try {
            await submit(publishA, { fields: { email: secret, message: secret, [secret]: secret } });
            await submit(publishMailto, { fields: { email: secret, message: secret } });
            await submit(publishA, { fields: { email: secret, message: "x".repeat(17 * 1024) } });
            await submit(publishA, `{"fields": "${secret}`);
            await submit(publishA, { fields: { email: `${secret}@example.com`, message: secret } });
            const logged = spies.flatMap((spy) => spy.mock.calls).map((call) => JSON.stringify(call)).join("\n");
            expect(logged).not.toContain(secret);
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }
    });

    it("exposes submissions through the forms capability of their own project only", async () => {
        const { createFormsProjectDataCapability } = await import("../../../../application/forms/FormsProjectDataCapability");
        const capability = createFormsProjectDataCapability();
        expect(capability.id).toBe("forms");
        expect(capability.label).toBe("Form submissions");

        expect((await submit(publishB, { fields: { email: "b-visitor@example.com", message: "Project B only" } })).status).toBe(201);
        const scopeA = { ownerUserId: ownerA.toHexString(), projectId: projA };
        const scopeB = { ownerUserId: ownerB.toHexString(), projectId: projB };

        const groupsA = await capability.groups(scopeA);
        expect(groupsA).toEqual([expect.objectContaining({ id: "contact", label: "Contact us" })]);
        const totalA = groupsA[0]!.records;
        expect(totalA).toBeGreaterThan(0);

        const listB = await capability.list(scopeB, { page: 1, limit: 50 });
        expect(listB.total).toBe(1);
        expect(listB.items[0]!.data).toMatchObject({ fields: { email: "b-visitor@example.com", message: "Project B only" } });
        expect(listB.items[0]!.data).not.toHaveProperty("ipHash");
        expect(JSON.stringify(listB)).not.toContain("\"visitor@example.com\"");

        // Wrong owner for project A, or project A with B's owner: nothing.
        expect((await capability.list({ ownerUserId: ownerB.toHexString(), projectId: projA }, { page: 1, limit: 50 })).total).toBe(0);
        expect(await capability.groups({ ownerUserId: ownerA.toHexString(), projectId: projB })).toEqual([]);

        // A's record id cannot be deleted through B's scope; clearing B leaves A intact.
        const [firstA] = (await capability.list(scopeA, { page: 1, limit: 1 })).items;
        expect(await capability.deleteRecord(scopeB, firstA!.id)).toBe(false);
        expect(await capability.clear(scopeB)).toBe(1);
        expect((await capability.list(scopeA, { page: 1, limit: 50 })).total).toBe(totalA);

        // Search is plain text over string values, newest first; export is newest first.
        expect((await submit(publishA, { fields: { email: "needle@example.com", message: "Find (me) .*" } })).status).toBe(201);
        const found = await capability.list(scopeA, { page: 1, limit: 50, search: "(ME) .*" });
        expect(found.total).toBe(1);
        expect(found.items[0]!.data).toMatchObject({ fields: { email: "needle@example.com" } });
        expect((await capability.list(scopeA, { page: 1, limit: 50, search: ".*" })).total).toBe(1);
        const exported = await capability.exportRecords(scopeA, "contact", 2);
        expect(exported).toHaveLength(2);
        expect(exported[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(exported[1]!.createdAt.getTime());
        expect(exported[0]!.data).toMatchObject({ fields: { email: "needle@example.com" } });

        // Delete one, then clear one form.
        expect(await capability.deleteRecord(scopeA, found.items[0]!.id)).toBe(true);
        expect(await capability.clear(scopeA, "contact")).toBe(totalA);
        expect(await capability.groups(scopeA)).toEqual([]);
    });
});
