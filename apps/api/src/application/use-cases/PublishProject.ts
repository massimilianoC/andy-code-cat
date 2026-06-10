import { createHash, randomUUID } from "crypto";
import type { SiteDeployment } from "../../domain/entities/SiteDeployment";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { LocalFileStorage } from "../../infra/storage/LocalFileStorage";
import type { PublishHistoryRepository } from "../../domain/repositories/PublishHistoryRepository";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import { assertNoUnresolvedMediaPlaceholders, UnresolvedMediaPlaceholderError } from "../media/assertResolvedMediaPlaceholders";
import { SystemNotifier } from "../services/SystemNotifier";
import { buildPublishedDatasetBindingPackage } from "../datasets/PublishedDatasetBindings";

// ---------------------------------------------------------------------------
// Artifact post-processing (same logic as ExportLayer1Zip, minimal version)
// ---------------------------------------------------------------------------

function extractInlineCss(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    const cleaned = html.replace(/<style(?:[^>]*)>([\s\S]*?)<\/style>/gi, (_match, content: string) => {
        const trimmed = content.trim();
        if (trimmed) blocks.push(trimmed);
        return "";
    });
    return { html: cleaned, extracted: blocks.join("\n\n") };
}

function extractInlineJs(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    const cleaned = html.replace(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi, (_match, content: string) => {
        const trimmed = content.trim();
        if (trimmed) blocks.push(trimmed);
        return "";
    });
    return { html: cleaned, extracted: blocks.join("\n\n") };
}

function stripMetaCsp(html: string): string {
    return html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");
}

function joinUniqueBlocks(...parts: string[]): string {
    const unique: string[] = [];
    const seen = new Set<string>();

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const key = trimmed.replace(/\s+/g, " ").trim();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(trimmed);
    }

    return unique.join("\n\n");
}

function ensureLinkTag(html: string): string {
    if (html.includes('href="style.css"')) return html;
    return html.replace(/<\/head>/i, `  <link rel="stylesheet" href="style.css">\n</head>`);
}

function ensureScriptTag(html: string): string {
    if (html.includes('src="script.js"')) return html;
    return html.replace(/<\/body>/i, `  <script src="script.js"></script>\n</body>`);
}

/**
 * Compute a short (8-char hex) SHA-256 fingerprint of the CSS + JS content.
 * This is injected as a query-string version into the HTML asset references so
 * that browsers fetch fresh assets on every republish without needing to break
 * the published site's stable URL (/p/{publishId}/).
 */
function computeContentVersion(css: string, js: string): string {
    return createHash("sha256").update(css + "\n" + js).digest("hex").slice(0, 8);
}

/**
 * Replace bare style.css / script.js references in the HTML with versioned URLs
 * (e.g. style.css?v=a1b2c3d4). The query string changes whenever content changes,
 * so long-cached CSS/JS is automatically invalidated on republish.
 */
function injectVersionHash(html: string, version: string): string {
    return html
        .replace(/href="style\.css"/g, `href="style.css?v=${version}"`)
        .replace(/src="script\.js"/g, `src="script.js?v=${version}"`);
}

function postProcess(artifacts: { html: string; css: string; js: string }) {
    let { html, css, js } = artifacts;

    html = stripMetaCsp(html);

    const { html: htmlNoCss, extracted: extractedCss } = extractInlineCss(html);
    html = htmlNoCss;
    const { html: htmlNoJs, extracted: extractedJs } = extractInlineJs(html);
    html = htmlNoJs;

    // If the dedicated field is already populated it is the canonical source —
    // the LLM also embeds the same content inline in HTML for iframe preview,
    // so merging would produce duplicate declarations. Fall back to extracted
    // content only when the dedicated field is empty.
    css = css.trim() ? css.trim() : joinUniqueBlocks(extractedCss);
    js = js.trim() ? js.trim() : joinUniqueBlocks(extractedJs);

    if (css.trim()) html = ensureLinkTag(html);
    if (js.trim()) html = ensureScriptTag(html);

    return { html: html.trim(), css: css.trim(), js: js.trim() };
}

/**
 * Inject operator-configured governance HTML fragments and analytics snippets into the
 * published site's HTML. Called after postProcess so injection targets are stable.
 */
function injectGovernanceHtml(
    html: string,
    injections: {
        headHtml?: string;
        headerHtml?: string;
        footerHtml?: string;
        scriptInHead?: string;
        scriptBeforeBodyClose?: string;
        googleTagManagerId?: string;
        googleAnalyticsId?: string;
        matomoSiteId?: string;
        matomoUrl?: string;
    },
): string {
    let out = html;

    // GTM snippet in <head>
    if (injections.googleTagManagerId?.trim()) {
        const gtmId = injections.googleTagManagerId.trim();
        const gtmHead = `<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');</script>\n<!-- End Google Tag Manager -->`;
        out = out.replace(/<\/head>/i, `${gtmHead}\n</head>`);
    }

    // GA4 snippet in <head>
    if (injections.googleAnalyticsId?.trim()) {
        const gaId = injections.googleAnalyticsId.trim();
        const ga4Head = `<!-- Google Analytics -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');</script>\n<!-- End Google Analytics -->`;
        out = out.replace(/<\/head>/i, `${ga4Head}\n</head>`);
    }

    // scriptInHead inline in <head>
    if (injections.scriptInHead?.trim()) {
        out = out.replace(/<\/head>/i, `<script>${injections.scriptInHead.trim()}</script>\n</head>`);
    }

    // headHtml before </head>
    if (injections.headHtml?.trim()) {
        out = out.replace(/<\/head>/i, `${injections.headHtml.trim()}\n</head>`);
    }

    // GTM noscript after <body>
    if (injections.googleTagManagerId?.trim()) {
        const gtmId = injections.googleTagManagerId.trim();
        const gtmBody = `<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n<!-- End Google Tag Manager (noscript) -->`;
        out = out.replace(/<body([^>]*)>/i, `<body$1>\n${gtmBody}`);
    }

    // headerHtml after <body>
    if (injections.headerHtml?.trim()) {
        out = out.replace(/<body([^>]*)>/i, `<body$1>\n${injections.headerHtml.trim()}`);
    }

    // Matomo before </body>
    if (injections.matomoSiteId?.trim() && injections.matomoUrl?.trim()) {
        const siteId = injections.matomoSiteId.trim();
        const trackerUrl = injections.matomoUrl.trim().replace(/\/$/, "");
        const matomo = `<!-- Matomo -->\n<script>var _paq=window._paq=window._paq||[];_paq.push(['trackPageView']);_paq.push(['enableLinkTracking']);(function(){var u='${trackerUrl}/';_paq.push(['setTrackerUrl',u+'matomo.php']);_paq.push(['setSiteId','${siteId}']);var d=document,g=d.createElement('script'),s=d.getElementsByTagName('script')[0];g.async=true;g.src=u+'matomo.js';s.parentNode.insertBefore(g,s);})();</script>\n<!-- End Matomo -->`;
        out = out.replace(/<\/body>/i, `${matomo}\n</body>`);
    }

    // scriptBeforeBodyClose inline before </body>
    if (injections.scriptBeforeBodyClose?.trim()) {
        out = out.replace(/<\/body>/i, `<script>${injections.scriptBeforeBodyClose.trim()}</script>\n</body>`);
    }

    // footerHtml before </body>
    if (injections.footerHtml?.trim()) {
        out = out.replace(/<\/body>/i, `${injections.footerHtml.trim()}\n</body>`);
    }

    return out;
}

// ---------------------------------------------------------------------------
// Short publish-id generator (8 lowercase hex chars from UUID)
// ---------------------------------------------------------------------------

async function generatePublishId(repo: SiteDeploymentRepository, maxRetries = 5): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
        const id = randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
        const taken = await repo.isPublishIdTaken(id);
        if (!taken) return id;
    }
    throw Object.assign(new Error("Failed to generate unique publish ID"), { statusCode: 503 });
}

// ---------------------------------------------------------------------------
// Use-case
// ---------------------------------------------------------------------------

export interface PublishProjectInput {
    projectId: string;
    userId: string;
    snapshotId?: string;
    customSlug?: string;
    /** Preset ID of the project — used to resolve governance injections at publish time. */
    presetId?: string | null;
}

export class PublishProject {
    constructor(
        private deploymentRepo: SiteDeploymentRepository,
        private snapshotRepo: PreviewSnapshotRepository,
        private storage: LocalFileStorage,
        private assetRepository?: ProjectAssetRepository,
        private historyRepo?: PublishHistoryRepository,
        private platformConfigRepo?: PlatformConfigRepository,
    ) { }

    async execute(input: PublishProjectInput): Promise<SiteDeployment> {
        // 1. Resolve snapshot
        const snapshot = input.snapshotId
            ? await this.snapshotRepo.findById(input.projectId, input.snapshotId)
            : await this.snapshotRepo.getActiveForProject(input.projectId);

        if (!snapshot) {
            throw Object.assign(new Error("No snapshot found to publish"), { statusCode: 404 });
        }

        this.assertPublishableMedia(snapshot.artifacts, {
            projectId: input.projectId,
            userId: input.userId,
            snapshotId: snapshot.id,
        });

        // 2. Validate and check uniqueness of customSlug (if provided)
        if (input.customSlug) {
            const taken = await this.deploymentRepo.isCustomSlugTaken(input.customSlug);
            if (taken) {
                throw Object.assign(new Error("This slug is already in use by another deployment"), { statusCode: 409 });
            }
        }

        // 3. Check for existing live deployment — re-publish if exists
        const existing = await this.deploymentRepo.findActiveByProjectId(input.projectId);

        if (existing) {
            return this.republish(existing, snapshot.id, snapshot.artifacts, snapshot.metadata, input.userId, input.projectId, input.customSlug, input.presetId);
        }

        // 4. Generate publish ID
        const publishId = await generatePublishId(this.deploymentRepo);
        const url = `/p/${publishId}`;

        // 5. Post-process artifacts and inject cache-busting version hash
        const processed = postProcess(snapshot.artifacts);
        const version = computeContentVersion(processed.css, processed.js);
        let html = injectVersionHash(processed.html, version);

        // 5b. Apply governance HTML injections (operator-configured per presetId)
        if (this.platformConfigRepo) {
            const platformConfig = await this.platformConfigRepo.get().catch(() => null);
            const govKey = input.presetId ?? "default";
            const injections = platformConfig?.governanceByProduct?.[govKey]?.injections;
            if (injections) {
                html = injectGovernanceHtml(html, injections);
            }
        }

        // 6. Write files to /data/www/{publishId}/
        const files: Record<string, string> = { "index.html": html };
        if (processed.css) files["style.css"] = processed.css;
        if (processed.js) files["script.js"] = processed.js;
        const datasetPackage = this.assetRepository
            ? await buildPublishedDatasetBindingPackage({
                publishId,
                projectId: input.projectId,
                userId: input.userId,
                metadata: snapshot.metadata,
                assetRepository: this.assetRepository,
                storage: this.storage,
            })
            : { files: {}, limitations: [], writtenBindings: [] };
        Object.assign(files, datasetPackage.files);

        const filesDeployed = await this.storage.writePublishFiles(publishId, files);

        // 7. Also write to custom slug dir so {customSlug}.domain.tld is served
        if (input.customSlug) {
            await this.storage.writePublishFiles(input.customSlug, files);
        }

        // 8. Create SiteDeployment record
        const deployment = await this.deploymentRepo.create({
            publishId,
            customSlug: input.customSlug,
            projectId: input.projectId,
            userId: input.userId,
            snapshotId: snapshot.id,
            url,
            filesDeployed,
        });

        // 9. Mark as live
        const live = await this.deploymentRepo.updateStatus(deployment.id, "live", {
            deployedAt: new Date(),
        });

        // 10. Record publish event (non-blocking)
        void this.historyRepo?.record({
            projectId: input.projectId,
            userId: input.userId,
            publishId,
            deploymentId: deployment.id,
            snapshotId: snapshot.id,
            action: "publish",
            publishedAt: new Date(),
        }).catch(() => { /* non-critical */ });

        return live ?? deployment;
    }

    private async republish(
        existing: SiteDeployment,
        snapshotId: string,
        artifacts: { html: string; css: string; js: string },
        metadata: import("../../domain/entities/PreviewSnapshot").PreviewSnapshotMetadata | undefined,
        userId: string,
        projectId: string,
        newCustomSlug?: string,
        presetId?: string | null,
    ): Promise<SiteDeployment> {
        this.assertPublishableMedia(artifacts, { projectId, userId, snapshotId });

        const processed = postProcess(artifacts);
        const version = computeContentVersion(processed.css, processed.js);
        let html = injectVersionHash(processed.html, version);

        // Apply governance HTML injections
        if (this.platformConfigRepo) {
            const platformConfig = await this.platformConfigRepo.get().catch(() => null);
            const govKey = presetId ?? "default";
            const injections = platformConfig?.governanceByProduct?.[govKey]?.injections;
            if (injections) {
                html = injectGovernanceHtml(html, injections);
            }
        }

        const files: Record<string, string> = { "index.html": html };
        if (processed.css) files["style.css"] = processed.css;
        if (processed.js) files["script.js"] = processed.js;
        const datasetPackage = this.assetRepository
            ? await buildPublishedDatasetBindingPackage({
                publishId: existing.publishId,
                projectId,
                userId,
                metadata,
                assetRepository: this.assetRepository,
                storage: this.storage,
            })
            : { files: {}, limitations: [], writtenBindings: [] };
        Object.assign(files, datasetPackage.files);

        const filesDeployed = await this.storage.writePublishFiles(existing.publishId, files);

        // Handle customSlug change: clean up old slug dir, write to new one
        const oldSlug = existing.customSlug;
        const slugChanged = newCustomSlug !== undefined && newCustomSlug !== oldSlug;
        if (slugChanged) {
            if (oldSlug) {
                await this.storage.deletePublishDir(oldSlug).catch(() => { /* best-effort */ });
            }
            if (newCustomSlug) {
                await this.storage.writePublishFiles(newCustomSlug, files);
                await this.deploymentRepo.updateCustomSlug(existing.id, newCustomSlug);
            } else {
                await this.deploymentRepo.updateCustomSlug(existing.id, null);
            }
        } else if (existing.customSlug) {
            // Keep slug directory in sync with republished content
            await this.storage.writePublishFiles(existing.customSlug, files);
        }

        const updated = await this.deploymentRepo.updateStatus(existing.id, "live", {
            snapshotId,
            filesDeployed,
            deployedAt: new Date(),
        });

        // Record republish event (non-blocking)
        void this.historyRepo?.record({
            projectId,
            userId,
            publishId: existing.publishId,
            deploymentId: existing.id,
            snapshotId,
            action: "republish",
            publishedAt: new Date(),
        }).catch(() => { /* non-critical */ });

        return updated ?? existing;
    }

    private assertPublishableMedia(
        artifacts: { html: string; css: string },
        context: { projectId: string; userId: string; snapshotId: string },
    ): void {
        try {
            assertNoUnresolvedMediaPlaceholders(artifacts, {
                operation: "publish",
                ...context,
            });
        } catch (error) {
            if (error instanceof UnresolvedMediaPlaceholderError) {
                SystemNotifier.instance.emit({
                    projectId: context.projectId,
                    userId: context.userId,
                    audience: "both",
                    domain: "publish",
                    severity: "error",
                    title: "Pubblicazione bloccata: media non risolti",
                    message: `Risolvi o rigenera i media prima di pubblicare. Placeholder: ${error.keys.join(", ")}.`,
                    sourceEventType: "publish_blocked_unresolved_media",
                    metadata: {
                        snapshotId: context.snapshotId,
                        unresolvedMediaKeys: error.keys,
                    },
                });
            }
            throw error;
        }
    }
}
