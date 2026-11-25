import { Router, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoSiteDeploymentRepository } from "../../../infra/repositories/MongoSiteDeploymentRepository";
import { MongoPublishHistoryRepository } from "../../../infra/repositories/MongoPublishHistoryRepository";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { MongoPreviewSnapshotRepository } from "../../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoFormSubmissionRepository } from "../../../infra/repositories/MongoFormSubmissionRepository";
import { SubmitPublishedForm, resolveFormIpHashSalt } from "../../../application/forms/SubmitPublishedForm";
import { createPublishedFormSubmitRouter } from "./publishedFormSubmitRoutes";
import { localFileStorage } from "../../../infra/storage/LocalFileStorage";
import { composePublishProject } from "../../../composition/composeVibeEntryStages";
import { UnpublishProject } from "../../../application/use-cases/UnpublishProject";
import { GetSiteDeployment } from "../../../application/use-cases/GetSiteDeployment";
import { publishProjectSchema, customSlugSchema, classifySlugFormat, isPublicSiteSlug } from "@andy-code-cat/contracts";
import { appHostnames, decideSiteRequest, resolvePublicSitesConfig, resolvePublicSiteUrl } from "../../../application/publish/publicSiteAddress";
import { env } from "../../../config";
import type { PublicSitesConfig } from "../../../domain/entities/PlatformConfig";
import type { SlugCheckResponse } from "@andy-code-cat/contracts";
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

function toDto(d: SiteDeployment, publicSites: PublicSitesConfig) {
    return {
        id: d.id,
        publishId: d.publishId,
        projectId: d.projectId,
        status: d.status,
        url: d.url,
        publicUrl: resolvePublicSiteUrl(d, publicSites),
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
 * Creates three sets of routes:
 * 1. publicRouter — mounted at /v1 BEFORE any auth-applying router, no auth.
 *    Holds /publish/check-slug, which must stay reachable without a token.
 * 2. apiRouter — mounted at /v1, require auth + sandbox
 * 3. staticRouter — mounted at /p, public, serve static files by publishId
 * 4. siteRouter — mounted at the API root LAST, public, serves the same files by custom slug
 * 5. formSubmitRouter — mounted at /p BEFORE the global JSON parser, public: the capture form
 *    submit path /p/:publishId/_pf/forms/:formId/submit (docs/specs/FORMS_CAPTURE.md)
 *
 * Why publicRouter is separate: several /v1 routers call `router.use(authMiddleware)`,
 * and Express runs those for every /v1 request that reaches them in mount order. If the
 * public check-slug route is mounted after them (as part of apiRouter), the auth middleware
 * short-circuits the request with 401 before it ever reaches the handler — which is exactly
 * why slug validation silently failed in production. Mounting publicRouter early fixes it.
 */
export function createPublishRoutes() {
    const apiRouter = Router();
    const staticRouter = Router();
    const siteRouter = Router();
    const publicRouter = Router();

    const projectRepository = new MongoProjectRepository();
    const deploymentRepository = new MongoSiteDeploymentRepository();
    const historyRepository = new MongoPublishHistoryRepository();
    const userRepository = new MongoUserRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    const platformConfigRepository = new MongoPlatformConfigRepository();
    const publishProject = composePublishProject();
    const unpublishProject = new UnpublishProject(deploymentRepository, localFileStorage);
    const getSiteDeployment = new GetSiteDeployment(deploymentRepository);
    const publicSites = async () => resolvePublicSitesConfig(await platformConfigRepository.get());

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

                const project = await projectRepository.findByIdForUser(req.sandbox!.projectId, req.auth!.userId);
                const deployment = await publishProject.execute({
                    projectId: req.sandbox!.projectId,
                    userId: req.auth!.userId,
                    snapshotId: body.snapshotId,
                    customSlug: body.customSlug,
                    presetId: project?.presetId,
                    formSettings: project?.serviceConfig?.forms,
                });

                res.status(201).json(toDto(deployment, await publicSites()));
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
                res.json(toDto(deployment, await publicSites()));
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
    // No auth required. Returns a coherent SlugCheckResponse for every outcome:
    // reason ∈ "ok" | "taken" | "invalid" | "reserved" so the UI can show the
    // exact reason a slug can't be used (not just a generic "already in use").
    // Optional `excludeDeploymentId` lets a caller editing its own slug treat
    // its current value as available instead of "taken".
    // NOTE: registered on publicRouter (mounted before the auth routers) so it
    // is reachable without a bearer token. See createPublishRoutes() docblock.
    // -----------------------------------------------------------------
    publicRouter.get("/publish/check-slug", async (req, res, next) => {
        try {
            const raw = req.query.slug;
            if (typeof raw !== "string") {
                res.status(400).json({ error: "slug query param is required" });
                return;
            }
            const { normalized, reason: formatReason } = classifySlugFormat(raw);
            if (formatReason !== "ok") {
                const response: SlugCheckResponse = { available: false, slug: normalized, reason: formatReason };
                res.json(response);
                return;
            }
            const exclude = typeof req.query.excludeDeploymentId === "string" ? req.query.excludeDeploymentId : undefined;
            const taken = await deploymentRepository.isCustomSlugTaken(normalized, exclude);
            const response: SlugCheckResponse = {
                available: !taken,
                slug: normalized,
                reason: taken ? "taken" : "ok",
            };
            res.json(response);
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
                    // Friendly early answer; the unique slug index below is the actual lock.
                    const taken = await deploymentRepository.isCustomSlugTaken(newSlug, deployment.id);
                    if (taken) {
                        res.status(409).json({ error: "Slug is already taken" });
                        return;
                    }
                }

                // Claim the slug in the database first (unique index → 409 on a concurrent claim);
                // only the holder then writes the new slug directory and removes the old one.
                const updated = await deploymentRepository.updateCustomSlug(deployment.id, newSlug);
                if (newSlug !== null) {
                    await localFileStorage.copyPublishDir(deployment.publishId, newSlug);
                }
                if (oldSlug && oldSlug !== newSlug) {
                    await localFileStorage.deletePublishDir(oldSlug).catch(() => { /* best-effort */ });
                }
                res.json(toDto(updated ?? deployment, await publicSites()));
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
        "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' https: 'unsafe-inline'; " +
        "img-src 'self' data: https: blob:; " +
        "font-src 'self' data: https:; " +
        "connect-src 'self' https:; " +
        "frame-src 'self' https:;";

    // One serving path for both public addresses of a site: /p/{publishId}/ and /{slug}/.
    // The slug router only translates its slug to the live deployment's publishId; suspension
    // checks, headers, caching and file resolution are the same code for both.

    const APP_HOSTS = appHostnames(env.CORS_ORIGIN);

    /**
     * Site content is never executed on the app's origin (see decideSiteRequest): on an app host
     * the request is redirected to the site's own address, or refused when there is none.
     * Returns true when the response has been sent. Off the app hosts it costs nothing.
     */
    if (APP_HOSTS.length === 0 && env.NODE_ENV === "production") {
        console.warn("[published-site] CORS_ORIGIN names no app host: only a configured sites origin keeps published sites off the app's origin");
    }

    async function divertFromAppOrigin(req: Request, res: Response, publishId: string, deployment: SiteDeployment | null, sitePrefix: string): Promise<boolean> {
        const requestHostname = (req.hostname ?? "").toLowerCase();
        const config = await publicSites();
        // Fast path: no sites origin configured and not an app host — nothing to decide.
        if (!(config.urlMode === "path" && config.sitesOrigin) && !APP_HOSTS.includes(requestHostname)) return false;
        const sitePath = req.originalUrl.startsWith(sitePrefix) ? req.originalUrl.slice(sitePrefix.length) : "/";
        const decision = decideSiteRequest({
            requestHostname,
            appHosts: APP_HOSTS,
            config,
            deployment,
            publishId,
            sitePath,
        });
        if (decision.action === "redirect") {
            res.redirect(301, decision.location);
            return true;
        }
        if (decision.action === "refuse") {
            console.warn("[published-site] refused on the app origin", { host: requestHostname, path: req.originalUrl, reason: decision.reason });
            res.status(404).send("Not found");
            return true;
        }
        return false;
    }

    /** Sends 403 and returns true when the site or its owner is suspended. */
    async function rejectSuspended(res: Response, deploymentRecord: SiteDeployment): Promise<boolean> {
        if (deploymentRecord?.isAdminBlocked) {
            res.status(403).setHeader("Content-Type", "text/plain; charset=utf-8").send(
                "This site has been suspended by the platform administrator."
            );
            return true;
        }
        if (deploymentRecord) {
            // Fail closed: if the owner cannot be checked, the site is not served.
            let owner;
            try {
                owner = await userRepository.findById(deploymentRecord.userId);
            } catch (error) {
                console.error("[published-site] owner check failed; not serving", { publishId: deploymentRecord.publishId, error });
                res.status(503).setHeader("Content-Type", "text/plain; charset=utf-8").send("Temporarily unavailable");
                return true;
            }
            if (owner?.isBlocked) {
                res.status(403).setHeader("Content-Type", "text/plain; charset=utf-8").send(
                    "This site is unavailable because the owner account has been suspended."
                );
                return true;
            }
            // A live site whose owner record is gone (deleted account) is not a suspension: it keeps
            // being served, as before, and is reported so the superadmin can decide (admin block).
            if (!owner) {
                console.warn("[published-site] owner account not found; serving live site — block it from the admin panel if unwanted", {
                    publishId: deploymentRecord.publishId,
                    userId: deploymentRecord.userId,
                });
            }
        }
        return false;
    }

    /**
     * index.html of a site. `canonicalPath` is the trailing-slash address the request came in on
     * (`/p/{publishId}/` or `/{slug}/`): the browser must be there so the site's relative
     * style.css / script.js resolve inside it.
     */
    async function sendSiteIndex(req: Request, res: Response, publishId: string, canonicalPath: string, deploymentRecord: SiteDeployment) {
        if (!(req.originalUrl.split("?")[0] ?? "").endsWith("/")) {
            res.redirect(301, canonicalPath);
            return;
        }
        if (await rejectSuspended(res, deploymentRecord)) return;

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

        // Override helmet's restrictive default CSP before the 304 check so the permissive
        // policy is sent on both 200 and 304 responses (304 headers update the browser cache).
        // removeHeader first eliminates any existing CSP set by helmet, ensuring a single header.
        res.removeHeader("Content-Security-Policy");
        res.setHeader("Content-Security-Policy", PUBLISHED_PAGE_CSP);
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
        fs.createReadStream(filePath).pipe(res);
    }

    /** Any other file of a site: a top-level asset, or a dataset under data/. */
    async function sendSiteFile(req: Request, res: Response, publishId: string, file: string, kind: "asset" | "data", deploymentRecord: SiteDeployment) {
        if (await rejectSuspended(res, deploymentRecord)) return;

        // Only allow simple filenames — no path traversal
        if (file.includes("..") || file.includes("/") || file.includes("\\")) {
            res.status(400).send("Invalid path");
            return;
        }

        const filePath = localFileStorage.resolvePublishFile(publishId, kind === "data" ? `data/${file}` : file);
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

        // Same override pattern as the index.html handler: remove helmet's restrictive CSP
        // first, then set the permissive one before the 304 check.
        res.removeHeader("Content-Security-Policy");
        res.setHeader("Content-Security-Policy", PUBLISHED_PAGE_CSP);
        res.setHeader("ETag", etag);
        res.setHeader("Last-Modified", stat.mtime.toUTCString());
        if (req.headers["if-none-match"] === etag) {
            res.status(304).end();
            return;
        }

        // CSS and JS are cache-busted via ?v=<hash> injected into index.html at publish time.
        // Because their effective URL changes on every content change they can be cached
        // indefinitely.  All other assets (images, fonts) and datasets get a 1-day cache.
        const cacheControl = kind === "asset" && [".css", ".js"].includes(ext)
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", cacheControl);
        res.setHeader("X-Content-Type-Options", "nosniff");
        fs.createReadStream(filePath).pipe(res);
    }

    // ---- /p/{publishId}/ ----
    staticRouter.get("/:publishId", async (req, res) => {
        const { publishId } = req.params;
        if (!PUBLISH_ID_RE.test(publishId)) {
            res.status(404).send("Not found");
            return;
        }
        const deploymentRecord = await deploymentRepository.findByPublishId(publishId);
        // Only a live deployment is served. Without this, /p/{x} served any directory named x —
        // a slug's copy or an orphan — skipping the suspension checks, which need the record.
        if (!deploymentRecord) {
            res.status(404).send("Not found");
            return;
        }
        if (await divertFromAppOrigin(req, res, publishId, deploymentRecord, `/p/${publishId}`)) return;
        await sendSiteIndex(req, res, publishId, `/p/${publishId}/`, deploymentRecord);
    });

    staticRouter.get("/:publishId/:file", async (req, res) => {
        const { publishId, file } = req.params;
        if (!PUBLISH_ID_RE.test(publishId) || !file) {
            res.status(404).send("Not found");
            return;
        }
        const deploymentRecord = await deploymentRepository.findByPublishId(publishId);
        // Only a live deployment is served. Without this, /p/{x} served any directory named x —
        // a slug's copy or an orphan — skipping the suspension checks, which need the record.
        if (!deploymentRecord) {
            res.status(404).send("Not found");
            return;
        }
        if (await divertFromAppOrigin(req, res, publishId, deploymentRecord, `/p/${publishId}`)) return;
        await sendSiteFile(req, res, publishId, file, "asset", deploymentRecord);
    });

    staticRouter.get("/:publishId/data/:file", async (req, res) => {
        const { publishId, file } = req.params;
        if (!PUBLISH_ID_RE.test(publishId) || !file) {
            res.status(404).send("Not found");
            return;
        }
        const deploymentRecord = await deploymentRepository.findByPublishId(publishId);
        // Only a live deployment is served. Without this, /p/{x} served any directory named x —
        // a slug's copy or an orphan — skipping the suspension checks, which need the record.
        if (!deploymentRecord) {
            res.status(404).send("Not found");
            return;
        }
        if (await divertFromAppOrigin(req, res, publishId, deploymentRecord, `/p/${publishId}`)) return;
        await sendSiteFile(req, res, publishId, file, "data", deploymentRecord);
    });

    // ---- /{slug}/ ----
    // Mounted at the API root, after every other route. A first segment that cannot be a slug
    // (bad shape, or a reserved root segment such as v1/p/health) is left to the next handler.
    // A slug-shaped segment with no live deployment is a 404 here: the namespace is the sites'.
    // The web app forwards the same paths here (apps/web/middleware.ts), so `/{slug}/` works on
    // the web origin and on the API origin alike.
    async function liveDeploymentForSlug(slug: string): Promise<SiteDeployment | null> {
        return deploymentRepository.findLiveByCustomSlug(slug);
    }

    siteRouter.get("/:slug", async (req, res, next) => {
        const { slug } = req.params;
        if (!isPublicSiteSlug(slug)) return next();
        const deployment = await liveDeploymentForSlug(slug);
        if (!deployment) {
            res.status(404).send("Not found");
            return;
        }
        if (await divertFromAppOrigin(req, res, deployment.publishId, deployment, `/${slug}`)) return;
        await sendSiteIndex(req, res, deployment.publishId, `/${slug}/`, deployment);
    });

    siteRouter.get("/:slug/:file", async (req, res, next) => {
        const { slug, file } = req.params;
        if (!isPublicSiteSlug(slug)) return next();
        const deployment = await liveDeploymentForSlug(slug);
        if (!deployment || !file) {
            res.status(404).send("Not found");
            return;
        }
        if (await divertFromAppOrigin(req, res, deployment.publishId, deployment, `/${slug}`)) return;
        await sendSiteFile(req, res, deployment.publishId, file, "asset", deployment);
    });

    siteRouter.get("/:slug/data/:file", async (req, res, next) => {
        const { slug, file } = req.params;
        if (!isPublicSiteSlug(slug)) return next();
        const deployment = await liveDeploymentForSlug(slug);
        if (!deployment || !file) {
            res.status(404).send("Not found");
            return;
        }
        if (await divertFromAppOrigin(req, res, deployment.publishId, deployment, `/${slug}`)) return;
        await sendSiteFile(req, res, deployment.publishId, file, "data", deployment);
    });

    // ---- POST /p/{publishId}/_pf/forms/{formId}/submit ----
    // Same host rule as the site's pages (decideSiteRequest), but a POST is refused, never
    // redirected. The redirect target is irrelevant here, so no deployment lookup is needed.
    async function isSiteHost(req: Request, publishId: string): Promise<boolean> {
        const decision = decideSiteRequest({
            requestHostname: (req.hostname ?? "").toLowerCase(),
            appHosts: APP_HOSTS,
            config: await publicSites(),
            deployment: null,
            publishId,
            sitePath: "/",
        });
        return decision.action === "serve";
    }

    const formSubmitRouter = createPublishedFormSubmitRouter({
        submitForm: new SubmitPublishedForm({
            deployments: deploymentRepository,
            users: userRepository,
            projects: projectRepository,
            snapshots: new MongoPreviewSnapshotRepository(),
            submissions: new MongoFormSubmissionRepository(),
            ipHashSalt: resolveFormIpHashSalt(env),
        }),
        isSiteHost,
    });

    return { apiRouter, staticRouter, publicRouter, siteRouter, formSubmitRouter };
}
