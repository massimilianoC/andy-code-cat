import { Router } from "express";
import path from "path";
import fs from "fs";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoSiteDeploymentRepository } from "../../../infra/repositories/MongoSiteDeploymentRepository";
import { MongoPublishHistoryRepository } from "../../../infra/repositories/MongoPublishHistoryRepository";
import { localFileStorage } from "../../../infra/storage/LocalFileStorage";
import { PublishProject } from "../../../application/use-cases/PublishProject";
import { UnpublishProject } from "../../../application/use-cases/UnpublishProject";
import { GetSiteDeployment } from "../../../application/use-cases/GetSiteDeployment";
import { publishProjectSchema, customSlugSchema } from "@andy-code-cat/contracts";
import { env } from "../../../config";
import type { RequestWithContext } from "../types";
import type { SiteDeployment } from "../../../domain/entities/SiteDeployment";
import type { PublishHistoryEntry } from "../../../domain/entities/PublishHistory";

// MIME map for static files served from /p/:publishId
const MIME_MAP: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
};

// Validate publishId: only lowercase alphanumeric, 6-12 chars
const PUBLISH_ID_RE = /^[a-z0-9]{6,12}$/;

function toDto(d: SiteDeployment) {
    // Prefer customSlug for subdomain URL so human-readable link is shown when set
    const identifier = d.customSlug ?? d.publishId;
    const subdomainUrl = env.PUBLIC_DOMAIN
        ? `http://${identifier}.${env.PUBLIC_DOMAIN}`
        : null;
    return {
        id: d.id,
        publishId: d.publishId,
        projectId: d.projectId,
        status: d.status,
        url: d.url,
        subdomainUrl,
        customSlug: d.customSlug ?? null,
        filesDeployed: d.filesDeployed,
        snapshotId: d.snapshotId,
        errorMessage: d.errorMessage,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
        deployedAt: d.deployedAt?.toISOString(),
    };
}

function toHistoryDto(e: PublishHistoryEntry) {
    return {
        id: e.id,
        projectId: e.projectId,
        userId: e.userId,
        publishId: e.publishId,
        deploymentId: e.deploymentId,
        snapshotId: e.snapshotId,
        action: e.action,
        publishedAt: e.publishedAt.toISOString(),
    };
}

/**
 * Creates two sets of routes:
 * 1. publishApiRoutes — mounted at /v1, require auth + sandbox
 * 2. publishStaticRoutes — mounted at /p, public, serve static files
 */
export function createPublishRoutes() {
    const apiRouter = Router();
    const staticRouter = Router();

    const projectRepository = new MongoProjectRepository();
    const snapshotRepository = new MongoPreviewSnapshotRepository();
    const deploymentRepository = new MongoSiteDeploymentRepository();
    const historyRepository = new MongoPublishHistoryRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const publishProject = new PublishProject(deploymentRepository, snapshotRepository, localFileStorage, historyRepository);
    const unpublishProject = new UnpublishProject(deploymentRepository, localFileStorage);
    const getSiteDeployment = new GetSiteDeployment(deploymentRepository);

    // -----------------------------------------------------------------
    // POST /v1/projects/:projectId/publish — publish current snapshot
    // -----------------------------------------------------------------
    apiRouter.post(
        "/projects/:projectId/publish",
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const body = publishProjectSchema.parse(req.body);

                const deployment = await publishProject.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    snapshotId: body.snapshotId,
                    customSlug: body.customSlug,
                });

                res.status(201).json(toDto(deployment));
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /v1/projects/:projectId/publish — current deployment status
    // -----------------------------------------------------------------
    apiRouter.get(
        "/projects/:projectId/publish",
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const deployment = await getSiteDeployment.findActiveByProjectId(
                    req.sandbox!.projectId
                );
                if (!deployment) {
                    res.status(404).json({ error: "No active deployment" });
                    return;
                }
                if (deployment.userId !== req.auth!.userId) {
                    res.status(403).json({ error: "Access denied" });
                    return;
                }
                res.json(toDto(deployment));
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // DELETE /v1/projects/:projectId/publish/:deploymentId — unpublish
    // -----------------------------------------------------------------
    apiRouter.delete(
        "/projects/:projectId/publish/:deploymentId",
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                await unpublishProject.execute(
                    req.params.deploymentId!,
                    req.auth!.userId
                );
                res.status(204).send();
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /v1/projects/:projectId/publish/history — audit log
    // -----------------------------------------------------------------
    apiRouter.get(
        "/projects/:projectId/publish/history",
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const entries = await historyRepository.findByProjectId(req.sandbox!.projectId);
                res.json({ history: entries.map(toHistoryDto) });
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /v1/publish/check-slug?slug=xxx — public availability check
    // No auth required. Returns { available: boolean, slug: string }.
    // -----------------------------------------------------------------
    apiRouter.get("/publish/check-slug", async (req, res, next) => {
        try {
            const raw = req.query.slug;
            if (typeof raw !== "string") {
                res.status(400).json({ error: "slug query param is required" });
                return;
            }
            const parsed = customSlugSchema.safeParse(raw);
            if (!parsed.success) {
                res.json({ available: false, slug: raw, reason: "invalid" });
                return;
            }
            const taken = await deploymentRepository.isCustomSlugTaken(parsed.data);
            res.json({ available: !taken, slug: parsed.data });
        } catch (error) {
            next(error);
        }
    });

    // -----------------------------------------------------------------
    // PATCH /v1/projects/:projectId/publish/slug — update custom slug
    // Body: { customSlug: string | null }
    // Copies files from publishId dir to new slug dir, deletes old slug dir.
    // -----------------------------------------------------------------
    apiRouter.patch(
        "/projects/:projectId/publish/slug",
        authMiddleware,
        sandboxMiddleware,
        async (req: RequestWithContext, res, next) => {
            try {
                const { customSlug: rawSlug } = req.body;

                // Validate: null clears the slug; string must match schema
                let newSlug: string | null;
                if (rawSlug === null || rawSlug === undefined) {
                    newSlug = null;
                } else {
                    const parsed = customSlugSchema.safeParse(rawSlug);
                    if (!parsed.success) {
                        res.status(400).json({ error: "Invalid slug format" });
                        return;
                    }
                    newSlug = parsed.data;
                }

                // Fetch active deployment
                const deployment = await deploymentRepository.findActiveByProjectId(
                    req.sandbox!.projectId
                );
                if (!deployment) {
                    res.status(404).json({ error: "No active deployment" });
                    return;
                }
                if (deployment.userId !== req.auth!.userId) {
                    res.status(403).json({ error: "Access denied" });
                    return;
                }

                const oldSlug = deployment.customSlug ?? null;

                if (newSlug !== null) {
                    // Check availability (exclude current deployment)
                    const taken = await deploymentRepository.isCustomSlugTaken(newSlug, deployment.id);
                    if (taken) {
                        res.status(409).json({ error: "Slug is already taken" });
                        return;
                    }
                    // Copy published files to new slug dir
                    await localFileStorage.copyPublishDir(deployment.publishId, newSlug);
                }

                // Delete old slug dir (best-effort) when slug changes
                if (oldSlug && oldSlug !== newSlug) {
                    await localFileStorage.deletePublishDir(oldSlug).catch(() => { /* best-effort */ });
                }

                const updated = await deploymentRepository.updateCustomSlug(deployment.id, newSlug);
                res.json(toDto(updated ?? deployment));
            } catch (error) {
                next(error);
            }
        }
    );

    // -----------------------------------------------------------------
    // GET /p/:publishId — serve published index.html (PUBLIC)
    // GET /p/:publishId/:file — serve any published file (PUBLIC)
    // -----------------------------------------------------------------
    // CSP for published pages: allow CDN scripts, external images, fonts and styles.
    // This overrides helmet's restrictive default-src 'self' for public static sites.
    const PUBLISHED_PAGE_CSP =
        "default-src 'self' https:; " +
        "script-src 'self' https: 'unsafe-inline'; " +
        "style-src 'self' https: 'unsafe-inline'; " +
        "img-src 'self' data: https: blob:; " +
        "font-src 'self' data: https:; " +
        "connect-src 'self' https:; " +
        "frame-src 'self' https:;";

    staticRouter.get("/:publishId", async (req, res) => {
        const { publishId } = req.params;
        if (!PUBLISH_ID_RE.test(publishId)) {
            res.status(404).send("Not found");
            return;
        }

        // Redirect to trailing-slash URL so the browser resolves relative paths
        // (style.css, script.js) relative to /p/{publishId}/ not /p/
        if (!req.originalUrl.endsWith("/")) {
            res.redirect(301, `/p/${publishId}/`);
            return;
        }

        const filePath = localFileStorage.resolvePublishFile(publishId, "index.html");
        if (!filePath) {
            res.status(404).send("Not found");
            return;
        }

        try {
            await fs.promises.access(filePath);
        } catch {
            res.status(404).send("Not found");
            return;
        }

        // index.html must never be served stale — always revalidate.
        // ETag allows the browser to get a 304 Not Modified when the file hasn't changed,
        // avoiding a full re-download while still guaranteeing freshness on every republish.
        const stat = await fs.promises.stat(filePath);
        const etag = `"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
        res.setHeader("ETag", etag);
        res.setHeader("Last-Modified", stat.mtime.toUTCString());
        if (req.headers["if-none-match"] === etag) {
            res.status(304).end();
            return;
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        // no-cache: browser revalidates on every navigation. Combined with ETag this gives
        // instant freshness after a republish while still leveraging the browser cache.
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", PUBLISHED_PAGE_CSP);
        fs.createReadStream(filePath).pipe(res);
    });

    staticRouter.get("/:publishId/:file", async (req, res) => {
        const { publishId, file } = req.params;
        if (!PUBLISH_ID_RE.test(publishId) || !file) {
            res.status(404).send("Not found");
            return;
        }

        // Only allow simple filenames — no path traversal
        if (file.includes("..") || file.includes("/") || file.includes("\\")) {
            res.status(400).send("Invalid path");
            return;
        }

        const filePath = localFileStorage.resolvePublishFile(publishId, file);
        if (!filePath) {
            res.status(404).send("Not found");
            return;
        }

        try {
            await fs.promises.access(filePath);
        } catch {
            res.status(404).send("Not found");
            return;
        }

        const ext = path.extname(file).toLowerCase();
        const contentType = MIME_MAP[ext] ?? "application/octet-stream";

        // ETag + conditional GET for all assets
        const stat = await fs.promises.stat(filePath);
        const etag = `"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
        res.setHeader("ETag", etag);
        res.setHeader("Last-Modified", stat.mtime.toUTCString());
        if (req.headers["if-none-match"] === etag) {
            res.status(304).end();
            return;
        }

        // CSS and JS are cache-busted via ?v=<hash> injected into index.html at publish time.
        // Because their effective URL changes on every content change they can be cached
        // indefinitely.  All other assets (images, fonts) get a 1-day cache.
        const cacheControl = [".css", ".js"].includes(ext)
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", cacheControl);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", PUBLISHED_PAGE_CSP);
        fs.createReadStream(filePath).pipe(res);
    });

    return { apiRouter, staticRouter };
}
