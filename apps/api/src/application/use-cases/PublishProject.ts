import { createHash, randomUUID } from "crypto";
import type { SiteDeployment } from "../../domain/entities/SiteDeployment";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { LocalFileStorage } from "../../infra/storage/LocalFileStorage";
import type { PublishHistoryRepository } from "../../domain/repositories/PublishHistoryRepository";

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

    const { html: htmlNoCss, extracted: extractedCss } = extractInlineCss(html);
    html = htmlNoCss;
    const { html: htmlNoJs, extracted: extractedJs } = extractInlineJs(html);
    html = htmlNoJs;

    css = [css.trim(), extractedCss].filter(Boolean).join("\n\n");
    js = [js.trim(), extractedJs].filter(Boolean).join("\n\n");

    if (css.trim()) html = ensureLinkTag(html);
    if (js.trim()) html = ensureScriptTag(html);

    return { html: html.trim(), css: css.trim(), js: js.trim() };
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
}

export class PublishProject {
    constructor(
        private deploymentRepo: SiteDeploymentRepository,
        private snapshotRepo: PreviewSnapshotRepository,
        private storage: LocalFileStorage,
        private historyRepo?: PublishHistoryRepository,
    ) { }

    async execute(input: PublishProjectInput): Promise<SiteDeployment> {
        // 1. Resolve snapshot
        const snapshot = input.snapshotId
            ? await this.snapshotRepo.findById(input.projectId, input.snapshotId)
            : await this.snapshotRepo.getActiveForProject(input.projectId);

        if (!snapshot) {
            throw Object.assign(new Error("No snapshot found to publish"), { statusCode: 404 });
        }

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
            return this.republish(existing, snapshot.id, snapshot.artifacts, input.userId, input.projectId, input.customSlug);
        }

        // 4. Generate publish ID
        const publishId = await generatePublishId(this.deploymentRepo);
        const url = `/p/${publishId}`;

        // 5. Post-process artifacts and inject cache-busting version hash
        const processed = postProcess(snapshot.artifacts);
        const version = computeContentVersion(processed.css, processed.js);
        const html = injectVersionHash(processed.html, version);

        // 6. Write files to /data/www/{publishId}/
        const files: Record<string, string> = { "index.html": html };
        if (processed.css) files["style.css"] = processed.css;
        if (processed.js) files["script.js"] = processed.js;

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
        userId: string,
        projectId: string,
        newCustomSlug?: string,
    ): Promise<SiteDeployment> {
        const processed = postProcess(artifacts);
        const version = computeContentVersion(processed.css, processed.js);
        const html = injectVersionHash(processed.html, version);

        const files: Record<string, string> = { "index.html": html };
        if (processed.css) files["style.css"] = processed.css;
        if (processed.js) files["script.js"] = processed.js;

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
}
