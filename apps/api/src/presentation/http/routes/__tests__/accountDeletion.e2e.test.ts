/**
 * E2E: deleting an account leaves nothing of it behind (security review A2/M8).
 * Real app (createApp), MongoMemoryServer, real files in a temporary DATA_DIR.
 *
 * The account owns a project with a record in every project-scoped collection, account-level
 * records, stored files and a published site. After DELETE /v1/admin/users/:id no document in any
 * collection refers to the account or its project, no file or directory of it remains, and the
 * site is no longer served. A failing step keeps the account (blocked) and the project.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { ObjectId, type Db } from "mongodb";
import type { Express } from "express";
import jwt from "jsonwebtoken";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "andy-account-del-"));

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";
process.env.DATA_DIR = DATA_DIR;
process.env.STORAGE_ADAPTER = "local";
process.env.CORS_ORIGIN = "https://app.example.test";

/** Collections that are meant to outlive the account (audit trails). */
const KEPT = new Set(["admin_audit_logs", "execution_logs"]);

let mongod: MongoMemoryServer;
let app: Express;
let db: Db;

const admin = new ObjectId();
const adminToken = () => jwt.sign({ sub: admin.toHexString(), roles: ["superadmin"] }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "1h" });

function writeFile(rel: string, content = "x") {
    const target = path.join(DATA_DIR, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

interface Seeded { user: ObjectId; userId: string; projectId: string; publishId: string; slug: string }

async function seedAccount(tag: string): Promise<Seeded> {
    const user = new ObjectId();
    const userId = user.toHexString();
    const projectId = new ObjectId().toHexString();
    const publishId = `${tag}0pub01`;
    const slug = `${tag}-site`;
    const now = new Date();
    const doc = (extra: Record<string, unknown> = {}) => ({ _id: `${tag}-${new ObjectId().toHexString()}`, createdAt: now, ...extra }) as Record<string, unknown> & { _id: string };
    const byProject = { projectId, userId };

    await db.collection("users").insertOne({ _id: user, email: `${tag}@example.test`, passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["user"], createdAt: now });
    await db.collection("projects").insertOne({ _id: new ObjectId(projectId), ownerUserId: user, name: tag, presetId: "landing", createdAt: now });
    const insert = (name: string, extra: Record<string, unknown>) => db.collection<Record<string, unknown> & { _id: string }>(name).insertOne(doc(extra));

    // Project-scoped records.
    await insert("project_moodboards", { projectId });
    for (const name of ["prompt_execution_logs", "cost_transactions", "conversations", "work_sessions", "vibe_intakes",
        "zero_effort_form_proposals", "background_runs", "export_records"]) {
        await insert(name, byProject);
    }
    await insert("pipeline_runs", { projectId, ownerUserId: userId });
    for (const name of ["preview_snapshots", "media_resolution_traces", "publish_history", "wysiwyg_edit_sessions",
        "didactic_artifact_knowledge", "didactic_qna", "llm_prompt_configs"]) {
        await insert(name, { projectId, userId });
    }
    await insert("project_assets", { ...byProject, scope: "project", storedFilename: "a.png" });
    await insert("brand_assets", { scope: "project", projectId, ownerUserId: userId });
    await insert("form_submissions", { ownerUserId: userId, projectId, formId: "contact" });
    await insert("leaderboard_scores", { ownerUserId: userId, projectId, boardId: "main" });
    await insert("site_deployments", { projectId, userId, publishId, customSlug: slug, status: "live", url: `/p/${publishId}`, snapshotId: "s", filesDeployed: ["index.html"], updatedAt: now });

    // Account-scoped records.
    await db.collection("sessions").insertOne({ userId: user, tokenId: `${tag}-token`, refreshTokenHash: "x", createdAt: now, expiresAt: new Date(Date.now() + 86_400_000) });
    await insert("user_templates", { ownerId: userId, tenantId: "t", isSystem: false, status: "active" });
    await insert("user_preferences", { userId });
    await insert("user_style_profiles", { userId });
    await insert("system_notifications", { userId, status: "unread" });
    await insert("service_api_keys", { ownerType: "user", ownerUserId: userId, service: "x" });
    await insert("brand_assets", { scope: "user", ownerUserId: userId });
    await insert("project_assets", { userId, projectId: "library", scope: "user", storedFilename: "lib.png" });

    // Files.
    writeFile(`uploads/${userId}/${projectId}/a.png`);
    writeFile(`uploads/${userId}/brand/logo.png`);
    writeFile(`exports/${userId}/${projectId}/e1.zip`);
    writeFile(`workspaces/${userId}/${projectId}/job/input/x`);
    writeFile(`profiles/${userId}/dataset-cache-${projectId}-a1.json`, "{}");
    writeFile(`thumbnails/${projectId}/s.jpg`);
    for (const dir of [publishId, slug]) writeFile(`www/${dir}/index.html`, `<html>${tag}</html>`);
    return { user, userId, projectId, publishId, slug };
}

async function residue(s: Seeded): Promise<string[]> {
    const found: string[] = [];
    const filter = {
        $or: [
            { _id: s.user }, { userId: s.userId }, { userId: s.user }, { ownerUserId: s.userId }, { ownerUserId: s.user },
            { ownerId: s.userId }, { projectId: s.projectId }, { _id: new ObjectId(s.projectId) },
        ],
    };
    for (const { name } of await db.listCollections().toArray()) {
        if (KEPT.has(name)) continue;
        const count = await db.collection(name).countDocuments(filter);
        if (count > 0) found.push(`${name}: ${count}`);
    }
    for (const rel of [`uploads/${s.userId}`, `exports/${s.userId}`, `workspaces/${s.userId}`, `profiles/${s.userId}`,
        `thumbnails/${s.projectId}`, `www/${s.publishId}`, `www/${s.slug}`]) {
        if (fs.existsSync(path.join(DATA_DIR, rel))) found.push(`file: ${rel}`);
    }
    return found;
}

describe("account deletion", () => {
    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        process.env.MONGODB_URI = mongod.getUri();
        const { createApp } = await import("../../../../app");
        const { getDb } = await import("../../../../infra/db/mongo");
        app = createApp();
        db = await getDb();
        await db.collection("users").insertOne({ _id: admin, email: "admin@example.test", passwordHash: "x", emailVerified: true, isBlocked: false, roles: ["superadmin"], createdAt: new Date() });
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        const { closeDb } = await import("../../../../infra/db/mongo");
        await closeDb();
        await mongod?.stop();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    it("leaves no record, file or served site of the account", async () => {
        const seeded = await seedAccount("aa");
        const bystander = await seedAccount("bb");
        expect((await residue(seeded)).length).toBeGreaterThan(20);

        const res = await request(app).delete(`/v1/admin/users/${seeded.userId}`).set("Authorization", `Bearer ${adminToken()}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ deleted: true, projectsDeleted: 1 });

        expect(await residue(seeded)).toEqual([]);
        expect((await request(app).get(`/p/${seeded.publishId}/`)).status).toBe(404);
        expect((await request(app).get(`/${seeded.slug}/`)).status).toBe(404);

        // Another account is untouched.
        expect((await residue(bystander)).length).toBeGreaterThan(20);
        expect((await request(app).get(`/p/${bystander.publishId}/`)).status).toBe(200);
    });

    it("keeps the account blocked, and its project, when a step fails; a retry completes it", async () => {
        const seeded = await seedAccount("cc");
        const { MongoDidacticQnaRepository } = await import("../../../../infra/repositories/MongoDidacticQnaRepository");
        const spy = vi.spyOn(MongoDidacticQnaRepository.prototype, "deleteByProject").mockRejectedValueOnce(new Error("simulated failure"));
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const failed = await request(app).delete(`/v1/admin/users/${seeded.userId}`).set("Authorization", `Bearer ${adminToken()}`);
        expect(failed.status).toBe(500);
        expect(failed.body.code).toBe("PROJECT_DELETE_INCOMPLETE");
        const user = await db.collection("users").findOne({ _id: seeded.user });
        expect(user?.isBlocked).toBe(true);
        expect(await db.collection("projects").countDocuments({ _id: new ObjectId(seeded.projectId) })).toBe(1);
        expect(await db.collection("didactic_qna").countDocuments({ projectId: seeded.projectId })).toBe(1);
        spy.mockRestore();
        errorLog.mockRestore();

        const retried = await request(app).delete(`/v1/admin/users/${seeded.userId}`).set("Authorization", `Bearer ${adminToken()}`);
        expect(retried.status).toBe(200);
        expect(await residue(seeded)).toEqual([]);
    });

    it("superadmin project deletion runs the same deletion", async () => {
        const seeded = await seedAccount("dd");
        const res = await request(app).delete(`/v1/admin/projects/${seeded.projectId}`).set("Authorization", `Bearer ${adminToken()}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ deleted: true });
        for (const name of ["form_submissions", "leaderboard_scores", "didactic_qna", "site_deployments", "project_assets", "llm_prompt_configs"]) {
            expect(await db.collection(name).countDocuments({ projectId: seeded.projectId }), name).toBe(0);
        }
        expect(fs.existsSync(path.join(DATA_DIR, `uploads/${seeded.userId}/${seeded.projectId}`))).toBe(false);
        expect(fs.existsSync(path.join(DATA_DIR, `www/${seeded.publishId}`))).toBe(false);
        // The account itself is not touched by a project deletion.
        expect(await db.collection("users").countDocuments({ _id: seeded.user })).toBe(1);
    });
});
