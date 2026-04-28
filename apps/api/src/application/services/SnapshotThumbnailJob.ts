/**
 * SnapshotThumbnailJob — fire-and-forget background job that renders a
 * Puppeteer JPEG screenshot for a preview snapshot and persists it to storage.
 *
 * Design rules:
 *  - Non-blocking: callers fire with `SnapshotThumbnailJob.schedule(...)` and
 *    do NOT await the result.
 *  - Errors are caught and logged; they never propagate to the HTTP response.
 *  - One concurrent job per snapshotId (de-duplicated via `inFlight` set).
 */

import { buildFullDoc, captureHtml } from "../../infra/capture/PuppeteerCaptureService";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import { getFileStorage } from "../../infra/storage/StorageFactory";

const inFlight = new Set<string>();

export class SnapshotThumbnailJob {
    /**
     * Schedule a background Puppeteer screenshot for the given snapshot.
     *
     * The method returns immediately. The thumbnail is generated asynchronously
     * and stored; `previewSnapshotRepository.updateThumbnailPath()` is called
     * when the file has been persisted.
     *
     * @param projectId     - owning project (for storage path and DB update)
     * @param snapshotId    - the snapshot whose artifacts to render
     * @param artifacts     - HTML/CSS/JS source artifacts to render
     * @param repository    - snapshot repository for persisting the stored path
     */
    static schedule(
        projectId: string,
        snapshotId: string,
        artifacts: { html: string; css: string; js: string },
        repository: PreviewSnapshotRepository
    ): void {
        const key = `${projectId}:${snapshotId}`;
        if (inFlight.has(key)) return; // already running for this snapshot
        inFlight.add(key);

        // Intentionally NOT awaited — fire and forget
        SnapshotThumbnailJob.run(projectId, snapshotId, artifacts, repository)
            .catch((err) => {
                console.error(
                    `[SnapshotThumbnailJob] failed for snapshot ${snapshotId}:`,
                    err instanceof Error ? err.message : String(err)
                );
            })
            .finally(() => {
                inFlight.delete(key);
            });
    }

    private static async run(
        projectId: string,
        snapshotId: string,
        artifacts: { html: string; css: string; js: string },
        repository: PreviewSnapshotRepository
    ): Promise<void> {
        const html = buildFullDoc(artifacts.html, artifacts.css, artifacts.js);

        // Render at 1280 × 800 viewport (same as the existing capture service)
        const buffer = await captureHtml(html, "jpg");

        const storage = getFileStorage();
        const storedPath = await storage.saveThumbnailFile(projectId, snapshotId, buffer);

        await repository.updateThumbnailPath(projectId, snapshotId, storedPath);
    }
}
